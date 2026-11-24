//! `autore dev` — jalankan project di laptop tanpa ribet: Dockerfile dibuat kalau
//! belum ada, image dibangun, container jalan di foreground. Repo GitHub, Jenkins,
//! dan deploy VPS tetap di luar cakupan perintah ini.

use crate::connect::deteksi_stack;
use crate::templates::{
    render_dockerfile, render_dockerignore, validate_app_name, InitConfig, TechStack,
};
use crate::workspace;
use colored::Colorize;
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

/// Rentang port host untuk `dev`, dijauhkan dari port deploy (8003-9000) supaya
/// tidak bertabrakan dengan container staging/production di mesin yang sama.
pub(crate) const PORT_AWAL: u16 = 8300;
pub(crate) const PORT_AKHIR: u16 = 8400;

pub(crate) struct DevArgs {
    pub(crate) app_name: Option<String>,
    pub(crate) stack: Option<String>,
    pub(crate) app_port: Option<u16>,
    pub(crate) port: Option<u16>,
}

pub(crate) fn jalankan(args: DevArgs) -> i32 {
    let dir = match std::env::current_dir() {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!(
                "{} tidak bisa membaca folder ini: {error}",
                "ERROR:".red().bold()
            );
            return 1;
        }
    };
    let nama = match nama_app(&dir, args.app_name.as_deref()) {
        Ok(nama) => nama,
        Err(error) => {
            eprintln!("{} {error}", "ERROR:".red().bold());
            return 1;
        }
    };
    let stack = match stack_pilihan(&dir, args.stack.as_deref()) {
        Ok(stack) => stack,
        Err(error) => {
            eprintln!("{} {error}", "ERROR:".red().bold());
            return 1;
        }
    };
    let app_port = args.app_port.unwrap_or_else(|| stack.default_port());
    if app_port == 0 {
        eprintln!("{} --app-port harus antara 1-65535", "ERROR:".red().bold());
        return 1;
    }

    let interrupted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Err(error) =
        signal_hook::flag::register(signal_hook::consts::SIGINT, interrupted.clone())
    {
        eprintln!(
            "{} tidak bisa menangani Ctrl+C: {error}",
            "ERROR:".red().bold()
        );
        return 1;
    }
    match run_compose_watch_with(
        &dir,
        ComposeWatchOptions {
            stack,
            app_port,
            requested_port: args.port,
        },
        || compose_watch_version().map(|_| ()),
        || {
            let cfg = InitConfig {
                app_name: nama.clone(),
                stack,
                app_port,
                deploy_port: args.port.unwrap_or(PORT_AWAL),
            };
            let dibuat = tulis_pipeline_kurang(&dir, &cfg)?;
            if dibuat.is_empty() {
                println!("{} pakai Dockerfile & .dockerignore yang ada", "i".dimmed());
            } else {
                for file in &dibuat {
                    println!("  • dibuat: {}", file.display());
                }
            }
            Ok(dibuat)
        },
        workspace::port_bebas,
        |command_args, project_dir, _| {
            run_compose_watch_child(command_args, project_dir, &interrupted)
        },
    ) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("{} {error}", "ERROR:".red().bold());
            1
        }
    }
}

/// Nama aplikasi: `--app-name` bila diisi, kalau tidak nama folder (huruf kecil).
/// Ditolak sebelum docker disentuh, dengan saran flag-nya.
fn nama_app(dir: &Path, pilihan: Option<&str>) -> Result<String, String> {
    let nama = match pilihan {
        Some(n) => n.trim().to_string(),
        None => dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase(),
    };
    validate_app_name(&nama).map_err(|e| format!("{e}; sebut namanya: --app-name <nama>"))?;
    Ok(nama)
}

fn stack_pilihan(dir: &Path, pilihan: Option<&str>) -> Result<TechStack, String> {
    if let Some(s) = pilihan {
        return TechStack::from_str_loose(s)
            .ok_or_else(|| format!("Stack '{s}' tidak dikenali. Pilih: python, nodejs, java, go"));
    }
    deteksi_stack(dir).ok_or_else(|| {
        "tidak menemukan kode aplikasi di folder ini; sebut stack-nya: --stack python|nodejs|java|go"
            .to_string()
    })
}

static TEMP_COMPOSE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn parse_compose_version(output: &str) -> Result<(u64, u64, u64), String> {
    for token in output.split_whitespace() {
        let token = token.strip_prefix('v').unwrap_or(token);
        if let Some(version) = parse_version_token(token) {
            return Ok(version);
        }
    }
    Err(format!(
        "Docker Compose returned malformed version output: {output:?}"
    ))
}

