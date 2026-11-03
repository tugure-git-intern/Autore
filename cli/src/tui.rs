//! TUI layar penuh untuk menu utama Autore (tanpa dependensi baru: crossterm sudah
//! ikut terpasang lewat `inquire`).
//!
//! Alur: `Session::start` mengunci terminal sekali, `Session::pick` mengembalikan index
//! pilihan, `Session::run` menjalankan pekerjaannya sementara layar tetap hidup, dan
//! `Session::close` **selalu** mengembalikan terminal ke mode normal sebelum keluar —
//! supaya perintah yang interaktif (tanya nama project, token, dll.) bisa jalan seperti biasa.

use crossterm::cursor::{Hide, MoveTo, Show};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::style::{Print, ResetColor};
use crossterm::terminal::{self, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::{execute, queue};
use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, Write};
use std::os::fd::FromRawFd;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const CYAN: &str = "\x1b[36m";
const DIM: &str = "\x1b[2m";
/// Subjudul di bawah banner: abu hangat yang lebih gelap dari teks biasa (agak redup).
const SUBTITLE: &str = "\x1b[38;2;122;104;96m";
const REV: &str = "\x1b[7m";
const ORANGE: &str = "\x1b[38;2;217;119;87m";
/// fd keluaran standar (lihat `unistd.h`).
const STDOUT_FILENO: i32 = 1;
const STDERR_FILENO: i32 = 2;

// Tiga syscall yang dipakai untuk menangkap output ke panel kanan. Ditulis langsung
// supaya tidak menambah dependensi (`libc`) hanya untuk ini.
unsafe extern "C" {
    fn pipe(fds: *mut i32) -> i32;
    fn dup(fd: i32) -> i32;
    fn dup2(lama: i32, baru: i32) -> i32;
    fn close(fd: i32) -> i32;
}
/// Lebar maksimum panel kiri (judul menu) — cukup untuk label terpanjang (47 karakter).
const LEFT_W: usize = 49;
/// Tinggi minimum layar supaya banner blok ikut tampil (banner 8 + panel + kotak perintah + status).
const BANNER_MIN_ROWS: usize = 20;
/// Tinggi minimum supaya baris bantuan + baris input perintah (total 4 baris) ikut tampil.
const COMMAND_BLOCK_MIN: usize = 12;

/// Banner blok "AUTORE" — gradasi oranye terakota (#E18A68 -> #B95F42).
/// Dipakai TUI (tengah atas) dan mode teks (`print_ascii_banner`).
pub(crate) const BANNER: [(&str, (u8, u8, u8)); 6] = [
    (
        "  █████╗ ██╗   ██╗████████╗ ██████╗ ██████╗ ███████╗",
        (235, 138, 104),
    ),
    (
        " ██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██╔══██╗██╔════╝",
        (229, 131, 98),
    ),
    (
        " ███████║██║   ██║   ██║   ██║   ██║██████╔╝█████╗  ",
        (223, 125, 92),
    ),
    (
        " ██╔══██║██║   ██║   ██║   ██║   ██║██╔══██╗██╔══╝  ",
        (217, 119, 87),
    ),
    (
        " ██║  ██║╚██████╔╝   ██║   ╚██████╔╝██║  ██║███████╗",
        (204, 108, 77),
    ),
    (
        " ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝",
        (185, 95, 66),
    ),
];

#[derive(Clone, Copy)]
pub struct Item {
    pub label: &'static str,
    pub desc: &'static str,
    pub hints: &'static str,
}

/// Aksi hasil satu tombol. Dipisah dari loop I/O supaya bisa diuji tanpa TTY.
#[derive(Debug, PartialEq)]
enum Outcome {
    Move(usize),
    Run,
    Quit,
    Stay,
}

/// Fokus keyboard: menu kiri, baris input perintah, atau command palette (Ctrl+K).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
enum Focus {
    #[default]
    Menu,
    Input,
    Palette,
}

/// Fokus + teks input. `selected` selalu index ke daftar yang sedang tampil
/// (menu penuh, atau hasil filter saat palette terbuka).
#[derive(Debug, Default)]
struct Ui {
    selected: usize,
    focus: Focus,
    input: String,
}

/// Hasil satu tombol untuk seluruh fokus. `Run` memakai index item asli (bukan index tampilan).
#[derive(Debug, PartialEq)]
enum Act {
    Stay,
    Run(usize),
    Quit,
}

/// Tombol yang dicatat input saat fokus di menu/input/palette.
fn outcome_for(key: KeyEvent, selected: usize, max_index: usize) -> Outcome {
    match key.code {
        KeyCode::Up => Outcome::Move(selected.saturating_sub(1)),
        KeyCode::Down => Outcome::Move((selected + 1).min(max_index)),
        KeyCode::Home => Outcome::Move(0),
        KeyCode::End => Outcome::Move(max_index),
        KeyCode::Enter => Outcome::Run,
        KeyCode::Esc => Outcome::Quit,
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => Outcome::Quit,
        KeyCode::Char('q') if key.modifiers.is_empty() => Outcome::Quit,
        // Ctrl+J datang sebagai Char('j') ber-modifier CONTROL — jangan dianggap navigasi.
        KeyCode::Char('k') if key.modifiers.is_empty() => Outcome::Move(selected.saturating_sub(1)),
        KeyCode::Char('j') if key.modifiers.is_empty() => {
            Outcome::Move((selected + 1).min(max_index))
        }
        _ => Outcome::Stay,
    }
}

/// Index item yang lolos filter (cocok sebagian, abaikan besar-kecil huruf).
/// Filter kosong = semua item, jadi menu biasa dan command palette pakai jalur yang sama.
fn visible_indices(items: &[Item], query: &str) -> Vec<usize> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return (0..items.len()).collect();
    }
    items
        .iter()
        .enumerate()
        .filter(|(_, it)| it.label.to_lowercase().contains(&q))
        .map(|(i, _)| i)
        .collect()
}

/// Huruf biasa saat fokus di menu: pindah fokus ke baris input dan simpan hurufnya.
fn is_typing(key: &KeyEvent) -> bool {
    matches!(key.code, KeyCode::Char(c) if key.modifiers.is_empty() && !c.is_control())
        || key.modifiers.contains(KeyModifiers::ALT)
}

/// Satu tombol -> satu aksi. Tidak menyentuh terminal, jadi bisa diuji langsung.
fn handle_key(ui: &mut Ui, key: KeyEvent, items: &[Item]) -> Act {
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    if ctrl && matches!(key.code, KeyCode::Char('k')) {
        // Ctrl+K: buka command palette, isinya perintah yang sama dengan menu kiri.
        ui.focus = Focus::Palette;
        ui.selected = 0;
        return Act::Stay;
    }

    match ui.focus {
        Focus::Menu => {
            match outcome_for(key, ui.selected, items.len().saturating_sub(1)) {
                Outcome::Move(i) => ui.selected = i,
                Outcome::Run => return Act::Run(ui.selected),
                Outcome::Quit => return Act::Quit,
                // Tombol biasa (bukan q/j/k/panah/Enter/Esc) = user mulai mengetik.
                Outcome::Stay => {
                    if is_typing(&key) {
                        ui.focus = Focus::Input;
                        if let KeyCode::Char(c) = key.code {
                            ui.input.push(c);
                        }
                    }
                }
            }
        }
        Focus::Input => match key.code {
            KeyCode::Esc => ui.focus = Focus::Menu,
            KeyCode::Backspace => {
                ui.input.pop();
            }
            KeyCode::Enter => return run_from_input(ui, items),
            KeyCode::Char(c) if key.modifiers.is_empty() && !c.is_control() => ui.input.push(c),
            _ => {}
        },
        // Palette: ketikan menyaring daftar, sama persis dengan menu kiri saat filter kosong.
        Focus::Palette => match key.code {
            KeyCode::Esc => ui.focus = Focus::Menu,
            KeyCode::Backspace => {
                ui.input.pop();
                ui.selected = 0;
            }
            KeyCode::Char(c) if key.modifiers.is_empty() && !c.is_control() => {
                ui.input.push(c);
                ui.selected = 0;
            }
            KeyCode::Up => ui.selected = ui.selected.saturating_sub(1),
            KeyCode::Down => ui.selected = ui.selected.saturating_add(1),
            KeyCode::Enter => {
                let visible = visible_indices(items, &ui.input);
                if let Some(&idx) = visible.get(ui.selected) {
                    return Act::Run(idx);
                }
            }
            _ => {}
        },
    }
    let visible = visible_indices(items, &ui.input);
    ui.selected = ui.selected.min(visible.len().saturating_sub(1));
    Act::Stay
}

