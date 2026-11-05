//! Kontrak `autore active --json` — sumber section "Active Pipelines" di dashboard.
//! Diuji lewat binari sungguhan + Jenkins palsu: yang diuji perilaku, bukan
//! fungsi internal.

use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

const APP: &str = "tes-web";

/// Jenkins palsu: root listing dan queue dibalas berbeda, karena `autore active`
/// memang dua panggilan. Header permintaan pertama dicatat untuk membuktikan
/// kredensial benar-benar ikut (tanpa itu Jenkins asli membalas 403).
fn fake_jenkins(
    jobs: String,
    queue: String,
) -> (u16, std::thread::JoinHandle<()>, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let dicatat = Arc::new(Mutex::new(Vec::new()));
    let catatan = Arc::clone(&dicatat);
    let handle = std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => break,
            };
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
            let mut head = Vec::new();
            let mut buf = [0u8; 1024];
            while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => head.extend_from_slice(&buf[..n]),
                }
            }
            let permintaan = String::from_utf8_lossy(&head).to_lowercase();
            catatan.lock().unwrap().push(permintaan.clone());
            let body = if permintaan.contains("/queue/api/json") {
                &queue
            } else {
                &jobs
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    (port, handle, dicatat)
}

fn fake_jenkins_config(home: &Path, port: u16) {
    let conf = home.join(".config").join("autore").join("jenkins.conf");
    fs::create_dir_all(conf.parent().unwrap()).unwrap();
    fs::write(
        &conf,
        format!("url=http://127.0.0.1:{port}\nuser=uji\ntoken=uji\n"),
    )
    .unwrap();
}

/// Repo aplikasi + satu commit; mengembalikan SHA commit-nya.
fn repo_dengan_commit(dir: &Path) -> String {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("app.txt"), "halo\n").unwrap();
    for args in [
        ["init", "-q", "-b", "main"].as_slice(),
        ["add", "."].as_slice(),
        [
            "-c",
            "user.name=Uji",
            "-c",
            "user.email=uji@example.test",
            "commit",
            "-q",
            "-m",
            "commit uji",
        ]
        .as_slice(),
    ] {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {:?} gagal: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "HEAD"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn workspace(dir: &Path) -> PathBuf {
    let ws = dir.join("autore-workspace");
    fs::create_dir_all(&ws).unwrap();
    fs::write(ws.join("registry.tsv"), format!("{APP}\t8000\t8003\n")).unwrap();
    ws
}

/// Bentuk nyata: `tes-web` sedang build, `diag-ws` selesai, `autore-dummy`
/// belum pernah build (dilewati), plus satu item queue.
fn jobs_fixture(sha_app: &str) -> String {
    let sekarang = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    format!(
        r#"{{"jobs":[
{{"name":"{APP}","lastBuild":{{"number":42,"building":true,"timestamp":{},"actions":[{{"lastBuiltRevision":{{"SHA1":"e9ae790be2aeebae5a3b82d434062a1489ce6baa","branch":[{{"name":"main"}}]}}}},{{"lastBuiltRevision":{{"SHA1":"{sha_app}","branch":[{{"name":"refs/remotes/origin/main"}}]}}}}]}}}},
{{"name":"diag-ws","lastBuild":{{"number":7,"building":false,"timestamp":{},"actions":[{{}}]}}}},
{{"name":"autore-dummy","lastBuild":null}}
]}}"#,
        sekarang - 60_000,
        sekarang - 3_600_000
    )
}

const QUEUE_FIXTURE: &str = r#"{"items":[
{"id":11,"why":"Menunggu node tersedia","inQueueSince":1793849100000,"task":{"name":"ui-demo"}}
]}"#;

fn jalankan(tmp: &TempDir, ws: &Path, arg: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_autore"))
        .arg("active")
        .args(arg)
        .env("HOME", tmp.path())
        .env("AUTORE_WORKSPACE", ws)
        .output()
        .unwrap()
}

