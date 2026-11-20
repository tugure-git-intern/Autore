//! Orkestrasi `autore hapus-app`: satu aksi membersihkan app di server.
//!
//! Urutan efek samping: backup -> container -> job Jenkins -> registry ->
//! environments -> folder. Satu langkah gagal tidak menghentikan langkah lain;
//! exit code datang dari `ringkasan`.

use crate::{connect, jenkins, lingkungan, workspace};
use colored::Colorize;
use std::path::Path;

/// Batas panjang nama app, sama dengan pola API `/^[A-Za-z0-9._-]{1,64}$/`.
/// `connect::nama_sah` sengaja tidak diperketat: ia juga memvalidasi nama repo
/// GitHub yang boleh sampai 100 karakter.
const BATAS_NAMA: usize = 64;

/// Hasil satu langkah pembersihan, dipakai untuk laporan dan exit code.
pub(crate) struct HasilLangkah {
    pub(crate) nama: &'static str,
    pub(crate) berhasil: bool,
    pub(crate) pesan: String,
}

fn hasil(nama: &'static str, berhasil: bool, pesan: String) -> HasilLangkah {
    HasilLangkah {
        nama,
        berhasil,
        pesan,
    }
}

/// Gerbang sebelum efek samping: nama sah, konfirmasi sama, app terdaftar,
/// dan folder bukan repo sumber Autore.
pub(crate) fn periksa(
    nama: &str,
    konfirmasi: &str,
    terdaftar: &[String],
    folder: &Path,
) -> Result<(), String> {
    if !connect::nama_sah(nama) {
        return Err(format!(
            "Nama app '{nama}' tidak sah: hanya huruf/angka ASCII serta . _ -"
        ));
    }
    if nama.chars().count() > BATAS_NAMA {
        return Err(format!(
            "Nama app '{nama}' melebihi {BATAS_NAMA} karakter ({} karakter).",
            nama.chars().count()
        ));
    }
    if konfirmasi != nama {
        return Err(format!(
            "Konfirmasi '{konfirmasi}' tidak sama dengan nama app '{nama}'. Tidak ada yang dihapus."
        ));
    }
    if !terdaftar.iter().any(|n| n == nama) {
        return Err(format!(
            "App '{nama}' tidak terdaftar di registry.tsv. Tidak ada yang dihapus."
        ));
    }
    if crate::is_autore_source_repo(folder) {
        return Err(format!(
            "{} adalah repo sumber Autore dan tidak boleh dihapus.",
            folder.display()
        ));
    }
    Ok(())
}

/// Exit code + teks ringkasan: 0 hanya bila semua langkah berhasil.
pub(crate) fn ringkasan(langkah: &[HasilLangkah]) -> (i32, String) {
    let gagal: Vec<String> = langkah
        .iter()
        .filter(|l| !l.berhasil)
        .map(|l| {
            if l.pesan.is_empty() {
                l.nama.to_string()
            } else {
                format!("{}: {}", l.nama, l.pesan)
            }
        })
        .collect();
    if gagal.is_empty() {
        return (0, "Semua langkah berhasil.".to_string());
    }
    (1, format!("Langkah gagal -> {}", gagal.join("; ")))
}

/// Salin registry.tsv + environments.json ke `.bak-<epoch-detik>` sebelum ada
/// yang dibuang. Berkas yang tidak ada dilewati.
fn langkah_backup(workspace: &Path) -> HasilLangkah {
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut disalin = Vec::new();
    let mut rusak = Vec::new();
    for berkas in ["registry.tsv", "environments.json"] {
        let asal = workspace.join(berkas);
        if !asal.exists() {
            continue;
        }
        let tujuan = workspace.join(format!("{berkas}.bak-{epoch}"));
        match std::fs::copy(&asal, &tujuan) {
            Ok(_) => disalin.push(berkas),
            Err(e) => rusak.push(format!("{berkas}: {e}")),
        }
    }
    if !rusak.is_empty() {
        return hasil("backup", false, rusak.join("; "));
    }
    let pesan = if disalin.is_empty() {
        "tidak ada berkas untuk dibackup".to_string()
    } else {
        format!("{} disalin ke .bak-{epoch}", disalin.join(", "))
    };
    hasil("backup", true, pesan)
}

