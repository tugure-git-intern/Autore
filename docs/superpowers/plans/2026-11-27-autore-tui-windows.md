# TUI Windows untuk Autore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `autore.exe` di Windows mendapat TUI layar penuh yang sama dengan Linux — menu ↑/↓, panel log live, baris status, dan prompt di dalam layar — dari satu kode yang sama.

**Architecture:** Tiga ketergantungan POSIX di `cli/src/tui.rs` diganti abstraksi kecil per-platform: sink layar (`/dev/tty` ↔ `CONOUT$`), tangkap stdout proses (`dup2` ↔ `CreatePipe` + `SetStdHandle`), dan ukuran terminal (`terminal::size` ↔ `GetConsoleScreenBufferInfo`). Jalur Linux tidak berubah perilaku. Semua kode Windows hidup di satu file baru `cli/src/tui_win.rs` sehingga build Linux tidak menyentuhnya. Kalau setup Windows gagal di mesin pengguna, `Session::start` mengembalikan `None` dan menu teks lama (`text_menu_loop`) tetap jalan — perilaku hari ini, bukan regresi.

**Tech Stack:** Rust 2021, crossterm 0.25, FFI tangan (`extern "system"` + `#[link(name = "kernel32")]`), tanpa crate baru.

**Spec:** dokumen ini (§ Latar belakang & Keputusan).

## Latar belakang

`cli/src/tui.rs` (1.891 baris, 31 unit test) seluruhnya `#[cfg(unix)]`; di Windows file itu jadi dead code sehingga `main.rs:1269` jatuh ke menu `inquire`. Binary Windows sudah diproduksi (`docs/github-actions-ci-release.yml:35,61` → `x86_64-pc-windows-gnu`), jadi yang hilang hanya TUI-nya.

Tiga hal yang membuat TUI Linux bekerja dan tidak portabel apa adanya:

| Kebutuhan | Linux (sekarang) | Windows (rencana) |
|---|---|---|
| Sink layar | `File::open("/dev/tty")` (`tui.rs:558`) | `File::open("CONOUT$")` + aktifkan VT |
| Tangkap output job | `pipe()` + `dup2()` ke fd 1/2 (`tui.rs:402`) | `CreatePipe` + `SetStdHandle` ke handle 1/2 |
| Ukuran layar | `crossterm::terminal::size()` (`tui.rs:663`) | `GetConsoleScreenBufferInfo(CONOUT$)` |

Keyboard tidak berubah: `crossterm::event::poll/read` (`tui.rs:709`) sudah jalan di Windows lewat handle input console, yang tidak kita sentuh.

## Keputusan yang sudah dikunci

1. **Tanpa crate baru.** `windows-sys` tidak ditambah; 6 fungsi kernel32 dideklarasikan tangan seperti pola `extern "C"` yang sudah ada di `tui.rs:45-51`.
2. **Satu jalur kode.** Setelah plan ini, tidak ada lagi `#[cfg(not(unix))] text_menu_loop()` di `main.rs`; fallback hanya lewat `Session::start() == None`.
3. **Kode Windows di file sendiri** (`tui_win.rs`, `#[cfg(windows)] mod tui_win;`) supaya `tui.rs` tetap bisa dibaca dan build Linux tidak berubah.
4. **`SetStdHandle` harus jalan sebelum `std::io::stdout()` pertama kali dipakai.** Rust meng-cache handle stdout saat pertama dipanggil. Karena itu pre-check "apakah stdout console?" di Windows memakai `GetConsoleMode` mentah, bukan `std::io::stdout().is_terminal()`.
5. **UTF-8 dipaksa**: `SetConsoleOutputCP(65001)` karena UI memakai `✔ ✘ ↑ ↓ ─ │`.

## Global Constraints

- Tanpa dependensi baru di `cli/Cargo.toml`.
- 513 test `cargo test` di `cli/` tetap hijau, termasuk 31 test `tui::`.
- Nama fungsi/tipe dan komentar bahasa Indonesia, mengikuti gaya file sekitarnya.
- Windows wajib punya jalan mundur: setup gagal → menu teks.
- Tidak ada perubahan pada server, pipeline, Jenkins, registry, dashboard, atau data rilis.

