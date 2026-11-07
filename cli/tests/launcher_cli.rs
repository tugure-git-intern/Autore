//! Tes integrasi Friendly Launcher: biner `autore` sungguhan, layanan sungguhan TIDAK disentuh.
//!
//! Cara: `systemctl`, `tailscale`, dan `id` diganti skrip tiruan di direktori sementara yang
//! diletakkan paling depan di PATH. Port 9120/9121 dijaga hidup oleh listener milik tes supaya
//! hasilnya tidak bergantung pada layanan yang kebetulan sedang jalan.

#![cfg(unix)]

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;

fn tulis_shim(dir: &Path, nama: &str, isi: &str) {
    let jalur = dir.join(nama);
    std::fs::write(&jalur, isi).unwrap();
    let mut izin = std::fs::metadata(&jalur).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut izin, 0o755);
    std::fs::set_permissions(&jalur, izin).unwrap();
}

/// Direktori shim; isinya dihapus saat tes selesai.
struct Shim {
    dir: PathBuf,
    _penjaga: Vec<TcpListener>,
}

impl Shim {
    fn baru(nama: &str) -> Shim {
        let dir = std::env::temp_dir().join(format!(
            "autore-tes-launcher-{}-{nama}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        tulis_shim(
            &dir,
            "systemctl",
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 'systemd 255'; exit 0; fi\n\
             if [ \"$1\" = \"--user\" ] && [ \"$2\" = \"is-active\" ]; then echo active; echo active; exit 0; fi\n\
             if [ \"$1\" = \"--user\" ] && [ \"$2\" = \"cat\" ]; then echo '[Unit]'; exit 0; fi\n\
             exit 0\n",
        );
        tulis_shim(&dir, "tailscale", "#!/bin/sh\necho 100.80.3.14\n");
        tulis_shim(&dir, "id", "#!/bin/sh\nif [ \"$1\" = \"-un\" ]; then echo \"${AUTORE_TES_PENGGUNA:-tugure}\"; exit 0; fi\nexit 0\n");

        // Port siap: kalau bebas, tes sendiri yang memegangnya; kalau sudah dipakai layanan
        // nyata, biarkan (dua-duanya berarti port menerima koneksi).
        let _penjaga = [9120u16, 9121]
            .iter()
            .filter_map(|port| TcpListener::bind(("127.0.0.1", *port)).ok())
            .collect();

        Shim { dir, _penjaga }
    }

    fn jalankan(&self, pilihan: Option<&str>, pengguna: &str) -> (i32, String) {
        let path = format!(
            "{}:{}",
            self.dir.display(),
            std::env::var("PATH").unwrap_or_default()
        );
        let mut perintah = Command::new(env!("CARGO_BIN_EXE_autore"));
        perintah.env("PATH", path).env("AUTORE_TES_PENGGUNA", pengguna);
        if let Some(pilihan) = pilihan {
            perintah.env("AUTORE_MENU_PILIHAN", pilihan);
        }
        let hasil = perintah.output().unwrap();
        let mut teks = String::from_utf8_lossy(&hasil.stdout).to_string();
        teks.push_str(&String::from_utf8_lossy(&hasil.stderr));
        (hasil.status.code().unwrap_or(-1), teks)
    }
}

impl Drop for Shim {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn pilihan_1_menampilkan_url_dan_catatan_penutup() {
    let shim = Shim::baru("pilihan_1_menampilkan_url_dan_catatan_penutup");
    let (kode, teks) = shim.jalankan(Some("1"), "tugure");
    assert_eq!(kode, 0, "{teks}");
    assert!(teks.contains("[OK] autore-web-dashboard: aktif"), "{teks}");
    assert!(teks.contains("http://localhost:9120"), "{teks}");
    assert!(teks.contains("http://100.80.3.14:9120"), "{teks}");
    assert!(
        teks.contains("Catatan: Anda dapat menutup terminal ini. Dashboard akan tetap berjalan di background."),
        "{teks}"
    );
}

#[test]
fn seluruh_keluaran_ascii_tanpa_emoji() {
    let shim = Shim::baru("seluruh_keluaran_ascii_tanpa_emoji");
    let (_, teks) = shim.jalankan(Some("1"), "tugure");
    assert!(teks.is_ascii(), "keluaran memuat non-ASCII: {teks:?}");
}

#[test]
fn pengguna_lain_ditolak_tanpa_menyentuh_systemd() {
    let shim = Shim::baru("pengguna_lain_ditolak_tanpa_menyentuh_systemd");
    let (kode, teks) = shim.jalankan(Some("1"), "mectov");
    assert_eq!(kode, 1, "{teks}");
    assert!(
        teks.contains("[!] Akses ditolak. Silakan jalankan sebagai user yang sesuai."),
        "{teks}"
    );
    assert!(!teks.contains("URL Dashboard:"), "jangan lanjut ke URL: {teks}");
}

#[test]
fn pilihan_3_keluar_bersih() {
    let shim = Shim::baru("pilihan_3_keluar_bersih");
    let (kode, teks) = shim.jalankan(Some("3"), "tugure");
    assert_eq!(kode, 0, "{teks}");
    assert!(!teks.contains("URL Dashboard:"), "{teks}");
    assert!(!teks.contains("[OK]"), "{teks}");
}

#[test]
fn stdout_bukan_terminal_menampilkan_panduan() {
    let shim = Shim::baru("stdout_bukan_terminal_menampilkan_panduan");
    let (kode, teks) = shim.jalankan(None, "tugure");
    assert_eq!(kode, 0, "{teks}");
    assert!(teks.contains("autore status"), "{teks}");
    assert!(teks.contains("autore --help"), "{teks}");
    assert!(!teks.contains("URL Dashboard:"), "{teks}");
}