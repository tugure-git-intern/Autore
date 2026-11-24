//! `autore init` tanpa TTY: nilai yang tidak disebut memakai bawaan, deteksi
//! stack yang gagal berteriak. Semua tes menjalankan binary sungguhan dengan
//! stdin tertutup, seperti script/CI.

use std::fs;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use tempfile::TempDir;

fn init(ws: &Path, cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_autore"))
        .arg("init")
        .args(args)
        .current_dir(cwd)
        .env("AUTORE_WORKSPACE", ws)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("autore harus bisa dijalankan")
}

fn isi(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("{} tidak terbaca: {e}", path.display()))
}

#[test]
fn tanpa_app_port_memakai_port_bawaan_stack() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let out = init(
        &ws,
        tmp.path(),
        &[
            "--app-name",
            "uji",
            "--stack",
            "python",
            "--output-dir",
            "out",
        ],
    );
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(isi(&tmp.path().join("out/Dockerfile")).contains("EXPOSE 8000"));
    assert!(isi(&tmp.path().join("out/Jenkinsfile")).contains("appPort: 8000"));
}

#[test]
fn tanpa_app_name_memakai_nama_folder() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let proyek = tmp.path().join("demo-folder");
    fs::create_dir_all(&proyek).unwrap();
    let out = init(&ws, &proyek, &["--stack", "python", "--output-dir", "out"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(isi(&proyek.join("out/Jenkinsfile")).contains("appName: 'demo-folder'"));
}

#[test]
fn stack_tidak_bisa_dideteksi_ditolak_dengan_pesan_jelas() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let out = init(
        &ws,
        tmp.path(),
        &["--app-name", "uji", "--output-dir", "out"],
    );
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("--stack"), "stderr harus menyebut --stack: {err}");
    assert!(!tmp.path().join("out/Dockerfile").exists());
}