## Review Focus

Lima hal yang tidak akan tertangkap unit test Linux dan paling mungkin menggigit pemakai:

1. **Ctrl+C saat job jalan** — harus menghentikan job dan keluar dari alt screen dengan terminal bersih, bukan menggantung.
2. **Codepage console** — kalau `SetConsoleOutputCP(65001)` gagal, `✔ ✘ ↑ ↓` jadi mojibake; lebih baik fallback teks daripada layar rusak.
3. **Resize jendela saat job jalan** — `ukuran_layar()` dipanggil tiap frame; jangan panik/out-of-bounds kalau mengecil.
4. **stdout bukan console** (di-redirect ke file, MSYS/Git Bash pipe, CI) — harus jatuh ke menu teks, bukan menggambar escape sequence ke file.
5. **Windows lama / conhost tanpa VT** — `SetConsoleMode(ENABLE_VIRTUAL_TERMINAL_PROCESSING)` gagal → `Session::start` harus `None`, bukan layar penuh `←[2K`.

## File Structure

- **Create** `cli/src/tui_win.rs` — FFI kernel32, sink `CONOUT$`, tangkap `CreatePipe`, ukuran layar, `stdout_terminal()`. Hanya dikompilasi di Windows.
- **Modify** `cli/src/tui.rs` — ganti `tty`, `stdout_asli`, `pipe_to_log`, `terminal::size()` jadi shim per-platform; struct `Tangkap`.
- **Modify** `cli/src/main.rs:1260-1300` — hapus gerbang `cfg(not(unix))`, pakai `tui::stdout_terminal()`.
- **Modify** `cli/README.md` (bagian Windows) — catatan TUI.

---

### Task 1: Ekstrak tangkap stdout jadi `Tangkap` (Linux dulu, perilaku identik)

**Files:**
- Modify: `cli/src/tui.rs` (`pipe_to_log` di :402, `Session` struct, `Session::start` :551, `restore` :589, `sesi_uji` :1641)

**Interfaces:**
- Produces: `struct Tangkap` dengan `fn pasang(log: &Arc<Log>) -> Option<Tangkap>`, `fn lepas(&mut self)`, `fn uji() -> Tangkap` (no-op untuk unit test).
- Produces: `Session.tangkap: Tangkap` menggantikan `Session.stdout_asli: i32`.

- [ ] **Step 1: Tulis test yang gagal** — `restore_tangkap_tidak_mengubah_stdout` di modul test `tui.rs`: buat `Tangkap::uji()`, panggil `lepas()`, lalu `assert!(std::io::stdout().is_terminal(), "stdout tetap terminal setelah tangkap uji dilepas")`.
- [ ] **Step 2: Jalankan** — `cargo test -p autore-cli tui::restore_tangkap -- --nocapture`. Harapan: FAIL, `Tangkap` belum ada.
- [ ] **Step 3: Implementasi** — pindahkan isi `pipe_to_log` + dua `dup2` di `restore` ke `impl Tangkap`; `pasang` mengembalikan `None` kalau `pipe()` gagal (perilaku sekarang: `?`). `sesi_uji` memakai `Tangkap::uji()`.
- [ ] **Step 4: Jalankan** — `cargo test -p autore-cli tui::` → 32 test hijau; `cargo test -p autore-cli` → 513 hijau.
- [ ] **Step 5: Commit** — `git add cli/src/tui.rs && git commit -m "refactor(cli): bungkus tangkap stdout jadi Tangkap"`.

---

### Task 2: Sink layar per-platform (`buka_layar`)

**Files:**
- Modify: `cli/src/tui.rs:551-580`
- Create: `cli/src/tui_win.rs` (stub `pub fn buka_layar() -> Option<File> { None }` dulu)

**Interfaces:**
- Produces: `fn buka_layar() -> Option<File>` — Linux: `OpenOptions::new().read(true).write(true).open("/dev/tty")`; Windows: `tui_win::buka_layar()`.

