//! Kontrak `autore dev` yang bisa diperiksa tanpa Docker: penolakan terjadi
//! sebelum docker dipanggil, dengan saran flag yang jelas.

use std::fs;
use std::process::{Command, Stdio};
use tempfile::TempDir;

fn autore() -> Command {
    Command::new(env!("CARGO_BIN_EXE_autore"))
}

#[test]
fn dev_di_folder_tanpa_kode_gagal_dan_menyarankan_stack() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("kosong");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();

    let out = autore()
        .env("HOME", &home)
        .arg("dev")
        .current_dir(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(1),
        "folder tanpa kode harus keluar 1\nstdout: {}\nstderr: {stderr}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(
        stderr.contains("--stack"),
        "stderr harus menyebut cara memilih stack: {stderr}"
    );
}

#[test]
fn dev_menolak_nama_folder_tidak_sah_sebelum_docker() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("my app");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("app.py"), "print(1)\n").unwrap();

    let out = autore()
        .env("HOME", &home)
        .arg("dev")
        .current_dir(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("--app-name"),
        "stderr harus menyarankan --app-name: {stderr}"
    );
    assert!(
        !project.join("Dockerfile").exists(),
        "berkas tidak boleh dibuat saat nama ditolak"
    );
}

#[cfg(unix)]
#[test]
fn dev_named_projects_fail_before_docker_or_files_and_show_upgrade_guidance() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("project");
    let bin = tmp.path().join("bin");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&bin).unwrap();
    fs::write(project.join("app.py"), "print(1)\n").unwrap();
    let log = tmp.path().join("docker.log");
    let docker = bin.join("docker");
    fs::write(
        &docker,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nif [ \"$1 $2 $3\" = 'compose version --short' ]; then echo 2.22.9; exit 0; fi\nexit 99\n",
            log.display()
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&docker, fs::Permissions::from_mode(0o755)).unwrap();

    let out = autore()
        .env("HOME", &home)
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .args([
            "dev",
            "--app-name",
            "spaced-project",
            "--stack",
            "python",
            "--port",
            "8301",
        ])
        .current_dir(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(stderr.contains("2.23.0 or newer"), "{stderr}");
    assert!(stderr.contains("Docker Compose"), "{stderr}");
    assert!(!project.join("Dockerfile").exists());
    let calls = fs::read_to_string(log).unwrap();
    assert_eq!(calls, "compose version --short\n");
}

#[cfg(unix)]
#[test]
fn dev_prints_url_and_ctrl_c_instructions_and_keeps_paths_as_one_arg() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("project with spaces");
    let bin = tmp.path().join("bin");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&bin).unwrap();
    fs::write(
        project.join("Dockerfile"),
        "FROM python:3.12\nCMD [\"python\", \"app.py\"]\n",
    )
    .unwrap();
    let log = tmp.path().join("docker.log");
    let cwd_log = tmp.path().join("docker.cwd");
    let yaml_log = tmp.path().join("compose.yaml");
    let argv_log = tmp.path().join("compose.argv");
    let docker = bin.join("docker");
    fs::write(
        &docker,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nif [ \"$1 $2 $3\" = 'compose version --short' ]; then echo 2.23.1; exit 0; fi\npwd > '{}'\ncat \"$5\" > '{}'\nif [ \"$1\" = compose ]; then printf '%s\\n' \"$@\" > '{}'; exit 23; fi\nexit 99\n",
            log.display(),
            cwd_log.display(),
            yaml_log.display(),
            argv_log.display()
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&docker, fs::Permissions::from_mode(0o755)).unwrap();

    let out = autore()
        .env("HOME", &home)
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .args([
            "dev",
            "--app-name",
            "spaced-project",
            "--stack",
            "python",
            "--port",
            "8301",
        ])
        .current_dir(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(23),
        "stdout: {} stderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(stdout.contains("http://localhost:8301"), "{stdout}");
    assert!(stdout.contains("Ctrl+C"), "{stdout}");
    let calls = fs::read_to_string(log).unwrap();
    assert_eq!(calls.lines().count(), 2, "{calls}");
    let compose = calls.lines().nth(1).unwrap();
    assert!(compose.contains("compose -p autore-dev-"), "{compose}");
    let argv: Vec<_> = fs::read_to_string(argv_log)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    let canonical_project = project.canonicalize().unwrap();
    let project_dir_index = argv
        .iter()
        .position(|arg| arg == "--project-directory")
        .expect("up argv must include --project-directory");
    assert_eq!(
        argv.get(project_dir_index + 1).map(String::as_str),
        canonical_project.to_str(),
        "up argv must select canonical project directory: {argv:?}"
    );
    let actual_cwd = fs::read_to_string(cwd_log).unwrap();
    assert_eq!(
        actual_cwd.trim(),
        project.canonicalize().unwrap().to_str().unwrap()
    );
    let actual_yaml = fs::read_to_string(yaml_log).unwrap();
    assert!(
        actual_yaml.contains(&format!(
            "context: '{}'",
            project.canonicalize().unwrap().to_string_lossy()
        )),
        "{actual_yaml}"
    );
    assert!(actual_yaml.contains("action: rebuild"), "{actual_yaml}");
    assert!(actual_yaml.contains("path: '.'"), "{actual_yaml}");
    assert!(
        !actual_yaml.contains("action: sync"),
        "custom Dockerfile must rebuild: {actual_yaml}"
    );
    assert!(compose.contains(" -f "), "{compose}");
    assert!(
        compose.contains(" up --build --watch --remove-orphans"),
        "{compose}"
    );
    assert!(!compose.contains("rm -f"), "{compose}");
    assert!(!project.join("autore-dev-compose.yaml").exists());
}

#[cfg(unix)]
#[test]
fn dev_keyboard_interrupt_cleans_generated_compose_project() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("project");
    let bin = tmp.path().join("bin");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&bin).unwrap();
    fs::write(project.join("app.py"), "print(1)\n").unwrap();
    let log = tmp.path().join("docker.log");
    let argv_log = tmp.path().join("compose.argv");
    let docker = bin.join("docker");
    fs::write(
        &docker,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nif [ \"$1 $2 $3\" = 'compose version --short' ]; then echo 2.23.1; exit 0; fi\nif [ \"$1\" = compose ] && [ \"$8\" = up ]; then printf '%s\\n' \"$@\" > '{}'; kill -INT \"$PPID\"; sleep 0.2; exit 130; fi\nif [ \"$1\" = compose ] && [ \"$8\" = down ]; then printf '%s\\n' \"$@\" >> '{}'; exit 0; fi\nexit 99\n",
            log.display(),
            argv_log.display(),
            argv_log.display()
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&docker, fs::Permissions::from_mode(0o755)).unwrap();

    let out = autore()
        .env("HOME", &home)
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .args([
            "dev",
            "--app-name",
            "spaced-project",
            "--stack",
            "python",
            "--port",
            "8301",
        ])
        .current_dir(&project)
        .stdin(Stdio::null())
        .output()
        .unwrap();

    assert_eq!(out.status.code(), Some(130));
    let argv: Vec<_> = fs::read_to_string(argv_log)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    let canonical_project = project.canonicalize().unwrap();
    let project_directories: Vec<_> = argv
        .windows(2)
        .filter(|pair| pair[0] == "--project-directory")
        .map(|pair| pair[1].as_str())
        .collect();
    assert_eq!(
        project_directories,
        [canonical_project.to_str().unwrap(); 2],
        "up and down argv must select canonical project directory: {argv:?}"
    );
    let calls = fs::read_to_string(log).unwrap();
    let calls: Vec<_> = calls.lines().collect();
    assert_eq!(calls.len(), 3, "{calls:?}");
    let up: Vec<_> = calls[1].split_whitespace().collect();
    let down: Vec<_> = calls[2].split_whitespace().collect();
    assert_eq!(&up[..2], &["compose", "-p"]);
    assert_eq!(&down[..2], &["compose", "-p"]);
    assert_eq!(up[2], down[2], "cleanup must target generated project");
    assert_eq!(up[4], down[4], "cleanup must use same temporary YAML");
    assert_eq!(
        &down[7..],
        &["down", "--remove-orphans"],
        "down argv: {down:?}"
    );
    assert!(!calls[2].contains("--rmi"));
    assert!(!calls[2].contains("-v"));
}
#[test]
fn dev_tampil_di_bantuan() {
    let out = autore().arg("--help").output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success());
    assert!(
        stdout.contains("dev"),
        "subcommand dev harus terdaftar: {stdout}"
    );
}
