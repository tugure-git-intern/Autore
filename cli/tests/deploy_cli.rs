//! Kontrak exit code `autore deploy` di jalur satu-perintah (non-interaktif).
//!
//! Jalur inilah yang dipakai dashboard (`POST /api/actions/deploy`): tanpa TTY, tanpa
//! orang yang bisa menjawab prompt. Kegagalan konfigurasi harus terlihat sebagai exit
//! code non-nol, bukan "selesai tanpa melakukan apa pun".

use std::fs;
use std::process::{Command, Stdio};
use tempfile::TempDir;

fn autore() -> Command {
    Command::new(env!("CARGO_BIN_EXE_autore"))
}

/// Project minimal dengan repo git sendiri, supaya deploy tidak menyentuh repo Autore.
fn project_git(dir: &std::path::Path) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("app.py"), "def hello():\n    return 'ok'\n").unwrap();
    let init = Command::new("git")
        .args(["init", "-q", "-b", "main"])
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(init.success(), "git init gagal di {}", dir.display());
}

#[test]
fn deploy_tanpa_konfigurasi_jenkins_gagal_di_mode_non_interaktif() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("app");
    fs::create_dir_all(&home).unwrap();
    project_git(&project);

    // HOME dipindah: ~/.config/autore/jenkins.conf di dalam sandbox pasti tidak ada,
    // jadi konfigurasi nyata milik user tidak pernah dibaca maupun dihapus.
    let out = autore()
        .env("HOME", &home)
        .args(["deploy", "--path"])
        .arg(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(
        out.status.code(),
        Some(1),
        "deploy tanpa konfigurasi harus keluar 1 (bukan nol yang berarti sukses)\nstdout: {stdout}\nstderr: {stderr}"
    );
    assert!(
        stderr.contains("Konfigurasi Jenkins belum ada"),
        "stderr harus menyebut sebabnya\nstdout: {stdout}\nstderr: {stderr}"
    );
    assert!(
        !stdout.contains("berhasil disambungkan"),
        "tidak boleh ada klaim sukses saat tidak ada yang dikerjakan\nstdout: {stdout}"
    );
}

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Jenkins palsu: menjawab empat permintaan yang dipakai jalur pendaftaran job
/// (crumb, cek job, unggah config.xml, trigger build). Dipakai supaya deploy lama
/// benar-benar sampai ke klaim sukses walau push-nya gagal.
fn fake_jenkins_server() -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&hits);

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => break,
            };
            counter.fetch_add(1, Ordering::SeqCst);
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));

            let mut head = Vec::new();
            let mut buf = [0u8; 1024];
            while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => head.extend_from_slice(&buf[..n]),
                }
            }
            let text = String::from_utf8_lossy(&head).to_string();
            let target = text
                .lines()
                .next()
                .unwrap_or("")
                .split_whitespace()
                .nth(1)
                .unwrap_or("/")
                .to_string();

            // curl memakai Expect: 100-continue untuk body > 1 KiB (config.xml).
            if text.to_ascii_lowercase().contains("expect: 100-continue") {
                let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
                let _ = stream.flush();
                let mut body = vec![0u8; 65536];
                let _ = stream.read(&mut body);
            }

            let (code, body) = if target.contains("crumbIssuer") {
                (200, r#"{"crumb":"uji","crumbRequestField":"Jenkins-Crumb"}"#)
            } else if target.contains("/build") {
                (201, "created")
            } else {
                (200, "{}")
            };
            let response = format!(
                "HTTP/1.1 {code} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });

    (port, hits)
}

/// Konfigurasi Jenkins menunjuk ke server palsu di loopback.
fn fake_jenkins_config(home: &std::path::Path, port: u16) {
    let conf = home.join(".config").join("autore").join("jenkins.conf");
    fs::create_dir_all(conf.parent().unwrap()).unwrap();
    fs::write(
        &conf,
        format!("url=http://127.0.0.1:{port}\nuser=uji\ntoken=uji\n"),
    )
    .unwrap();
}

fn commit_all(dir: &std::path::Path) {
    for args in [
        ["add", "."].as_slice(),
        [
            "-c",
            "user.name=Uji",
            "-c",
            "user.email=uji@example.test",
            "commit",
            "-q",
            "-m",
            "awal",
        ]
        .as_slice(),
    ] {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} gagal di {}", dir.display());
    }
}

/// Push gagal = deploy gagal, walau Jenkins bisa dihubungi. Tanpa ini endpoint
/// dashboard menjawab HTTP 200 + "Deploy terkirim" untuk kode yang tidak pernah
/// sampai ke remote.
#[test]
fn deploy_gagal_push_keluar_non_nol_dan_tidak_mengaku_sukses() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("app");
    fs::create_dir_all(&home).unwrap();
    project_git(&project);
    commit_all(&project);
    let (port, jenkins_hits) = fake_jenkins_server();
    fake_jenkins_config(&home, port);

    // Remote di path yang tidak ada: `git push` pasti gagal.
    let missing_remote = tmp.path().join("remote-yang-tidak-ada.git");

    let out = autore()
        .env("HOME", &home)
        .args(["deploy", "--path"])
        .arg(&project)
        .arg("--git-url")
        .arg(&missing_remote)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(
        out.status.code(),
        Some(1),
        "push gagal harus keluar 1 (bukan nol yang berarti sukses)\nstdout: {stdout}\nstderr: {stderr}"
    );
    assert!(
        stderr.contains("Gagal push"),
        "stderr harus menyebut push sebagai sebabnya\nstdout: {stdout}\nstderr: {stderr}"
    );
    assert!(
        !stdout.contains("berhasil disambungkan"),
        "tidak boleh ada klaim sukses saat kode tidak terkirim\nstdout: {stdout}"
    );
    assert_eq!(
        jenkins_hits.load(Ordering::SeqCst),
        0,
        "push gagal: Jenkins tidak boleh disentuh sama sekali"
    );
}
