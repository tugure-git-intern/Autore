//! Kontrak `autore runs --json` — sumber data grafik dan Recent Runs di
//! dashboard. Diuji lewat binari sungguhan + Jenkins palsu di loopback: yang
//! diuji perilaku, bukan fungsi internal.

use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

const APP: &str = "tes-web";

/// Jenkins palsu: membalas daftar build untuk job apa pun yang diminta.
fn fake_jenkins(body: String) -> (u16, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
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
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    (port, handle)
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

fn workspace(dir: &Path) -> std::path::PathBuf {
    let ws = dir.join("autore-workspace");
    fs::create_dir_all(&ws).unwrap();
    fs::write(ws.join("registry.tsv"), format!("{APP}\t8000\t8003\n")).unwrap();
    ws
}

fn fixture(sha_app: &str) -> String {
    let sekarang = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let jam = 3_600_000u64;
    // Bentuk nyata balasan Jenkins untuk job Autore: DUA BuildData — checkout
    // library Autore lalu repo aplikasi. Yang benar adalah yang origin.
    format!(
        r#"{{"builds":[
{{"number":6,"result":"SUCCESS","duration":45244,"timestamp":{},"actions":[{{"lastBuiltRevision":{{"SHA1":"e9ae790be2aeebae5a3b82d434062a1489ce6baa","branch":[{{"name":"main"}}]}}}},{{"lastBuiltRevision":{{"SHA1":"{sha_app}","branch":[{{"name":"refs/remotes/origin/main"}}]}}}}]}},
{{"number":5,"result":"FAILURE","duration":20833,"timestamp":{},"actions":[{{"lastBuiltRevision":{{"SHA1":"{sha_app}","branch":[{{"name":"refs/remotes/origin/main"}}]}}}}]}}
]}}"#,
        sekarang - jam,
        sekarang - 2 * jam
    )
}

fn jalankan(tmp: &TempDir, ws: &Path, arg: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_autore"))
        .args(["runs"])
        .args(arg)
        .env("HOME", tmp.path())
        .env("AUTORE_WORKSPACE", ws)
        .output()
        .unwrap()
}

#[test]
fn runs_json_memuat_histori_jenkins() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    let sha = repo_dengan_commit(&ws.join(APP));
    let (port, server) = fake_jenkins(fixture(&sha));
    fake_jenkins_config(tmp.path(), port);

    let out = jalankan(&tmp, &ws, &["--json"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let laporan: Value = serde_json::from_slice(&out.stdout).expect("stdout harus satu objek JSON");
    assert_eq!(laporan["window_days"], 7);
    assert_eq!(laporan["daily"].as_array().unwrap().len(), 7);

    let runs = laporan["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 2, "dua build dalam jendela: {runs:?}");
    assert_eq!(runs[0]["app"], APP);
    assert_eq!(runs[0]["number"], 6);
    assert_eq!(runs[0]["status"], "passed");
    assert_eq!(runs[0]["duration_ms"], 45244);
    assert_eq!(runs[0]["commit_sha"], sha);
    assert_eq!(runs[0]["author"], "Uji <uji@example.test>");
    assert!(
        runs[0]["url"].as_str().unwrap().ends_with("/job/tes-web/6"),
        "url harus menunjuk build: {}",
        runs[0]["url"]
    );
    assert!(runs[0]["started_at"].as_str().unwrap().ends_with('Z'));

    assert_eq!(runs[1]["number"], 5);
    assert_eq!(runs[1]["status"], "failed");
    assert_eq!(laporan["totals"]["passed"], 1);
    assert_eq!(laporan["totals"]["failed"], 1);
    assert_eq!(laporan["totals"]["running"], 0);

    drop(server);
}

#[test]
fn runs_tanpa_konfigurasi_jenkins_exit_1() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());

    let out = jalankan(&tmp, &ws, &["--json"]);
    assert_eq!(out.status.code(), Some(1), "harus gagal, bukan sukses palsu");
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    assert!(
        stderr.contains("Jenkins"),
        "stderr harus menyebut Jenkins: {stderr}"
    );
    assert!(out.stdout.is_empty(), "stdout tidak boleh berisi data karangan");
}

#[test]
fn runs_jenkins_mati_masih_exit_0_dengan_histori_kosong() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    // Port yang sudah ditutup: koneksi ditolak.
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    fake_jenkins_config(tmp.path(), port);

    let out = jalankan(&tmp, &ws, &["--json"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "Jenkins diam bukan alasan menggagalkan dashboard: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let laporan: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(laporan["runs"].as_array().unwrap().is_empty());
    assert_eq!(laporan["totals"]["passed"], 0);
    assert_eq!(laporan["daily"].as_array().unwrap().len(), 7);
}

#[test]
fn runs_hanya_mengirim_limit_terbaru() {
    let tmp = TempDir::new().unwrap();
    let ws = workspace(tmp.path());
    let sha = repo_dengan_commit(&ws.join(APP));
    let (port, _server) = fake_jenkins(fixture(&sha));
    fake_jenkins_config(tmp.path(), port);

    let out = jalankan(&tmp, &ws, &["--json", "--limit", "1"]);
    assert_eq!(out.status.code(), Some(0));
    let laporan: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(laporan["runs"].as_array().unwrap().len(), 1);
    assert_eq!(
        laporan["totals"]["passed"], 1,
        "totals menghitung jendela penuh, bukan hasil potong"
    );
    assert_eq!(laporan["totals"]["failed"], 1);
}