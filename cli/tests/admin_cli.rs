//! Tes integrasi Admin Commands: biner `autore` sungguhan, layanan sungguhan TIDAK disentuh.
//!
//! Cara: `systemctl`, `journalctl`, `id`, dan `npm` diganti skrip tiruan di direktori sementara
//! yang diletakkan paling depan di PATH; argv tiap panggilan dicatat ke `$AUTORE_TES_LOG`.
//! State selalu dialihkan (`XDG_STATE_HOME`, `AUTORE_WEB_DIR`) supaya tidak menyentuh
//! `~/.local/state/autore` milik mesin.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn tulis_shim(dir: &Path, nama: &str, isi: &str) {
    let jalur = dir.join(nama);
    std::fs::write(&jalur, isi).unwrap();
    let mut izin = std::fs::metadata(&jalur).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut izin, 0o755);
    std::fs::set_permissions(&jalur, izin).unwrap();
}

/// Direktori shim + direktori kerja tes; dihapus saat tes selesai.
struct Shim {
    dir: PathBuf,
    kerja: PathBuf,
}

impl Shim {
    fn baru(nama: &str) -> Shim {
        let akar = std::env::temp_dir().join(format!("autore-tes-admin-{}-{nama}", std::process::id()));
        let _ = std::fs::remove_dir_all(&akar);
        let dir = akar.join("bin");
        let kerja = akar.join("kerja");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&kerja).unwrap();

        tulis_shim(
            &dir,
            "systemctl",
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 'systemd 255'; exit 0; fi\n\
             echo \"$@\" >> \"$AUTORE_TES_LOG\"\n\
             if [ \"$1\" = \"--user\" ] && [ \"$2\" = \"is-active\" ]; then echo active; echo active; exit 0; fi\n\
             if [ \"$1\" = \"--user\" ] && [ \"$2\" = \"cat\" ]; then echo '[Unit]'; exit 0; fi\n\
             exit 0\n",
        );
        tulis_shim(
            &dir,
            "journalctl",
            "#!/bin/sh\necho \"$@\" >> \"$AUTORE_TES_LOG\"\necho journalctl-ok\nexit 0\n",
        );
        tulis_shim(
            &dir,
            "id",
            "#!/bin/sh\nif [ \"$1\" = \"-un\" ]; then echo \"$AUTORE_TES_PENGGUNA\"; exit 0; fi\nexit 0\n",
        );
        tulis_shim(&dir, "npm", "#!/bin/sh\nsleep 1\nexit 0\n");

        Shim { dir, kerja }
    }

    fn log(&self) -> PathBuf {
        self.kerja.join("panggilan.log")
    }

    fn isi_log(&self) -> String {
        std::fs::read_to_string(self.log()).unwrap_or_default()
    }

    fn path(&self) -> String {
        format!(
            "{}:{}",
            self.dir.display(),
            std::env::var("PATH").unwrap_or_default()
        )
    }

    fn web(&self) -> PathBuf {
        let web = self.kerja.join("web");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::write(web.join("package.json"), "{}").unwrap();
        web
    }

    fn perintah(&self, pengguna: &str) -> Command {
        let mut perintah = Command::new(env!("CARGO_BIN_EXE_autore"));
        perintah
            .env("PATH", self.path())
            .env("AUTORE_TES_LOG", self.log())
            .env("AUTORE_TES_PENGGUNA", pengguna)
            .env("XDG_STATE_HOME", self.kerja.join("state"))
            .env("AUTORE_WEB_DIR", self.web())
            .current_dir(&self.kerja);
        perintah
    }

    fn jalankan(&self, argumen: &[&str]) -> (i32, String) {
        let hasil = self.perintah("tugure").args(argumen).output().unwrap();
        (hasil.status.code().unwrap_or(-1), gabung(&hasil))
    }

    fn jalankan_sebagai(&self, pengguna: &str, argumen: &[&str]) -> (i32, String) {
        let hasil = self.perintah(pengguna).args(argumen).output().unwrap();
        (hasil.status.code().unwrap_or(-1), gabung(&hasil))
    }

    fn jalankan_menu(&self, menu: &str, admin: &str) -> (i32, String) {
        let hasil = self
            .perintah("tugure")
            .env("AUTORE_MENU_PILIHAN", menu)
            .env("AUTORE_ADMIN_PILIHAN", admin)
            .output()
            .unwrap();
        (hasil.status.code().unwrap_or(-1), gabung(&hasil))
    }
}

fn gabung(hasil: &std::process::Output) -> String {
    let mut teks = String::from_utf8_lossy(&hasil.stdout).to_string();
    teks.push_str(&String::from_utf8_lossy(&hasil.stderr));
    teks
}

