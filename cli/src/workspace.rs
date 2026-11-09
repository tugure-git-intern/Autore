//! Manajemen direktori kerja, alokasi port deploy, dan pencatatan registry aplikasi.
//!
//! Seluruh state runtime file-backed disimpan di workspace (`~/autore-workspace`).

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Direktori kerja utama Autore: hormati `AUTORE_WORKSPACE`, atau jatuh ke `~/autore-workspace`.
pub(crate) fn workspace_dir() -> PathBuf {
    if let Ok(p) = std::env::var("AUTORE_WORKSPACE") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join("autore-workspace")
}

/// Satu project yang tercatat di `registry.tsv`.
pub(crate) struct Proyek {
    pub(crate) nama: String,
    pub(crate) deploy_port: u16,
}

/// Baca catatan project di workspace (dibuat saat pertama kali deploy).
/// Baris rusak dilewati, bukan bikin seluruh daftar hilang.
pub(crate) fn baca_registry(workspace: &Path) -> Vec<Proyek> {
    entri_registry(workspace)
        .into_iter()
        .map(|(nama, _app, deploy_port)| Proyek { nama, deploy_port })
        .collect()
}

/// Nama container yang sedang jalan. `None` = docker tidak bisa ditanya, supaya
/// pemanggil bisa bilang "tidak diketahui" alih-alih menuduh aplikasi mati.
pub(crate) fn container_jalan() -> Option<Vec<String>> {
    let out = Command::new("docker")
        .args(["ps", "--format", "{{.Names}}"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|b| b.trim().to_string())
            .filter(|b| !b.is_empty())
            .collect(),
    )
}

/// Rentang port deploy di host: kebiasaan lama kelipatan 10 dari 8003, lalu celah lain.
const PORT_AWAL: u16 = 8003;
const PORT_TENGAH: u16 = 8200;
const PORT_AKHIR: u16 = 9000;

/// Port deploy untuk `nama`. Port lama dipakai ulang kalau sudah terdaftar; port
/// pilihan pengguna ditolak kalau sudah dikunci aplikasi lain atau sedang hidup —
/// tidak pernah diganti diam-diam. Tidak menulis registry: pakai `catat_port`
/// setelah aplikasi benar-benar dibuat.
pub(crate) fn pilih_port(
    workspace: &Path,
    nama: &str,
    pilihan: Option<u16>,
) -> Result<(u16, u16), String> {
    // Port DI DALAM container selalu 8000: tiap container punya jaringan sendiri,
    // jadi tidak pernah bentrok. Yang harus unik adalah port di host (deploy).
    const APP_PORT: u16 = 8000;

    if let Some(p) = pilihan {
        if let Some(pemilik) = pemilik_port(workspace, nama, p) {
            return Err(pesan_port_bentrok(
                workspace,
                nama,
                p,
                &format!("sudah dipakai aplikasi '{pemilik}'"),
            ));
        }
        if !port_bebas(p) {
            return Err(pesan_port_bentrok(
                workspace,
                nama,
                p,
                "sedang dipakai proses lain di server ini",
            ));
        }
        return Ok((APP_PORT, p));
    }

    if let Some(lama) = baca_registry(workspace)
        .iter()
        .find(|proyek| proyek.nama == nama)
        .map(|proyek| proyek.deploy_port)
    {
        return Ok((APP_PORT, lama));
    }

    match saran_port_bebas(workspace, nama) {
        Some(p) => Ok((APP_PORT, p)),
        None => Err(format!(
            "Tidak ada port bebas di rentang {PORT_AWAL}-{PORT_AKHIR}. Bersihkan registry.tsv atau hentikan container lama."
        )),
    }
}

/// Kunci port aplikasi di `registry.tsv` (tambah kalau baru, segarkan kalau sudah
/// ada) supaya aplikasi berikutnya tidak diberi port yang sama.
pub(crate) fn catat_port(
    workspace: &Path,
    nama: &str,
    app_port: u16,
    deploy_port: u16,
) {
    let mut baris = entri_registry(workspace);
    match baris.iter_mut().find(|(n, _, _)| n == nama) {
        Some(entri) => {
            entri.1 = app_port;
            entri.2 = deploy_port;
        }
        None => baris.push((nama.to_string(), app_port, deploy_port)),
    }
    let isi: String = baris
        .iter()
        .map(|(n, a, d)| format!("{n}\t{a}\t{d}\n"))
        .collect();
    let reg = workspace.join("registry.tsv");
    if let Err(e) = std::fs::write(&reg, isi) {
        eprintln!("WARNING: gagal menulis {}: {e}", reg.display());
    }
}

