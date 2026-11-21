//! `environments.json`: entri staging + production untuk setiap app di registry.
//!
//! Satu sumber kebenaran untuk target deploy. Entri lama tidak pernah ditimpa;
//! command ini hanya menambah app yang belum punya entri, lalu menulis atomik.

use crate::workspace;
use clap::{Args, Subcommand};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

/// Label target staging saat staging masih di VPS yang sama dengan production.
pub(crate) const STAGING_TARGET: &str = "vps-staging";
const PORT_AWAL: u16 = 8300;
const PORT_AKHIR: u16 = 8399;

#[derive(Debug, PartialEq)]
pub(crate) struct Laporan {
    pub(crate) ditambah: Vec<String>,
    pub(crate) dipertahankan: Vec<String>,
}

#[derive(Subcommand)]
pub(crate) enum EnvAction {
    /// Tambah entry staging + production untuk semua app di registry.tsv
    Init(InitArgs),
}

#[derive(Args)]
pub(crate) struct InitArgs {
    /// Wajib: proses semua app di registry.tsv
    #[arg(long, required = true)]
    pub(crate) all: bool,
}

/// Tambah entry untuk semua app di registry. Entri yang sudah ada dipertahankan.
pub(crate) fn init_semua(workspace: &Path) -> Result<Laporan, String> {
    init_semua_dengan(workspace, workspace::port_bebas)
}

fn init_semua_dengan<F>(workspace: &Path, bebas: F) -> Result<Laporan, String>
where
    F: Fn(u16) -> bool,
{
    let entri = workspace::entri_registry(workspace);
    if entri.is_empty() {
        return Err(format!(
            "registry.tsv kosong atau tidak ada di {}",
            workspace.display()
        ));
    }

    let path = workspace.join("environments.json");
    let mut doc = baca_env(&path)?;
    let mut dipakai = port_dipakai(&doc, &entri);
    let mut laporan = Laporan {
        ditambah: Vec::new(),
        dipertahankan: Vec::new(),
    };

    for (nama, app_port, _deploy_port) in entri {
        if doc.contains_key(&nama) {
            laporan.dipertahankan.push(nama);
            continue;
        }

        let (staging, production) = alokasi_dua(&mut dipakai, &bebas)?;
        doc.insert(nama.clone(), entri_json(staging, production, app_port));
        laporan.ditambah.push(nama);
    }

    if !laporan.ditambah.is_empty() {
        tulis_env(&path, &doc)?;
    }
    Ok(laporan)
}

/// Pastikan `nama` punya entri staging + production, lalu kembalikan
/// `(staging_port, production_port, baru_dibuat)`. Dipanggil sebelum Jenkinsfile
/// dirender supaya `deployPort` di repo = port di ledger, dan container staging
/// sudah bisa diakses begitu pipeline pertama selesai (tanpa `env init` terpisah).
pub(crate) fn pastikan_entri(
    workspace: &Path,
    nama: &str,
    app_port: u16,
) -> Result<(u16, u16, bool), String> {
    pastikan_entri_dengan(workspace, nama, app_port, workspace::port_bebas)
}

fn pastikan_entri_dengan<F>(
    workspace: &Path,
    nama: &str,
    app_port: u16,
    bebas: F,
) -> Result<(u16, u16, bool), String>
where
    F: Fn(u16) -> bool,
{
    let path = workspace.join("environments.json");
    let mut doc = baca_env(&path)?;
    if let Some(pair) = port_lingkungan(&doc, nama) {
        return Ok((pair.0, pair.1, false));
    }

    let mut dipakai = port_dipakai(&doc, &workspace::entri_registry(workspace));
    let (staging, production) = alokasi_dua(&mut dipakai, &bebas)?;
    doc.insert(nama.to_string(), entri_json(staging, production, app_port));
    tulis_env(&path, &doc)?;
    Ok((staging, production, true))
}

/// `(staging, production)` yang sudah tercatat untuk `nama`, bila ada.
pub(crate) fn port_tercatat(workspace: &Path, nama: &str) -> Option<(u16, u16)> {
    let doc = baca_env(&workspace.join("environments.json")).ok()?;
    port_lingkungan(&doc, nama)
}

/// `(staging, production)` bila kedua port sudah tercatat untuk `nama`.
fn port_lingkungan(doc: &Map<String, Value>, nama: &str) -> Option<(u16, u16)> {
    let app = doc.get(nama)?;
    let ambil = |lingkungan: &str| -> Option<u16> {
        let port = app.get(lingkungan)?.get("deploy_port")?.as_u64()?;
        u16::try_from(port).ok()
    };
    Some((ambil("staging")?, ambil("production")?))
}