impl Drop for Shim {
    fn drop(&mut self) {
        if let Some(akar) = self.kerja.parent() {
            let _ = std::fs::remove_dir_all(akar);
        }
    }
}

#[test]
fn start_memanggil_systemctl_satu_kali_dua_unit() {
    let shim = Shim::baru("start_memanggil_systemctl_satu_kali_dua_unit");
    let (kode, teks) = shim.jalankan(&["start"]);
    assert_eq!(kode, 0, "{teks}");
    let log = shim.isi_log();
    let baris: Vec<&str> = log.lines().filter(|b| b.contains(" start ")).collect();
    assert_eq!(
        baris,
        vec!["--user start autore-web-api autore-web-dashboard"],
        "log: {log:?}"
    );
    assert!(teks.contains("[OK] autore-web-api: aktif"), "{teks}");
    assert!(teks.is_ascii(), "keluaran memuat non-ASCII: {teks:?}");
}

#[test]
fn stop_dan_restart_memakai_aksi_benar() {
    let shim = Shim::baru("stop_dan_restart_memakai_aksi_benar");
    let (kode_stop, teks_stop) = shim.jalankan(&["stop"]);
    assert_eq!(kode_stop, 0, "{teks_stop}");
    let (kode_restart, teks_restart) = shim.jalankan(&["restart"]);
    assert_eq!(kode_restart, 0, "{teks_restart}");

    let log = shim.isi_log();
    assert!(
        log.contains("--user stop autore-web-api autore-web-dashboard"),
        "{log:?}"
    );
    assert!(
        log.contains("--user restart autore-web-api autore-web-dashboard"),
        "{log:?}"
    );
}

#[test]
fn alias_st_membuka_bantuan_status() {
    let shim = Shim::baru("alias_st_membuka_bantuan_status");
    let (kode, teks) = shim.jalankan(&["st", "--help"]);
    assert_eq!(kode, 0, "{teks}");
    assert!(teks.contains("--json"), "alias st tidak menunjuk status: {teks}");
}

#[test]
fn pengguna_lain_ditolak_tanpa_memanggil_systemctl() {
    let shim = Shim::baru("pengguna_lain_ditolak_tanpa_memanggil_systemctl");
    let (kode, teks) = shim.jalankan_sebagai("mectov", &["restart"]);
    assert_eq!(kode, 1, "{teks}");
    assert!(
        teks.contains("[!] Akses ditolak. Silakan jalankan sebagai user yang sesuai."),
        "{teks}"
    );
    assert!(shim.isi_log().is_empty(), "systemctl tidak boleh dipanggil");
}

#[test]
fn logs_no_follow_meneruskan_keluaran_journalctl() {
    let shim = Shim::baru("logs_no_follow_meneruskan_keluaran_journalctl");
    let (kode, teks) = shim.jalankan(&["logs", "--no-follow"]);
    assert_eq!(kode, 0, "{teks}");
    assert!(teks.contains("journalctl-ok"), "{teks}");
    let log = shim.isi_log();
    assert!(
        log.contains("--user -u autore-web-api -u autore-web-dashboard"),
        "{log:?}"
    );
    assert!(!log.contains("-f"), "mode no-follow tidak boleh memakai -f: {log:?}");
}

#[test]
fn menu_4_lalu_1_menjalankan_start() {
    let shim = Shim::baru("menu_4_lalu_1_menjalankan_start");
    let (kode, teks) = shim.jalankan_menu("4", "1");
    assert_eq!(kode, 0, "{teks}");
    assert!(
        shim.isi_log()
            .contains("--user start autore-web-api autore-web-dashboard"),
        "menu [4] -> [1] harus memanggil start: {teks}"
    );
}

#[test]
fn tanpa_systemd_start_menulis_pid() {
    let shim = Shim::baru("tanpa_systemd_start_menulis_pid");
    let hasil = shim
        .perintah("tugure")
        .env("AUTORE_TANPA_SYSTEMD", "1")
        .arg("start")
        .output()
        .unwrap();
    let (kode, teks) = (hasil.status.code().unwrap_or(-1), gabung(&hasil));
    assert_eq!(kode, 0, "{teks}");
    assert!(
        teks.contains("[i] systemctl tidak tersedia. Memakai jalur tanpa systemd."),
        "{teks}"
    );
    let state = shim.kerja.join("state").join("autore");
    for berkas in ["api.pid", "dashboard.pid"] {
        let jalur = state.join(berkas);
        assert!(jalur.exists(), "{} belum ditulis: {teks}", jalur.display());
        let isi = std::fs::read_to_string(&jalur).unwrap();
        assert!(
            isi.trim().parse::<u32>().is_ok(),
            "isi {} bukan PID: {isi:?}",
            jalur.display()
        );
    }
}