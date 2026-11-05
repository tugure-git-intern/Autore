//! Kontrak `repository_health` di `autore status --json` — kartu ke-5 dashboard.
//!
//! Diuji lewat binari sungguhan + workspace sementara: yang diuji dokumen yang
//! dilihat web, bukan fungsi internal.

use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

const SNAPSHOT: &str = "dashboard-status.json";
const REGISTRY: &str = "registry.tsv";

fn autore(ws: &Path) -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_autore"));
    c.env("AUTORE_WORKSPACE", ws);
    c
}

/// Tulis `registry.tsv` bentuk nyata: `nama<TAB>app_port<TAB>deploy_port`.
fn daftarkan(ws: &Path, nama: &[&str]) {
    let isi: String = nama
        .iter()
        .enumerate()
        .map(|(i, n)| format!("{n}\t8000\t{}\n", 8003 + i * 10))
        .collect();
    fs::write(ws.join(REGISTRY), isi).unwrap();
}

/// Jalankan `pipeline record`; panik kalau exit code bukan 0.
fn rekam(ws: &Path, args: &[&str]) {
    let out = autore(ws)
        .args(["pipeline", "record"])
        .args(args)
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "record gagal: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn health(ws: &Path) -> Value {
    let out = autore(ws).args(["status", "--json"]).output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let cetak: Value = serde_json::from_slice(&out.stdout).expect("stdout status --json harus JSON");
    cetak["repository_health"].clone()
}

/// Lulus + pernah deploy (tahap `periksa`) = gold.
fn gold(ws: &Path, nama: &str) {
    rekam(
        ws,
        &["--app", nama, "--reset", "--status", "running", "--stage", "checkout"],
    );
    rekam(
        ws,
        &["--app", nama, "--status", "running", "--stage", "periksa"],
    );
    rekam(ws, &["--app", nama, "--status", "passed"]);
}

#[test]
fn skor_membagi_gold_seratus_dan_silver_lima_puluh() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();
    daftarkan(ws, &["a", "b", "c", "d"]);

    gold(ws, "a");
    // Lulus tanpa lewat tahap deploy → silver.
    rekam(ws, &["--app", "b", "--status", "passed"]);
    rekam(
        ws,
        &["--app", "c", "--status", "failed", "--message", "Gagal di tahap: 5. Build"],
    );
    // `d` tidak pernah dibangun → bronze.

    let h = health(ws);
    assert_eq!(h["total_repos"], 4);
    assert_eq!(h["gold"], 1);
    assert_eq!(h["silver"], 1);
    assert_eq!(h["bronze"], 2);
    assert_eq!(h["score_percent"], 37, "(100 + 50) / 4 dibulatkan ke bawah");
}

#[test]
fn repo_tanpa_build_dihitung_bronze() {
    let tmp = TempDir::new().unwrap();
    daftarkan(tmp.path(), &["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);

    let h = health(tmp.path());
    assert_eq!(h["total_repos"], 10);
    assert_eq!(h["gold"], 0);
    assert_eq!(h["silver"], 0);
    assert_eq!(h["bronze"], 10);
    assert_eq!(h["score_percent"], 0);
}

#[test]
fn semua_gold_menghasilkan_seratus_persen() {
    let tmp = TempDir::new().unwrap();
    daftarkan(tmp.path(), &["a", "b", "c"]);
    for nama in ["a", "b", "c"] {
        gold(tmp.path(), nama);
    }

    let h = health(tmp.path());
    assert_eq!(h["gold"], 3);
    assert_eq!(h["bronze"], 0);
    assert_eq!(h["score_percent"], 100);
}

#[test]
fn tanpa_registry_skor_nol_tanpa_pembagian_nol() {
    let tmp = TempDir::new().unwrap();

    let h = health(tmp.path());
    assert_eq!(h["total_repos"], 0);
    assert_eq!(h["silver"], 0);
    assert_eq!(h["bronze"], 0);
    assert_eq!(h["score_percent"], 0, "total nol tidak boleh panic");
}

#[test]
fn aplikasi_di_luar_registry_tidak_ikut_dihitung() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();
    daftarkan(ws, &["a", "b"]);
    // `autore-e2e` mencatat `autore-dummy` yang bukan baris registry.
    rekam(ws, &["--app", "hantu", "--status", "passed"]);

    let h = health(ws);
    assert_eq!(h["total_repos"], 2, "daftar resmi tetap registry");
    assert_eq!(h["gold"], 0);
    assert_eq!(h["bronze"], 2);
}

#[test]
fn simpanan_lama_tanpa_repository_health_tetap_dibaca() {
    let tmp = TempDir::new().unwrap();
    let lama = r#"{"system_status":"passed","infra":{"jenkins":"active","nexus":"active"},"stats":{"total_apps":1,"running_containers":2},"applications":[{"id":"x","name":"x","status":"passed","last_build":"","commit_sha":"","security_issues":0}],"latest_pipeline":{"status":"passed","failure_reason":"","stages":[],"security_summary":"","commit_sha":"","author":"","raw_log":[]}}"#;
    fs::write(tmp.path().join(SNAPSHOT), lama).unwrap();
    daftarkan(tmp.path(), &["x"]);

    let h = health(tmp.path());
    assert_eq!(h["total_repos"], 1);
    assert_eq!(
        h["gold"], 0,
        "baris lama tanpa `deployed` dibaca `false`"
    );
    assert_eq!(h["silver"], 1, "lulus tapi belum tercatat pernah deploy");
    assert_eq!(h["bronze"], 0);
}