- [ ] **Step 1: Implementasi** — `Session::start` memanggil `buka_layar()` menggantikan blok `open("/dev/tty")`; tambahkan `#[cfg(windows)] mod tui_win;` di `tui.rs:13` dan stub yang mengembalikan `None`.
- [ ] **Step 2: Verifikasi Linux** — `cargo test -p autore-cli tui::` hijau; jalankan `./target/debug/autore` interaktif, layar TUI tetap muncul.
- [ ] **Step 3: Verifikasi Windows (compile)** — `cargo check -p autore-cli --target x86_64-pc-windows-gnu` (setelah `rustup target add x86_64-pc-windows-gnu`), tanpa warning `unused`.
- [ ] **Step 4: Commit** — `feat(cli): buka_layar() lintas platform`.

---

### Task 3: `tui_win.rs` — VT, ukuran layar, dan tangkap pipe

**Files:**
- Modify: `cli/src/tui_win.rs`
- Modify: `cli/src/tui.rs:663` (`terminal::size()` → `ukuran_layar()`)

**Interfaces:**
- Produces: `pub fn stdout_terminal() -> bool` (Windows: `GetConsoleMode(GetStdHandle(STD_OUTPUT_HANDLE)) != 0`; Linux: `std::io::stdout().is_terminal()`).
- Produces: `pub fn ukuran_layar(layar: &File) -> (u16, u16)` — `GetConsoleScreenBufferInfo` pada handle `layar`; fallback `(80, 24)`.
- Produces: `pub struct Tangkap` (Windows) dengan `pasang`/`lepas`, memakai `CreatePipe` (ujung tulis `SECURITY_ATTRIBUTES.bInheritHandle = TRUE`) lalu `SetStdHandle(STD_OUTPUT_HANDLE/STD_ERROR_HANDLE, ujung_tulis)`; thread pembaca memakai `super::salurkan`.
- Externs yang dideklarasikan: `GetStdHandle`, `SetStdHandle`, `CreatePipe`, `GetConsoleMode`, `SetConsoleMode`, `GetConsoleScreenBufferInfo`, `SetConsoleOutputCP`, `CloseHandle`.

- [ ] **Step 1: Tulis test yang gagal** — di `tui_win.rs`, `ukuran_layar_dari_handle_palsu_tidak_panik`: `ukuran_layar(&File::create(std::env::temp_dir().join("uji-sz")).unwrap()) == (80, 24)`.
- [ ] **Step 2: Jalankan di Linux** — test ini `#[cfg(windows)]` sehingga 0 test; yang diverifikasi hanya `cargo check --target x86_64-pc-windows-gnu` (Step 5).
- [ ] **Step 3: Implementasi** — `buka_layar()`: buka `CONOUT$` read+write, `SetConsoleOutputCP(65001)`, `GetConsoleMode`+`SetConsoleMode(mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING)`; gagal salah satu → `None`. `Tangkap::pasang`: ambil handle asli dulu (`GetStdHandle`), baru `CreatePipe` + `SetStdHandle`. `lepas`: `SetStdHandle` ke handle asli + `CloseHandle` ujung tulis.
- [ ] **Step 4: Implementasi** — `ukuran_layar` dipanggil dari `gambar()` (ganti `terminal::size()`); di Linux tetap `terminal::size()`.
- [ ] **Step 5: Verifikasi** — `cargo test -p autore-cli` (Linux) hijau; `cargo check --target x86_64-pc-windows-gnu` hijau; `cargo clippy --target x86_64-pc-windows-gnu -- -D warnings` hijau.
- [ ] **Step 6: Commit** — `feat(cli): dukungan console Windows untuk TUI`.

---

### Task 4: `main.rs` — satu jalur, hapus gerbang `cfg(not(unix))`

**Files:**
- Modify: `cli/src/main.rs:1259-1300`

**Interfaces:**
- Consumes: `tui::stdout_terminal()`, `tui::Session::start`.

