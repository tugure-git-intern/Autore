//! Kontrak `autore sbom --app <id> --json` — sumber tabel SBOM Viewer di
//! dashboard. Diuji lewat binari sungguhan: yang diuji perilaku, bukan fungsi
//! internal.

use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::TempDir;

const APP: &str = "tes-web";

/// CycloneDX kecil tapi memuat semua kasus yang penting: OS package + language
/// library, duplikat, versi hilang, komponen bersarang, dan satu komponen tanpa
/// nama yang harus dilewati.
const FIXTURE: &str = r#"{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "metadata": { "timestamp": "2026-11-05T08:27:11Z" },
  "components": [
    { "type": "operating-system", "name": "openssl", "version": "3.0.11" },
    { "type": "operating-system", "name": "libc6", "version": "2.36-9" },
    { "type": "library", "name": "express", "version": "4.18.2" },
    { "type": "library", "name": "express", "version": "4.18.2" },
    { "type": "library", "name": "tanpa-versi" },
    { "type": "library", "name": "induk", "version": "1.0.0",
      "components": [ { "type": "library", "name": "anak", "version": "0.2.0" } ] },
    { "type": "library", "version": "9.9.9" }
  ]
}"#;

fn workspace(dir: &Path) -> std::path::PathBuf {
    let ws = dir.join("autore-workspace");
    fs::create_dir_all(ws.join(APP).join("dist")).unwrap();
    ws
}

fn tulis_sbom(ws: &Path, isi: &str) {
    fs::write(ws.join(APP).join("dist").join("sbom.cdx.json"), isi).unwrap();
}

fn jalankan(home: &Path, ws: Option<&Path>, args: &[&str]) -> Output {
    let mut c = Command::new(env!("CARGO_BIN_EXE_autore"));
    c.env("HOME", home);
    match ws {
        Some(p) => c.env("AUTORE_WORKSPACE", p),
        None => c.env_remove("AUTORE_WORKSPACE"),
    };
    c.arg("sbom").args(args).output().unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).to_string()
}

#[test]
fn sbom_menyusun_daftar_paket_ringkas_dan_terurut() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    tulis_sbom(&ws, FIXTURE);

    let out = jalankan(tmp.path(), Some(&ws), &["--app", APP, "--json"]);
    assert_eq!(out.status.code(), Some(0), "stderr: {}", stderr(&out));

    let laporan: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(laporan["app"], APP);
    assert_eq!(laporan["generated_at"], "2026-11-05T08:27:11Z");
    assert!(laporan["source"]
        .as_str()
        .unwrap()
        .ends_with(&format!("{APP}/dist/sbom.cdx.json")));

    let paket = laporan["packages"].as_array().unwrap();
    let nama: Vec<&str> = paket.iter().map(|p| p["name"].as_str().unwrap()).collect();
    assert_eq!(
        nama,
        vec!["anak", "express", "induk", "libc6", "openssl", "tanpa-versi"],
        "urut nama (case-insensitive), duplikat dibuang, komponen tanpa nama dilewati"
    );
    assert_eq!(laporan["total"], 6, "total dihitung CLI, bukan dihitung ulang UI");

    let type_dari = |n: &str| -> String {
        paket
            .iter()
            .find(|p| p["name"] == n)
            .unwrap()["type"]
            .as_str()
            .unwrap()
            .to_string()
    };
    assert_eq!(type_dari("openssl"), "os");
    assert_eq!(type_dari("libc6"), "os");
    assert_eq!(type_dari("express"), "language");
    assert_eq!(type_dari("anak"), "language", "komponen bersarang ikut dibaca");

    let tanpa_versi = paket.iter().find(|p| p["name"] == "tanpa-versi").unwrap();
    assert_eq!(tanpa_versi["version"], "", "versi hilang jadi string kosong, bukan null");
}

#[test]
fn sbom_menolak_workspace_tanpa_file() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());

    let out = jalankan(tmp.path(), Some(&ws), &["--app", APP, "--json"]);
    assert_ne!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty(), "tidak boleh mencetak JSON palsu");
    assert!(
        stderr(&out).contains("sbom.cdx.json"),
        "pesan harus menyebut file yang dicari: {}",
        stderr(&out)
    );
}