fn entri_json(staging: u16, production: u16, container_port: u16) -> Value {
    json!({
        "staging": {
            "target": STAGING_TARGET,
            "deploy_port": staging
        },
        "production": {
            "target": format!("127.0.0.1:{production}"),
            "deploy_port": production,
            "container_port": container_port
        }
    })
}

/// Buang kunci `nama` dari `environments.json`. `Ok(false)` bila berkas tidak
/// ada atau kunci tidak ada (berkas tidak disentuh); `Err` hanya bila berkas
/// ada tapi rusak atau tidak bisa ditulis. Penulisan atomik lewat `tulis_env`.
pub(crate) fn hapus_app(workspace: &Path, nama: &str) -> Result<bool, String> {
    let path = workspace.join("environments.json");
    let mut doc = baca_env(&path)?;
    if doc.remove(nama).is_none() {
        return Ok(false);
    }
    tulis_env(&path, &doc)?;
    Ok(true)
}

fn baca_env(path: &Path) -> Result<Map<String, Value>, String> {
    match fs::read_to_string(path) {
        Ok(isi) => {
            let nilai: Value = serde_json::from_str(&isi)
                .map_err(|e| format!("{} bukan JSON valid: {e}", path.display()))?;
            match nilai {
                Value::Object(map) => Ok(map),
                _ => Err(format!("{} harus berupa objek JSON", path.display())),
            }
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(format!("gagal membaca {}: {e}", path.display())),
    }
}

fn port_dipakai(doc: &Map<String, Value>, entri: &[(String, u16, u16)]) -> BTreeSet<u16> {
    let mut dipakai = BTreeSet::new();
    for (_, _, deploy) in entri {
        dipakai.insert(*deploy);
    }
    for app in doc.values() {
        for lingkungan in ["staging", "production"] {
            if let Some(port) = app
                .get(lingkungan)
                .and_then(|v| v.get("deploy_port"))
                .and_then(Value::as_u64)
            {
                if port <= u16::MAX as u64 {
                    dipakai.insert(port as u16);
                }
            }
        }
    }
    dipakai
}

fn alokasi_dua<F>(dipakai: &mut BTreeSet<u16>, bebas: &F) -> Result<(u16, u16), String>
where
    F: Fn(u16) -> bool,
{
    let kandidat: Vec<u16> = (PORT_AWAL..=PORT_AKHIR)
        .filter(|port| !dipakai.contains(port) && bebas(*port))
        .collect();
    let pasangan = kandidat
        .windows(2)
        .find(|pair| pair[1] == pair[0] + 1)
        .ok_or_else(|| {
            format!("Tidak ada pasangan port bebas berurutan di {PORT_AWAL}-{PORT_AKHIR}.")
        })?;
    let (staging, production) = (pasangan[0], pasangan[1]);
    dipakai.insert(staging);
    dipakai.insert(production);
    Ok((staging, production))
}

fn tulis_env(path: &Path, doc: &Map<String, Value>) -> Result<(), String> {
    let isi = serde_json::to_string_pretty(doc)
        .map_err(|e| format!("gagal menyusun JSON {}: {e}", path.display()))?;
    let tmp = path.with_file_name(".environments.json.tmp");
    fs::write(&tmp, format!("{isi}\n"))
        .map_err(|e| format!("gagal menulis {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("gagal mengganti {}: {e}", path.display()))
}

pub(crate) fn jalankan(action: EnvAction) -> i32 {
    match action {
        EnvAction::Init(args) => {
            // clap sudah mewajibkan --all; field dibaca agar kontrak CLI tetap jelas.
            let _ = args.all;
            let dir = workspace::workspace_dir();
            match init_semua(&dir) {
                Ok(laporan) => {
                    println!(
                        "==> environments.json: {} ditambah, {} dipertahankan",
                        laporan.ditambah.len(),
                        laporan.dipertahankan.len()
                    );
                    for nama in &laporan.ditambah {
                        println!("  + {nama}");
                    }
                    0
                }
                Err(e) => {
                    eprintln!("ERROR: {e}");
                    1
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;
    use tempfile::TempDir;

    fn tulis_registry(dir: &Path, baris: &[(&str, u16, u16)]) {
        let isi: String = baris
            .iter()
            .map(|(nama, app, deploy)| format!("{nama}\t{app}\t{deploy}\n"))
            .collect();
        fs::write(dir.join("registry.tsv"), isi).unwrap();
    }

    fn baca_json(dir: &Path) -> Value {
        let isi = fs::read_to_string(dir.join("environments.json")).unwrap();
        serde_json::from_str(&isi).unwrap()
    }

    #[test]
    fn init_menambah_staging_dan_production_untuk_setiap_app() {
        let tmp = TempDir::new().unwrap();
        tulis_registry(tmp.path(), &[("app-a", 8000, 8101), ("app-b", 8080, 8102)]);

        let laporan = init_semua_dengan(tmp.path(), |_| true).unwrap();
        assert_eq!(laporan.ditambah.len(), 2);
        assert!(laporan.ditambah.contains(&"app-a".to_string()));
        assert!(laporan.ditambah.contains(&"app-b".to_string()));
        assert!(laporan.dipertahankan.is_empty());

        let doc = baca_json(tmp.path());
        assert_eq!(doc["app-a"]["staging"]["target"], STAGING_TARGET);
        assert_eq!(doc["app-a"]["staging"]["deploy_port"].as_u64(), Some(8300));
        assert_eq!(doc["app-a"]["production"]["target"], "127.0.0.1:8301");
        assert_eq!(
            doc["app-a"]["production"]["deploy_port"].as_u64(),
            Some(8301)
        );
        assert_eq!(
            doc["app-a"]["production"]["container_port"].as_u64(),
            Some(8000)
        );

        assert_eq!(doc["app-b"]["staging"]["deploy_port"].as_u64(), Some(8302));
        assert_eq!(
            doc["app-b"]["production"]["deploy_port"].as_u64(),
            Some(8303)
        );
        assert_eq!(
            doc["app-b"]["production"]["container_port"].as_u64(),
            Some(8080),
            "container_port harus dari registry, bukan hardcode"
        );
    }

    #[test]
    fn entri_lama_dipertahankan_dan_init_idempoten() {
        let tmp = TempDir::new().unwrap();
        tulis_registry(
            tmp.path(),
            &[("tes-testing", 8000, 8154), ("app-baru", 8000, 8102)],
        );
        let lama = json!({
            "tes-testing": {
                "staging": {"target": "vps-staging", "deploy_port": 8153},
                "production": {
                    "target": "127.0.0.1:8154",
                    "deploy_port": 8154,
                    "container_port": 8000
                }
            }
        });
        fs::write(
            tmp.path().join("environments.json"),
            serde_json::to_string_pretty(&lama).unwrap(),
        )
        .unwrap();

        let laporan = init_semua_dengan(tmp.path(), |_| true).unwrap();
        assert_eq!(laporan.ditambah, vec!["app-baru".to_string()]);
        assert_eq!(laporan.dipertahankan, vec!["tes-testing".to_string()]);

        let doc = baca_json(tmp.path());
        assert_eq!(doc["tes-testing"], lama["tes-testing"]);
        assert_eq!(
            doc["app-baru"]["staging"]["deploy_port"].as_u64(),
            Some(8300)
        );

        let setelah_pertama = fs::read_to_string(tmp.path().join("environments.json")).unwrap();
        let kedua = init_semua_dengan(tmp.path(), |_| true).unwrap();
        assert!(kedua.ditambah.is_empty());
        assert_eq!(kedua.dipertahankan.len(), 2);
        assert_eq!(
            fs::read_to_string(tmp.path().join("environments.json")).unwrap(),
            setelah_pertama,
            "run kedua tidak boleh mengubah file"
        );
    }

    #[test]
    fn json_rusak_tidak_ditimpa() {
        let tmp = TempDir::new().unwrap();
        tulis_registry(tmp.path(), &[("app-a", 8000, 8101)]);
        let asli = "{ ini bukan json";
        fs::write(tmp.path().join("environments.json"), asli).unwrap();

        let hasil = init_semua_dengan(tmp.path(), |_| true);
        assert!(hasil.is_err());
        assert_eq!(
            fs::read_to_string(tmp.path().join("environments.json")).unwrap(),
            asli
        );
    }

    #[test]
    fn port_yang_sudah_dipakai_dilewati() {
        let tmp = TempDir::new().unwrap();
        tulis_registry(tmp.path(), &[("app-baru", 8000, 8101)]);
        let lama = json!({
            "app-lama": {
                "staging": {"target": "vps-staging", "deploy_port": 8300},
                "production": {
                    "target": "127.0.0.1:8301",
                    "deploy_port": 8301,
                    "container_port": 8000
                }
            }
        });
        fs::write(
            tmp.path().join("environments.json"),
            serde_json::to_string_pretty(&lama).unwrap(),
        )
        .unwrap();

        init_semua_dengan(tmp.path(), |_| true).unwrap();
        let doc = baca_json(tmp.path());
        assert_eq!(
            doc["app-baru"]["staging"]["deploy_port"].as_u64(),
            Some(8302)
        );
        assert_eq!(
            doc["app-baru"]["production"]["deploy_port"].as_u64(),
            Some(8303)
        );
    }

    #[test]
    fn registry_kosong_tidak_membuat_file() {
        let tmp = TempDir::new().unwrap();
        let hasil = init_semua(tmp.path());
        assert!(hasil.is_err());
        assert!(!tmp.path().join("environments.json").exists());
    }

    #[test]
    fn hapus_app_membuang_kunci_app_itu_saja() {
        let tmp = TempDir::new().unwrap();
        let lama = json!({
            "app-a": {
                "staging": {"target": "vps-staging", "deploy_port": 8300},
                "production": {"target": "127.0.0.1:8301", "deploy_port": 8301, "container_port": 8000}
            },
            "app-b": {
                "staging": {"target": "vps-staging", "deploy_port": 8302},
                "production": {"target": "127.0.0.1:8303", "deploy_port": 8303, "container_port": 8000}
            }
        });
        fs::write(
            tmp.path().join("environments.json"),
            serde_json::to_string_pretty(&lama).unwrap(),
        )
        .unwrap();

        assert_eq!(hapus_app(tmp.path(), "app-a"), Ok(true));
        let doc = baca_json(tmp.path());
        assert!(doc.get("app-a").is_none(), "kunci app-a harus hilang");
        assert_eq!(doc["app-b"], lama["app-b"], "kunci lain harus utuh");
    }

    #[test]
    fn hapus_app_tanpa_berkas_mengembalikan_false() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(hapus_app(tmp.path(), "app-a"), Ok(false));
        assert!(!tmp.path().join("environments.json").exists());
    }

    #[test]
    fn hapus_app_berkas_rusak_mengembalikan_err() {
        let tmp = TempDir::new().unwrap();
        let asli = "{ ini bukan json";
        fs::write(tmp.path().join("environments.json"), asli).unwrap();
        assert!(hapus_app(tmp.path(), "app-a").is_err());
        assert_eq!(
            fs::read_to_string(tmp.path().join("environments.json")).unwrap(),
            asli,
            "berkas rusak tidak boleh ditimpa"
        );
    }

    #[test]
    fn pastikan_entri_membuat_entri_lalu_idempoten() {
        let tmp = TempDir::new().unwrap();
        tulis_registry(tmp.path(), &[("app-baru", 8000, 8101)]);

        let (staging, production, baru) =
            pastikan_entri_dengan(tmp.path(), "app-baru", 8000, |_| true).unwrap();
        assert!(baru, "entri belum ada, jadi harus dibuat");
        assert_eq!(
            (staging, production),
            (8300, 8301),
            "deployPort di Jenkinsfile harus port staging dari ledger"
        );
        let doc = baca_json(tmp.path());
        assert_eq!(doc["app-baru"]["staging"]["target"], STAGING_TARGET);
        assert_eq!(
            doc["app-baru"]["production"]["container_port"].as_u64(),
            Some(8000)
        );

        let sebelum = fs::read_to_string(tmp.path().join("environments.json")).unwrap();
        let (staging_lagi, production_lagi, baru_lagi) =
            pastikan_entri_dengan(tmp.path(), "app-baru", 8000, |_| true).unwrap();
        assert_eq!((staging_lagi, production_lagi), (8300, 8301));
        assert!(!baru_lagi, "run kedua memakai entri yang sudah ada");
        assert_eq!(
            fs::read_to_string(tmp.path().join("environments.json")).unwrap(),
            sebelum,
            "run kedua tidak boleh mengubah file"
        );
    }

    #[test]
    fn pastikan_entri_lewati_port_yang_sudah_dipakai() {
        let tmp = TempDir::new().unwrap();
        tulis_registry(tmp.path(), &[("app-baru", 8000, 8101)]);
        let lama = json!({
            "app-lama": {
                "staging": {"target": "vps-staging", "deploy_port": 8300},
                "production": {
                    "target": "127.0.0.1:8301",
                    "deploy_port": 8301,
                    "container_port": 8000
                }
            }
        });
        fs::write(
            tmp.path().join("environments.json"),
            serde_json::to_string_pretty(&lama).unwrap(),
        )
        .unwrap();

        let (staging, production, _) =
            pastikan_entri_dengan(tmp.path(), "app-baru", 8000, |_| true).unwrap();
        assert_eq!((staging, production), (8302, 8303));
    }

    #[test]
    fn pastikan_entri_berkas_rusak_tidak_ditimpa() {
        let tmp = TempDir::new().unwrap();
        let asli = "{ ini bukan json";
        fs::write(tmp.path().join("environments.json"), asli).unwrap();
        assert!(pastikan_entri_dengan(tmp.path(), "app-baru", 8000, |_| true).is_err());
        assert_eq!(
            fs::read_to_string(tmp.path().join("environments.json")).unwrap(),
            asli
        );
    }
}