fn parse_version_token(token: &str) -> Option<(u64, u64, u64)> {
    let bytes = token.as_bytes();
    let mut index = 0;
    let major = parse_version_component(bytes, &mut index)?;
    if bytes.get(index) != Some(&b'.') {
        return None;
    }
    index += 1;
    let minor = parse_version_component(bytes, &mut index)?;
    if bytes.get(index) != Some(&b'.') {
        return None;
    }
    index += 1;
    let patch = parse_version_component(bytes, &mut index)?;
    let suffix = &token[index..];
    if !suffix.is_empty()
        && (!matches!(suffix.as_bytes()[0], b'-' | b'+' | b'~')
            || suffix.len() == 1
            || !suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b".+-~_".contains(&byte)))
    {
        return None;
    }
    Some((major, minor, patch))
}

fn parse_version_component(bytes: &[u8], index: &mut usize) -> Option<u64> {
    let start = *index;
    while bytes.get(*index).is_some_and(u8::is_ascii_digit) {
        *index += 1;
    }
    if start == *index {
        return None;
    }
    std::str::from_utf8(&bytes[start..*index])
        .ok()?
        .parse()
        .ok()
}

fn compose_watch_supported(version: (u64, u64, u64)) -> bool {
    version >= (2, 23, 0)
}

fn compose_command(program: &OsStr, args: &[OsString], project_dir: Option<&Path>) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(dir) = project_dir {
        command.current_dir(dir);
    }
    command
}

fn compose_watch_version_with(
    program: &OsStr,
    run: impl FnOnce(&mut Command) -> Result<String, String>,
) -> Result<(u64, u64, u64), String> {
    let args = ["compose", "version", "--short"].map(OsString::from);
    let mut command = compose_command(program, &args, None);
    let output = run(&mut command).map_err(|error| {
        format!(
            "could not run `docker compose version --short`: {error}. Install Docker Compose 2.23.0 or newer."
        )
    })?;
    let version = parse_compose_version(&output).map_err(|_| {
        "could not read Docker Compose version; run `docker compose version --short` and install Docker Compose 2.23.0 or newer".to_string()
    })?;
    if !compose_watch_supported(version) {
        return Err(format!(
            "Docker Compose {}.{}.{} is too old; `autore dev` watch requires Docker Compose 2.23.0 or newer. Upgrade Docker Compose and retry.",
            version.0, version.1, version.2
        ));
    }
    Ok(version)
}

fn compose_watch_version() -> Result<(u64, u64, u64), String> {
    compose_watch_version_with(OsStr::new("docker"), |command| {
        let output = command.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
}

struct TempComposeFile {
    path: PathBuf,
    removed: bool,
}

impl TempComposeFile {
    fn create(project_dir: &Path, contents: &str) -> Result<Self, String> {
        let project_dir = project_dir
            .canonicalize()
            .map_err(|error| format!("could not resolve project directory: {error}"))?;
        let temp_dir = std::env::temp_dir()
            .canonicalize()
            .map_err(|error| format!("could not resolve temporary directory: {error}"))?;
        if temp_dir.starts_with(&project_dir) {
            return Err(format!(
                "temporary directory {} is inside project {}; cannot safely create temporary Compose file",
                temp_dir.display(),
                project_dir.display()
            ));
        }

        for _ in 0..100 {
            let sequence = TEMP_COMPOSE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = temp_dir.join(format!("autore-dev-{}-{sequence}.yaml", std::process::id()));
            let mut file = match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "could not create temporary Compose file {}: {error}",
                        path.display()
                    ));
                }
            };
            if let Err(error) = file.write_all(contents.as_bytes()) {
                drop(file);
                let _ = std::fs::remove_file(&path);
                return Err(format!(
                    "could not write temporary Compose file {}: {error}",
                    path.display()
                ));
            }
            return Ok(Self {
                path,
                removed: false,
            });
        }
        Err("could not reserve a unique temporary Compose file name".to_string())
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn cleanup(&mut self) -> Result<(), String> {
        if self.removed {
            return Ok(());
        }
        match std::fs::remove_file(&self.path) {
            Ok(()) => self.removed = true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => self.removed = true,
            Err(error) => {
                return Err(format!(
                    "could not remove temporary Compose file {}: {error}",
                    self.path.display()
                ));
            }
        }
        Ok(())
    }
}

