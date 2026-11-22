//! `autore connect` pada folder yang sudah ada: penolakan tanpa `--resume`,
//! penolakan `--resume` untuk checkout repo/branch lain, dan berkas dev yang
//! dipertahankan saat resume. Tidak ada tes yang butuh jaringan.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use tempfile::TempDir;

const REPO: &str = "https://github.com/tugure-reasuransi/autore-demo";

fn autore() -> Command {
    Command::new(env!("CARGO_BIN_EXE_autore"))
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .expect("git harus bisa dijalankan");
    assert!(status.success(), "git {args:?} gagal");
}

/// Checkout tiruan: folder git berisi commit, origin sesuai `url`, branch `main`.
fn checkout(dir: &Path, url: &str) {
    fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "dev@example.com"]);
    git(dir, &["config", "user.name", "Dev"]);
    fs::write(dir.join("app.py"), "print('halo')\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "awal"]);
    git(dir, &["remote", "add", "origin", url]);
}

/// `(workspace, folder app)` yang belum ada.
fn workspace(tmp: &TempDir) -> (PathBuf, PathBuf) {
    let ws = tmp.path().join("autore-workspace");
    fs::create_dir_all(&ws).unwrap();
    (ws.clone(), ws.join("autore-demo"))
}

fn connect(ws: &Path, tambahan: &[&str]) -> Output {
    autore()
        .args(["connect", "--path"])
        .arg(ws)
        .args([
            "--repo",
            REPO,
            "--app-name",
            "autore-demo",
            "--branch",
            "main",
        ])
        .args(tambahan)
        .env("AUTORE_WORKSPACE", ws)
        .env("AUTORE_PROGRESS", "json")
        .env("GIT_TERMINAL_PROMPT", "0")
        // Uji ini tidak boleh menyentuh GitHub sungguhan: tanpa ini `git push`
        // bisa benar-benar menulis ke repo kalau mesin punya kredensial.
        .env("GIT_ALLOW_PROTOCOL", "file")
        .output()
        .expect("autore connect harus bisa dijalankan")
}

#[test]
fn folder_ada_tanpa_resume_ditolak_dan_menyebut_resume() {
    let tmp = TempDir::new().unwrap();
    let (ws, app) = workspace(&tmp);
    fs::create_dir_all(&app).unwrap();
    fs::write(app.join("catatan.txt"), "jangan disentuh\n").unwrap();

    let out = connect(&ws, &[]);

    assert!(!out.status.success(), "folder yang ada harus ditolak");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("--resume"),
        "pesan harus menawarkan --resume: {stderr}"
    );
    // Ditolak sebelum menyentuh folder: isi lama utuh.
    assert_eq!(
        fs::read_to_string(app.join("catatan.txt")).unwrap(),
        "jangan disentuh\n"
    );
    assert!(
        !app.join(".git").exists(),
        "tanpa --resume folder tidak dijadikan repo"
    );
}

#[test]
fn resume_menolak_checkout_repo_lain_tanpa_menyentuh_berkas() {
    let tmp = TempDir::new().unwrap();
    let (ws, app) = workspace(&tmp);
    checkout(&app, "https://github.com/lain/proyek-lain");
    fs::write(app.join("catatan.txt"), "milik repo lain\n").unwrap();

    let out = connect(&ws, &["--resume"]);

    assert!(!out.status.success(), "origin yang beda harus ditolak");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("tidak bisa dilanjutkan"),
        "pesan harus menjelaskan kenapa ditolak: {stderr}"
    );
    assert_eq!(
        fs::read_to_string(app.join("catatan.txt")).unwrap(),
        "milik repo lain\n"
    );
    // Tahap klon dilaporkan gagal supaya dashboard bisa menunjuk tahapnya.
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains(r#""tahap":"klon","status":"gagal""#),
        "tahap gagal harus dikabarkan: {stdout}"
    );
}

#[test]
fn resume_memakai_ulang_checkout_dan_mempertahankan_berkas_dev() {
    let tmp = TempDir::new().unwrap();
    let (ws, app) = workspace(&tmp);
    checkout(&app, &format!("{REPO}.git"));
    // Berkas milik dev: `connect` tidak boleh menimpanya saat resume.
    fs::write(app.join("Dockerfile"), "FROM alpine:3.20\n# milik dev\n").unwrap();
    fs::write(app.join("catatan.txt"), "penting\n").unwrap();
    git(&app, &["add", "."]);
    git(&app, &["commit", "-q", "-m", "berkas dev"]);

    let out = connect(&ws, &["--resume"]);

    // Push ke repo sungguhan akan gagal (tanpa kredensial): yang diuji di sini
    // adalah tahap sebelum push — checkout dipakai ulang, berkas dev utuh.
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Checkout") && stdout.contains("--resume"),
        "checkout harus dipakai ulang: {stdout}"
    );
    assert_eq!(
        fs::read_to_string(app.join("Dockerfile")).unwrap(),
        "FROM alpine:3.20\n# milik dev\n",
        "Dockerfile dev tidak boleh ditimpa"
    );
    assert_eq!(
        fs::read_to_string(app.join("catatan.txt")).unwrap(),
        "penting\n"
    );
    // Pipeline yang belum ada tetap dibuat.
    assert!(app.join("Jenkinsfile").exists(), "Jenkinsfile harus dibuat");
    // Belum terdaftar: port tidak boleh terkunci sebelum Jenkins sukses.
    let reg = ws.join("registry.tsv");
    let isi = fs::read_to_string(&reg).unwrap_or_default();
    assert!(
        !isi.contains("autore-demo"),
        "port tidak boleh dicatat saat connect belum selesai: {isi}"
    );
}
