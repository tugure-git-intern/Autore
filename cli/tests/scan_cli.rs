//! End-to-end regression tests for H-1 (authoritative scan really runs
//! Gitleaks + Trivy, and never executes repo-controlled scripts).
//!
//! These need a local Docker daemon (+ network on the first Trivy DB fetch),
//! so they are ignored by default:  cargo test -- --ignored

use std::fs;
use std::process::Command;
use tempfile::TempDir;

fn autore() -> Command {
    Command::new(env!("CARGO_BIN_EXE_autore"))
}

fn clean_project(dir: &std::path::Path) {
    fs::write(dir.join("app.py"), "def hello():\n    return 'ok'\n").unwrap();
    fs::write(
        dir.join("Dockerfile"),
        "FROM python:3.12-slim\nUSER appuser\nCMD [\"python\", \"app.py\"]\n",
    )
    .unwrap();
}

#[test]
#[ignore = "requires docker"]
fn scan_runs_gitleaks_and_trivy_even_without_repo_scripts() {
    let tmp = TempDir::new().unwrap();
    clean_project(tmp.path());

    let out = autore().args(["scan", "--path"]).arg(tmp.path()).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{stdout}\n{}", String::from_utf8_lossy(&out.stderr));
    assert!(stdout.contains("Gitleaks LULUS"), "Gitleaks did not run:\n{stdout}");
    assert!(stdout.contains("Trivy LULUS"), "Trivy did not run:\n{stdout}");
}

#[test]
#[ignore = "requires docker"]
fn scan_never_executes_repo_controlled_security_script() {
    let tmp = TempDir::new().unwrap();
    clean_project(tmp.path());
    let marker = tmp.path().join("PWNED");
    fs::create_dir_all(tmp.path().join("scripts")).unwrap();
    let script = tmp.path().join("scripts/security-check.sh");
    fs::write(&script, format!("#!/bin/sh\ntouch '{}'\nexit 0\n", marker.display())).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

    // `--docker` is the old flag that used to delegate to the repo script.
    let _ = autore().args(["scan", "--docker", "--path"]).arg(tmp.path()).output().unwrap();
    assert!(!marker.exists(), "autore executed a script from the scanned repository");
}

#[test]
fn no_docker_mode_is_labelled_non_authoritative() {
    let tmp = TempDir::new().unwrap();
    clean_project(tmp.path());
    let out = autore()
        .args(["scan", "--no-docker", "--path"])
        .arg(tmp.path())
        .output()
        .unwrap();
    let all = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    assert!(out.status.success(), "{all}");
    assert!(all.contains("NON-AUTHORITATIVE"), "{all}");
}

#[test]
fn scan_image_rejects_latest_tag() {
    let out = autore()
        .args(["scan-image", "--image", "127.0.0.1:5000/app:latest"])
        .output()
        .unwrap();
    let all = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    assert!(!out.status.success(), "scan-image should fail on :latest tag");
    assert!(all.contains("latest"), "{all}");
}

#[test]
fn scan_image_no_docker_mode_is_labelled_non_authoritative() {
    let out = autore()
        .args([
            "scan-image",
            "--image",
            "127.0.0.1:5000/app:build-1-commit-0123456789abcdef0123456789abcdef01234567",
            "--no-docker",
        ])
        .output()
        .unwrap();
    let all = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    assert!(out.status.success(), "{all}");
    assert!(all.contains("NON-AUTHORITATIVE"), "{all}");
}