/// Enter di baris input: jalankan perintah yang cocok dengan yang diketik.
fn run_from_input(ui: &mut Ui, items: &[Item]) -> Act {
    match visible_indices(items, &ui.input).first() {
        Some(&idx) => Act::Run(idx),
        None => Act::Stay,
    }
}

/// Item yang ikut digambar: menu penuh, atau hasil filter saat palette terbuka.
fn view_items(items: &[Item], ui: &Ui) -> Vec<Item> {
    visible_indices(items, &ui.input)
        .into_iter()
        .map(|i| items[i])
        .collect()
}

/// Tulis satu frame ke layar. Dipisah agar bisa diuji tanpa TTY (mis. ke Vec<u8>).
///
/// Sengaja TIDAK memakai `Clear(FromCursorDown)`: mengosongkan sekujur layar lalu
/// menggambarnya ulang bikin layar kedip. Tiap baris dibersihkan sendiri
/// (`Clear(CurrentLine)`) sebelum ditulis, jadi sisa teks lama tetap terhapus rapi.
fn paint<W: Write>(out: &mut W, screen: &str) -> io::Result<()> {
    let mut buf: Vec<u8> = Vec::with_capacity(screen.len() + 64);
    queue!(buf, MoveTo(0, 0))?;
    for (i, baris) in screen.split("\r\n").enumerate() {
        if i > 0 {
            buf.extend_from_slice(b"\r\n");
        }
        queue!(buf, Clear(ClearType::CurrentLine), Print(baris))?;
    }
    out.write_all(&buf)?;
    out.flush()
}

// ── Sesi TUI: menu kiri + log proses kanan, tanpa keluar layar ───────────────
//
// Terminal dipegang selama sesi. fd 1 & 2 dialihkan ke pipe, jadi output perintah
// (println kita maupun proses anak seperti docker/git/trivy) tertangkap dan tampil
// di panel kanan. Menggambar langsung ke /dev/tty, bukan lewat stdout.

/// Batas baris log yang disimpan (yang lama dibuang).
const LOG_MAX: usize = 2000;
/// Jeda antar frame saat menunggu (juga batas latensi lihat log baru).
const TICK: Duration = Duration::from_millis(120);

/// Pertanyaan alur kerja ke UI; dijawab lewat baris input bawah, bukan pop-up.
enum Ask {
    Text {
        label: String,
        secret: bool,
    },
    Choose {
        label: String,
        options: Vec<String>,
        start: usize,
    },
}

/// Jawaban satu pertanyaan. `Cancel` = Esc; pemanggil yang menentukan artinya.
#[derive(Debug)]
enum Answer {
    Text(String),
    Index(usize),
    Cancel,
}

struct Question {
    ask: Ask,
    reply: Sender<Answer>,
}

/// Kanal pertanyaan sesi aktif (diisi `Session::start`, dibaca `ask_*` dari thread mana pun).
static HUB: OnceLock<Sender<Question>> = OnceLock::new();

/// Sesi TUI hidup? Kalau tidak, alur interaktif jatuh ke `inquire` (mode dipipe).
pub fn hub_active() -> bool {
    HUB.get().is_some()
}

fn tanya(ask: Ask) -> Option<Answer> {
    let (tx, rx) = channel();
    HUB.get()?.send(Question { ask, reply: tx }).ok()?;
    rx.recv().ok()
}

/// Tanya teks di baris input; kosong = pakai `default`. `None` = dibatalkan.
pub fn ask_text(label: &str, default: &str) -> Option<String> {
    let ask = Ask::Text {
        label: label.to_string(),
        secret: false,
    };
    match tanya(ask)? {
        Answer::Text(t) if t.trim().is_empty() => Some(default.to_string()),
        Answer::Text(t) => Some(t.trim().to_string()),
        _ => None,
    }
}

/// Tanya rahasia (token/password) — isi tidak ditampilkan di layar.
pub fn ask_secret(label: &str) -> Option<String> {
    let ask = Ask::Text {
        label: label.to_string(),
        secret: true,
    };
    match tanya(ask)? {
        Answer::Text(t) => Some(t),
        _ => None,
    }
}

/// Pilih satu dari daftar lewat ↑/↓ di baris input.
pub fn ask_choice(label: &str, options: &[String]) -> Option<usize> {
    let ask = Ask::Choose {
        label: label.to_string(),
        options: options.to_vec(),
        start: 0,
    };
    match tanya(ask)? {
        Answer::Index(i) => Some(i),
        _ => None,
    }
}

/// Konfirmasi ya/tidak; pilihan awal mengikuti `default_ya`.
pub fn ask_yes_no(label: &str, default_ya: bool) -> Option<bool> {
    let ask = Ask::Choose {
        label: label.to_string(),
        options: vec!["Ya".to_string(), "Tidak".to_string()],
        start: usize::from(!default_ya),
    };
    match tanya(ask)? {
        Answer::Index(i) => Some(i == 0),
        _ => None,
    }
}

/// Buf log panel kanan (diisi thread pembaca pipe).
#[derive(Default)]
struct Log {
    buf: Mutex<VecDeque<String>>,
}

impl Log {
    fn push(&self, line: String) {
        // ponytail: lock beracun (panic di thread lain) tidak boleh ikut membunuh UI.
        let mut b = self.buf.lock().unwrap_or_else(|e| e.into_inner());
        if b.len() >= LOG_MAX {
            b.pop_front();
        }
        b.push_back(line);
    }

    fn semua(&self) -> Vec<String> {
        let b = self.buf.lock().unwrap_or_else(|e| e.into_inner());
        b.iter().cloned().collect()
    }
}

/// Alihkan stdout+stderr ke pipe yang isinya masuk log. `None` = gagal (tanpa pipe).
/// Mengembalikan fd stdout asli untuk dipulihkan saat sesi selesai.
fn pipe_to_log(log: &Arc<Log>) -> Option<i32> {
    let mut fd = [0i32; 2];
    if unsafe { pipe(fd.as_mut_ptr()) } != 0 {
        return None;
    }
    let (baca, tulis) = (fd[0], fd[1]);
    let asli = unsafe { dup(STDOUT_FILENO) };
    let ok =
        unsafe { dup2(tulis, STDOUT_FILENO) } >= 0 && unsafe { dup2(tulis, STDERR_FILENO) } >= 0;
    unsafe { close(tulis) };
    if !ok || asli < 0 {
        return None;
    }
    let log = Arc::clone(log);
    thread::spawn(move || salurkan(unsafe { File::from_raw_fd(baca) }, &log));
    Some(asli)
}

/// Baca sampai EOF, pecah per baris, masukkan ke log. Sisa tanpa `\n` ikut masuk di akhir.
fn salurkan<R: io::Read>(mut sumber: R, log: &Log) {
    let mut buf = [0u8; 8192];
    let mut sisa = String::new();
    while let Ok(n) = sumber.read(&mut buf) {
        if n == 0 {
            break;
        }
        sisa.push_str(&String::from_utf8_lossy(&buf[..n]));
        while let Some(pos) = sisa.find('\n') {
            let baris: String = sisa.drain(..=pos).collect();
            log.push(buang_kendali(baris.trim_end_matches(['\n', '\r'])));
        }
    }
    if !sisa.trim().is_empty() {
        log.push(buang_kendali(sisa.trim_end()));
    }
}

/// Buang karakter kendali yang bisa merusak layout; urutan ANSI (warna) dibiarkan.
fn buang_kendali(baris: &str) -> String {
    baris
        .chars()
        .filter(|c| *c == '\t' || *c == '\x1b' || !c.is_control())
        .collect()
}

/// Satu pertanyaan yang sedang menunggu jawaban.
struct Pending {
    label: String,
    secret: bool,
    options: Vec<String>,
    sel: usize,
    input: String,
    reply: Sender<Answer>,
}

impl Pending {
    fn baru(q: Question) -> Pending {
        let (label, secret, options, sel) = match q.ask {
            Ask::Text { label, secret } => (label, secret, Vec::new(), 0),
            Ask::Choose {
                label,
                options,
                start,
            } => (label, false, options, start),
        };
        Pending {
            label,
            secret,
            options,
            sel,
            input: String::new(),
            reply: q.reply,
        }
    }