#[test]
fn active_json_memuat_pipeline_berjalan_dan_menunggu() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    let sha = repo_dengan_commit(&ws.join(APP));
    let (port, server, dicatat) = fake_jenkins(jobs_fixture(&sha), QUEUE_FIXTURE.to_string());
    fake_jenkins_config(tmp.path(), port);

    let out = jalankan(&tmp, &ws, &["--json"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let laporan: Value = serde_json::from_slice(&out.stdout).expect("stdout harus satu objek JSON");
    let aktif = laporan["active"].as_array().unwrap();
    assert_eq!(aktif.len(), 2, "satu jalan + satu menunggu: {aktif:?}");

    assert_eq!(aktif[0]["app"], APP);
    assert_eq!(aktif[0]["number"], 42);
    assert_eq!(aktif[0]["status"], "running");
    assert_eq!(aktif[0]["branch"], "main");
    assert_eq!(aktif[0]["commit_sha"], sha);
    assert_eq!(aktif[0]["author"], "Uji <uji@example.test>");
    assert_eq!(
        aktif[0]["url"],
        format!("http://127.0.0.1:{port}/job/{APP}/42")
    );
    assert!(aktif[0]["started_at"].as_str().unwrap().ends_with('Z'));

    assert_eq!(aktif[1]["app"], "ui-demo");
    assert_eq!(aktif[1]["status"], "queued");
    assert_eq!(aktif[1]["number"], 0);
    assert_eq!(aktif[1]["commit_sha"], "");
    assert_eq!(aktif[1]["branch"], "");
    assert_eq!(aktif[1]["author"], "");
    assert_eq!(aktif[1]["url"], format!("http://127.0.0.1:{port}/job/ui-demo"));

    assert_eq!(laporan["counts"]["running"], 1);
    assert_eq!(laporan["counts"]["queued"], 1);
    assert!(laporan["generated_at"].as_str().unwrap().ends_with('Z'));

    let permintaan = dicatat.lock().unwrap().clone();
    assert_eq!(permintaan.len(), 2, "tepat dua panggilan: {permintaan:?}");
    assert!(
        permintaan
            .iter()
            .any(|p| p.contains("get /api/json") && p.contains("authorization: basic ")),
        "root listing wajib lewat API JSON dengan kredensial: {permintaan:?}"
    );
    assert!(
        permintaan
            .iter()
            .any(|p| p.contains("get /queue/api/json") && p.contains("authorization: basic ")),
        "queue wajib ikut dibaca: {permintaan:?}"
    );

    drop(server);
}

#[test]
fn active_tanpa_konfigurasi_jenkins_exit_1() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());

    let out = jalankan(&tmp, &ws, &["--json"]);

    assert_eq!(out.status.code(), Some(1), "harus gagal, bukan sukses palsu");
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    assert!(stderr.contains("Jenkins"), "stderr: {stderr}");
    assert!(out.stdout.is_empty(), "stdout harus kosong saat gagal");
}

#[test]
fn active_tanpa_yang_jalan_tetap_sukses_dengan_daftar_kosong() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    let (port, server, _) = fake_jenkins(
        r#"{"jobs":[{"name":"diag-ws","lastBuild":{"number":7,"building":false,"actions":[{}]}}]}"#
            .to_string(),
        r#"{"items":[]}"#.to_string(),
    );
    fake_jenkins_config(tmp.path(), port);

    let out = jalankan(&tmp, &ws, &["--json"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let laporan: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(laporan["active"].as_array().unwrap().is_empty());
    assert_eq!(laporan["counts"]["running"], 0);
    assert_eq!(laporan["counts"]["queued"], 0);

    drop(server);
}

#[test]
fn active_tanpa_json_mencetak_tabel_manusia() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    let sha = repo_dengan_commit(&ws.join(APP));
    let (port, server, _) = fake_jenkins(jobs_fixture(&sha), r#"{"items":[]}"#.to_string());
    fake_jenkins_config(tmp.path(), port);

    let out = jalankan(&tmp, &ws, &[]);
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    assert!(stdout.contains(APP), "stdout: {stdout}");
    assert!(stdout.contains("running"), "stdout: {stdout}");

    drop(server);
}
