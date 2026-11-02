//! TUI layar penuh untuk menu utama Autore (tanpa dependensi baru: crossterm sudah
//! ikut terpasang lewat `inquire`).
//!
//! Alur: `select_action` menggambar layar full-screen, mengembalikan index pilihan,
//! dan **selalu** mengembalikan terminal ke mode normal sebelum keluar — supaya
//! perintah yang interaktif (tanya nama project, token, dll.) bisa jalan seperti biasa.

use crossterm::cursor::{Hide, MoveTo, Show};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::style::{Print, ResetColor};
use crossterm::terminal::{self, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::{execute, queue};
use std::io::{self, IsTerminal, Write};

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const CYAN: &str = "\x1b[36m";
const DIM: &str = "\x1b[2m";
const REV: &str = "\x1b[7m";
const ORANGE: &str = "\x1b[38;2;217;119;87m";
/// Lebar maksimum panel kiri (judul menu) — cukup untuk label terpanjang (47 karakter).
const LEFT_W: usize = 49;
/// Tinggi minimum layar supaya banner blok ikut tampil (banner 8 + panel + kotak perintah + status).
const BANNER_MIN_ROWS: usize = 20;
/// Tinggi minimum supaya baris bantuan + baris input perintah (total 4 baris) ikut tampil.
const COMMAND_BLOCK_MIN: usize = 12;

/// Banner blok "AUTORE" — gradasi oranye terakota (#E18A68 -> #B95F42).
/// Dipakai TUI (tengah atas) dan mode teks (`print_ascii_banner`).
pub(crate) const BANNER: [(&str, (u8, u8, u8)); 6] = [
    ("  █████╗ ██╗   ██╗████████╗ ██████╗ ██████╗ ███████╗", (235, 138, 104)),
    (" ██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██╔══██╗██╔════╝", (229, 131, 98)),
    (" ███████║██║   ██║   ██║   ██║   ██║██████╔╝█████╗  ", (223, 125, 92)),
    (" ██╔══██║██║   ██║   ██║   ██║   ██║██╔══██╗██╔══╝  ", (217, 119, 87)),
    (" ██║  ██║╚██████╔╝   ██║   ╚██████╔╝██║  ██║███████╗", (204, 108, 77)),
    (" ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝", (185, 95, 66)),
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
        KeyCode::Char('j') if key.modifiers.is_empty() => Outcome::Move((selected + 1).min(max_index)),
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

/// Tampilkan menu full-screen. `None` = user keluar (q/Esc/Ctrl-C).
pub fn select_action(
    items: &[Item],
    project: Option<&str>,
    last: Option<&str>,
) -> Option<usize> {
    if items.is_empty() {
        return None;
    }
    let mut out = io::stdout();
    terminal::enable_raw_mode().ok()?;
    if execute!(out, EnterAlternateScreen, Hide).is_err() {
        let _ = terminal::disable_raw_mode();
        return None;
    }

    let result = run_ui(&mut out, items, project, last);

    let _ = execute!(out, ResetColor, LeaveAlternateScreen, Show);
    let _ = terminal::disable_raw_mode();
    result
}

/// Item yang ikut digambar: menu penuh, atau hasil filter saat palette terbuka.
fn view_items(items: &[Item], ui: &Ui) -> Vec<Item> {
    visible_indices(items, &ui.input)
        .into_iter()
        .map(|i| items[i])
        .collect()
}

/// Tulis satu frame ke layar. Dipisah agar bisa diuji tanpa TTY (mis. ke Vec<u8>).
fn paint<W: Write>(out: &mut W, screen: &str) -> io::Result<()> {
    queue!(
        out,
        MoveTo(0, 0),
        Clear(ClearType::FromCursorDown),
        Print(screen)
    )?;
    out.flush()
}

/// Loop interaksi: gambar -> baca tombol -> ubah fokus, sampai user menjalankan atau keluar.
fn run_ui<W: Write>(
    out: &mut W,
    items: &[Item],
    project: Option<&str>,
    last: Option<&str>,
) -> Option<usize> {
    let mut ui = Ui::default();
    loop {
        let (cols, rows) = terminal::size().ok()?;
        let screen = render(&view_items(items, &ui), &ui, project, last, cols, rows);
        paint(out, &screen).ok()?;
        match event::read() {
            Ok(Event::Key(k)) => match handle_key(&mut ui, k, items) {
                Act::Stay => {}
                Act::Run(i) => return Some(i),
                Act::Quit => return None,
            },
            Ok(_) => {}
            Err(_) => return None,
        }
    }
}

// ── Kotak tanya TUI ──────────────────────────────────────────────────────────
// Dipakai alur interaktif supaya user tidak pernah keluar dari layar TUI:
// menu -> kotak tanya -> proses -> menu lagi, semuanya di alternate screen.

/// Jenis kotak tanya: `Text` = input bebas, `Choose` = pilih satu dari daftar.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Ask {
    Text { secret: bool },
    Choose,
}

/// Isi kotak tanya; dipisah dari I/O supaya bisa diuji tanpa TTY.
#[derive(Debug, Default)]
struct AskState {
    buf: String,
    sel: usize,
}

#[derive(Debug, PartialEq)]
enum AskAct {
    Stay,
    Submit,
    Cancel,
}

/// Satu tombol di kotak tanya -> satu aksi.
fn ask_key(kind: Ask, st: &mut AskState, key: KeyEvent, count: usize) -> AskAct {
    let plain = key.modifiers.is_empty();
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    match kind {
        Ask::Text { .. } => match key.code {
            KeyCode::Esc => AskAct::Cancel,
            KeyCode::Enter => AskAct::Submit,
            KeyCode::Backspace => {
                st.buf.pop();
                AskAct::Stay
            }
            KeyCode::Char('u') if ctrl => {
                st.buf.clear();
                AskAct::Stay
            }
            KeyCode::Char(c) if plain && !c.is_control() => {
                st.buf.push(c);
                AskAct::Stay
            }
            _ => AskAct::Stay,
        },
        Ask::Choose => match key.code {
            KeyCode::Esc => AskAct::Cancel,
            KeyCode::Enter => AskAct::Submit,
            KeyCode::Up => {
                st.sel = st.sel.saturating_sub(1);
                AskAct::Stay
            }
            KeyCode::Down => {
                st.sel = (st.sel + 1).min(count.saturating_sub(1));
                AskAct::Stay
            }
            KeyCode::Char('k') if plain => {
                st.sel = st.sel.saturating_sub(1);
                AskAct::Stay
            }
            KeyCode::Char('j') if plain => {
                st.sel = (st.sel + 1).min(count.saturating_sub(1));
                AskAct::Stay
            }
            _ => AskAct::Stay,
        },
    }
}

/// Satu frame kotak tanya: border di tengah layar, sisa baris dikosongkan.
fn ask_frame(
    kind: Ask,
    label: &str,
    st: &AskState,
    default: &str,
    options: &[String],
    cols: u16,
    rows: u16,
) -> String {
    let cols = (cols as usize).max(20);
    let rows = (rows as usize).max(6);
    let inner = 68.min(cols.saturating_sub(4)).max(20);
    let mut body: Vec<String> = wrap(label, inner.saturating_sub(2))
        .iter()
        .map(|l| format!("{BOLD}{l}{RESET}"))
        .collect();
    match kind {
        Ask::Text { secret } => {
            if !default.is_empty() {
                body.push(format!("{DIM}Enter = pakai default: {default}{RESET}"));
            }
            body.push(String::new());
            let shown = if secret {
                "*".repeat(st.buf.chars().count())
            } else {
                st.buf.clone()
            };
            body.push(format!("{CYAN}>{RESET} {shown}\x1b[7m \x1b[0m"));
            body.push(String::new());
            body.push(format!(
                "{DIM}Enter lanjut  •  Esc batal  •  Ctrl+U hapus{RESET}"
            ));
        }
        Ask::Choose => {
            if options.is_empty() {
                body.push(format!("{DIM}(tidak ada pilihan){RESET}"));
            }
            for (i, o) in options.iter().enumerate() {
                let line = format!("{} {o}", if i == st.sel { "▸" } else { " " });
                if i == st.sel {
                    body.push(format!("{REV}{}", pad_plain(&line, inner.saturating_sub(2))));
                } else {
                    body.push(line);
                }
            }
            body.push(String::new());
            body.push(format!(
                "{DIM}↑/↓ geser  •  Enter pilih  •  Esc batal{RESET}"
            ));
        }
    }

    // Banner AUTORE tetap di tengah atas, kotak oranye di bawahnya — senada dengan menu.
    let mut screen: Vec<String> = Vec::new();
    if rows >= BANNER_MIN_ROWS {
        for (row, (r, g, b)) in BANNER {
            screen.push(center(&format!("\x1b[38;2;{r};{g};{b}m{row}{RESET}"), cols));
        }
        screen.push(blank_row(cols));
    }
    let edge = |s: String| center(&format!("{ORANGE}{s}{RESET}"), cols);
    let mut lines: Vec<String> = vec![edge(format!("┌{}┐", "─".repeat(inner)))];
    for b in &body {
        lines.push(center(
            &format!(
                "{ORANGE}│{RESET} {} {ORANGE}│{RESET}",
                pad_plain(b, inner.saturating_sub(2))
            ),
            cols,
        ));
    }
    lines.push(edge(format!("└{}┘", "─".repeat(inner))));

    let top = screen.len();
    for _ in 0..rows.saturating_sub(top + lines.len()) / 2 {
        screen.push(blank_row(cols));
    }
    screen.extend(lines);
    screen.truncate(rows); // ponytail: layar pendek -> kotak dipotong, bukan panic
    while screen.len() < rows {
        screen.push(blank_row(cols));
    }
    screen.join("\r\n")
}

/// Loop kotak tanya: gambar -> baca tombol -> sampai Submit/Cancel. `None` = batal atau I/O gagal.
fn dialog_loop(
    kind: Ask,
    label: &str,
    default: &str,
    options: &[String],
    start: usize,
) -> Option<AskState> {
    let mut st = AskState {
        buf: String::new(),
        sel: start,
    };
    let mut out = io::stdout();
    // ponytail: di `cargo test` (walau dari terminal sungguhan) jangan pernah menunggu tombol.
    if cfg!(test) || !out.is_terminal() {
        return None;
    }
    terminal::enable_raw_mode().ok()?;
    if execute!(out, EnterAlternateScreen, Hide).is_err() {
        let _ = terminal::disable_raw_mode();
        return None;
    }
    let hasil = loop {
        let Ok((cols, rows)) = terminal::size() else {
            break None;
        };
        let screen = ask_frame(kind, label, &st, default, options, cols, rows);
        if paint(&mut out, &screen).is_err() {
            break None;
        }
        match event::read() {
            Ok(Event::Key(k)) => match ask_key(kind, &mut st, k, options.len()) {
                AskAct::Stay => {}
                AskAct::Submit => break Some(()),
                AskAct::Cancel => break None,
            },
            Ok(_) => {}
            Err(_) => break None,
        }
    };

    let _ = execute!(out, ResetColor, LeaveAlternateScreen, Show);
    let _ = terminal::disable_raw_mode();
    hasil.map(|_| st)
}

/// Tanya teks di layar TUI. `None` = user batal (Esc) atau terminal tak mendukung.
pub fn ask_text(label: &str, default: &str) -> Option<String> {
    let st = dialog_loop(Ask::Text { secret: false }, label, default, &[], 0)?;
    Some(text_or_default(&st.buf, default))
}

/// Isi kosong (cuma Enter) = pakai default.
fn text_or_default(buf: &str, default: &str) -> String {
    match buf.trim() {
        "" => default.to_string(),
        isi => isi.to_string(),
    }
}

/// Tanya rahasia (token/password) — isi disamarkan.
pub fn ask_secret(label: &str) -> Option<String> {
    dialog_loop(Ask::Text { secret: true }, label, "", &[], 0).map(|st| st.buf)
}

/// Pilih satu dari daftar; hasil = index. `None` = batal.
pub fn ask_choose(label: &str, options: &[String]) -> Option<usize> {
    dialog_loop(Ask::Choose, label, "", options, 0)
        .map(|st| st.sel.min(options.len().saturating_sub(1)))
}

/// Konfirmasi ya/tidak; `None` = batal (dianggap tidak).
pub fn ask_confirm(label: &str, default_ya: bool) -> Option<bool> {
    let opts = ["Ya".to_string(), "Tidak".to_string()];
    dialog_loop(Ask::Choose, label, "", &opts, usize::from(!default_ya)).map(|st| st.sel == 0)
}

fn render(
    items: &[Item],
    ui: &Ui,
    project: Option<&str>,
    last: Option<&str>,
    cols: u16,
    rows: u16,
) -> String {
    let selected = ui.selected.min(items.len().saturating_sub(1));
    let cols = (cols as usize).max(20);
    let rows = (rows as usize).max(6);
    let left_w = LEFT_W.min(cols.saturating_sub(22)).max(12);
    let right_w = cols.saturating_sub(left_w + 5);
    let mut lines: Vec<String> = Vec::with_capacity(rows);

    // Banner AUTORE di tengah atas + subjudul (hanya kalau layar cukup tinggi).
    if rows >= BANNER_MIN_ROWS {
        for (row, (r, g, b)) in BANNER {
            lines.push(center(
                &format!("\x1b[38;2;{r};{g};{b}m{row}{RESET}"),
                cols,
            ));
        }
        lines.push(center(
            &format!(
                "{DIM}DevSecOps & CI/CD Platform  •  v{}{RESET}",
                env!("CARGO_PKG_VERSION")
            ),
            cols,
        ));
        lines.push(blank_row(cols));
    }

    // Sisa tinggi dibagi: panel menu/penjelasan, baris bantuan + input, baris status.
    let cmd_block = if rows >= COMMAND_BLOCK_MIN { 4 } else { 0 };
    let avail = rows.saturating_sub(lines.len() + cmd_block + 1);
    let body_h = avail.saturating_sub(2);
    let detail: Vec<String> = match items.get(selected) {
        Some(it) => detail_lines(it, right_w.saturating_sub(2)),
        None => Vec::new(),
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
        let palette = if ui.focus == Focus::Palette {
            format!("{CYAN}[command palette]{RESET}  ")
        } else {
            String::new()
        };
        lines.push(pad_plain(
            &format!("  {palette}{DIM}↑/↓ geser  •  Enter jalankan  •  q keluar{RESET}"),
            cols,
        ));

        let border = if ui.focus == Focus::Menu { "" } else { CYAN };
        if ui.input.is_empty() {
            lines.push(format!(
                "{border}┌{}┐{RESET}",
                "─".repeat(inner)
            ));
            lines.push(format!(
                "{border}│{RESET}{}│{RESET}",
                pad_plain(
                    &format!("{CYAN}>{RESET} {DIM}Type a command... (Ctrl+K for menu){RESET}"),
                    inner
                )
            ));
        } else {
            let cursor = if ui.focus == Focus::Menu { "" } else { "\x1b[7m \x1b[0m" };
            lines.push(format!("{border}┌{}┐{RESET}", "─".repeat(inner)));
            lines.push(format!(
                "{border}│{RESET}{}│{RESET}",
                pad_plain(&format!("{CYAN}>{RESET} {}{cursor}", ui.input), inner)
            ));
        }
        lines.push(format!("{border}└{}┘{RESET}", "─".repeat(inner)));
    }

    lines.push(status_bar(cols, project, last));
    debug_assert_eq!(lines.len(), rows, "tinggi layar harus pas {rows} baris");
    lines.join("\r\n")
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
    format!("{}{}{}", " ".repeat(left), text, " ".repeat(cols - w - left))
}

/// Baris status 3 segmen: lokasi project (biru), aksi terakhir (hijau/merah), versi.
fn status_bar(cols: usize, project: Option<&str>, last: Option<&str>) -> String {
    let w1 = cols / 3;
    let w2 = cols / 3;
    let w3 = cols - w1 - w2;
    let left = format!(
        "\x1b[44m\x1b[97m{}",
        pad_plain(project.unwrap_or("(belum ada project)"), w1)
    );
    let (bg, fg) = match last {
        Some(l) if l.starts_with('✘') => ("\x1b[41m", "\x1b[97m"),
        _ => ("\x1b[42m", "\x1b[30m"),
    };
    let mid = format!("{bg}{fg}{}", pad_plain(last.unwrap_or("siap"), w2));
    let right = format!(
        "\x1b[47m\x1b[30m{}",
        pad_plain(&format!("autore v{}", env!("CARGO_PKG_VERSION")), w3)
    );
    format!("{left}\x1b[0m{mid}\x1b[0m{right}\x1b[0m")
}

fn detail_lines(item: &Item, width: usize) -> Vec<String> {
    let mut out = vec![
        format!("{BOLD}{}{RESET}", item.label),
        String::new(),
    ];
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

    /// Gambar layar lewat jalur menu biasa (fokus di menu kiri, input kosong).
    fn draw(
        items: &[Item],
        selected: usize,
        project: Option<&str>,
        last: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> String {
        let ui = Ui {
            selected,
            focus: Focus::Menu,
            input: String::new(),
        };
        render(items, &ui, project, last, cols, rows)
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
            let screen = draw(&sample(), 1, Some("/home/user/project"), Some("✔ terakhir: Doctor"), cols, rows);
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
        assert_eq!(outcome_for(tap(KeyCode::Down), last, last), Outcome::Move(last));
        assert_eq!(outcome_for(tap(KeyCode::Down), 3, last), Outcome::Move(4));
        assert_eq!(outcome_for(tap(KeyCode::Up), 3, last), Outcome::Move(2));
        assert_eq!(outcome_for(tap(KeyCode::Home), 5, last), Outcome::Move(0));
        assert_eq!(outcome_for(tap(KeyCode::End), 1, last), Outcome::Move(last));
        assert_eq!(outcome_for(tap(KeyCode::Char('j')), 0, last), Outcome::Move(1));
        assert_eq!(outcome_for(tap(KeyCode::Char('k')), 2, last), Outcome::Move(1));
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
        let fail = draw(&sample(), 0, None, Some("✘ terakhir: Doctor (kode 1)"), 100, 20);
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
        assert!(rows[6].contains("DevSecOps & CI/CD Platform"));
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
        assert!(!screen.contains('█'), "banner harus dilewati di layar pendek");
        assert!(!screen.contains("Enter jalankan"), "kotak perintah dilewati");
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
        let screen = draw(&items, items.len() - 1, Some("/tmp/x"), Some("catatan"), 24, 6);
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
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Enter), &items), Act::Run(0));
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Char('q')), &items), Act::Quit);
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
    fn palette_menggambar_mode_dan_menulis_frame_ke_penulis_apa_pun() {
        let items = sample();
        let ui = Ui {
            selected: 0,
            focus: Focus::Palette,
            input: "hapus".into(),
        };
        let screen = render(&view_items(&items, &ui), &ui, Some("/tmp/p"), None, 100, 24);
        assert!(screen.contains("[command palette]"), "mode palette harus tampil");
        let baris_input = screen
            .split("\r\n")
            .find(|r| r.contains("hapus") && r.contains('>'))
            .expect("teks ketikan ada di baris input");
        assert!(baris_input.contains(CYAN), "border input menyala saat fokus");
        // view_items menyaring sesuai ketikan, index tetap mengarah ke item asli.
        let tampil = view_items(&items, &ui);
        assert_eq!(tampil.len(), 1);
        assert_eq!(tampil[0].label, "Hapus Project");
        // paint() bisa dipakai tanpa TTY: hasilnya frame penuh + kode pindah kursor.
        let mut buf: Vec<u8> = Vec::new();
        assert!(paint(&mut buf, "halo").is_ok());
        let keluaran = String::from_utf8_lossy(&buf).to_string();
        assert!(keluaran.contains("halo"));
        assert!(keluaran.contains("\x1b[1;1H"), "kursor harus balik ke kiri atas");
    }

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    #[test]
    fn kotak_teks_simpan_ketikan_escape_dan_submit() {
        let mut st = AskState::default();
        let kind = Ask::Text { secret: false };
        assert_eq!(
            ask_key(kind, &mut st, key(KeyCode::Char('h')), 0),
            AskAct::Stay
        );
        assert_eq!(
            ask_key(kind, &mut st, key(KeyCode::Char('i')), 0),
            AskAct::Stay
        );
        assert_eq!(st.buf, "hi");
        ask_key(kind, &mut st, key(KeyCode::Backspace), 0);
        assert_eq!(st.buf, "h");
        ask_key(
            kind,
            &mut st,
            KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
            0,
        );
        assert_eq!(st.buf, "", "Ctrl+U mengosongkan isi");
        ask_key(kind, &mut st, key(KeyCode::Char('j')), 0);
        assert_eq!(st.buf, "j", "'j' huruf biasa di kotak teks, bukan navigasi");
        assert_eq!(
            ask_key(kind, &mut st, key(KeyCode::Enter), 0),
            AskAct::Submit
        );
        assert_eq!(ask_key(kind, &mut st, key(KeyCode::Esc), 0), AskAct::Cancel);
    }

    #[test]
    fn kotak_pilih_j_k_dan_tombol_lain() {
        let mut st = AskState::default();
        ask_key(Ask::Choose, &mut st, key(KeyCode::Char('j')), 3);
        assert_eq!(st.sel, 1);
        ask_key(Ask::Choose, &mut st, key(KeyCode::Char('k')), 3);
        assert_eq!(st.sel, 0);
        assert_eq!(ask_key(Ask::Choose, &mut st, key(KeyCode::Tab), 3), AskAct::Stay);
        assert_eq!(
            ask_key(Ask::Text { secret: false }, &mut st, key(KeyCode::Tab), 0),
            AskAct::Stay
        );
        assert_eq!(st.sel, 0);
    }

    #[test]
    fn teks_kosong_pakai_default() {
        assert_eq!(text_or_default("  ", "web-app"), "web-app");
        assert_eq!(text_or_default(" demo ", "web-app"), "demo");
    }

    #[test]
    fn kotak_pilih_geser_dan_berhenti_di_batas() {
        let mut st = AskState::default();
        assert_eq!(
            ask_key(Ask::Choose, &mut st, key(KeyCode::Up), 3),
            AskAct::Stay
        );
        assert_eq!(st.sel, 0, "tidak bisa geser di atas pilihan pertama");
        for _ in 0..4 {
            ask_key(Ask::Choose, &mut st, key(KeyCode::Down), 3);
        }
        assert_eq!(st.sel, 2, "mentok di pilihan terakhir");
        assert_eq!(
            ask_key(Ask::Choose, &mut st, key(KeyCode::Enter), 3),
            AskAct::Submit
        );
        assert_eq!(
            ask_key(Ask::Choose, &mut st, key(KeyCode::Esc), 3),
            AskAct::Cancel
        );
    }

    #[test]
    fn frame_teks_menampilkan_label_default_dan_border() {
        let st = AskState::default();
        let f = ask_frame(
            Ask::Text { secret: false },
            "Nama aplikasi",
            &st,
            "web-app",
            &[],
            100,
            24,
        );
        assert_eq!(f.split("\r\n").count(), 24);
        assert!(f.contains("Nama aplikasi"));
        assert!(f.contains("default: web-app"));
        assert!(f.contains('┌') && f.contains('└'));
    }

    #[test]
    fn frame_teks_rahasia_menyamarkan_isi() {
        let st = AskState {
            buf: "token-rahasia".to_string(),
            sel: 0,
        };
        let f = ask_frame(
            Ask::Text { secret: true },
            "Token GitHub",
            &st,
            "",
            &[],
            80,
            20,
        );
        assert!(f.contains("*************"));
        assert!(
            !f.contains("token-rahasia"),
            "isi rahasia tidak boleh tampil"
        );
        assert_eq!(visible_len(f.lines().next().unwrap_or("")), 80);
    }

    #[test]
    fn frame_pilih_menyorot_pilihan_aktif_dan_menangani_daftar_kosong() {
        let st = AskState {
            buf: String::new(),
            sel: 1,
        };
        let f = ask_frame(
            Ask::Choose,
            "Selesai — lanjut?",
            &st,
            "",
            &["Kembali ke Menu".to_string(), "Keluar".to_string()],
            90,
            18,
        );
        assert!(f.contains("Kembali ke Menu") && f.contains("Keluar"));
        assert!(f.contains("\x1b[7m"), "pilihan aktif disorot terbalik");
        assert_eq!(f.split("\r\n").count(), 18);

        let kosong = ask_frame(Ask::Choose, "Pilih", &st, "", &[], 40, 6);
        assert!(kosong.contains("(tidak ada pilihan)"));
        assert_eq!(kosong.split("\r\n").count(), 6);
    }

    #[test]
    fn kotak_tanya_menyerah_rapi_tanpa_terminal() {
        // Tanpa TTY semua kotak tanya mengembalikan None, bukan panic.
        assert_eq!(ask_text("Nama aplikasi", "web-app"), None);
        assert_eq!(ask_secret("Token GitHub"), None);
        assert_eq!(ask_choose("Pilih project", &["a".to_string()]), None);
        assert_eq!(ask_confirm("Yakin hapus?", false), None);
    }

    #[test]
    fn run_ui_menyerah_rapi_tanpa_terminal() {
        // Tanpa TTY (seperti saat `cargo test`), event::read/size gagal — harus keluar None, bukan panic.
        let items = sample();
        let mut buf: Vec<u8> = Vec::new();
        assert_eq!(run_ui(&mut buf, &items, Some("/tmp/x"), None), None);
    }

    #[test]
    fn baris_input_tampil_di_atas_status_dan_placeholder_muncul() {
        let ui = Ui::default();
        let screen = render(&sample(), &ui, None, None, 100, 24);
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
        assert_eq!(input_row + 2, rows.len() - 1, "tidak ada celah sebelum status bar");
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
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Char('s')), &items), Act::Stay);
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
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Backspace), &items), Act::Stay);
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
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Enter), &items), Act::Run(1));
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
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Enter), &items), Act::Run(0));
        // Kata yang tidak cocok: tidak menjalankan apa pun.
        ui.input = "zzz".into();
        assert_eq!(handle_key(&mut ui, tap(KeyCode::Enter), &items), Act::Stay);
        // Palette tanpa hasil: layar tetap penuh lebar & tidak panic.
        let screen = render(&[], &ui, None, None, 80, 24);
        assert!(screen.contains("(tidak ada perintah cocok)"));
        for row in screen.split("\r\n") {
            assert_eq!(visible_len(row), 80);
        }
    }
}
