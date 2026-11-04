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