impl Drop for TempComposeFile {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn compose_watch_yaml(
    dir: &Path,
    stack: TechStack,
    sync_enabled: bool,
    host_port: u16,
    app_port: u16,
) -> Result<String, String> {
    let root = dir
        .canonicalize()
        .map_err(|e| format!("gagal menentukan folder project: {e}"))?;
    #[cfg(windows)]
    let root = root.strip_prefix(r"\\?\").unwrap_or(&root);
    let context = yaml_scalar(&root.to_string_lossy().replace('\\', "/"));
    let mut yaml = format!(
        r#"services:
  app:
    build:
      context: {context}
    ports:
      - "{host_port}:{app_port}"
    develop:
      watch:
"#
    );
    let base_ignores = [
        ".git/",
        ".env",
        ".env.*",
        "*.secret",
        "*.pem",
        "*.key",
        "*.p12",
        "__pycache__/",
        "*.py[cod]",
        ".venv/",
        "venv/",
        "node_modules/",
        "target/",
        "build/",
        "dist/",
        ".next/",
        ".nuxt/",
    ];
    let rebuild = |path: &str, yaml: &mut String| {
        yaml.push_str(&format!(
            "        - action: rebuild\n          path: {}\n",
            yaml_scalar(path)
        ));
    };
    let rebuild_all = |yaml: &mut String| {
        yaml.push_str("        - action: rebuild\n          path: '.'\n          ignore:\n");
        for pattern in base_ignores {
            yaml.push_str(&format!("            - {}\n", yaml_scalar(pattern)));
        }
    };
    let sync = |ignores: &[&str], yaml: &mut String| {
        yaml.push_str("        - action: sync+restart\n          path: '.'\n          target: /app\n          ignore:\n");
        let mut seen = std::collections::BTreeSet::new();
        for pattern in base_ignores.iter().chain(ignores) {
            if seen.insert(*pattern) {
                yaml.push_str(&format!("            - {}\n", yaml_scalar(pattern)));
            }
        }
    };
    if !sync_enabled || matches!(stack, TechStack::Java | TechStack::Go) {
        rebuild_all(&mut yaml);
        return Ok(yaml);
    }
    match stack {
        TechStack::Python => {
            for path in [
                "requirements.txt",
                "requirements-dev.txt",
                "requirements-test.txt",
                "requirements-prod.txt",
                "requirements-local.txt",
                "requirements-ci.txt",
                "requirements-dev-requirements.txt",
                "requirements-prod-requirements.txt",
                "pyproject.toml",
                "setup.py",
                "setup.cfg",
                "Pipfile",
                "Pipfile.lock",
                "poetry.lock",
                "uv.lock",
                "Dockerfile",
                ".dockerignore",
            ] {
                rebuild(path, &mut yaml);
            }
            sync(
                &[
                    "requirements.txt",
                    "requirements-dev.txt",
                    "requirements-test.txt",
                    "requirements-prod.txt",
                    "requirements-local.txt",
                    "requirements-ci.txt",
                    "requirements-dev-requirements.txt",
                    "requirements-prod-requirements.txt",
                    "pyproject.toml",
                    "setup.py",
                    "setup.cfg",
                    "Pipfile",
                    "Pipfile.lock",
                    "poetry.lock",
                    "uv.lock",
                    "Dockerfile",
                    ".dockerignore",
                    "__pycache__/",
                    "*.py[cod]",
                    ".venv/",
                    "venv/",
                    "target/",
                    "build/",
                    "dist/",
                ],
                &mut yaml,
            );
        }
        TechStack::NodeJs => {
            for path in [
                "package.json",
                "package-lock.json",
                "npm-shrinkwrap.json",
                "yarn.lock",
                "pnpm-lock.yaml",
                "bun.lock",
                "bun.lockb",
                ".npmrc",
                "Dockerfile",
                ".dockerignore",
            ] {
                rebuild(path, &mut yaml);
            }
            sync(
                &[
                    "package.json",
                    "package-lock.json",
                    "npm-shrinkwrap.json",
                    "yarn.lock",
                    "pnpm-lock.yaml",
                    "bun.lock",
                    "bun.lockb",
                    ".npmrc",
                    "Dockerfile",
                    ".dockerignore",
                    "node_modules/",
                    "target/",
                    "build/",
                    "dist/",
                    ".next/",
                    ".nuxt/",
                ],
                &mut yaml,
            );
        }
        TechStack::Java | TechStack::Go => unreachable!(),
    }
    Ok(yaml)
}

fn yaml_scalar(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn generated_watch_enabled(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join("Dockerfile")).is_ok_and(|dockerfile| {
        dockerfile
            .lines()
            .any(|line| line.trim() == "# AUTORE_WATCH_SYNC_APP_V1")
    })
}

fn validate_project_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 63
        || !name.as_bytes()[0].is_ascii_lowercase() && !name.as_bytes()[0].is_ascii_digit()
        || !name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
    {
        return Err(format!("nama project Compose tidak valid: {name}"));
    }
    Ok(())
}

fn cari_port_host(bebas: impl Fn(u16) -> bool) -> Option<u16> {
    (PORT_AWAL..=PORT_AKHIR).find(|p| bebas(*p))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ComposeRunResult {
    Exited(i32),
    Interrupted,
}

fn compose_watch_args(
    project_id: &str,
    project_dir: &Path,
    compose_file: &Path,
    command: &[&str],
) -> Vec<OsString> {
    [
        OsString::from("compose"),
        OsString::from("-p"),
        OsString::from(project_id),
        OsString::from("-f"),
        compose_file.as_os_str().to_os_string(),
        OsString::from("--project-directory"),
        project_dir.as_os_str().to_os_string(),
    ]
    .into_iter()
    .chain(command.iter().map(OsString::from))
    .collect()
}

struct ComposeWatchOptions {
    stack: TechStack,
    app_port: u16,
    requested_port: Option<u16>,
}

fn run_compose_watch_with(
    project_dir: &Path,
    options: ComposeWatchOptions,
    check_version: impl FnOnce() -> Result<(), String>,
    ensure_files: impl FnOnce() -> Result<Vec<PathBuf>, String>,
    port_is_free: impl Fn(u16) -> bool,
    mut run: impl FnMut(&[OsString], &Path, &Path) -> Result<ComposeRunResult, String>,
) -> Result<i32, String> {
    let ComposeWatchOptions {
        stack,
        app_port,
        requested_port,
    } = options;
    check_version()?;
    let generated_files = ensure_files()?;
    let host_port = match requested_port {
        Some(port) if port > 0 && port_is_free(port) => port,
        Some(port) => {
            return Err(format!(
                "port {port} tidak valid atau sedang dipakai; pilih port bebas"
            ))
        }
        None => cari_port_host(port_is_free)
            .ok_or_else(|| format!("tidak ada port bebas di {PORT_AWAL}-{PORT_AKHIR}"))?,
    };
    let sync_enabled = generated_watch_enabled(project_dir);
    let sequence = TEMP_COMPOSE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let project_id = format!("autore-dev-{}-{sequence}", std::process::id());
    validate_project_name(&project_id)?;
    let yaml = compose_watch_yaml(project_dir, stack, sync_enabled, host_port, app_port)?;
    let mut compose_file = TempComposeFile::create(project_dir, &yaml)?;
    println!("{} http://localhost:{host_port}", "➜".green().bold());
    println!("  Ctrl+C untuk berhenti\n");
    for file in generated_files {
        println!("  • dibuat: {}", file.display());
    }

    let up_args = compose_watch_args(
        &project_id,
        project_dir,
        compose_file.path(),
        &["up", "--build", "--watch", "--remove-orphans"],
    );
    match run(&up_args, project_dir, compose_file.path())? {
        ComposeRunResult::Exited(code) => {
            compose_file.cleanup()?;
            Ok(code)
        }
        ComposeRunResult::Interrupted => {
            let down_args = compose_watch_args(
                &project_id,
                project_dir,
                compose_file.path(),
                &["down", "--remove-orphans"],
            );
            let cleanup = run(&down_args, project_dir, compose_file.path());
            compose_file.cleanup()?;
            if let Err(error) = cleanup {
                eprintln!("ERROR: gagal membersihkan project Compose {project_id}: {error}");
            }
            Ok(130)
        }
    }
}

fn run_compose_watch_child(
    args: &[OsString],
    project_dir: &Path,
    interrupted: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<ComposeRunResult, String> {
    let mut child = compose_command(OsStr::new("docker"), args, Some(project_dir))
        .spawn()
        .map_err(|error| format!("docker compose failed to start: {error}"))?;
    loop {
        match child.try_wait() {
            Ok(Some(status))
                if interrupted.swap(false, Ordering::SeqCst) || status.code() == Some(130) =>
            {
                return Ok(ComposeRunResult::Interrupted)
            }
            Ok(Some(status)) => return Ok(ComposeRunResult::Exited(status.code().unwrap_or(1))),
            Ok(None) if interrupted.swap(false, Ordering::SeqCst) => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(ComposeRunResult::Interrupted);
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(error) => return Err(format!("failed waiting for docker compose: {error}")),
        }
    }
}

/// `Jenkinsfile` tidak dibuat di sini — `connect`/`deploy` yang menambahkannya
/// saat repo didaftarkan ke Jenkins.
fn tulis_pipeline_kurang(dir: &Path, cfg: &InitConfig) -> Result<Vec<PathBuf>, String> {
    let mut dibuat = Vec::new();
    let dockerfile = dir.join("Dockerfile");
    if !dockerfile.is_file() {
        std::fs::write(&dockerfile, render_dockerfile(cfg))
            .map_err(|e| format!("gagal menulis {}: {e}", dockerfile.display()))?;
        dibuat.push(dockerfile);
    }
    let dockerignore = dir.join(".dockerignore");
    if !dockerignore.is_file() {
        std::fs::write(&dockerignore, render_dockerignore())
            .map_err(|e| format!("gagal menulis {}: {e}", dockerignore.display()))?;
        dibuat.push(dockerignore);
    }
    Ok(dibuat)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_watch_lifecycle_orders_setup_and_uses_unique_project_without_named_removal() {
        use std::cell::RefCell;
        use std::rc::Rc;

        let project = tempfile::Builder::new()
            .prefix("watch project ")
            .tempdir()
            .unwrap();
        let events = Rc::new(RefCell::new(Vec::new()));
        let version_events = events.clone();
        let files_events = events.clone();
        let port_events = events.clone();
        let runner_events = events.clone();
        let mut up_args = Vec::new();
        let mut compose_file = None;
        let mut workdir = None;
        let code = run_compose_watch_with(
            project.path(),
            ComposeWatchOptions {
                stack: TechStack::Python,
                app_port: 8000,
                requested_port: Some(8301),
            },
            || {
                version_events.borrow_mut().push("version".to_string());
                Ok(())
            },
            || {
                files_events.borrow_mut().push("files".to_string());
                std::fs::write(
                    project.path().join("Dockerfile"),
                    "# AUTORE_WATCH_SYNC_APP_V1\n",
                )
                .unwrap();
                Ok(Vec::new())
            },
            |port| {
                port_events.borrow_mut().push(format!("port:{port}"));
                true
            },
            |args, dir, file| {
                runner_events.borrow_mut().push("compose".to_string());
                up_args = args.to_vec();
                compose_file = Some(file.to_path_buf());
                workdir = Some(dir.to_path_buf());
                assert!(file.is_file());
                Ok(ComposeRunResult::Exited(23))
            },
        )
        .unwrap();

        assert_eq!(code, 23, "child exit code must survive");
        assert_eq!(
            *events.borrow(),
            ["version", "files", "port:8301", "compose"]
        );
        assert_eq!(workdir.as_deref(), Some(project.path()));
        let project_dir = project.path().canonicalize().unwrap();
        assert!(
            up_args.windows(2).any(|pair| {
                pair[0] == "--project-directory" && pair[1] == project_dir.as_os_str()
            }),
            "up argv must select canonical project directory: {up_args:?}"
        );
        assert_eq!(up_args[0], "compose");
        assert_eq!(up_args[1], "-p");
        assert_eq!(up_args[3], "-f");
        assert_eq!(up_args[5], "--project-directory");
        assert_eq!(up_args[6], project_dir.as_os_str());
        assert_eq!(up_args[7], "up");
        assert_eq!(up_args[8..], ["--build", "--watch", "--remove-orphans"]);
        let project_id = up_args[2].to_string_lossy();
        assert!(project_id.starts_with("autore-dev-"), "{project_id}");
        assert!(validate_project_name(&project_id).is_ok());
        let temporary_file = compose_file.unwrap();
        assert!(
            !temporary_file.exists(),
            "temporary Compose config must be removed after child exits"
        );
        assert_eq!(
            std::fs::read_dir(project.path()).unwrap().count(),
            1,
            "only generated Dockerfile may remain"
        );
        assert!(
            !up_args.iter().any(|arg| arg == "rm" || arg == "docker"),
            "Compose Watch must not remove the old named container: {up_args:?}"
        );
    }

    #[test]
    fn compose_watch_version_failure_precedes_file_creation_and_compose() {
        let project = tempfile::tempdir().unwrap();
        let files_called = std::cell::Cell::new(false);
        let compose_called = std::cell::Cell::new(false);
        let error = run_compose_watch_with(
            project.path(),
            ComposeWatchOptions {
                stack: TechStack::Python,
                app_port: 8000,
                requested_port: Some(8301),
            },
            || Err("Compose too old".to_string()),
            || {
                files_called.set(true);
                Ok(Vec::new())
            },
            |_| true,
            |_, _, _| {
                compose_called.set(true);
                Ok(ComposeRunResult::Exited(0))
            },
        )
        .unwrap_err();

        assert_eq!(error, "Compose too old");
        assert!(!files_called.get());
        assert!(!compose_called.get());
        assert_eq!(std::fs::read_dir(project.path()).unwrap().count(), 0);
    }

    #[test]
    fn compose_watch_port_collision_never_starts_compose() {
        let project = tempfile::tempdir().unwrap();
        let compose_called = std::cell::Cell::new(false);
        let error = run_compose_watch_with(
            project.path(),
            ComposeWatchOptions {
                stack: TechStack::Python,
                app_port: 8000,
                requested_port: Some(8301),
            },
            || Ok(()),
            || Ok(Vec::new()),
            |_| false,
            |_, _, _| {
                compose_called.set(true);
                Ok(ComposeRunResult::Exited(0))
            },
        )
        .unwrap_err();

        assert!(error.contains("8301"), "{error}");
        assert!(!compose_called.get());
    }

    #[test]
    fn compose_watch_startup_failure_removes_temporary_config() {
        let project = tempfile::tempdir().unwrap();
        let temporary_file = std::cell::RefCell::new(None);
        let code = run_compose_watch_with(
            project.path(),
            ComposeWatchOptions {
                stack: TechStack::Python,
                app_port: 8000,
                requested_port: Some(8301),
            },
            || Ok(()),
            || Ok(Vec::new()),
            |_| true,
            |_, _, file| {
                assert!(file.is_file());
                *temporary_file.borrow_mut() = Some(file.to_path_buf());
                Ok(ComposeRunResult::Exited(17))
            },
        )
        .unwrap();

        assert_eq!(code, 17);
        assert!(!temporary_file.borrow().as_ref().unwrap().exists());
    }

    #[test]
    fn compose_watch_interrupt_runs_down_for_same_generated_project_only() {
        let project = tempfile::tempdir().unwrap();
        let mut calls = Vec::new();
        let code = run_compose_watch_with(
            project.path(),
            ComposeWatchOptions {
                stack: TechStack::Python,
                app_port: 8000,
                requested_port: Some(8301),
            },
            || Ok(()),
            || Ok(Vec::new()),
            |_| true,
            |args, _, file| {
                assert!(file.is_file());
                calls.push(args.to_vec());
                if calls.len() == 1 {
                    Ok(ComposeRunResult::Interrupted)
                } else {
                    Ok(ComposeRunResult::Exited(0))
                }
            },
        )
        .unwrap();

        assert_eq!(code, 130);
        assert_eq!(calls.len(), 2, "interrupt must call Compose down");
        let up = &calls[0];
        let down = &calls[1];
        assert_eq!(up[3], "-f");
        assert_eq!(up[5], "--project-directory");
        assert_eq!(up[6], project.path().as_os_str());
        assert_eq!(up[7], "up");
        assert_eq!(up[8..], ["--build", "--watch", "--remove-orphans"]);
        assert_eq!(down[0], "compose");
        assert_eq!(down[1], "-p");
        assert_eq!(down[2], up[2], "cleanup project ID must match up");
        assert_eq!(down[3], "-f");
        assert_eq!(down[4], up[4], "cleanup must use same Compose file");
        assert_eq!(down[5], "--project-directory");
        assert_eq!(down[6], project.path().as_os_str());
        assert_eq!(down[7], "down");
        assert_eq!(down[8..], ["--remove-orphans"]);
        assert!(!down
            .iter()
            .any(|arg| { arg == "--rmi" || arg == "-v" || arg == "--volumes" }));
    }

    #[test]
    fn compose_watch_supported_requires_minimum_version() {
        assert!(compose_watch_supported((2, 23, 0)));
        assert!(compose_watch_supported((2, 23, 1)));
        assert!(compose_watch_supported((2, 24, 0)));
        assert!(compose_watch_supported((3, 0, 0)));
        assert!(!compose_watch_supported((2, 22, 9)));
        assert!(!compose_watch_supported((1, 99, 99)));
    }

    #[test]
    fn parse_compose_version_accepts_release_and_suffixes() {
        assert_eq!(parse_compose_version("2.23.0").unwrap(), (2, 23, 0));
        assert_eq!(parse_compose_version("v2.24.1-rc2").unwrap(), (2, 24, 1));
        assert_eq!(
            parse_compose_version("Docker Compose version v2.27.0-desktop.1").unwrap(),
            (2, 27, 0)
        );
        assert_eq!(
            parse_compose_version("2.23.0-1~ubuntu.1").unwrap(),
            (2, 23, 0)
        );
        assert_eq!(parse_compose_version("2.23.0+build.4").unwrap(), (2, 23, 0));
    }

    #[test]
    fn parse_compose_version_rejects_missing_or_malformed_version() {
        for output in [
            "",
            "Docker Compose version",
            "2.23",
            "2.23.x",
            "2.23.0-",
            "abc2.23.0bad",
        ] {
            assert!(
                parse_compose_version(output).is_err(),
                "accepted malformed version {output:?}"
            );
        }
    }

    #[test]
    fn compose_command_and_version_probe_are_injectable() {
        let project = tempfile::tempdir().unwrap();
        let args = ["compose", "up", "--watch"].map(OsString::from);
        let command = compose_command(OsStr::new("docker"), &args, Some(project.path()));
        assert_eq!(command.get_program(), OsStr::new("docker"));
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            args.iter().map(OsString::as_os_str).collect::<Vec<_>>()
        );
        assert_eq!(command.get_current_dir(), Some(project.path()));

        let version = compose_watch_version_with(OsStr::new("docker-test"), |command| {
            assert_eq!(command.get_program(), OsStr::new("docker-test"));
            assert_eq!(
                command
                    .get_args()
                    .map(|arg| arg.to_string_lossy())
                    .collect::<Vec<_>>(),
                ["compose", "version", "--short"]
            );
            Ok("2.23.0-desktop.1".to_string())
        })
        .unwrap();
        assert_eq!(version, (2, 23, 0));

        let error =
            compose_watch_version_with(OsStr::new("fake-docker"), |_| Ok("2.22.9".to_string()))
                .unwrap_err();
        assert!(error.contains("2.23.0 or newer"), "{error}");
    }

    #[test]
    fn temp_compose_file_explicit_cleanup_removes_file_outside_project() {
        let project_dir = tempfile::tempdir().unwrap();
        let project_path = project_dir.path().canonicalize().unwrap();
        let mut compose = TempComposeFile::create(&project_path, "services: {}\n").unwrap();
        let path = compose.path().to_path_buf();
        assert!(path.is_file());
        assert!(
            !path.starts_with(&project_path),
            "{} inside {}",
            path.display(),
            project_path.display()
        );
        let temp_dir = std::env::temp_dir().canonicalize().unwrap();
        assert_eq!(path.parent(), Some(temp_dir.as_path()));

        compose.cleanup().unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn temp_compose_file_drop_removes_file() {
        let project = tempfile::tempdir().unwrap();
        let path = {
            let compose = TempComposeFile::create(project.path(), "services: {}\n").unwrap();
            let path = compose.path().to_path_buf();
            assert!(path.is_file());
            path
        };
        assert!(!path.exists());
    }

    #[test]
    fn compose_watch_yaml_emits_unique_sync_ignores() {
        for stack in [TechStack::Python, TechStack::NodeJs] {
            let dir = tempfile::tempdir().unwrap();
            let yaml = compose_watch_yaml(dir.path(), stack, true, 8300, 8000).unwrap();
            let mut seen = std::collections::BTreeSet::new();
            let mut in_ignores = false;
            for line in yaml.lines() {
                if line.trim() == "ignore:" {
                    in_ignores = true;
                    continue;
                }
                if !in_ignores {
                    continue;
                }
                let Some(pattern) = line.trim().strip_prefix("- ") else {
                    break;
                };
                assert!(
                    seen.insert(pattern),
                    "duplicate watch ignore: {pattern}\n{yaml}"
                );
            }
        }
    }

    #[test]
    fn compose_watch_yaml_syncs_python_and_rebuilds_dependencies() {
        let dir = tempfile::Builder::new()
            .prefix("my app ")
            .tempdir()
            .unwrap();
        let yaml = compose_watch_yaml(dir.path(), TechStack::Python, true, 8301, 8000).unwrap();
        let context = dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned()
            .replace('\\', "/");
        assert!(
            yaml.contains(&format!("context: {}", yaml_scalar(&context))),
            "{yaml}"
        );
        assert!(yaml.contains("\"8301:8000\""), "{yaml}");
        assert!(yaml.contains("action: sync+restart"), "{yaml}");
        for path in [
            "requirements.txt",
            "requirements-dev.txt",
            "requirements-test.txt",
            "requirements-prod.txt",
            "requirements-local.txt",
            "requirements-ci.txt",
            "requirements-dev-requirements.txt",
            "requirements-prod-requirements.txt",
            "pyproject.toml",
            "setup.py",
            "setup.cfg",
            "Pipfile",
            "Pipfile.lock",
            "poetry.lock",
            "uv.lock",
            "Dockerfile",
            ".dockerignore",
        ] {
            assert!(
                yaml.contains(&format!("path: '{}'", path)),
                "missing rebuild rule for {path}: {yaml}"
            );
        }
        for ignored in [
            "'.git/'",
            "'.env'",
            "'.env.*'",
            "'*.secret'",
            "'*.pem'",
            "'*.key'",
            "'*.p12'",
            "'__pycache__/'",
            "'*.py[cod]'",
            "'.venv/'",
            "'venv/'",
            "'target/'",
            "'build/'",
            "'dist/'",
        ] {
            assert!(yaml.contains(ignored), "missing ignore {ignored}: {yaml}");
        }
    }

    #[test]
    fn compose_watch_yaml_rebuilds_custom_java_go_and_node_dependencies() {
        for stack in [TechStack::Java, TechStack::Go] {
            let dir = tempfile::tempdir().unwrap();
            let yaml = compose_watch_yaml(dir.path(), stack, false, 8300, 8080).unwrap();
            assert!(yaml.contains("action: rebuild"), "{yaml}");
            assert!(
                !yaml.contains("action: sync"),
                "compiled app must rebuild only: {yaml}"
            );
            assert!(
                yaml.contains("path: '.'"),
                "whole-project watch missing: {yaml}"
            );
            for ignored in [
                "'.git/'",
                "'.env'",
                "'.env.*'",
                "'*.secret'",
                "'*.pem'",
                "'*.key'",
                "'*.p12'",
                "'__pycache__/'",
                "'*.py[cod]'",
                "'.venv/'",
                "'venv/'",
                "'node_modules/'",
                "'target/'",
                "'build/'",
                "'dist/'",
                "'.next/'",
                "'.nuxt/'",
            ] {
                assert!(
                    yaml.contains(ignored),
                    "missing rebuild ignore {ignored}: {yaml}"
                );
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let custom = compose_watch_yaml(dir.path(), TechStack::Python, false, 8300, 8000).unwrap();
        assert!(custom.contains("action: rebuild"), "{custom}");
        assert!(
            !custom.contains("action: sync"),
            "custom Dockerfile must rebuild only: {custom}"
        );
        assert!(
            custom.contains("path: '.'"),
            "custom Dockerfile watches whole project: {custom}"
        );

        let dir = tempfile::tempdir().unwrap();
        let node = compose_watch_yaml(dir.path(), TechStack::NodeJs, true, 8300, 3000).unwrap();
        assert!(node.contains("path: '.'"), "{node}");
        assert!(node.contains("action: sync+restart"), "{node}");
        let sync_at = node.find("action: sync+restart").unwrap();
        let mut rebuild_rules = node[..sync_at].lines().filter_map(|line| {
            line.trim_start()
                .strip_prefix("path: '")
                .and_then(|path| path.strip_suffix('\''))
        });
        for manifest in [
            "package.json",
            "package-lock.json",
            "npm-shrinkwrap.json",
            "yarn.lock",
            "pnpm-lock.yaml",
            "bun.lock",
            "bun.lockb",
            ".npmrc",
            "Dockerfile",
            ".dockerignore",
        ] {
            assert_eq!(rebuild_rules.next(), Some(manifest), "{node}");
        }
        assert_eq!(
            rebuild_rules.next(),
            None,
            "unexpected rebuild path: {node}"
        );
        let sync_rules = &node[sync_at..];
        for manifest in [
            "package.json",
            "package-lock.json",
            "npm-shrinkwrap.json",
            "yarn.lock",
            "pnpm-lock.yaml",
            "bun.lock",
            "bun.lockb",
            ".npmrc",
            "Dockerfile",
            ".dockerignore",
        ] {
            assert!(
                sync_rules.contains(&format!("            - '{manifest}'")),
                "sync must ignore rebuild input {manifest}: {node}"
            );
        }
    }

    #[test]
    fn generated_watch_marker_is_exact_and_project_name_is_validated() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dockerfile = tmp.path().join("Dockerfile");
        assert!(!generated_watch_enabled(tmp.path()));
        std::fs::write(&dockerfile, "# custom\n").unwrap();
        assert!(!generated_watch_enabled(tmp.path()));
        std::fs::write(&dockerfile, "# AUTORE_WATCH_SYNC_APP_V1\n").unwrap();
        assert!(generated_watch_enabled(tmp.path()));
        assert!(validate_project_name("autore-dev-123-456").is_ok());
        for invalid in ["", "Upper", "bad name", "-leading", "period.name", "a/b"] {
            assert!(
                validate_project_name(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
    }

    #[test]
    fn nama_folder_jadi_nama_aplikasi_huruf_kecil() {
        assert_eq!(
            nama_app(&PathBuf::from("/tmp/Hello-App"), None).unwrap(),
            "hello-app"
        );
        assert_eq!(
            nama_app(&PathBuf::from("/tmp/hello"), Some("nama-lain")).unwrap(),
            "nama-lain",
            "--app-name menang atas nama folder"
        );
    }

    #[test]
    fn nama_tidak_sah_ditolak_sebelum_docker_dipanggil() {
        let e = nama_app(&PathBuf::from("/tmp/my app"), None).unwrap_err();
        assert!(e.contains("--app-name"), "saran --app-name wajib ada: {e}");
    }

    #[test]
    fn stack_dipaksa_flag_menang_atas_deteksi() {
        let kosong = PathBuf::from("/tmp/autore-dev-kosong");
        std::fs::create_dir_all(&kosong).unwrap();
        let e = stack_pilihan(&kosong, None).unwrap_err();
        assert!(e.contains("--stack"), "saran --stack wajib ada: {e}");
        assert_eq!(stack_pilihan(&kosong, Some("go")).unwrap(), TechStack::Go);
        std::fs::remove_dir_all(&kosong).ok();
    }

    #[test]
    fn port_host_yang_terpakai_dilewati() {
        let mulai = PORT_AWAL + 1;
        assert_eq!(cari_port_host(|p| p >= mulai), Some(mulai));
        assert_eq!(cari_port_host(|_| false), None);
    }

    #[test]
    fn argv_docker_berbentuk_array_tanpa_shell() {
        let build = ["build", "-t", "web:dev", "."].map(OsString::from);
        assert_eq!(
            build
                .iter()
                .map(|arg| arg.to_string_lossy())
                .collect::<Vec<_>>(),
            ["build", "-t", "web:dev", "."]
        );
        let run = [
            "run",
            "--rm",
            "--name",
            "web-dev",
            "-p",
            "8300:8000",
            "web:dev",
        ]
        .map(OsString::from);
        assert_eq!(
            run.iter()
                .map(|arg| arg.to_string_lossy())
                .collect::<Vec<_>>(),
            [
                "run",
                "--rm",
                "--name",
                "web-dev",
                "-p",
                "8300:8000",
                "web:dev"
            ]
        );
    }

    #[test]
    fn dockerfile_yang_sudah_ada_tidak_ditimpa() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("Dockerfile"), "FROM scratch\n").unwrap();
        let cfg = InitConfig {
            app_name: "web".into(),
            stack: TechStack::Python,
            app_port: 8000,
            deploy_port: 8300,
        };
        let dibuat = tulis_pipeline_kurang(tmp.path(), &cfg).unwrap();
        assert_eq!(dibuat, vec![tmp.path().join(".dockerignore")]);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("Dockerfile")).unwrap(),
            "FROM scratch\n"
        );
    }
}