- [ ] **Step 1: Implementasi** — ganti `if !std::io::stdout().is_terminal()` → `if !tui::stdout_terminal()`; hapus blok `#[cfg(not(unix))] { text_menu_loop(...) }` dan `#[cfg(unix)]` pembungkus sesi sehingga jalur TUI tunggal; `text_menu_loop` tetap ada sebagai fallback `None`.
- [ ] **Step 2: Verifikasi Linux** — `cargo test -p autore-cli` 513 hijau; `cargo build --release` lalu jalankan TUI, menu & log normal.
- [ ] **Step 3: Verifikasi Windows (compile)** — `cargo check --target x86_64-pc-windows-gnu` hijau tanpa `dead_code` warning pada `text_menu_loop`.
- [ ] **Step 4: Commit** — `feat(cli): TUI untuk Windows, satu jalur kode`.

---

### Task 5: Build `.exe`, dokumentasi, dan checklist uji manual

**Files:**
- Modify: `cli/README.md` (bagian "Windows")
- Create: `docs/superpowers/plans/2026-11-27-autore-tui-windows.md` (dokumen ini, sudah ada)

- [ ] **Step 1: Build artefak** — `cargo build --release --target x86_64-pc-windows-gnu` (butuh `gcc-mingw-w64-x86-64`; kalau linker tidak ada, cukup `cargo check` dan biarkan GitHub Actions yang build).
- [ ] **Step 2: Dokumentasi** — tambah 5 baris di README: TUI jalan di Linux & Windows; Windows butuh Windows Terminal / cmd Win10+ (VT); fallback menu teks kalau console tidak mendukung.
- [ ] **Step 3: Commit** — `docs(cli): TUI juga di Windows`.

**Checklist uji manual di mesin Windows bos alif** (hasilnya dilaporkan balik, bukan otomatis):

- [ ] `autore.exe` di PowerShell: layar penuh muncul, menu bisa ↑/↓.
- [ ] `autore.exe` di `cmd`: sama.
- [ ] Jalankan job (mis. Doctor / Deploy): log mengalir hidup di panel kanan.
- [ ] Prompt token: isi tidak tampil.
- [ ] `✔` dan `✘` tampil benar (bukan `?` / mojibake).
- [ ] Ctrl+C saat job jalan: job berhenti, terminal kembali normal, prompt balik.
- [ ] Resize jendela saat job jalan: layar tidak rusak.
- [ ] Keluar menu (Esc/q): tidak ada sisa alt screen, teks shell normal.
- [ ] `autore --version > out.txt` (stdout di-redirect): tetap mode teks, tidak ada escape sequence di `out.txt`.
- [ ] Kalau ada yang gagal: screenshot + langkah, lalu Task 6.

---

### Task 6: Jalan mundur kalau Windows gagal (hanya jika Task 5 merah)

**Files:**
- Modify: `cli/src/main.rs` (kembalikan gerbang 4 baris)

- [ ] **Step 1: Implementasi** — tambahkan lagi `#[cfg(windows)] { text_menu_loop(&mut active_project, &mut last_note); return; }` sebelum jalur TUI; `tui_win.rs` dibiarkan (tidak dipakai) atau dihapus.
- [ ] **Step 2: Verifikasi** — `cargo test -p autore-cli` hijau; `cargo check --target x86_64-pc-windows-gnu` hijau.
- [ ] **Step 3: Commit** — `fix(cli): matikan TUI Windows sementara (fallback menu teks)`.

---

## Estimasi & risiko

- Kerja kode: Task 1–4 ≈ 250–300 baris baru di `tui_win.rs` + refactor kecil; satu hari kerja santai.
- Risiko utama: `SetStdHandle` harus mendahului pemakaian `std::io::stdout()` pertama. Sudah dikunci di Keputusan 4 (pre-check pakai `GetConsoleMode`).
- Risiko kedua: VT tidak aktif di console lama → sudah jadi fallback, bukan bug.
- Yang **tidak** bisa saya verifikasi tanpa mesin Windows: perilaku console nyata. Compile + clippy per-target bisa saya buktikan di VPS; runtime butuh Task 5 checklist.
