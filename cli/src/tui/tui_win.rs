//! Bagian TUI yang menyentuh console Windows: sink layar (`CONOUT$`), mode VT,
//! ukuran layar, dan penangkap stdout/stderr (`CreatePipe` + `SetStdHandle`).
//!
//! Dipanggil `tui.rs` lewat nama yang sama dengan versi POSIX (`buka_layar`,
//! `ukuran_layar`, `Tangkap`), jadi jalur kode TUI tetap satu.

use crossterm::terminal;
use std::ffi::c_void;
use std::fs::File;
use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};
use std::ptr::null_mut;
use std::sync::Arc;
use std::thread;

use super::{salurkan, Log};

type Handle = *mut c_void;

const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
const STD_ERROR_HANDLE: u32 = -12i32 as u32;
const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
const HANDLE_FLAG_INHERIT: u32 = 0x0000_0001;
const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;
const CP_UTF8: u32 = 65001;

#[repr(C)]
struct SecurityAttributes {
    length: u32,
    descriptor: *mut c_void,
    inherit: i32,
}

#[repr(C)]
#[derive(Default)]
struct Coord {
    x: i16,
    y: i16,
}

#[repr(C)]
#[derive(Default)]
struct SmallRect {
    left: i16,
    top: i16,
    right: i16,
    bottom: i16,
}

#[repr(C)]
#[derive(Default)]
struct ConsoleScreenBufferInfo {
    size: Coord,
    cursor: Coord,
    attributes: u16,
    window: SmallRect,
    max_window: Coord,
}

// Enam fungsi kernel32. Ditulis langsung supaya tidak menambah dependensi
// (`windows-sys`) hanya untuk ini — pola yang sama dengan `extern "C"` di tui.rs.
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetStdHandle(jenis: u32) -> Handle;
    fn SetStdHandle(jenis: u32, handle: Handle) -> i32;
    fn CreatePipe(baca: *mut Handle, tulis: *mut Handle, sa: *mut SecurityAttributes, ukuran: u32) -> i32;
    fn SetHandleInformation(handle: Handle, mask: u32, tanda: u32) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
    fn GetConsoleMode(handle: Handle, mode: *mut u32) -> i32;
    fn SetConsoleMode(handle: Handle, mode: u32) -> i32;
    fn GetConsoleScreenBufferInfo(handle: Handle, info: *mut ConsoleScreenBufferInfo) -> i32;
    fn SetConsoleOutputCP(cp: u32) -> i32;
}

/// Apakah stdout proses ini console sungguhan (bukan pipe/file/CI).
///
/// Memakai `GetConsoleMode` mentah, bukan `std::io::stdout()`: handle stdout Rust
/// di-cache saat pertama dipakai, dan `Tangkap` harus menggantinya lebih dulu.
pub(crate) fn stdout_terminal() -> bool {
    let mut mode = 0u32;
    unsafe { GetConsoleMode(GetStdHandle(STD_OUTPUT_HANDLE), &mut mode) != 0 }
}

/// Buka layar TUI: `CONOUT$` (console tetap bisa ditulis walau stdout dialihkan),
/// plus UTF-8 dan VT supaya `✔ ✘ ↑ ↓` dan escape crossterm tampil benar.
/// `None` = console tidak mendukung VT → pemanggil jatuh ke menu teks.
pub(super) fn buka_layar() -> Option<File> {
    let layar = File::options().read(true).write(true).open("CONOUT$").ok()?;
    let handle = layar.as_raw_handle() as Handle;
    let mut mode = 0u32;
    unsafe {
        SetConsoleOutputCP(CP_UTF8);
        if GetConsoleMode(handle, &mut mode) == 0 {
            return None;
        }
        if SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) == 0 {
            return None;
        }
    }
    Some(layar)
}

/// Ukuran layar dari handle console; fallback 80x24 kalau bukan console.
pub(super) fn ukuran_layar(layar: &File) -> (u16, u16) {
    let mut info = ConsoleScreenBufferInfo::default();
    let ok = unsafe { GetConsoleScreenBufferInfo(layar.as_raw_handle() as Handle, &mut info) };
    if ok == 0 {
        // ponytail: crossterm::terminal::size() tidak dipakai karena ia membaca
        // handle stdout yang sudah dialihkan ke pipe oleh Tangkap.
        let _ = terminal::size();
        return (80, 24);
    }
    let cols = (info.window.right - info.window.left + 1).max(1) as u16;
    let rows = (info.window.bottom - info.window.top + 1).max(1) as u16;
    (cols, rows)
}

/// Pengalih stdout+stderr ke pipe selama sesi (padanan `Tangkap` POSIX).
pub(super) struct Tangkap {
    asli_out: Handle,
    asli_err: Handle,
    tulis: Handle,
    aktif: bool,
}

impl Tangkap {
    /// Pasang pipe lalu arahkan handle stdout/stderr proses ke ujung tulisnya.
    /// Anak proses (docker/git/curl) mewarisi handle itu, jadi keluarannya masuk log.
    pub(super) fn pasang(log: &Arc<Log>) -> Option<Tangkap> {
        unsafe {
            let asli_out = GetStdHandle(STD_OUTPUT_HANDLE);
            let asli_err = GetStdHandle(STD_ERROR_HANDLE);
            let mut baca: Handle = INVALID_HANDLE_VALUE;
            let mut tulis: Handle = INVALID_HANDLE_VALUE;
            let mut sa = SecurityAttributes {
                length: std::mem::size_of::<SecurityAttributes>() as u32,
                descriptor: null_mut(),
                inherit: 1,
            };
            if CreatePipe(&mut baca, &mut tulis, &mut sa, 0) == 0 {
                return None;
            }
            // Ujung baca tidak boleh diwarisi anak, kalau tidak pipe tidak pernah EOF.
            SetHandleInformation(baca, HANDLE_FLAG_INHERIT, 0);
            if SetStdHandle(STD_OUTPUT_HANDLE, tulis) == 0
                || SetStdHandle(STD_ERROR_HANDLE, tulis) == 0
            {
                CloseHandle(baca);
                CloseHandle(tulis);
                return None;
            }
            let sumber = File::from_raw_handle(baca as RawHandle);
            let log = Arc::clone(log);
            thread::spawn(move || salurkan(sumber, &log));
            Some(Tangkap {
                asli_out,
                asli_err,
                tulis,
                aktif: true,
            })
        }
    }

    /// Untuk unit test: tidak menyentuh handle proses sama sekali.
    #[cfg(test)]
    pub(super) fn uji() -> Tangkap {
        Tangkap {
            asli_out: INVALID_HANDLE_VALUE,
            asli_err: INVALID_HANDLE_VALUE,
            tulis: INVALID_HANDLE_VALUE,
            aktif: false,
        }
    }

    /// Kembalikan stdout+stderr ke handle asli dan tutup ujung tulis (pembaca EOF).
    pub(super) fn lepas(&mut self) {
        if !self.aktif {
            return;
        }
        unsafe {
            SetStdHandle(STD_OUTPUT_HANDLE, self.asli_out);
            SetStdHandle(STD_ERROR_HANDLE, self.asli_err);
            CloseHandle(self.tulis);
        }
        self.aktif = false;
    }
}