    /// Satu tombol -> jawaban (kalau pertanyaan sudah selesai dijawab).
    fn key(&mut self, key: KeyEvent) -> Option<Answer> {
        if self.options.is_empty() {
            match key.code {
                KeyCode::Esc => Some(Answer::Cancel),
                KeyCode::Enter => Some(Answer::Text(std::mem::take(&mut self.input))),
                KeyCode::Backspace => {
                    self.input.pop();
                    None
                }
                KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    self.input.clear();
                    None
                }
                KeyCode::Char(c) if key.modifiers.is_empty() && !c.is_control() => {
                    self.input.push(c);
                    None
                }
                _ => None,
            }
        } else {
            let akhir = self.options.len() - 1;
            match key.code {
                KeyCode::Esc => Some(Answer::Cancel),
                KeyCode::Enter => Some(Answer::Index(self.sel.min(akhir))),
                KeyCode::Up => {
                    self.sel = self.sel.saturating_sub(1);
                    None
                }
                KeyCode::Down => {
                    self.sel = (self.sel + 1).min(akhir);
                    None
                }
                _ => None,
            }
        }
    }

    /// Teks yang tampil di baris input (rahasia = bintang).
    fn tampil(&self) -> String {
        if !self.options.is_empty() {
            return self.options[self.sel.min(self.options.len() - 1)].clone();
        }
        if self.secret {
            "*".repeat(self.input.chars().count())
        } else {
            self.input.clone()
        }
    }
}

/// Sesi TUI penuh: menu, log, pertanyaan, status — satu layar, tidak pernah keluar.
pub struct Session {
    tty: File,
    items: &'static [Item],
    ui: Ui,
    pending: Option<Pending>,
    log: Arc<Log>,
    status: String,
    project: Option<String>,
    rx: Receiver<Question>,
    stdout_asli: i32,
    /// Baris digeser dari bawah di panel log (0 = selalu ikut baris terbaru).
    scroll: usize,
    /// Frame terakhir yang sudah digambar — frame identik tidak ditulis ulang (kedip).
    frame: String,
}

impl Session {
    /// Mulai sesi: raw mode + alternate screen + tangkap stdout/stderr ke panel kanan.
    pub fn start(items: &'static [Item], project: Option<String>) -> Option<Session> {
        let tty = File::options()
            .read(true)
            .write(true)
            .open("/dev/tty")
            .ok()?;
        let (tx, rx) = channel();
        let log = Arc::new(Log::default());
        let stdout_asli = pipe_to_log(&log)?;
        let _ = HUB.set(tx);
        terminal::enable_raw_mode().ok()?;
        let mut sesi = Session {
            tty,
            items,
            ui: Ui::default(),
            pending: None,
            log,
            status: "siap".to_string(),
            project,
            rx,
            stdout_asli,
            scroll: 0,
            frame: String::new(),
        };
        if execute!(sesi.tty, EnterAlternateScreen, Hide).is_err() {
            sesi.restore();
            return None;
        }
        Some(sesi)
    }

    /// Tutup sesi: balikkan layar, raw mode, dan fd stdout/stderr ke aslinya.
    pub fn close(mut self) {
        self.restore();
    }

    fn restore(&mut self) {
        let _ = execute!(self.tty, ResetColor, LeaveAlternateScreen, Show);
        let _ = terminal::disable_raw_mode();
        unsafe {
            dup2(self.stdout_asli, STDOUT_FILENO);
            dup2(self.stdout_asli, STDERR_FILENO);
            close(self.stdout_asli);
        }
    }

    /// Status yang tampil di segmen tengah baris bawah (mis. "jalan: Deploy", "siap").
    pub fn set_status(&mut self, status: impl Into<String>) {
        self.status = status.into();
    }

    /// Project aktif yang tampil di segmen kiri baris bawah.
    pub fn set_project(&mut self, project: Option<String>) {
        self.project = project;
    }

    /// Tunggu user memilih menu. `None` = keluar (q/Esc/Ctrl-C).
    pub fn pick(&mut self) -> Option<usize> {
        if self.items.is_empty() {
            return None;
        }
        loop {
            self.tick();
            let Some(key) = self.next_key(TICK) else {
                continue;
            };
            if self.pending.is_some() {
                self.jawab(key);
                continue;
            }
            if self.gulir(key) {
                continue;
            }
            match handle_key(&mut self.ui, key, self.items) {
                Act::Run(i) => return Some(i),
                Act::Quit => return None,
                Act::Stay => {}
            }
        }
    }

    /// Jalankan pekerjaan di thread lain; UI tetap hidup — log jalan, pertanyaan dilayani.
    pub fn run(&mut self, label: &str, job: impl FnOnce() -> i32 + Send + 'static) -> i32 {
        self.set_status(format!("jalan: {label}"));
        let kerja = thread::spawn(job);
        while !kerja.is_finished() {
            self.tick();
            if let Some(key) = self.next_key(TICK) {
                self.jawab(key);
            }
        }
        let kode = kerja.join().unwrap_or(1);
        let tanda = if kode == 0 { "✔" } else { "✘" };
        self.log
            .push(format!("{tanda} {label} — selesai (kode {kode})"));
        self.scroll = 0;
        kode
    }

    /// Satu putaran UI: layani pertanyaan yang datang, lalu gambar ulang layar.
    fn tick(&mut self) {
        while let Ok(q) = self.rx.try_recv() {
            self.pending = Some(Pending::baru(q));
            self.ui.focus = Focus::Input;
        }
        self.gambar();
    }

    fn gambar(&mut self) {
        let (cols, rows) = terminal::size().unwrap_or((80, 24));
        let log = self.log.semua();
        let ask = self.pending.as_ref().map(|p| AskView {
            label: p.label.clone(),
            tampil: p.tampil(),
            pilihan: !p.options.is_empty(),
        });
        let view = View {
            items: &view_items(self.items, &self.ui),
            ui: &self.ui,
            project: self.project.as_deref(),
            status: &self.status,
            log: &log,
            ask,
            scroll: self.scroll,
        };
        let layar = render(&view, cols, rows);
        if layar == self.frame {
            return;
        }
        if paint(&mut self.tty, &layar).is_ok() {
            self.frame = layar;
        }
    }

    /// Tombol gulir panel log. `true` = sudah dipakai (jangan diteruskan ke menu).
    fn gulir(&mut self, key: KeyEvent) -> bool {
        let maks = self.log.semua().len();
        match key.code {
            KeyCode::PageUp => {
                self.scroll = (self.scroll + 5).min(maks);
                true
            }
            KeyCode::PageDown => {
                self.scroll = self.scroll.saturating_sub(5);
                true
            }
            KeyCode::End => {
                self.scroll = 0;
                true
            }
            _ => false,
        }
    }

    fn next_key(&mut self, timeout: Duration) -> Option<KeyEvent> {
        if !event::poll(timeout).unwrap_or(false) {
            return None;
        }
        match event::read() {
            Ok(Event::Key(k)) => Some(k),
            _ => None,
        }
    }

    /// Jawab pertanyaan yang sedang menunggu; Enter kirim, Esc batal.
    fn jawab(&mut self, key: KeyEvent) {
        let Some(p) = self.pending.as_mut() else {
            return;
        };
        if let Some(ans) = p.key(key) {
            let p = self.pending.take().expect("pertanyaan masih ada");
            let _ = p.reply.send(ans);
            self.ui.focus = Focus::Menu;
        }
    }
}

/// Potong log jadi baris pas lebar panel: bungkus yang panjang, ambil `n` baris terakhir.
fn log_lines(log: &[String], width: usize, n: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for l in log {
        out.extend(wrap(l, width.max(8)));
    }
    let mulai = out.len().saturating_sub(n);
    out.split_off(mulai)
}

/// Pertanyaan yang tampil di baris input (label + isi + jenis).
struct AskView {
    label: String,
    tampil: String,
    pilihan: bool,
}

/// Semua yang perlu digambar satu frame — `render` sendiri murni (tanpa I/O).
struct View<'a> {
    items: &'a [Item],
    ui: &'a Ui,
    project: Option<&'a str>,
    status: &'a str,
    /// Baris log panel kanan (kosong = panel kanan jadi penjelasan menu).
    log: &'a [String],
    ask: Option<AskView>,
    /// Baris digeser dari bawah di panel log.
    scroll: usize,
}

