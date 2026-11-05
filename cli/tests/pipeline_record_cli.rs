//! Kontrak `autore pipeline record` — perintah yang dipanggil pipeline Jenkins
//! untuk menulis `dashboard-status.json` di workspace.
//!
//! Diuji lewat binari sungguhan + `AUTORE_WORKSPACE` sementara: yang diuji
//! perilaku, bukan fungsi internal.

use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

/// Berkas simpanan kontrak (`status::SNAPSHOT_FILE`).
const SNAPSHOT: &str = "dashboard-status.json";
/// Batas kontrak pemangkasan (`status::MAX_LOG_LINES`, `status::MAX_SNAPSHOT_BYTES`).
const MAX_LOG_LINES: usize = 500;
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024;

fn autore(ws: &Path) -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_autore"));
    c.env("AUTORE_WORKSPACE", ws);
    c
}

fn simpanan(ws: &Path) -> Value {
    let isi = fs::read_to_string(ws.join(SNAPSHOT))
        .unwrap_or_else(|e| panic!("{SNAPSHOT} tidak ada di {}: {e}", ws.display()));
    serde_json::from_str(&isi).expect("simpanan bukan JSON")
}

fn pipeline(ws: &Path) -> Value {
    simpanan(ws)["latest_pipeline"].clone()
}