#[cfg(test)]
fn alokasi_port(
    workspace: &Path,
    nama: &str,
    pilihan: Option<u16>,
) -> Result<(u16, u16), String> {
    let (app_port, deploy_port) = pilih_port(workspace, nama, pilihan)?;
    catat_port(workspace, nama, app_port, deploy_port);
    Ok((app_port, deploy_port))
}

/// Nama aplikasi lain yang sudah mengunci `port` di registry.
fn pemilik_port(workspace: &Path, nama: &str, port: u16) -> Option<String> {
    baca_registry(workspace)
        .into_iter()
        .find(|proyek| proyek.deploy_port == port && proyek.nama != nama)
        .map(|proyek| proyek.nama)
}

/// Port yang belum dikunci aplikasi lain **dan** belum di-listen proses mana pun.
fn saran_port_bebas(workspace: &Path, nama: &str) -> Option<u16> {
    let terkunci: Vec<u16> = baca_registry(workspace)
        .into_iter()
        .filter(|proyek| proyek.nama != nama)
        .map(|proyek| proyek.deploy_port)
        .collect();
    let kelipatan_sepuluh = (PORT_AWAL..PORT_TENGAH).step_by(10);
    #[allow(clippy::manual_is_multiple_of)]
    let celah = (PORT_AWAL..=PORT_AKHIR).filter(|p| (p - PORT_AWAL) % 10 != 0);
    kelipatan_sepuluh
        .chain(celah)
        .find(|p| !terkunci.contains(p) && port_bebas(*p))
}

fn pesan_port_bentrok(
    workspace: &Path,
    nama: &str,
    port: u16,
    sebab: &str,
) -> String {
    let saran = saran_port_bebas(workspace, nama)
        .map(|p| p.to_string())
        .unwrap_or_else(|| "(tidak ada)".to_string());
    format!("Port {port} {sebab}. Saran port bebas: {saran}.")
}

/// Semua baris `registry.tsv` utuh (nama, port app, port deploy) untuk ditulis ulang.
fn entri_registry(workspace: &Path) -> Vec<(String, u16, u16)> {
    const APP_PORT: u16 = 8000;
    let mut out = Vec::new();
    let Ok(isi) = std::fs::read_to_string(workspace.join("registry.tsv")) else {
        return out;
    };
    for baris in isi.lines() {
        let mut it = baris.split('\t');
        let nama = it.next().unwrap_or("").trim();
        if nama.is_empty() {
            continue;
        }
        let app = it
            .next()
            .and_then(|a| a.trim().parse::<u16>().ok())
            .unwrap_or(APP_PORT);
        let Some(deploy) = it.next().and_then(|d| d.trim().parse::<u16>().ok()) else {
            continue;
        };
        out.push((nama.to_string(), app, deploy));
    }
    out
}