#[test]
fn sbom_jatuh_ke_home_autore_workspace_kalau_env_tidak_disiapkan() {
    let tmp = TempDir::new().unwrap();

    let out = jalankan(tmp.path(), None, &["--app", APP, "--json"]);
    assert_ne!(out.status.code(), Some(0));
    assert!(
        stderr(&out).contains("autore-workspace"),
        "pesan harus menyebut workspace yang dipakai: {}",
        stderr(&out)
    );
}

#[test]
fn sbom_menolak_id_aplikasi_yang_bisa_kabur_dari_workspace() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    tulis_sbom(&ws, FIXTURE);

    for jahat in ["../rahasia", "a/b", "..", "te s"] {
        let out = jalankan(tmp.path(), Some(&ws), &["--app", jahat, "--json"]);
        assert_ne!(out.status.code(), Some(0), "id `{jahat}` harus ditolak");
        assert!(out.stdout.is_empty(), "id `{jahat}` tidak boleh menghasilkan JSON");
    }
}

#[test]
fn sbom_menolak_file_yang_bukan_cyclonedx() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());

    for sampah in [r#"{"hello":"world"}"#, "bukan json sama sekali"] {
        tulis_sbom(&ws, sampah);
        let out = jalankan(tmp.path(), Some(&ws), &["--app", APP, "--json"]);
        assert_ne!(out.status.code(), Some(0), "isi `{sampah}` harus ditolak");
        assert!(out.stdout.is_empty());
        assert!(
            stderr(&out).to_lowercase().contains("cyclonedx"),
            "pesan harus menjelaskan kontraknya: {}",
            stderr(&out)
        );
    }
}

/// Build berjalan di runner dengan filesystem sendiri, jadi salinan lokal bisa
/// tidak ada sementara artifact Jenkins ada. Jalur ini yang dipakai dashboard.
#[test]
fn sbom_diambil_dari_artifact_jenkins_kalau_salinan_lokal_tidak_ada() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let body = FIXTURE.to_string();
    let handle = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 8192];
            let _ = stream.read(&mut buf);
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
        }
    });

    let tmp = TempDir::new().unwrap();
    let home = tmp.path();
    fs::create_dir_all(home.join(".config").join("autore")).unwrap();
    fs::write(
        home.join(".config").join("autore").join("jenkins.conf"),
        format!("url=http://{addr}\nuser=admin\ntoken=tok\n"),
    )
    .unwrap();
    // Sengaja tanpa <workspace>/<app>/dist/sbom.cdx.json.
    let ws = tmp.path().join("autore-workspace");
    fs::create_dir_all(&ws).unwrap();

    let out = jalankan(home, Some(&ws), &["--app", APP, "--json"]);
    handle.join().unwrap();

    assert_eq!(out.status.code(), Some(0), "stderr: {}", stderr(&out));
    let laporan: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(laporan["total"], 6);
    assert_eq!(
        laporan["source"],
        format!("jenkins:{APP}/lastSuccessfulBuild"),
        "UI harus bisa menyebut sumber datanya"
    );
}

/// Artifact yang belum diarsipkan (404) bukan crash: pesannya menyebut jalan keluar.
#[test]
fn sbom_menyebut_artifact_jenkins_hilang_dengan_pesan_yang_jelas() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 8192];
            let _ = stream.read(&mut buf);
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        }
    });

    let tmp = TempDir::new().unwrap();
    let home = tmp.path();
    fs::create_dir_all(home.join(".config").join("autore")).unwrap();
    fs::write(
        home.join(".config").join("autore").join("jenkins.conf"),
        format!("url=http://{addr}\nuser=admin\ntoken=tok\n"),
    )
    .unwrap();
    let ws = tmp.path().join("autore-workspace");
    fs::create_dir_all(&ws).unwrap();

    let out = jalankan(home, Some(&ws), &["--app", APP, "--json"]);
    handle.join().unwrap();

    assert_ne!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty(), "tidak boleh mencetak JSON palsu");
    let pesan = stderr(&out);
    assert!(pesan.contains("belum mengarsipkan"), "pesan: {pesan}");
    assert!(pesan.contains("jalankan build"), "pesan: {pesan}");
}