fn render(v: &View, cols: u16, rows: u16) -> String {
    let items = v.items;
    let ui = v.ui;
    let selected = ui.selected.min(items.len().saturating_sub(1));
    let cols = (cols as usize).max(20);
    let rows = (rows as usize).max(6);
    let left_w = LEFT_W.min(cols.saturating_sub(22)).max(12);
    let right_w = cols.saturating_sub(left_w + 5);
    let mut lines: Vec<String> = Vec::with_capacity(rows);

    // Banner AUTORE di tengah atas + subjudul (hanya kalau layar cukup tinggi).
    if rows >= BANNER_MIN_ROWS {
        for (row, (r, g, b)) in BANNER {
            lines.push(center(&format!("\x1b[38;2;{r};{g};{b}m{row}{RESET}"), cols));
        }
        lines.push(center(
            &format!("{SUBTITLE}Powered by Tugu Reasuransi Indonesia{RESET}"),
            cols,
        ));
        lines.push(blank_row(cols));
    }

    // Sisa tinggi dibagi: panel menu/penjelasan, baris bantuan + input, baris status.
    let cmd_block = if rows >= COMMAND_BLOCK_MIN { 4 } else { 0 };
    let avail = rows.saturating_sub(lines.len() + cmd_block + 1);
    let body_h = avail.saturating_sub(2);
    // Panel kanan: log proses begitu ada output, kalau belum tetap penjelasan menu.
    let right_inner = right_w.saturating_sub(2);
    let detail: Vec<String> = if v.log.is_empty() {
        match items.get(selected) {
            Some(it) => detail_lines(it, right_inner),
            None => Vec::new(),
        }
    } else {
        let semua = log_lines(v.log, right_inner, LOG_MAX);
        let akhir = semua.len().saturating_sub(v.scroll);
        let mulai = akhir.saturating_sub(body_h);
        semua[mulai..akhir].to_vec()
    };

    // Kepala panel: ┌──┬──┐
    lines.push(format!(
        "┌{}┬{}┐",
        "─".repeat(left_w),
        "─".repeat(right_w + 2)
    ));

    for i in 0..body_h {
        let label = match items.get(i) {
            Some(it) => format!("{} {}", if i == selected { "▸" } else { " " }, it.label),
            None if i == 0 && items.is_empty() => {
                format!("  {DIM}(tidak ada perintah cocok){RESET}")
            }
            None => String::new(),
        };
        let left_cell = if i == selected {
            let padded = pad_plain(&label, left_w.saturating_sub(1));
            format!("{REV} {padded}{RESET}")
        } else {
            format!(" {}", pad_plain(&label, left_w.saturating_sub(1)))
        };
        let right_cell = pad_plain(detail.get(i).map(|s| s.as_str()).unwrap_or(""), right_w);
        lines.push(format!("│{left_cell}│ {right_cell} │"));
    }

    lines.push(format!(
        "└{}┴{}┘",
        "─".repeat(left_w),
        "─".repeat(right_w + 2)
    ));

    // Baris bantuan (tetap) + baris input perintah, tepat di atas baris status.
    if cmd_block == 4 {
        let inner = cols.saturating_sub(2);
        // Pertanyaan aktif menumpang baris ini: tanpa pop-up, layar tidak pernah hilang.
        let (bantuan, isi) = match &v.ask {
            Some(a) => (
                format!(
                    "{ORANGE}{BOLD}? {}{RESET}{DIM}  •  Enter kirim  •  Esc batal{RESET}",
                    a.label
                ),
                a.tampil.clone(),
            ),
            None => {
                let palette = if ui.focus == Focus::Palette {
                    format!("{CYAN}[command palette]{RESET}  ")
                } else {
                    String::new()
                };
                (
                    format!("{palette}{DIM}↑/↓ geser  •  Enter jalankan  •  q keluar{RESET}"),
                    ui.input.clone(),
                )
            }
        };
        let bantuan = match &v.ask {
            Some(a) if a.pilihan => bantuan.replace(
                "Enter kirim  •  Esc batal",
                "↑/↓ pilih  •  Enter kirim  •  Esc batal",
            ),
            _ => bantuan,
        };
        lines.push(pad_plain(&format!("  {bantuan}"), cols));

        let border = if ui.focus == Focus::Menu && v.ask.is_none() {
            ""
        } else {
            CYAN
        };
        lines.push(format!("{border}┌{}┐{RESET}", "─".repeat(inner)));
        if isi.is_empty() && v.ask.is_none() {
            lines.push(format!(
                "{border}│{RESET}{}│{RESET}",
                pad_plain(
                    &format!("{CYAN}>{RESET} {DIM}Type a command... (Ctrl+K for menu){RESET}"),
                    inner
                )
            ));
        } else {
            let kursor = if ui.focus == Focus::Menu && v.ask.is_none() {
                ""
            } else {
                "\x1b[7m \x1b[0m"
            };
            lines.push(format!(
                "{border}│{RESET}{}│{RESET}",
                pad_plain(&format!("{CYAN}>{RESET} {isi}{kursor}"), inner)
            ));
        }
        lines.push(format!("{border}└{}┘{RESET}", "─".repeat(inner)));
    }

    lines.push(status_bar(cols, v.project, Some(v.status)));
    debug_assert_eq!(lines.len(), rows, "tinggi layar harus pas {rows} baris");
    lines.join("\r\n")
}

/// Pendekkan teks ke `w` kolom dengan elipsis, supaya status tidak terpotong di tengah kata.
fn ringkas(teks: &str, w: usize) -> String {
    if visible_len(teks) <= w {
        return teks.to_string();
    }
    let mut out: String = teks.chars().take(w.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Baris kosong selebar layar (agar layar penuh benar-benar tertutup).
fn blank_row(cols: usize) -> String {
    " ".repeat(cols)
}

/// Teks di tengah, di-pad pas selebar `cols`; kode ANSI tidak ikut dihitung.
fn center(text: &str, cols: usize) -> String {
    let w = visible_len(text);
    if w >= cols {
        return pad_plain(text, cols);
    }
    let left = (cols - w) / 2;
    format!(
        "{}{}{}",
        " ".repeat(left),
        text,
        " ".repeat(cols - w - left)
    )
}

/// Baris status 3 segmen: lokasi project (biru), aksi terakhir (hijau/merah), versi.
fn status_bar(cols: usize, project: Option<&str>, status: Option<&str>) -> String {
    let status = status.unwrap_or("siap");
    // Blok warna hanya selebar teksnya; sisanya spasi biasa (tanpa background).
    let kanan = ringkas(
        &format!("autore v{}", env!("CARGO_PKG_VERSION")),
        cols.saturating_sub(2).max(1),
    );
    let w_kanan = visible_len(&kanan);
    let kiri = ringkas(
        project.unwrap_or("(belum ada project)"),
        cols.saturating_sub(w_kanan + 2).max(1),
    );
    let w_kiri = visible_len(&kiri);
    let mulai_kanan = cols.saturating_sub(w_kanan);
    // Batas lebar teks tengah supaya tetap bisa duduk di tengah tanpa menimpa blok tepi.
    let batas = cols
        .saturating_sub(2 * (w_kiri + 1))
        .min(cols.saturating_sub(2 * (w_kanan + 1)))
        .min(cols.saturating_sub(w_kiri + w_kanan + 2));
    let tengah = ringkas(status, batas.max(3));
    let w_tengah = visible_len(&tengah);
    let mulai_tengah = (cols.saturating_sub(w_tengah)) / 2;
    let (bg_t, fg_t) = if status.starts_with('✘') {
        ("\x1b[41m", "\x1b[97m")
    } else {
        ("\x1b[42m", "\x1b[30m")
    };

    let mut out = String::new();
    // `kolom` = posisi kursor (kolom) yang sudah ditulis; dipakai untuk menyisipkan spasi.
    let mut kolom = w_kiri;
    let geser = |out: &mut String, kolom: &mut usize, target: usize| {
        if target > *kolom {
            out.push_str(&" ".repeat(target - *kolom));
            *kolom = target;
        }
    };

    // Kiri: nempel tepi kiri, teks rata kiri.
    out.push_str(&format!("\x1b[44m\x1b[97m{kiri}\x1b[0m"));

    // Tengah: di tengah layar — hanya kalau masih ada ruang tanpa menimpa blok tepi.
    if mulai_tengah >= kolom && mulai_tengah + w_tengah <= mulai_kanan {
        geser(&mut out, &mut kolom, mulai_tengah);
        out.push_str(&format!("{bg_t}{fg_t}{tengah}\x1b[0m"));
        kolom = mulai_tengah + w_tengah;
    }

    // Kanan: nempel tepi kanan, teks rata kanan — hanya kalau belum tertimpa.
    if mulai_kanan >= kolom {
        geser(&mut out, &mut kolom, mulai_kanan);
        out.push_str(&format!("\x1b[47m\x1b[30m{kanan}\x1b[0m"));
        kolom = cols;
    }
    geser(&mut out, &mut kolom, cols);
    out
}

fn detail_lines(item: &Item, width: usize) -> Vec<String> {
    let mut out = vec![format!("{BOLD}{}{RESET}", item.label), String::new()];
    out.extend(wrap(item.desc, width));
    if !item.hints.is_empty() {
        out.push(String::new());
        for l in wrap(item.hints, width) {
            out.push(format!("{DIM}{l}{RESET}"));
        }
    }
    out
}

fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(8);
    let mut out = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        if line.is_empty() {
            line.push_str(word);
        } else if visible_len(&line) + 1 + visible_len(word) <= width {
            line.push(' ');
            line.push_str(word);
        } else {
            out.push(std::mem::take(&mut line));
            line.push_str(word);
        }
    }
    if !line.is_empty() {
        out.push(line);
    }
    out
}