fn langkah_container(nama: &str) -> HasilLangkah {
    if workspace::hapus_container(nama) {
        hasil("container", true, format!("docker rm -f {nama}"))
    } else {
        hasil(
            "container",
            false,
            format!("docker rm -f {nama} gagal (container tidak ada atau Docker tidak berjalan)"),
        )
    }
}

/// Tiga job per app. 404 = job memang tidak ada, tetap berhasil. Tanpa
/// jenkins.conf langkah ini GAGAL supaya user tahu job mungkin masih hidup.
fn langkah_job(cfg: Option<&jenkins::JenkinsConfig>, nama: &str) -> HasilLangkah {
    let Some(cfg) = cfg else {
        return hasil(
            "job Jenkins",
            false,
            format!(
                "jenkins.conf tidak terbaca di {}. Job mungkin masih ada di Jenkins; hapus manual.",
                jenkins::default_config_path().display()
            ),
        );
    };
    let mut catatan = Vec::new();
    let mut rusak = Vec::new();
    for job in [
        nama.to_string(),
        format!("{nama}-rollback"),
        format!("{nama}-promote"),
    ] {
        match jenkins::hapus_job(cfg, &job) {
            Ok(true) => catatan.push(format!("{job} terhapus")),
            Ok(false) => catatan.push(format!("{job} tidak ada")),
            Err(e) => rusak.push(format!("{job}: {e}")),
        }
    }
    if rusak.is_empty() {
        hasil("job Jenkins", true, catatan.join(", "))
    } else {
        hasil("job Jenkins", false, rusak.join("; "))
    }
}

/// `hapus_port` false berarti "tidak ada baris ATAU gagal tulis". Baca ulang
/// mentah membedakan keduanya: berkas ada tapi tak terbaca = GAGAL, karena
/// `entri_registry` mengembalikan vec kosong untuk keduanya.
fn langkah_registry(workspace: &Path, nama: &str) -> HasilLangkah {
    if workspace::hapus_port(workspace, nama) {
        return hasil("registry", true, format!("baris '{nama}' dibuang"));
    }
    let reg = workspace.join("registry.tsv");
    match std::fs::read_to_string(&reg) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            hasil("registry", true, "registry.tsv tidak ada".to_string())
        }
        Err(e) => hasil(
            "registry",
            false,
            format!("gagal membaca {}: {e}", reg.display()),
        ),
        Ok(isi) => {
            if isi
                .lines()
                .any(|b| b.split('\t').next().map(str::trim) == Some(nama))
            {
                hasil(
                    "registry",
                    false,
                    format!(
                        "baris '{nama}' masih ada di {} (gagal tulis)",
                        reg.display()
                    ),
                )
            } else {
                hasil(
                    "registry",
                    true,
                    format!("tidak ada baris '{nama}' di registry.tsv"),
                )
            }
        }
    }
}

fn langkah_env(workspace: &Path, nama: &str) -> HasilLangkah {
    match lingkungan::hapus_app(workspace, nama) {
        Ok(true) => hasil(
            "environments",
            true,
            format!("kunci '{nama}' dibuang dari environments.json"),
        ),
        Ok(false) => hasil(
            "environments",
            true,
            "tidak ada kunci app ini di environments.json".to_string(),
        ),
        Err(e) => hasil("environments", false, e),
    }
}

fn langkah_folder(folder: &Path) -> HasilLangkah {
    if !folder.exists() {
        return hasil("folder", true, "folder sudah tidak ada".to_string());
    }
    match std::fs::remove_dir_all(folder) {
        Ok(()) => hasil("folder", true, format!("{} dihapus", folder.display())),
        Err(e) => hasil(
            "folder",
            false,
            format!("gagal menghapus {}: {e}", folder.display()),
        ),
    }
}

