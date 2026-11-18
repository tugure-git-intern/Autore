use std::fs;
use std::process::Command;
use tempfile::TempDir;

fn autore() -> Command {
    Command::new(env!("CARGO_BIN_EXE_autore"))
}

#[test]
fn env_init_tanpa_all_ditolak() {
    let out = autore()
        .args(["env", "init"])
        .output()
        .expect("autore env init harus bisa dijalankan");
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("--all"),
        "pesan harus menyebut --all, dapat: {stderr}"
    );
}

#[test]
fn env_init_all_mengisi_workspace_salinan() {
    let tmp = TempDir::new().unwrap();
    fs::write(
        tmp.path().join("registry.tsv"),
        "app-a\t8000\t8101\napp-b\t8080\t8102\n",
    )
    .unwrap();

    let out = autore()
        .args(["env", "init", "--all"])
        .env("AUTORE_WORKSPACE", tmp.path())
        .output()
        .expect("autore env init --all harus bisa dijalankan");
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let doc: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(tmp.path().join("environments.json")).unwrap())
            .unwrap();
    assert_eq!(doc["app-a"]["staging"]["target"], "vps-staging");
    assert_eq!(doc["app-a"]["staging"]["deploy_port"], 8300);
    assert_eq!(doc["app-a"]["production"]["target"], "127.0.0.1:8301");
    assert_eq!(doc["app-a"]["production"]["container_port"], 8000);
    assert_eq!(doc["app-b"]["production"]["deploy_port"], 8303);
}
