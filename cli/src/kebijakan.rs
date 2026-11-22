//! Kebijakan kunci branch: satu berkas konfigurasi yang dibaca setiap alur
//! (quick-start, connect, kunci-repo). Dev tidak perlu mengingat flag; berkas
//! ini yang memutuskan repo kantor dikunci penuh dan repo pribadi cukup ringan.

use std::path::PathBuf;

/// Dua tingkat kunci. Ringan = larangan force-push/hapus; penuh = ditambah PR
/// wajib + review, jadi push langsung ke branch default ditolak GitHub.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum Mode {
    Ringan,
    #[default]
    Penuh,
}

impl Mode {
    pub fn ringan(self) -> bool {
        self == Mode::Ringan
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Kebijakan {
    pub akun_kantor: Vec<String>,
    pub akun_pribadi: Vec<String>,
    pub org_default: Option<String>,
    pub mode_baru: Mode,
    pub review_wajib: u8,
}

impl Default for Kebijakan {
    /// Tanpa berkas: repo baru dikunci penuh. Aman secara bawaan lebih baik
    /// daripada repo kantor yang lolos tanpa kunci karena berkas lupa dibuat.
    fn default() -> Self {
        Kebijakan {
            akun_kantor: Vec::new(),
            akun_pribadi: Vec::new(),
            org_default: None,
            mode_baru: Mode::Penuh,
            review_wajib: 1,
        }
    }
}

fn daftar(nilai: &str) -> Vec<String> {
    nilai
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

fn mode(nilai: &str) -> Option<Mode> {
    match nilai.trim().to_lowercase().as_str() {
        "ringan" => Some(Mode::Ringan),
        "penuh" => Some(Mode::Penuh),
        _ => None,
    }
}

/// Baris `#` adalah komentar; kunci yang tidak dikenal diabaikan supaya berkas
/// lama tetap terbaca setelah ada setelan baru.
pub fn parse(text: &str) -> Kebijakan {
    let mut k = Kebijakan::default();
    for baris in text.lines() {
        let baris = baris.split('#').next().unwrap_or("").trim();
        let Some((kunci, nilai)) = baris.split_once('=') else {
            continue;
        };
        let nilai = nilai.trim();
        match kunci.trim() {
            "akun_kantor" => k.akun_kantor = daftar(nilai),
            "akun_pribadi" => k.akun_pribadi = daftar(nilai),
            "org_default" => {
                k.org_default = Some(nilai.to_string()).filter(|s| !s.is_empty());
            }
            "mode_baru" => {
                if let Some(m) = mode(nilai) {
                    k.mode_baru = m;
                }
            }
            "review_wajib" => {
                if let Ok(n) = nilai.parse::<u8>() {
                    k.review_wajib = n.min(6);
                }
            }
            _ => {}
        }
    }
    k
}

pub fn path() -> PathBuf {
    let dasar = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
        });
    dasar.join("autore").join("kebijakan.conf")
}

/// Berkas tidak ada / tidak terbaca = kebijakan bawaan (penuh). Tidak pernah
/// gagal: kunci branch tidak boleh batal hanya karena berkas konfigurasi hilang.
pub fn muat() -> Kebijakan {
    std::fs::read_to_string(path())
        .map(|t| parse(&t))
        .unwrap_or_default()
}

/// Mode yang dipakai untuk satu repo. Urutan: flag eksplisit → organisasi →
/// akun pribadi → akun kantor → jumlah kolaborator → bawaan.
pub fn putuskan(
    k: &Kebijakan,
    pemilik: &str,
    tipe_pemilik: &str,
    kolaborator: Option<usize>,
    minta: Option<Mode>,
) -> Mode {
    if let Some(m) = minta {
        return m;
    }
    let pemilik = pemilik.to_lowercase();
    if tipe_pemilik.eq_ignore_ascii_case("organization") {
        return Mode::Penuh;
    }
    if k.akun_pribadi.iter().any(|a| a == &pemilik) {
        return Mode::Ringan;
    }
    if k.akun_kantor.iter().any(|a| a == &pemilik) {
        return Mode::Penuh;
    }
    match kolaborator {
        Some(n) if n >= 2 => Mode::Penuh,
        _ => k.mode_baru,
    }
}

/// Organisasi tujuan repo baru. Flag `--org` selalu menang; `org_default` hanya
/// dipakai kalau token milik akun kantor, supaya repo pribadi di laptop tidak
/// ikut lahir di organisasi kantor.
pub fn org_tujuan(k: &Kebijakan, flag: Option<&str>, login: &str) -> Option<String> {
    if let Some(f) = flag.map(str::trim).filter(|f| !f.is_empty()) {
        return Some(f.to_string());
    }
    let login = login.to_lowercase();
    let org = k.org_default.as_ref()?;
    k.akun_kantor
        .iter()
        .any(|a| a == &login)
        .then(|| org.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kantor() -> Kebijakan {
        parse(
            "akun_kantor=tugure-git-intern,tugure-reasuransi\n\
             akun_pribadi=MAliffadlan\n\
             org_default=tugure-reasuransi\n\
             mode_baru=penuh\n\
             review_wajib=1\n",
        )
    }

    #[test]
    fn berkas_kebijakan_memuat_daftar_akun_dan_org() {
        let k = kantor();
        assert_eq!(
            k.akun_kantor,
            vec!["tugure-git-intern".to_string(), "tugure-reasuransi".into()]
        );
        assert_eq!(k.akun_pribadi, vec!["maliffadlan".to_string()]);
        assert_eq!(k.org_default.as_deref(), Some("tugure-reasuransi"));
        assert_eq!(k.review_wajib, 1);
    }

    #[test]
    fn repo_kantor_dikunci_penuh() {
        assert_eq!(
            putuskan(&kantor(), "tugure-git-intern", "User", None, None),
            Mode::Penuh
        );
    }

    #[test]
    fn repo_pribadi_cukup_ringan() {
        assert_eq!(
            putuskan(&kantor(), "MAliffadlan", "User", Some(1), None),
            Mode::Ringan
        );
    }

    #[test]
    fn organisasi_selalu_penuh_walau_tidak_terdaftar() {
        assert_eq!(
            putuskan(&kantor(), "org-lain", "Organization", None, None),
            Mode::Penuh
        );
    }

    #[test]
    fn repo_baru_di_akun_asing_bawaan_penuh() {
        assert_eq!(
            putuskan(&kantor(), "orang-lain", "User", None, None),
            Mode::Penuh
        );
    }

    #[test]
    fn repo_dua_kolaborator_dikunci_penuh() {
        // Akun yang terdaftar di berkas kebijakan menang atas jumlah kolaborator:
        // repo pribadi tetap ringan walau ada dua orang.
        assert_eq!(
            putuskan(&kantor(), "MAliffadlan", "User", Some(2), None),
            Mode::Ringan
        );
        // Akun asing dengan dua kolaborator = repo tim → penuh.
        assert_eq!(
            putuskan(&kantor(), "orang-lain", "User", Some(2), None),
            Mode::Penuh
        );
        assert_eq!(
            putuskan(&kantor(), "orang-lain", "User", None, None),
            Mode::Penuh,
            "kolaborator tidak diketahui jatuh ke mode_baru"
        );
    }

    #[test]
    fn flag_kunci_selalu_menang() {
        assert_eq!(
            putuskan(
                &kantor(),
                "tugure-git-intern",
                "User",
                None,
                Some(Mode::Ringan)
            ),
            Mode::Ringan
        );
        assert_eq!(
            putuskan(&kantor(), "MAliffadlan", "User", None, Some(Mode::Penuh)),
            Mode::Penuh
        );
    }

    #[test]
    fn org_tujuan_hanya_untuk_akun_kantor() {
        let k = kantor();
        assert_eq!(
            org_tujuan(&k, None, "tugure-git-intern").as_deref(),
            Some("tugure-reasuransi")
        );
        assert_eq!(
            org_tujuan(&k, None, "MAliffadlan"),
            None,
            "laptop pribadi tidak boleh bikin repo di org kantor"
        );
        assert_eq!(
            org_tujuan(&k, None, "TUGURE-GIT-INTERN").as_deref(),
            Some("tugure-reasuransi")
        );
    }

    #[test]
    fn flag_org_menang_atas_org_default() {
        assert_eq!(
            org_tujuan(&kantor(), Some("org-lain"), "MAliffadlan").as_deref(),
            Some("org-lain")
        );
    }

    #[test]
    fn berkas_hilang_atau_rusak_memakai_bawaan_penuh() {
        let kosong = parse("");
        assert_eq!(kosong.mode_baru, Mode::Penuh);
        assert_eq!(kosong.review_wajib, 1);
        assert_eq!(kosong.akun_kantor, Vec::<String>::new());
        assert_eq!(
            putuskan(&kosong, "siapa-saja", "User", None, None),
            Mode::Penuh
        );
    }

    #[test]
    fn baris_komentar_dan_kunci_asing_diabaikan() {
        let k = parse("# catatan\nmode_baru=ringan\nkunci_aneh=1\nreview_wajib=2 # dua\n");
        assert_eq!(k.mode_baru, Mode::Ringan);
        assert_eq!(k.review_wajib, 2);
    }
}