/// Orkestrasi dengan workspace dan konfigurasi Jenkins disuntik supaya bisa
/// diuji tanpa jaringan.
pub(crate) fn jalankan_dengan(
    nama: &str,
    konfirmasi: &str,
    workspace: &Path,
    cfg: Option<&jenkins::JenkinsConfig>,
) -> (i32, Vec<HasilLangkah>) {
    let folder = workspace.join(nama);
    let terdaftar: Vec<String> = workspace::entri_registry(workspace)
        .into_iter()
        .map(|(n, _, _)| n)
        .collect();
    if let Err(e) = periksa(nama, konfirmasi, &terdaftar, &folder) {
        return (1, vec![hasil("periksa", false, e)]);
    }
    // vec! mengevaluasi kiri-ke-kanan: urutan efek samping terjamin.
    let langkah = vec![
        langkah_backup(workspace),
        langkah_container(nama),
        langkah_job(cfg, nama),
        langkah_registry(workspace, nama),
        langkah_env(workspace, nama),
        langkah_folder(&folder),
    ];
    (ringkasan(&langkah).0, langkah)
}

/// Cangkang tipis: workspace + konfigurasi Jenkins dari lokasi nyata, lalu
/// cetak satu baris per langkah dan ringkasan.
pub(crate) fn jalankan(nama: &str, konfirmasi: &str) -> i32 {
    let ws = workspace::workspace_dir();
    let cfg = jenkins::load_config_from(&jenkins::default_config_path());
    println!("\n{} Hapus app '{}'", "●".cyan().bold(), nama.bold());
    println!("  Riwayat build Jenkins ikut terhapus bersama job.");
    let (kode, langkah) = jalankan_dengan(nama, konfirmasi, &ws, cfg.as_ref());
    for l in &langkah {
        let tanda = if l.berhasil {
            "✔".green().bold()
        } else {
            "✖".red().bold()
        };
        if l.pesan.is_empty() {
            println!("  {tanda} {}", l.nama);
        } else {
            println!("  {tanda} {}: {}", l.nama, l.pesan);
        }
    }
    let (_, teks) = ringkasan(&langkah);
    if kode == 0 {
        println!("\n{} {teks}", "✔".green().bold());
    } else {
        eprintln!("\n{} {teks}", "ERROR:".red().bold());
    }
    kode
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::entri_registry;
    use tempfile::TempDir;

    #[test]
    fn periksa_menolak_konfirmasi_beda() {
        let tmp = TempDir::new().unwrap();
        assert!(periksa("app-a", "app-b", &["app-a".into()], tmp.path()).is_err());
    }

    #[test]
    fn periksa_menolak_nama_tidak_sah_dan_tidak_terdaftar() {
        let tmp = TempDir::new().unwrap();
        assert!(periksa("../lain", "../lain", &["../lain".into()], tmp.path()).is_err());
        assert!(periksa("app-x", "app-x", &["app-a".into()], tmp.path()).is_err());
    }

    #[test]
    fn periksa_mengizinkan_folder_sudah_hilang() {
        let tmp = TempDir::new().unwrap();
        assert!(periksa(
            "app-a",
            "app-a",
            &["app-a".into()],
            &tmp.path().join("app-a")
        )
        .is_ok());
    }

    /// Batas panjang pola API `/^[A-Za-z0-9._-]{1,64}$/` ditegakkan di sini,
    /// bukan di `nama_sah` yang juga dipakai nama repo GitHub sampai 100 karakter.
    #[test]
    fn periksa_menolak_nama_lebih_dari_64_karakter() {
        let tmp = TempDir::new().unwrap();
        let panjang = "a".repeat(65);
        assert!(periksa(
            &panjang,
            &panjang,
            std::slice::from_ref(&panjang),
            tmp.path()
        )
        .is_err());
        let pas = "a".repeat(64);
        assert!(periksa(&pas, &pas, std::slice::from_ref(&pas), tmp.path()).is_ok());
    }

    #[test]
    fn periksa_menolak_repo_sumber_autore() {
        let tmp = TempDir::new().unwrap();
        let folder = tmp.path().join("autore");
        std::fs::create_dir_all(folder.join("cli")).unwrap();
        std::fs::create_dir_all(folder.join("vars")).unwrap();
        std::fs::write(folder.join("cli/Cargo.toml"), "[package]").unwrap();
        std::fs::write(folder.join("vars/autorePipeline.groovy"), "def call() {}").unwrap();
        let err = periksa("autore", "autore", &["autore".into()], &folder).unwrap_err();
        assert!(
            err.contains("Autore"),
            "pesan harus menyebut repo sumber: {err}"
        );
    }

    #[test]
    fn ringkasan_keluar_satu_bila_ada_langkah_gagal() {
        let langkah = vec![
            HasilLangkah {
                nama: "container",
                berhasil: true,
                pesan: String::new(),
            },
            HasilLangkah {
                nama: "job Jenkins",
                berhasil: false,
                pesan: "HTTP 500".into(),
            },
        ];
        let (kode, teks) = ringkasan(&langkah);
        assert_eq!(kode, 1);
        assert!(teks.contains("job Jenkins"));
        assert!(teks.contains("HTTP 500"));
    }

    #[test]
    fn ringkasan_keluar_nol_bila_semua_berhasil() {
        let langkah = vec![HasilLangkah {
            nama: "registry",
            berhasil: true,
            pesan: "baris dibuang".into(),
        }];
        let (kode, _) = ringkasan(&langkah);
        assert_eq!(kode, 0);
    }

    /// `hapus_port` false berarti "tidak ada baris ATAU gagal tulis/baca".
    /// Berkas ada tetapi tak terbaca wajib dilaporkan GAGAL, bukan bersih.
    #[test]
    fn langkah_registry_tak_terbaca_dilaporkan_gagal() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("registry.tsv"), [0xff, 0xfe, 0x00]).unwrap();
        let hasil = langkah_registry(tmp.path(), "app-a");
        assert!(
            !hasil.berhasil,
            "registry non-UTF8 tidak boleh dianggap bersih"
        );
    }

    #[test]
    fn langkah_registry_berkas_hilang_dianggap_berhasil() {
        let tmp = TempDir::new().unwrap();
        assert!(langkah_registry(tmp.path(), "app-a").berhasil);
    }

    #[test]
    fn langkah_registry_baris_masih_ada_dilaporkan_gagal() {
        let tmp = TempDir::new().unwrap();
        // Folder bernama registry.tsv: tulis gagal, baca juga gagal -> GAGAL.
        std::fs::create_dir(tmp.path().join("registry.tsv")).unwrap();
        assert!(!langkah_registry(tmp.path(), "app-a").berhasil);
    }

    #[test]
    fn konfirmasi_beda_tidak_menyentuh_apa_pun() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        std::fs::write(ws.join("registry.tsv"), "app-a\t8000\t8083\n").unwrap();
        std::fs::create_dir_all(ws.join("app-a")).unwrap();
        let (kode, langkah) = jalankan_dengan("app-a", "app-b", ws, None);
        assert_eq!(kode, 1);
        assert!(langkah.iter().any(|l| l.nama == "periksa" && !l.berhasil));
        assert_eq!(entri_registry(ws).len(), 1);
        assert!(ws.join("app-a").exists());
        assert!(!std::fs::read_dir(ws).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".bak-")));
    }

    /// Docker palsu di PATH depan: tes orkestrasi tidak boleh menyentuh daemon
    /// Docker nyata. PATH lama dipulihkan saat guard jatuh (Drop).
    #[cfg(unix)]
    struct DockerPalsu {
        _kunci: std::sync::MutexGuard<'static, ()>,
        path_lama: std::ffi::OsString,
        pub(crate) log: std::path::PathBuf,
    }

    #[cfg(unix)]
    impl DockerPalsu {
        fn pasang(tmp: &Path) -> Self {
            let kunci = workspace::KUNCI_ENV_WS
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let bin = tmp.join("bin-palsu");
            std::fs::create_dir_all(&bin).unwrap();
            let log = tmp.join("docker.log");
            let stub = bin.join("docker");
            std::fs::write(
                &stub,
                format!(
                    "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\nexit 0\n",
                    log.display()
                ),
            )
            .unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
            let path_lama = std::env::var_os("PATH").unwrap_or_default();
            let path_baru = format!("{}:{}", bin.display(), path_lama.to_string_lossy());
            std::env::set_var("PATH", path_baru);
            Self {
                _kunci: kunci,
                path_lama,
                log,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for DockerPalsu {
        fn drop(&mut self) {
            std::env::set_var("PATH", &self.path_lama);
        }
    }

    #[cfg(unix)]
    #[test]
    fn jenkins_tidak_terkonfigurasi_tetap_membersihkan_registry_dan_folder() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        let _docker = DockerPalsu::pasang(ws);
        std::fs::write(ws.join("registry.tsv"), "app-a\t8000\t8083\n").unwrap();
        std::fs::create_dir_all(ws.join("app-a")).unwrap();
        let (kode, langkah) = jalankan_dengan("app-a", "app-a", ws, None);
        assert_eq!(kode, 1);
        let job = langkah
            .iter()
            .find(|l| l.nama == "job Jenkins")
            .expect("langkah job Jenkins harus ada");
        assert!(!job.berhasil);
        assert!(
            job.pesan.contains("jenkins.conf"),
            "pesan harus menyebut jenkins.conf: {}",
            job.pesan
        );
        assert!(entri_registry(ws).is_empty());
        assert!(!ws.join("app-a").exists());
        assert!(std::fs::read_dir(ws).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("registry.tsv.bak-")));
        // Container dipanggil lewat argv, bukan shell, dan namanya tepat.
        let log = std::fs::read_to_string(&_docker.log).unwrap();
        assert_eq!(log, "rm\n-f\napp-a\n");
        assert!(langkah.iter().any(|l| l.nama == "container" && l.berhasil));
    }

    #[cfg(unix)]
    #[test]
    fn environments_dibersihkan_dan_app_lain_dipertahankan() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        let _docker = DockerPalsu::pasang(ws);
        std::fs::write(
            ws.join("registry.tsv"),
            "app-a\t8000\t8083\napp-b\t8000\t8093\n",
        )
        .unwrap();
        std::fs::write(
            ws.join("environments.json"),
            r#"{"app-a":{"staging":{"deploy_port":8300}},"app-b":{"staging":{"deploy_port":8302}}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(ws.join("app-a")).unwrap();
        std::fs::create_dir_all(ws.join("app-b")).unwrap();
        let (kode, langkah) = jalankan_dengan("app-a", "app-a", ws, None);
        assert_eq!(kode, 1); // hanya langkah Jenkins yang gagal (cfg None)
        assert!(langkah
            .iter()
            .filter(|l| !l.berhasil)
            .all(|l| l.nama == "job Jenkins"));
        let env: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(ws.join("environments.json")).unwrap())
                .unwrap();
        assert!(env.get("app-a").is_none());
        assert!(env.get("app-b").is_some());
        assert_eq!(entri_registry(ws), vec![("app-b".to_string(), 8000, 8093)]);
        assert!(ws.join("app-b").exists());
        assert!(std::fs::read_dir(ws).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("environments.json.bak-")));
    }

    /// Baris legacy dua kolom milik app LAIN harus tersalin byte-per-byte.
    #[cfg(unix)]
    #[test]
    fn registry_baris_legacy_app_lain_tetap_verbatim() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        let _docker = DockerPalsu::pasang(ws);
        let reg = ws.join("registry.tsv");
        std::fs::write(&reg, "app-a\t8000\t8083\r\nlain\t8000\r\n").unwrap();
        let (kode, _) = jalankan_dengan("app-a", "app-a", ws, None);
        assert_eq!(kode, 1);
        assert_eq!(std::fs::read_to_string(&reg).unwrap(), "lain\t8000\r\n");
    }
}