/// Panjang teks tanpa kode ANSI.
fn visible_len(s: &str) -> usize {
    let mut len = 0usize;
    let mut in_esc = false;
    for c in s.chars() {
        if in_esc {
            if c.is_ascii_alphabetic() {
                in_esc = false;
            }
            continue;
        }
        if c == '\x1b' {
            in_esc = true;
            continue;
        }
        len += 1;
    }
    len
}

/// Potong lalu tambahkan spasi sampai lebar `w` kolom (aman untuk karakter lebar 1).
fn pad_plain(s: &str, w: usize) -> String {
    let mut trimmed = String::new();
    let mut count = 0usize;
    let mut in_esc = false;
    for c in s.chars() {
        if in_esc {
            trimmed.push(c);
            if c.is_ascii_alphabetic() {
                in_esc = false;
            }
            continue;
        }
        if c == '\x1b' {
            in_esc = true;
            trimmed.push(c);
            continue;
        }
        if count >= w {
            continue;
        }
        count += 1;
        trimmed.push(c);
    }
    let filler = w.saturating_sub(visible_len(&trimmed));
    if visible_len(&trimmed) < w {
        format!("{trimmed}{}{RESET}", " ".repeat(filler))
    } else {
        format!("{trimmed}{RESET}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Gambar satu frame dengan item disaring sesuai isi baris input di `ui`.
    fn layar(
        items: &[Item],
        ui: &Ui,
        ask: Option<AskView>,
        log: &[String],
        cols: u16,
        rows: u16,
    ) -> String {
        let v = View {
            items: &view_items(items, ui),
            ui,
            project: None,
            status: "siap",
            log,
            ask,
            scroll: 0,
        };
        render(&v, cols, rows)
    }

    /// Gambar layar lewat jalur menu biasa (fokus di menu kiri, input kosong, tanpa log).
    fn draw(
        items: &[Item],
        selected: usize,
        project: Option<&str>,
        status: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> String {
        let ui = Ui {
            selected,
            focus: Focus::Menu,
            input: String::new(),
        };
        let v = View {
            items,
            ui: &ui,
            project,
            status: status.unwrap_or("siap"),
            log: &[],
            ask: None,
            scroll: 0,
        };
        render(&v, cols, rows)
    }

    fn sample() -> Vec<Item> {
        vec![
            Item {
                label: "Mulai Project Baru (1-Klik)",
                desc: "Alur otomatis: tulis Dockerfile, buat repo GitHub, push, daftar ke Jenkins, trigger build.",
                hints: "Butuh token GitHub + akses Jenkins.",
            },
            Item {
                label: "Hapus Project",
                desc: "Menghapus folder project dari disk.",
                hints: "",
            },
        ]
    }

    /// Setiap baris harus pas selebar terminal & jumlah baris tidak melebihi tinggi —
    /// kalau lebih, layar ikut ter-scroll dan tampilan TUI rusak.
    #[test]
    fn layout_fills_exact_width_and_height() {
        for (cols, rows) in [(80u16, 24u16), (120, 40), (60, 18), (200, 50)] {
            let screen = draw(
                &sample(),
                1,
                Some("/home/user/project"),
                Some("✔ terakhir: Doctor"),
                cols,
                rows,
            );
            let lines: Vec<&str> = screen.split("\r\n").collect();
            assert_eq!(lines.len(), rows as usize, "tinggi beda di {cols}x{rows}");
            for (i, line) in lines.iter().enumerate() {
                let w = visible_len(line);
                assert_eq!(w, cols as usize, "baris {i} lebar {w}, harus {cols}");
            }
        }
    }

    #[test]
    fn highlight_uses_reverse_video_only_on_selected_row() {
        let screen = draw(&sample(), 0, None, None, 80, 12);
        let rows: Vec<&str> = screen.split("\r\n").collect();
        let marked: Vec<usize> = rows
            .iter()
            .enumerate()
            .filter(|(_, l)| l.contains(REV))
            .map(|(i, _)| i)
            .collect();
        assert_eq!(marked.len(), 1, "harus ada tepat satu baris tersorot");
        assert!(rows[marked[0]].contains("Mulai Project Baru"));
    }

    #[test]
    fn ansi_codes_do_not_break_width_math() {
        assert_eq!(visible_len(&format!("{BOLD}abc{RESET}")), 3);
        assert_eq!(visible_len(&pad_plain("abc", 6)), 6);
        assert_eq!(visible_len(&pad_plain("abcdefgh", 4)), 4);
    }

    fn tap(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::empty())
    }

    #[test]
    fn navigasi_berhenti_di_ujung_dan_tombol_asing_diabaikan() {
        let last = 8;
        assert_eq!(outcome_for(tap(KeyCode::Up), 0, last), Outcome::Move(0));
        assert_eq!(
            outcome_for(tap(KeyCode::Down), last, last),
            Outcome::Move(last)
        );
        assert_eq!(outcome_for(tap(KeyCode::Down), 3, last), Outcome::Move(4));
        assert_eq!(outcome_for(tap(KeyCode::Up), 3, last), Outcome::Move(2));
        assert_eq!(outcome_for(tap(KeyCode::Home), 5, last), Outcome::Move(0));
        assert_eq!(outcome_for(tap(KeyCode::End), 1, last), Outcome::Move(last));
        assert_eq!(
            outcome_for(tap(KeyCode::Char('j')), 0, last),
            Outcome::Move(1)
        );
        assert_eq!(
            outcome_for(tap(KeyCode::Char('k')), 2, last),
            Outcome::Move(1)
        );
        assert_eq!(outcome_for(tap(KeyCode::F(5)), 3, last), Outcome::Stay);
        // Ctrl+J (baris baru di mode raw) tidak boleh menggeser menu.
        assert_eq!(
            outcome_for(
                KeyEvent::new(KeyCode::Char('j'), KeyModifiers::CONTROL),
                3,
                last
            ),
            Outcome::Stay
        );
    }

    #[test]
    fn enter_jalankan_dan_q_esc_ctrl_c_keluar() {
        assert_eq!(outcome_for(tap(KeyCode::Enter), 2, 8), Outcome::Run);
        assert_eq!(outcome_for(tap(KeyCode::Esc), 2, 8), Outcome::Quit);
        assert_eq!(outcome_for(tap(KeyCode::Char('q')), 2, 8), Outcome::Quit);
        assert_eq!(
            outcome_for(
                KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL),
                2,
                8
            ),
            Outcome::Quit
        );
    }

    #[test]
    fn baris_status_kuat_untuk_semua_kombinasi_project_dan_catatan() {
        for (project, last) in [
            (None, None),
            (Some("qlinic"), None),
            (None, Some("✔ terakhir: Cek Kesehatan Sistem (Doctor)")),
            (Some("qlinic"), Some("✘ terakhir: Hapus Project (kode 1)")),
        ] {
            let screen = draw(&sample(), 0, project, last, 110, 14);
            assert_eq!(screen.split("\r\n").count(), 14);
            let tail = screen.split("\r\n").last().unwrap();
            assert_eq!(visible_len(tail), 110);
            assert!(tail.contains("autore v"), "versi harus tampil: {tail}");
            match project {
                Some(p) => assert!(tail.contains(p), "nama project harus tampil: {tail}"),
                None => assert!(tail.contains("(belum ada project)"), "{tail}"),
            }
        }
        // Segmen tengah ikut berubah warna: hijau saat siap/sukses, merah saat gagal.
        let ok = draw(&sample(), 0, None, None, 100, 20);
        assert!(ok.split("\r\n").last().unwrap().contains("\x1b[42m"));
        let fail = draw(
            &sample(),
            0,
            None,
            Some("✘ terakhir: Doctor (kode 1)"),
            100,
            20,
        );
        assert!(fail.split("\r\n").last().unwrap().contains("\x1b[41m"));
        // Terminal sempit: tetap satu baris pas lebar, isi boleh terpotong.
        let narrow = draw(&sample(), 0, Some("qlinic"), Some("catatan"), 30, 8);
        let tail = narrow.split("\r\n").last().unwrap();
        assert_eq!(visible_len(tail), 30);
    }

    #[test]
    fn banner_autore_tampil_di_tengah_atas() {
        let screen = draw(&sample(), 0, None, None, 100, 30);
        let rows: Vec<&str> = screen.split("\r\n").collect();
        // Enam baris banner paling atas, semua pas selebar layar dan benar-benar di tengah.
        for (i, row) in rows[..6].iter().enumerate() {
            let text = BANNER[i].0;
            let (r, g, b) = BANNER[i].1;
            let prefix = format!("\x1b[38;2;{r};{g};{b}m");
            let left = row.find(&prefix).expect("kode warna banner hilang");
            let right = 100 - visible_len(text) - left;
            assert!(
                left.abs_diff(right) <= 1,
                "banner tidak di tengah (kiri {left}, kanan {right})"
            );
            assert_eq!(visible_len(row), 100);
        }
        assert!(rows[6].contains("Powered by Tugu Reasuransi Indonesia"));
        // Layar tinggi tapi sempit: banner lebih lebar dari layar, tetap satu baris penuh.
        let narrow = draw(&sample(), 0, None, None, 30, 22);
        for row in narrow.split("\r\n") {
            assert_eq!(visible_len(row), 30);
        }
        // Kotak perintah muncul di atas baris status, plus panduan tombol.
        assert!(rows.iter().any(|r| r.contains("Enter jalankan")));
        assert!(rows.last().unwrap().contains("autore v"));
    }

    #[test]
    fn layar_pendek_turun_tanpa_banner_dan_tanpa_kotak_perintah() {
        let screen = draw(&sample(), 0, None, None, 80, 10);
        let rows: Vec<&str> = screen.split("\r\n").collect();
        assert_eq!(rows.len(), 10);
        assert!(
            !screen.contains('█'),
            "banner harus dilewati di layar pendek"
        );
        assert!(
            !screen.contains("Enter jalankan"),
            "kotak perintah dilewati"
        );
        assert!(rows.last().unwrap().contains("autore v"));
        for row in &rows {
            assert_eq!(visible_len(row), 80);
        }
    }

    #[test]
    fn terminal_kecil_tidak_panic_dan_nama_item_panjang_dipotong() {
        let mut items = sample();
        items.push(Item {
            label: "Scan Keamanan Kode (Static + Gitleaks + Trivy + Semgrep + Detekt)",
            desc: "Menjalankan pemeriksaan keamanan menyeluruh pada source code.",
            hints: "Butuh Docker untuk Trivy.",
        });
        let screen = draw(
            &items,
            items.len() - 1,
            Some("/tmp/x"),
            Some("catatan"),
            24,
            6,
        );
        assert_eq!(screen.split("\r\n").count(), 6);
        for line in screen.split("\r\n") {
            assert_eq!(visible_len(line), 24);
        }
        // Layar pendek: baris bantuan + input dilewati, status tetap baris terakhir.
        let short = draw(&items, 0, None, None, 60, 11);
        assert!(!short.contains("Type a command..."));
        assert!(short.split("\r\n").last().unwrap().contains("autore v"));
    }

    #[test]
    fn tombol_di_menu_geser_jalankan_dan_keluar() {
        let items = sample();
        let mut ui = Ui::default();
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Down), &items), Act::Stay);
        assert_eq!(ui.selected, 1);
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Up), &items), Act::Stay);
        assert_eq!(ui.selected, 0);
        assert_eq!(
            handle_key(&mut ui, tap(KeyCode::Enter), &items),
            Act::Run(0)
        );
        assert_eq!(
            handle_key(&mut ui, tap(KeyCode::Char('q')), &items),
            Act::Quit
        );
        assert_eq!(
            handle_key(
                &mut ui,
                KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL),
                &items
            ),
            Act::Quit
        );
        // Esc saat fokus di menu = keluar (perilaku lama, tidak berubah).
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Esc), &items), Act::Quit);
    }

    #[test]
    fn tombol_asing_saat_input_dan_palette_diabaikan() {
        let items = sample();
        let mut ui = Ui {
            selected: 0,
            focus: Focus::Input,
            input: "scan".into(),
        };
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Up), &items), Act::Stay);
        assert_eq!(ui.input, "scan");
        // Palette: panah naik/turun menggerakkan sorotan, backspace menyaring ulang.
        ui.focus = Focus::Palette;
        ui.input = "a".into();
        handle_key(&mut ui, tap(KeyCode::Down), &items);
        assert_eq!(ui.selected, 1);
        handle_key(&mut ui, tap(KeyCode::Up), &items);
        assert_eq!(ui.selected, 0);
        handle_key(&mut ui, tap(KeyCode::Backspace), &items);
        assert_eq!(ui.input, "");
        assert_eq!(ui.selected, 0);
        assert_eq!(handle_key(&mut ui, tap(KeyCode::F(5)), &items), Act::Stay);
        // Filter kosong hasil ketikan yang tidak cocok: Enter tidak menjalankan apa pun.
        ui.input = "zzz".into();
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Enter), &items), Act::Stay);
    }

    #[test]
    fn baris_input_tampil_di_atas_status_dan_placeholder_muncul() {
        let ui = Ui::default();
        let screen = layar(&sample(), &ui, None, &[], 100, 24);
        let rows: Vec<&str> = screen.split("\r\n").collect();
        let input_row = rows
            .iter()
            .position(|r| r.contains("Type a command... (Ctrl+K for menu)"))
            .expect("baris input perintah harus ada");
        let help_row = rows
            .iter()
            .position(|r| r.contains("Enter jalankan"))
            .expect("baris bantuan harus ada");
        assert_eq!(help_row, input_row - 2, "bantuan tepat di atas kotak input");
        assert!(rows[input_row].contains('>'), "harus diawali '>'");
        // Kotak input menempel di atas status bar; status bar tetap baris terakhir.
        assert_eq!(
            input_row + 2,
            rows.len() - 1,
            "tidak ada celah sebelum status bar"
        );
        assert!(rows.last().unwrap().contains("autore v"));
        for row in &rows {
            assert_eq!(visible_len(row), 100);
        }
        // Fokus di menu: border kotak input tidak berwarna.
        assert!(!rows[input_row - 1].contains(CYAN));
    }

    #[test]
    fn mengetik_memindahkan_fokus_ke_baris_input_dan_esc_kembali_ke_menu() {
        let items = sample();
        let mut ui = Ui::default();
        assert_eq!(
            handle_key(&mut ui, tap(KeyCode::Char('s')), &items),
            Act::Stay
        );
        assert_eq!(ui.focus, Focus::Input);
        assert_eq!(ui.input, "s");
        for c in "can".chars() {
            handle_key(&mut ui, tap(KeyCode::Char(c)), &items);
        }
        assert_eq!(ui.input, "scan");
        // Esc mengembalikan fokus ke menu, teks tetap ada.
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Esc), &items), Act::Stay);
        assert_eq!(ui.focus, Focus::Menu);
        assert_eq!(ui.input, "scan");
        // Backspace hanya jalan saat input fokus.
        assert_eq!(
            handle_key(&mut ui, tap(KeyCode::Backspace), &items),
            Act::Stay
        );
        assert_eq!(ui.input, "scan");
        ui.focus = Focus::Input;
        handle_key(&mut ui, tap(KeyCode::Backspace), &items);
        assert_eq!(ui.input, "sca");
    }

    #[test]
    fn ctrl_k_buka_palette_yang_menyaring_perintah_menu() {
        let items = sample();
        let mut ui = Ui::default();
        let ctrl_k = KeyEvent::new(KeyCode::Char('k'), KeyModifiers::CONTROL);
        assert_eq!(handle_key(&mut ui, ctrl_k, &items), Act::Stay);
        assert_eq!(ui.focus, Focus::Palette);
        // Filter kosong = semua perintah menu kiri.
        assert_eq!(visible_indices(&items, ""), vec![0, 1]);
        // Ketik "hapus" -> hanya item "Hapus Project" yang lolos, Enter menjalankan index asli 1.
        for c in "hapus".chars() {
            handle_key(&mut ui, tap(KeyCode::Char(c)), &items);
        }
        assert_eq!(visible_indices(&items, &ui.input), vec![1]);
        assert_eq!(
            handle_key(&mut ui, tap(KeyCode::Enter), &items),
            Act::Run(1)
        );
        // Esc dari palette juga kembali ke menu, bukan keluar.
        let mut ui2 = Ui::default();
        handle_key(&mut ui2, ctrl_k, &items);
        assert_eq!(handle_key(&mut ui2, tap(KeyCode::Esc), &items), Act::Stay);
        assert_eq!(ui2.focus, Focus::Menu);
    }

    #[test]
    fn enter_di_input_menjalankan_perintah_yang_cocok() {
        let items = sample();
        let mut ui = Ui {
            selected: 0,
            focus: Focus::Input,
            input: "mulai".into(),
        };
        assert_eq!(
            handle_key(&mut ui, tap(KeyCode::Enter), &items),
            Act::Run(0)
        );
        // Kata yang tidak cocok: tidak menjalankan apa pun.
        ui.input = "zzz".into();
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Enter), &items), Act::Stay);
        // Palette tanpa hasil: layar tetap penuh lebar & tidak panic.
        let screen = layar(&[], &ui, None, &[], 80, 24);
        assert!(screen.contains("(tidak ada perintah cocok)"));
        for row in screen.split("\r\n") {
            assert_eq!(visible_len(row), 80);
        }
    }

    /// Pertanyaan teks: ketik, backspace, Ctrl+U, Enter kirim, Esc batal.
    #[test]
    fn pertanyaan_teks_dijawab_dari_baris_input() {
        let (tx, _rx) = channel();
        let mut q = Pending::baru(Question {
            ask: Ask::Text {
                label: "Nama aplikasi".into(),
                secret: false,
            },
            reply: tx,
        });
        for c in "ab".chars() {
            assert!(q.key(tap(KeyCode::Char(c))).is_none());
        }
        assert_eq!(q.tampil(), "ab");
        q.key(tap(KeyCode::Backspace));
        assert_eq!(q.tampil(), "a");
        q.key(tap(KeyCode::Char('b')));
        q.key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
        assert_eq!(q.tampil(), "");
        q.key(tap(KeyCode::Char('x')));
        assert!(matches!(q.key(tap(KeyCode::Enter)), Some(Answer::Text(t)) if t == "x"));
        assert!(matches!(q.key(tap(KeyCode::Esc)), Some(Answer::Cancel)));
    }

    /// Pertanyaan rahasia: isi disamarkan bintang, isi asli tetap dikirim.
    #[test]
    fn pertanyaan_rahasia_menyamarkan_isi() {
        let (tx, _rx) = channel();
        let mut q = Pending::baru(Question {
            ask: Ask::Text {
                label: "Token GitHub".into(),
                secret: true,
            },
            reply: tx,
        });
        for c in "token-rahasia".chars() {
            q.key(tap(KeyCode::Char(c)));
        }
        assert_eq!(q.tampil(), "*".repeat("token-rahasia".chars().count()));
        assert!(!q.tampil().contains("token-rahasia"));
        assert!(
            matches!(q.key(tap(KeyCode::Enter)), Some(Answer::Text(t)) if t == "token-rahasia")
        );
    }

    /// Pertanyaan pilihan: ↑/↓ geser, mentok di batas, Enter kirim index.
    #[test]
    fn pertanyaan_pilihan_geser_dan_berhenti_di_batas() {
        let (tx, _rx) = channel();
        let opsi = vec!["Ya".to_string(), "Tidak".to_string()];
        let mut q = Pending::baru(Question {
            ask: Ask::Choose {
                label: "Selesai — lanjut?".into(),
                options: opsi,
                start: 1,
            },
            reply: tx,
        });
        assert_eq!(q.tampil(), "Tidak", "pilihan awal ikut default");
        q.key(tap(KeyCode::Down));
        assert_eq!(q.tampil(), "Tidak", "tidak lewat batas bawah");
        q.key(tap(KeyCode::Up));
        assert_eq!(q.tampil(), "Ya");
        q.key(tap(KeyCode::Up));
        assert_eq!(q.tampil(), "Ya", "tidak lewat batas atas");
        assert!(matches!(q.key(tap(KeyCode::Enter)), Some(Answer::Index(0))));
    }

    /// Tanpa sesi TUI (`hub_active()` false) semua pertanyaan mengembalikan None, bukan panic.
    #[test]
    fn tanya_tanpa_sesi_menyerah_rapi() {
        assert!(!hub_active());
        assert_eq!(ask_text("Nama aplikasi", "web-app"), None);
        assert_eq!(ask_secret("Token GitHub"), None);
        assert_eq!(ask_choice("Pilih project", &["a".to_string()]), None);
        assert_eq!(ask_yes_no("Yakin hapus?", false), None);
    }

    /// Log panjang dibungkus pas lebar panel dan hanya `n` baris terakhir yang dipakai.
    #[test]
    fn log_dibungkus_dan_dipotong_dari_bawah() {
        let log = vec![
            format!("{} akhir", "x".repeat(30)),
            "baris pendek".to_string(),
        ];
        let out = log_lines(&log, 20, 3);
        assert_eq!(out.len(), 3, "2 baris terbungkus -> 3 baris, semua muat");
        assert_eq!(out[out.len() - 1], "baris pendek");
        let potong = log_lines(&log, 20, 1);
        assert_eq!(potong, vec!["baris pendek".to_string()]);

        // Panel kanan menampilkan log, bukan lagi penjelasan menu, begitu ada output.
        let items = sample();
        let ui = Ui::default();
        let screen = layar(
            &items,
            &ui,
            None,
            &["halo dari docker".to_string()],
            100,
            24,
        );
        assert!(screen.contains("halo dari docker"));
        assert!(
            !screen.contains("Menghapus folder project"),
            "penjelasan menu digantikan log"
        );
        for row in screen.split("\r\n") {
            assert_eq!(visible_len(row), 100);
        }
    }

    /// Pertanyaan yang sedang menunggu tampil di baris input — bukan pop-up di tengah layar.
    #[test]
    fn pertanyaan_tampil_di_baris_input_bukan_popup() {
        let items = sample();
        let ui = Ui::default();
        let ask = AskView {
            label: "Token GitHub".into(),
            tampil: "*".repeat(5),
            pilihan: false,
        };
        let screen = layar(&items, &ui, Some(ask), &[], 100, 24);
        let rows: Vec<&str> = screen.split("\r\n").collect();
        let tanya = rows
            .iter()
            .position(|r| r.contains("? Token GitHub") && r.contains("Enter kirim"))
            .expect("baris pertanyaan harus ada");
        assert!(rows[tanya + 2].contains("*****"), "jawaban di baris input");
        assert_eq!(visible_len(rows.last().unwrap()), 100);
        assert!(rows.last().unwrap().contains("autore v"));
        assert!(
            screen.contains("Mulai Project Baru"),
            "menu kiri tetap utuh"
        );
    }

    /// Sesi tanpa TTY: layar ditulis ke file sementara, supaya alur run/tanya/gulir bisa dites.
    fn sesi_uji(nama: &str) -> (Session, PathBuf, Sender<Question>) {
        static MENU_UJI: [Item; 2] = [
            Item {
                label: "Mulai Project Baru (1-Klik)",
                desc: "Alur otomatis.",
                hints: "",
            },
            Item {
                label: "Cek Kesehatan Sistem (Doctor)",
                desc: "Memeriksa Git, Docker.",
                hints: "",
            },
        ];
        let layar =
            std::env::temp_dir().join(format!("autore-layar-{}-{nama}", std::process::id()));
        let (tx, rx) = channel();
        let sesi = Session {
            tty: File::create(&layar).expect("file layar uji"),
            items: &MENU_UJI,
            ui: Ui::default(),
            pending: None,
            log: Arc::new(Log::default()),
            status: "siap".to_string(),
            project: None,
            rx,
            stdout_asli: -1,
            scroll: 0,
            frame: String::new(),
        };
        (sesi, layar, tx)
    }

    /// Pembaca pipe: per baris, CRLF dibuang, karakter kendali dibuang, sisa akhir ikut.
    #[test]
    fn salurkan_memecah_baris_dan_membuang_kendali() {
        let log = Log::default();
        salurkan(&b"satu\r\ndua\x07\n\x1b[32mhijau\x1b[0m\nsisa"[..], &log);
        assert_eq!(
            log.semua(),
            vec!["satu", "dua", "\x1b[32mhijau\x1b[0m", "sisa"]
        );
        let kosong = Log::default();
        salurkan(&b"  \n"[..], &kosong);
        assert_eq!(kosong.semua(), vec!["  "]);
    }

    /// Log dibatasi LOG_MAX baris: yang paling lama dibuang duluan.
    #[test]
    fn log_membuang_baris_terlama_saat_penuh() {
        let log = Log::default();
        for i in 0..LOG_MAX + 3 {
            log.push(i.to_string());
        }
        let isi = log.semua();
        assert_eq!(isi.len(), LOG_MAX);
        assert_eq!(isi[0], "3");
    }

    /// `run` menunggu pekerjaan selesai sambil menggambar, lalu menulis baris hasil ke log.
    #[test]
    fn run_menjalankan_pekerjaan_dan_mencatat_hasil() {
        let (mut sesi, _layar, _tx) = sesi_uji("run");
        let log = Arc::clone(&sesi.log);
        let kode = sesi.run("Doctor", move || {
            log.push("cek git ok".to_string());
            0
        });
        assert_eq!(kode, 0);
        assert_eq!(sesi.status, "jalan: Doctor");
        assert_eq!(sesi.run("Gagal", || 3), 3);
        let isi = sesi.log.semua();
        assert!(isi.contains(&"cek git ok".to_string()));
        assert!(isi.iter().any(|l| l.starts_with("✔ Doctor")));
        assert!(isi
            .iter()
            .any(|l| l.starts_with("✘ Gagal") && l.contains("kode 3")));

        sesi.set_status("✘ terakhir: Gagal");
        sesi.set_project(Some("/tmp/demo".to_string()));
        sesi.gambar();
        let layar = std::fs::read_to_string(&_layar).unwrap();
        assert!(layar.contains("/tmp/demo") && layar.contains("cek git ok"));
    }

    /// Pertanyaan masuk lewat kanal, fokus pindah ke input, Enter mengirim jawaban balik.
    #[test]
    fn pertanyaan_dari_kanal_dijawab_lewat_sesi() {
        let (mut sesi, _layar, tx) = sesi_uji("tanya");
        let (balas, terima) = channel();
        tx.send(Question {
            ask: Ask::Text {
                label: "Nama project".into(),
                secret: false,
            },
            reply: balas,
        })
        .unwrap();
        sesi.tick();
        assert!(sesi.pending.is_some());
        assert_eq!(sesi.ui.focus, Focus::Input);
        for c in "demo".chars() {
            sesi.jawab(tap(KeyCode::Char(c)));
        }
        sesi.jawab(tap(KeyCode::Enter));
        assert!(matches!(terima.recv().unwrap(), Answer::Text(t) if t == "demo"));
        assert!(sesi.pending.is_none());
        assert_eq!(sesi.ui.focus, Focus::Menu);
        sesi.jawab(tap(KeyCode::Enter)); // tanpa pertanyaan: diabaikan
    }

    /// PgUp/PgDn/End menggulir log; tombol lain diteruskan ke menu.
    #[test]
    fn gulir_log_dibatasi_jumlah_baris() {
        let (mut sesi, _layar, _tx) = sesi_uji("gulir");
        for i in 0..8 {
            sesi.log.push(format!("baris {i}"));
        }
        assert!(sesi.gulir(tap(KeyCode::PageUp)));
        assert_eq!(sesi.scroll, 5);
        assert!(sesi.gulir(tap(KeyCode::PageUp)));
        assert_eq!(sesi.scroll, 8, "tidak lewat jumlah baris");
        sesi.gambar();
        assert!(sesi.gulir(tap(KeyCode::PageDown)));
        assert_eq!(sesi.scroll, 3);
        assert!(sesi.gulir(tap(KeyCode::End)));
        assert_eq!(sesi.scroll, 0);
        assert!(!sesi.gulir(tap(KeyCode::Down)));
    }

    /// Pertanyaan pilihan tampil dengan petunjuk ↑/↓ di baris bantuan.
    #[test]
    fn pertanyaan_pilihan_menampilkan_petunjuk_geser() {
        let items = sample();
        let ui = Ui::default();
        let ask = AskView {
            label: "Yakin hapus?".into(),
            tampil: "Tidak".into(),
            pilihan: true,
        };
        let screen = layar(&items, &ui, Some(ask), &[], 100, 24);
        assert!(screen.contains("↑/↓ pilih  •  Enter kirim"));
        assert!(screen.contains("Tidak"));
    }

    /// Status panjang dipendekkan dengan elipsis, tidak memotong lebar layar.
    #[test]
    fn status_panjang_diringkas() {
        assert_eq!(ringkas("siap", 10), "siap");
        assert_eq!(ringkas("jalan: Mulai Project Baru", 10), "jalan: Mu…");
    }

    /// Tulis frame: tanpa clear sekujur layar (sumber kedip), tiap baris dibersihkan sendiri.
    #[test]
    fn paint_tidak_mengosongkan_layar_penuh() {
        let mut out: Vec<u8> = Vec::new();
        paint(&mut out, "a\r\nbb").unwrap();
        let teks = String::from_utf8(out).unwrap();
        assert!(teks.starts_with("\x1b[1;1H"), "mulai dari pojok kiri atas");
        assert!(!teks.contains("\x1b[J"), "tidak mengosongkan sekujur layar");
        let bersih = "\x1b[2K"; // Clear(CurrentLine) crossterm
        assert_eq!(
            teks.matches(bersih).count(),
            2,
            "tiap baris dibersihkan sendiri"
        );
    }

    /// Frame identik tidak ditulis ulang — layar tidak kedip saat tidak ada perubahan.
    #[test]
    fn frame_identik_tidak_ditulis_ulang() {
        let (mut sesi, _layar, _tx) = sesi_uji("frame");
        let ukuran = |s: &Session| s.tty.metadata().map(|m| m.len()).unwrap_or(0);
        sesi.gambar();
        let sekali = ukuran(&sesi);
        assert!(sekali > 0);
        sesi.tick();
        assert_eq!(
            ukuran(&sesi),
            sekali,
            "gambar ulang tanpa perubahan harus dilewati"
        );
        sesi.log.push("halo".to_string());
        sesi.tick();
        assert!(ukuran(&sesi) > sekali, "perubahan log tetap digambar");
    }

    /// Baris status: biru nempel kiri, hijau di tengah layar, putih nempel kanan —
    /// tiap blok warna hanya selebar teksnya (tidak menuh-menuhin layar).
    #[test]
    fn status_blok_warna_selebar_teksnya() {
        let layar = draw(&sample(), 0, Some("qlinic"), Some("siap"), 100, 20);
        let baris = layar.split("\r\n").last().unwrap();
        assert_eq!(visible_len(baris), 100);
        assert!(
            baris.starts_with("\x1b[44m\x1b[97mqlinic\x1b[0m"),
            "biru rata kiri: {baris}"
        );
        // Hijau di tengah layar: mulai kolom (100 - 4) / 2 = 48.
        let kolom = |teks: &str| visible_len(&baris[..baris.find(teks).expect(teks)]);
        assert_eq!(kolom("siap"), 48);
        assert_eq!(
            kolom("autore v"),
            100 - visible_len(&format!("autore v{}", env!("CARGO_PKG_VERSION")))
        );
        // Tidak ada blok yang memakai background sampai ujung kanan selain blok versi.
        assert_eq!(baris.matches("\x1b[44m").count(), 1);
        assert_eq!(baris.matches("\x1b[42m").count(), 1);
        assert_eq!(baris.matches("\x1b[47m").count(), 1);

        // Status panjang tetap tampil di tengah (dipendekkan), tidak hilang.
        let panjang = "✘ terakhir: Cek Kesehatan Sistem (Doctor) (keluar dengan kode 1)";
        let layar = draw(
            &sample(),
            0,
            Some("/home/mectov/Autore"),
            Some(panjang),
            100,
            20,
        );
        let baris = layar.split("\r\n").last().unwrap();
        assert_eq!(visible_len(baris), 100);
        assert!(baris.contains("\x1b[41m"), "blok tengah tetap ada: {baris}");
        let mulai = visible_len(&baris[..baris.find("\x1b[41m").unwrap()]);
        // Pusat blok tengah harus dekat pusat layar (kolom 50).
        let isi = &baris[baris.find("\x1b[41m").unwrap() + "\x1b[41m".len()..];
        let lebar_blok = visible_len(&isi[..isi.find("\x1b[0m").unwrap()]);
        let tengah_blok = mulai + lebar_blok / 2;
        assert!(
            (tengah_blok as i32 - 50).abs() <= 2,
            "blok tengah duduk di tengah layar (tengah {tengah_blok})"
        );
        assert!(
            visible_len(baris) - visible_len(&format!("autore v{}", env!("CARGO_PKG_VERSION")))
                > 40
        );

        // Terminal sempit: blok tengah/kanan yang tidak muat dilewati, baris tetap pas lebar.
        for cols in [20usize, 27, 33, 42] {
            let layar = draw(
                &sample(),
                0,
                Some("project-panjang"),
                Some("jalan: Deploy"),
                cols as u16,
                20,
            );
            let baris = layar.split("\r\n").last().unwrap();
            assert_eq!(visible_len(baris), cols, "lebar {cols}");
        }
    }
}