fn port_bebas(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Port yang baru saja dibebaskan kernel: dipakai tes port pilihan pengguna
    /// supaya tidak bergantung pada port mana yang kebetulan hidup di server ini.
    fn port_bebas_baru() -> u16 {
        let tahan = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = tahan.local_addr().unwrap().port();
        drop(tahan);
        port
    }

    #[test]
    fn alokasi_port_memakai_ulang_port_project_lama() {
        let tmp = TempDir::new().unwrap();
        let (a1, d1) = alokasi_port(tmp.path(), "proj-a", None).unwrap();
        let (a2, d2) = alokasi_port(tmp.path(), "proj-a", None).unwrap();
        assert_eq!((a1, d1), (a2, d2));
        assert_eq!(a1, 8000, "port dalam container selalu 8000");
        assert!(d1 >= 8003);
        let (a3, d3) = alokasi_port(tmp.path(), "proj-b", None).unwrap();
        assert_eq!(a3, 8000);
        assert_ne!(d1, d3, "port host harus beda tiap project");
    }

    #[test]
    fn alokasi_port_menyimpan_port_pilihan_pengguna() {
        let tmp = TempDir::new().unwrap();
        let port = port_bebas_baru();
        let (a1, d1) = alokasi_port(tmp.path(), "proj-custom", Some(port)).unwrap();
        assert_eq!(d1, port);
        assert_eq!(a1, 8000);
        let daftar = baca_registry(tmp.path());
        assert_eq!(daftar.len(), 1);
        assert_eq!(daftar[0].nama, "proj-custom");
        assert_eq!(daftar[0].deploy_port, port);
    }

    #[test]
    fn pilih_port_menolak_port_pilihan_yang_sudah_terdaftar() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("registry.tsv"), "lain\t8000\t8088\n").unwrap();
        let err = pilih_port(tmp.path(), "baru", Some(8088)).unwrap_err();
        assert!(err.contains("8088"), "pesan harus menyebut portnya: {err}");
        assert!(
            err.contains("Saran port bebas"),
            "pesan harus menawarkan port lain: {err}"
        );
    }

    #[test]
    fn pilih_port_menolak_port_pilihan_yang_sedang_hidup() {
        let tmp = TempDir::new().unwrap();
        let tahan = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = tahan.local_addr().unwrap().port();
        let err = pilih_port(tmp.path(), "baru", Some(port)).unwrap_err();
        assert!(
            err.contains(&port.to_string()),
            "pesan harus menyebut portnya: {err}"
        );
    }

    #[test]
    fn pilih_port_melewati_port_yang_sudah_dikunci_registry() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("registry.tsv"), "lain\t8000\t8003\n").unwrap();
        let (app, deploy) = pilih_port(tmp.path(), "baru", None).unwrap();
        assert_eq!(app, 8000);
        assert_ne!(deploy, 8003, "port yang sudah dikunci aplikasi lain dipakai ulang");
    }

    #[test]
    fn pilih_port_memakai_ulang_port_aplikasi_yang_sama() {
        let tmp = TempDir::new().unwrap();
        catat_port(tmp.path(), "aku", 8000, 8090);
        catat_port(tmp.path(), "lain", 8000, 8003);
        assert_eq!(pilih_port(tmp.path(), "aku", None).unwrap().1, 8090);
    }

    #[test]
    fn catat_port_menambah_dan_menyegarkan_tanpa_menggusur_lain() {
        let tmp = TempDir::new().unwrap();
        catat_port(tmp.path(), "satu", 8000, 8003);
        catat_port(tmp.path(), "dua", 8000, 8013);
        catat_port(tmp.path(), "satu", 8000, 8023);
        let daftar = baca_registry(tmp.path());
        assert_eq!(daftar.len(), 2, "baris nama yang sama disegarkan, bukan digandakan");
        assert_eq!(daftar[0].nama, "satu");
        assert_eq!(daftar[0].deploy_port, 8023);
        assert_eq!(daftar[1].nama, "dua");
    }

    #[test]
    fn pilih_port_memberi_port_berbeda_untuk_tiga_nama() {
        let tmp = TempDir::new().unwrap();
        let mut dipakai = Vec::new();
        for nama in ["port-a", "port-b", "port-c"] {
            dipakai.push(alokasi_port(tmp.path(), nama, None).unwrap().1);
        }
        let jumlah_unik = {
            let mut u = dipakai.clone();
            u.sort_unstable();
            u.dedup();
            u.len()
        };
        assert_eq!(jumlah_unik, 3, "tiap aplikasi baru harus dapat port sendiri: {dipakai:?}");
        assert_eq!(baca_registry(tmp.path()).len(), 3);
    }

    #[test]
    fn pilih_port_melebar_kalau_tangga_sepuluhan_habis() {
        let tmp = TempDir::new().unwrap();
        let isi: String = (1..=20)
            .map(|i| format!("app-{i}\t8000\t{}\n", 8003 + i * 10))
            .collect();
        std::fs::write(tmp.path().join("registry.tsv"), isi).unwrap();
        let (_, deploy) = pilih_port(tmp.path(), "baru", None).unwrap();
        let dipakai: Vec<u16> = baca_registry(tmp.path())
            .iter()
            .map(|p| p.deploy_port)
            .collect();
        assert!(
            !dipakai.contains(&deploy),
            "port {deploy} sudah dipakai aplikasi lain"
        );
        assert!((8000..=9000).contains(&deploy), "port di luar rentang wajar: {deploy}");
    }

    #[test]
    fn baca_registry_melewati_baris_rusak() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("registry.tsv"),
            "web-a\t8000\t8003\n\nrusak-tanpa-port\nweb-b\t8000\t8013\n",
        )
        .unwrap();
        let daftar = baca_registry(tmp.path());
        assert_eq!(daftar.len(), 2, "baris rusak tidak masuk");
        assert_eq!(daftar[0].nama, "web-a");
        assert_eq!(daftar[0].deploy_port, 8003);
        assert_eq!(daftar[1].nama, "web-b");
    }

    #[test]
    fn baca_registry_kosong_kalau_belum_ada_catatan() {
        let tmp = TempDir::new().unwrap();
        assert!(baca_registry(tmp.path()).is_empty());
    }

    #[test]
    fn workspace_dir_menghasilkan_path() {
        let w = workspace_dir();
        assert!(!w.as_os_str().is_empty());

        std::env::set_var("AUTORE_WORKSPACE", "/tmp/autore-custom-ws");
        let w2 = workspace_dir();
        assert_eq!(w2, PathBuf::from("/tmp/autore-custom-ws"));
        std::env::remove_var("AUTORE_WORKSPACE");
    }

    #[test]
    fn port_bebas_memeriksa_port() {
        let _ = port_bebas(1024);
    }
}
