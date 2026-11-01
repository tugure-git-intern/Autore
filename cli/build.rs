// build.rs — Tanam versi rilis dari tag Git (`v0.2.0` -> `0.2.0`) ke binary.
// Jika tag belum ada atau git tidak tersedia, pakai CARGO_PKG_VERSION dari Cargo.toml.
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/packed-refs");
    println!("cargo:rerun-if-changed=../.git/refs/tags");
    println!("cargo:rerun-if-env-changed=AUTORE_RELEASE_VERSION");

    let pkg = std::env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.1.0".to_string());
    let from_env = std::env::var("AUTORE_RELEASE_VERSION").ok();
    let from_git = Command::new("git")
        .args(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    let raw = from_env.or(from_git).unwrap_or_else(|| pkg.clone());
    let candidate = raw.trim().trim_start_matches('v');
    // Tag lama di induk commit kalah jika Cargo.toml sudah dinaikkan lebih tinggi.
    let clean = if semver_tuple(candidate) >= semver_tuple(&pkg) { candidate } else { &pkg };
    println!("cargo:rustc-env=AUTORE_VERSION={clean}");
}

fn semver_tuple(v: &str) -> (u64, u64, u64) {
    let mut it = v.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}