fn tahap(ws: &Path) -> Vec<String> {
    pipeline(ws)["stages"]
        .as_array()
        .expect("stages harus array")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn bantuan_menampilkan_seluruh_flag_kontrak() {
    let tmp = TempDir::new().unwrap();
    let out = autore(tmp.path())
        .args(["pipeline", "record", "--help"])
        .output()
        .unwrap();
    assert!(out.status.success(), "subcommand tidak ada");
    let teks = String::from_utf8_lossy(&out.stdout).to_string();
    for flag in [
        "--stage",
        "--status",
        "--commit",
        "--author",
        "--summary",
        "--message",
        "--log",
        "--reset",
        "--json",
        "--app",
    ] {
        assert!(
            teks.contains(flag),
            "flag {flag} hilang dari bantuan:\n{teks}"
        );
    }
}

#[test]
fn record_menulis_simpanan_dan_keluar_nol() {
    let tmp = TempDir::new().unwrap();
    let out = autore(tmp.path())
        .args([
            "pipeline",
            "record",
            "--reset",
            "--status",
            "running",
            "--stage",
            "checkout",
            "--commit",
            "0770f21",
            "--author",
            "tugure-git-intern <tugure.gitintern@tugu-re.com>",
            "--log",
            "[checkout] ambil source",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let lp = pipeline(tmp.path());
    assert_eq!(lp["status"], "running");
    assert_eq!(lp["commit_sha"], "0770f21");
    assert_eq!(
        lp["author"],
        "tugure-git-intern <tugure.gitintern@tugu-re.com>"
    );
    assert_eq!(lp["raw_log"][0], "[checkout] ambil source");
    assert_eq!(simpanan(tmp.path())["system_status"], "running");
    assert!(!tmp.path().join(format!("{SNAPSHOT}.tmp")).exists());
}

#[test]
fn record_keluar_non_nol_kalau_workspace_tidak_ada() {
    let tmp = TempDir::new().unwrap();
    let hilang = tmp.path().join("belum-ada");
    let out = autore(&hilang)
        .args(["pipeline", "record", "--status", "running"])
        .output()
        .unwrap();

    assert_eq!(
        out.status.code(),
        Some(1),
        "harus gagal, bukan sukses palsu"
    );
    assert!(
        !String::from_utf8_lossy(&out.stderr).trim().is_empty(),
        "stderr harus menjelaskan sebabnya"
    );
    assert!(!hilang.exists(), "workspace tidak boleh dibuat diam-diam");
}

#[test]
fn record_berurutan_membangun_lima_tahap_lalu_gagal_menyimpan_alasan() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();

    let out = autore(ws)
        .args([
            "pipeline",
            "record",
            "--reset",
            "--status",
            "running",
            "--stage",
            "checkout",
            "--commit",
            "0770f21",
            "--author",
            "uji",
            "--log",
            "[checkout] mulai",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());

    for (tahap_id, baris) in [
        ("scan", "[scan] gerbang lulus"),
        ("build", "[build] image jadi"),
        ("pasang", "[push] nexus"),
        ("periksa", "[deploy] digest sha256:138de1085b65"),
    ] {
        let out = autore(ws)
            .args([
                "pipeline", "record", "--status", "running", "--stage", tahap_id, "--log", baris,
            ])
            .output()
            .unwrap();
        assert!(out.status.success(), "tahap {tahap_id} gagal");
    }

    assert_eq!(
        tahap(ws),
        vec!["checkout", "scan", "build", "pasang", "periksa"]
    );

    let out = autore(ws)
        .args([
            "pipeline",
            "record",
            "--status",
            "passed",
            "--summary",
            "9/9 gerbang lolos · digest sha256:138de1085b65",
            "--log",
            "[done] SUCCESS",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(pipeline(ws)["status"], "passed");
    assert!(pipeline(ws)["security_summary"]
        .as_str()
        .unwrap()
        .contains("digest"));

    let out = autore(ws)
        .args([
            "pipeline",
            "record",
            "--status",
            "failed",
            "--message",
            "Gagal di tahap: 5. Build",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(pipeline(ws)["status"], "failed");
    assert_eq!(pipeline(ws)["failure_reason"], "Gagal di tahap: 5. Build");
}

#[test]
fn log_panjang_dipangkas_bukan_error() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();
    let mut cmd = autore(ws);
    cmd.args([
        "pipeline", "record", "--reset", "--status", "running", "--stage", "build",
    ]);
    for i in 0..600 {
        cmd.args(["--log", &format!("baris {i} {}", "x".repeat(90))]);
    }
    let out = cmd.output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let baris = pipeline(ws)["raw_log"].as_array().unwrap().len();
    assert!(
        baris <= MAX_LOG_LINES,
        "{baris} baris log, batas {MAX_LOG_LINES}"
    );
    let ukuran = fs::metadata(ws.join(SNAPSHOT)).unwrap().len() as usize;
    assert!(ukuran <= MAX_SNAPSHOT_BYTES, "berkas {ukuran} byte");
    assert!(!ws.join(format!("{SNAPSHOT}.tmp")).exists());
    // Pemangkasan membuang baris TERLAMA: yang tersisa adalah ekor log.
    let log = pipeline(ws)["raw_log"].as_array().unwrap().clone();
    let nomor = |v: &Value| v.as_str().unwrap().split(' ').nth(1).unwrap().to_string();
    assert_eq!(nomor(&log[0]), "100");
    assert_eq!(nomor(log.last().unwrap()), "599");
}

#[test]
fn author_ber_spasi_dan_apostrof_tersimpan_utuh() {
    let tmp = TempDir::new().unwrap();
    let penulis = "O'Brien Nugraha <tugure.gitintern@tugu-re.com>";
    let out = autore(tmp.path())
        .args([
            "pipeline",
            "record",
            "--reset",
            "--status",
            "running",
            "--stage",
            "checkout",
            "--author",
            penulis,
            "--log",
            "pesan berisi 'kutip' dan <sudut>",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(pipeline(tmp.path())["author"], penulis);
    assert_eq!(
        pipeline(tmp.path())["raw_log"][0],
        "pesan berisi 'kutip' dan <sudut>"
    );
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

#[test]
fn mencatat_waktu_tiap_tahap_dan_jumlah_gerbang() {
    let tmp = TempDir::new().unwrap();
    rekam(
        tmp.path(),
        &["--reset", "--status", "running", "--stage", "checkout"],
    );
    rekam(tmp.path(), &["--status", "running", "--stage", "scan"]);
    rekam(tmp.path(), &["--status", "running", "--stage", "build"]);
    rekam(
        tmp.path(),
        &[
            "--status",
            "passed",
            "--summary",
            "9/9 gerbang lolos · digest sha256:abc",
        ],
    );

    let lp = pipeline(tmp.path());
    let wt = lp["stage_times"]
        .as_array()
        .expect("stage_times harus array");
    assert_eq!(wt.len(), 3, "satu entri per tahap: {wt:?}");
    assert_eq!(wt[0]["id"], "checkout");
    assert_eq!(wt[2]["id"], "build");

    let at: Vec<String> = wt
        .iter()
        .map(|v| v["at"].as_str().unwrap().to_string())
        .collect();
    assert!(
        at.iter().all(|s| s.len() == 20 && s.ends_with('Z')),
        "at harus ISO-8601 UTC: {at:?}"
    );
    assert!(
        at.windows(2).all(|w| w[0] <= w[1]),
        "waktu tahap tidak boleh menurun: {at:?}"
    );

    assert_eq!(lp["gates_passed"], 9);
    assert_eq!(lp["gates_total"], 9);
    assert_eq!(
        lp["finished_at"].as_str().unwrap().len(),
        20,
        "finished_at harus terisi saat pipeline selesai"
    );
    assert_eq!(lp["stages"].as_array().unwrap().len(), 3);
}

#[test]
fn build_baru_mengosongkan_waktu_tahap_dan_gerbang() {
    let tmp = TempDir::new().unwrap();
    rekam(
        tmp.path(),
        &["--reset", "--status", "running", "--stage", "checkout"],
    );
    rekam(
        tmp.path(),
        &["--status", "passed", "--summary", "9/9 gerbang lolos"],
    );
    assert_eq!(
        pipeline(tmp.path())["stage_times"].as_array().unwrap().len(),
        1
    );

    rekam(
        tmp.path(),
        &["--reset", "--status", "running", "--stage", "checkout"],
    );
    let lp = pipeline(tmp.path());
    assert_eq!(
        lp["stage_times"].as_array().unwrap().len(),
        1,
        "entri build lama harus hilang"
    );
    assert_eq!(lp["gates_total"], 0, "gerbang build lama tidak boleh nyangkut");
    assert_eq!(lp["finished_at"], "", "build baru belum selesai");
}

#[test]
fn simpanan_lama_tanpa_field_baru_tetap_dimuat() {
    let tmp = TempDir::new().unwrap();
    // Bentuk simpanan sebelum Phase 3: tanpa stage_times/finished_at/gates_*.
    let lama = r#"{"system_status":"passed","infra":{"jenkins":"active","nexus":"active"},"stats":{"total_apps":1,"running_containers":2},"applications":[],"latest_pipeline":{"status":"passed","failure_reason":"","stages":["checkout","scan"],"security_summary":"9/9 gerbang lolos","commit_sha":"2dfd6ef","author":"a <b@c>","raw_log":["x"]}}"#;
    fs::write(tmp.path().join(SNAPSHOT), lama).unwrap();

    let out = autore(tmp.path())
        .args(["status", "--json"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Dibaca dari keluaran `status --json` (bukan berkas): yang diuji kontrak
    // yang dilihat web, dan berkas lama tidak ditulis ulang oleh perintah baca.
    let cetak: Value = serde_json::from_slice(&out.stdout).expect("stdout status --json harus JSON");
    let lp = cetak["latest_pipeline"].clone();
    assert_eq!(lp["stage_times"].as_array().unwrap().len(), 0);
    assert_eq!(lp["finished_at"], "");
    assert_eq!(lp["gates_total"], 0);
    assert_eq!(
        lp["stages"].as_array().unwrap().len(),
        2,
        "data lama tetap utuh"
    );
}

/// Daftar aplikasi dari simpanan (dibaca apa adanya, tanpa `status --json`).
fn aplikasi(ws: &Path) -> Vec<Value> {
    simpanan(ws)["applications"]
        .as_array()
        .expect("applications harus array")
        .clone()
}

fn app(ws: &Path, nama: &str) -> Value {
    aplikasi(ws)
        .into_iter()
        .find(|a| a["name"] == nama)
        .unwrap_or_else(|| panic!("aplikasi {nama} tidak ada di simpanan"))
}

#[test]
fn app_hanya_ditulis_pada_hasil_akhir() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();

    rekam(
        ws,
        &[
            "--app",
            "tes-web",
            "--reset",
            "--status",
            "running",
            "--stage",
            "checkout",
            "--commit",
            "abc123",
        ],
    );
    // Build masih jalan: aplikasi belum boleh mengklaim apa pun.
    assert_eq!(
        app(ws, "tes-web")["status"],
        "unknown",
        "status running tidak boleh menimpa hasil akhir"
    );

    rekam(ws, &["--app", "tes-web", "--status", "passed"]);

    let a = app(ws, "tes-web");
    assert_eq!(a["status"], "passed");
    assert_eq!(a["commit_sha"], "abc123", "commit dari panggilan sebelumnya");
    assert_eq!(a["deployed"], false, "belum lewat tahap deploy");
    assert_eq!(a["id"], "tes-web");
}

#[test]
fn tahap_deploy_menandai_deployed_dan_tahan_lintas_build() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();

    rekam(
        ws,
        &["--app", "tes-web", "--reset", "--status", "running", "--stage", "checkout"],
    );
    rekam(
        ws,
        &["--app", "tes-web", "--status", "running", "--stage", "periksa"],
    );
    assert_eq!(
        app(ws, "tes-web")["deployed"],
        true,
        "tahap 9 (periksa) = sudah deploy"
    );
    assert_eq!(
        app(ws, "tes-web")["status"],
        "unknown",
        "deploy saja belum hasil akhir"
    );

    // Build baru: `--reset` tidak menghapus fakta "pernah deploy".
    rekam(
        ws,
        &["--app", "tes-web", "--reset", "--status", "running", "--stage", "checkout"],
    );
    assert_eq!(app(ws, "tes-web")["deployed"], true);

    // Build yang gagal tetap "pernah deploy".
    rekam(
        ws,
        &["--app", "tes-web", "--status", "failed", "--message", "Gagal di tahap: 5. Build"],
    );
    let a = app(ws, "tes-web");
    assert_eq!(a["status"], "failed");
    assert_eq!(a["deployed"], true);
}

#[test]
fn tanpa_app_perintah_lama_tidak_menyentuh_aplikasi() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();

    rekam(
        ws,
        &["--reset", "--status", "running", "--stage", "checkout"],
    );
    rekam(ws, &["--status", "passed", "--summary", "9/9 gerbang lolos"]);

    assert!(
        aplikasi(ws).is_empty(),
        "panggilan tanpa --app tidak boleh mengarang aplikasi: {:?}",
        aplikasi(ws)
    );
}

