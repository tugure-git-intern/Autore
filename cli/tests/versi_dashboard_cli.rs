//! Kontrak `autore status`: peringatan saat build dashboard yang tersaji di
//! mesin ini dibuat dari versi CLI lain. Diuji lewat binari sungguhan supaya
//! yang dikunci adalah bunyi stderr + kesucian stdout `--json`.
//!
//! Dashboard dipalsukan: `next build` menyalin `env` di `next.config.ts` ke
//! `.next/required-server-files.json`, dan itulah satu-satunya sumber versi
//! yang benar-benar ikut bundel — bukan `Cargo.toml`.

use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::TempDir;

const VERSI_CLI: &str = env!("CARGO_PKG_VERSION");

/// Dashboard palsu berisi build dengan versi `versi` tertanam.
fn dashboard(tmp: &Path, versi: &str) -> std::path::PathBuf {
    let dir = tmp.join("dashboard");
    fs::create_dir_all(dir.join(".next")).unwrap();
    fs::write(
        dir.join(".next/required-server-files.json"),
        format!(r#"{{"config":{{"env":{{"NEXT_PUBLIC_APP_VERSION":"{versi}"}}}}}}"#),
    )
    .unwrap();
    dir
}

fn status(ws: &Path, dashboard: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_autore"))
        .args(["status", "--json"])
        .env("AUTORE_WORKSPACE", ws)
        .env("AUTORE_WEB_DASHBOARD", dashboard)
        .output()
        .unwrap()
}

#[test]
fn versi_basi_diperingatkan_di_stderr_tanpa_merusak_json() {
    let tmp = TempDir::new().unwrap();
    let dash = dashboard(tmp.path(), "v0.6.1");

    let out = status(tmp.path(), &dash);

    assert_eq!(out.status.code(), Some(0), "status harus tetap sukses");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("PERINGATAN"), "{stderr}");
    assert!(stderr.contains("v0.6.1"), "versi build: {stderr}");
    assert!(
        stderr.contains(VERSI_CLI),
        "versi CLI {}: {stderr}",
        VERSI_CLI
    );
    serde_json::from_slice::<Value>(&out.stdout).expect("stdout tetap JSON murni");
}

#[test]
fn versi_sama_tidak_berisik() {
    let tmp = TempDir::new().unwrap();
    let dash = dashboard(tmp.path(), &format!("v{VERSI_CLI}"));

    let out = status(tmp.path(), &dash);

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!stderr.contains("PERINGATAN"), "{stderr}");
}

#[test]
fn mesin_tanpa_dashboard_tidak_diperingatkan() {
    let tmp = TempDir::new().unwrap();

    let out = status(tmp.path(), &tmp.path().join("tidak-ada"));

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!stderr.contains("PERINGATAN"), "{stderr}");
}
