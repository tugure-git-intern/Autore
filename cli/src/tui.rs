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
use std::io::{self, Write};

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const CYAN: &str = "\x1b[36m";
const YELLOW: &str = "\x1b[33m";
const DIM: &str = "\x1b[2m";
const REV: &str = "\x1b[7m";
/// Lebar maksimum panel kiri (judul menu) — cukup untuk label terpanjang (47 karakter).
const LEFT_W: usize = 49;

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

    let mut selected = 0usize;
    let max_index = items.len() - 1;
    let result = loop {
        let (cols, rows) = match terminal::size() {
            Ok(v) => v,
            Err(_) => break None,
        };
        let screen = draw(items, selected, project, last, cols, rows);
        if queue!(
            out,
            MoveTo(0, 0),
            Clear(ClearType::FromCursorDown),
            Print(screen)
        )
        .and_then(|_| out.flush())
        .is_err()
        {
            break None;
        }
        match event::read() {
            Ok(Event::Key(k)) => match outcome_for(k, selected, max_index) {
                Outcome::Move(i) => selected = i,
                Outcome::Run => break Some(selected),
                Outcome::Quit => break None,
                Outcome::Stay => {}
            },
            Ok(_) => {}
            Err(_) => break None,
        }
    };

    let _ = execute!(out, ResetColor, LeaveAlternateScreen, Show);
    let _ = terminal::disable_raw_mode();
    result
}

fn draw(
    items: &[Item],
    selected: usize,
    project: Option<&str>,
    last: Option<&str>,
    cols: u16,
    rows: u16,
) -> String {
    let cols = (cols as usize).max(20);
    let rows = (rows as usize).max(6);
    let left_w = LEFT_W.min(cols.saturating_sub(22)).max(12);
    let right_w = cols.saturating_sub(left_w + 5);

    let title_label = format!(
        " {}AUTORE v{}{} ",
        BOLD,
        env!("CARGO_PKG_VERSION"),
        RESET
    );
    let title_hint = format!("{DIM}DevSecOps & CI/CD Platform{RESET} ");
    let mut lines: Vec<String> = Vec::with_capacity(rows);
    lines.push(compose_row(&[(&title_label, 0), (&title_hint, 1)], cols));

    // Kepala panel: ┌──┬──┐
    lines.push(format!(
        "┌{}┬{}┐",
        "─".repeat(left_w),
        "─".repeat(right_w + 2)
    ));

    let body_h = rows.saturating_sub(4);
    let detail: Vec<String> = detail_lines(&items[selected], right_w.saturating_sub(2));

    for i in 0..body_h {
        let label = match items.get(i) {
            Some(it) => format!("{} {}", if i == selected { "▸" } else { " " }, it.label),
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

    let keys = format!(
        "{CYAN}↑/↓{RESET} geser  {CYAN}Enter{RESET} jalankan  {CYAN}q{RESET} keluar"
    );
    let where_ = match (project, last) {
        (Some(p), Some(l)) => format!("{DIM}{l}{RESET} {DIM}•{RESET} {YELLOW}{p}{RESET}"),
        (Some(p), None) => format!("{DIM}project aktif:{RESET} {YELLOW}{p}{RESET}"),
        (None, Some(l)) => format!("{DIM}{l}{RESET}"),
        (None, None) => String::new(),
    };
    let where_ = if where_.is_empty() {
        where_
    } else {
        format!("   {where_}")
    };
    lines.push(compose_row(&[(&keys, 0), (&where_, 1)], cols));

    lines.join("\r\n")
}

/// Satu baris dengan isi kiri + isi kanan, di-pad/dipotong sesuai lebar terminal.
fn compose_row(cells: &[(&str, usize)], cols: usize) -> String {
    let plain: String = cells.iter().map(|(t, _)| t.to_string()).collect();
    pad_plain(&plain, cols)
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
            assert!(tail.contains("q"));
            match project {
                Some(p) => assert!(tail.contains(p), "nama project harus tampil: {tail}"),
                None => assert!(!tail.contains("project aktif")),
            }
        }
        // Terminal sempit: tetap satu baris pas lebar, isi boleh terpotong.
        let narrow = draw(&sample(), 0, Some("qlinic"), Some("catatan"), 30, 8);
        let tail = narrow.split("\r\n").last().unwrap();
        assert_eq!(visible_len(tail), 30);
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
    }
}
