//! Baris data untuk pemanggil otomatis (dashboard web, uji otomatis).
//!
//! Aktif HANYA kalau env `AUTORE_PROGRESS=json` diset, jadi orang yang memakai
//! CLI langsung tidak melihat tambahan apa pun. Satu tahap = satu baris JSON
//! berawalan [`PENANDA`]. Kalimat untuk manusia tetap dicetak seperti biasa —
//! ini jalur tambahan, bukan pengganti.

/// Awalan penanda. Dipakai juga oleh pembaca (lihat `serve.rs`).
pub const PENANDA: &str = "@@AUTORE ";

/// Apakah pemanggil meminta baris data?
pub fn aktif() -> bool {
    std::env::var("AUTORE_PROGRESS")
        .map(|v| v.trim() == "json")
        .unwrap_or(false)
}

/// Kabarkan satu tahap. Diam total kalau pemanggil tidak meminta baris data.
///
/// `id` dipakai pemanggil untuk memutuskan tampilan (jangan diubah tanpa mengubah
/// pembaca di `serve.rs` + `web/index.html`), `pesan` untuk manusia.
pub fn tahap(id: &str, status: &str, pesan: &str) {
    if !aktif() {
        return;
    }
    println!(
        "{PENANDA}{{\"tahap\":\"{}\",\"status\":\"{}\",\"pesan\":\"{}\"}}",
        esc(id),
        esc(status),
        esc(pesan)
    );
    use std::io::Write;
    let _ = std::io::stdout().flush();
}

/// Ambil nilai sebuah kunci dari satu baris data. `None` kalau baris itu bukan
/// baris data atau kuncinya tidak ada.
pub fn ambil(baris: &str, kunci: &str) -> Option<String> {
    let isi = baris.strip_prefix(PENANDA)?;
    let pola = format!("\"{kunci}\":\"");
    let mulai = isi.find(&pola)? + pola.len();
    let sisa = &isi[mulai..];
    let mut out = String::new();
    let mut lewat = false;
    for c in sisa.chars() {
        if lewat {
            out.push(c);
            lewat = false;
            continue;
        }
        match c {
            '\\' => lewat = true,
            '"' => return Some(out),
            _ => out.push(c),
        }
    }
    None
}

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' | '\r' => out.push(' '),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ambil_membaca_kunci_dari_baris_data() {
        let baris = "@@AUTORE {\"tahap\":\"repo\",\"status\":\"selesai\",\"pesan\":\"Repo GitHub a\\\"b\"}";
        assert_eq!(ambil(baris, "tahap").as_deref(), Some("repo"));
        assert_eq!(ambil(baris, "status").as_deref(), Some("selesai"));
        assert_eq!(ambil(baris, "pesan").as_deref(), Some("Repo GitHub a\"b"));
        assert_eq!(ambil(baris, "hilang"), None);
    }

    #[test]
    fn ambil_menolak_baris_biasa() {
        assert_eq!(ambil("  ● Alur 1-klik — project 'x'", "tahap"), None);
    }

    #[test]
    fn esc_membuang_baris_baru() {
        assert_eq!(esc("a\nb"), "a b");
        assert_eq!(esc("a \"b\" c"), "a \\\"b\\\" c");
    }

    #[test]
    fn diam_kalau_tidak_diminta() {
        std::env::remove_var("AUTORE_PROGRESS");
        assert!(!aktif());
    }
}
