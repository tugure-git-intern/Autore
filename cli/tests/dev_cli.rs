//! Kontrak `autore dev` yang bisa diperiksa tanpa Docker: penolakan terjadi
//! sebelum docker dipanggil, dengan saran flag yang jelas.

use std::fs;
use std::process::{Command, Stdio};
use tempfile::TempDir;

fn autore() -> Command {
    Command::new(env!("CARGO_BIN_EXE_autore"))
}

#[test]
fn dev_di_folder_tanpa_kode_gagal_dan_menyarankan_stack() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("kosong");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();

    let out = autore()
        .env("HOME", &home)
        .arg("dev")
        .current_dir(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(1),
        "folder tanpa kode harus keluar 1\nstdout: {}\nstderr: {stderr}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(
        stderr.contains("--stack"),
        "stderr harus menyebut cara memilih stack: {stderr}"
    );
}

#[test]
fn dev_menolak_nama_folder_tidak_sah_sebelum_docker() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("my app");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("app.py"), "print(1)\n").unwrap();

    let out = autore()
        .env("HOME", &home)
        .arg("dev")
        .current_dir(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("--app-name"),
        "stderr harus menyarankan --app-name: {stderr}"
    );
    assert!(
        !project.join("Dockerfile").exists(),
        "berkas tidak boleh dibuat saat nama ditolak"
    );
}

#[test]
fn dev_tampil_di_bantuan() {
    let out = autore().arg("--help").output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success());
    assert!(
        stdout.contains("dev"),
        "subcommand dev harus terdaftar: {stdout}"
    );
}
