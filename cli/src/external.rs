//! Authoritative external scanners (Gitleaks + Trivy) run through Docker.
//!
//! Trust model: everything here is compiled into the admin-installed `autore`
//! binary. Nothing from the repository being scanned is executed — the repo is
//! only mounted read-only into pinned (by digest) scanner images. A scanner only
//! counts as "ran" if it exits with a known code AND writes a well-formed report.

use std::path::{Path, PathBuf};

pub const GITLEAKS_IMAGE: &str = "zricethezav/gitleaks:v8.21.2@sha256:0e99e8821643ea5b235718642b93bb32486af9c8162c8b8731f7cbdc951a7f46";
pub const TRIVY_IMAGE: &str =
    "aquasec/trivy:0.58.1@sha256:ab70a02200597efa04748f210f793936eb647cbcdb0ea69cc30b226d6f5a22c7";

/// Only these locations are accepted for the docker client (PATH is ignored,
/// because the pipeline environment is repo-controlled).
pub const TRUSTED_DOCKER_PATHS: &[&str] = &["/usr/bin/docker", "/usr/local/bin/docker"];

pub trait Runner {
    /// Run `program args...`; return the exit code (Err if it could not start
    /// or was killed by a signal).
    fn run(&self, program: &Path, args: &[String]) -> Result<i32, String>;
}

pub struct ScanContext {
    pub docker: PathBuf,
    /// Canonical, absolute directory to scan (mounted read-only).
    pub target: PathBuf,
    /// Fresh private directory the scanners write their reports into.
    pub out_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub uid: u32,
    pub gid: u32,
}

pub fn resolve_trusted_binary(candidates: &[PathBuf], expected_owner: u32) -> Result<PathBuf, String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let mut reasons = Vec::new();
    for path in candidates {
        // metadata() follows symlinks, so the checks apply to the real binary.
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => {
                reasons.push(format!("{}: tidak ada", path.display()));
                continue;
            }
        };
        let mode = meta.permissions().mode();
        if !meta.is_file() || mode & 0o111 == 0 {
            reasons.push(format!("{}: bukan file executable", path.display()));
        } else if mode & 0o022 != 0 {
            reasons.push(format!("{}: writable oleh group/other", path.display()));
        } else if meta.uid() != expected_owner {
            reasons.push(format!("{}: owner uid {} (harus {})", path.display(), meta.uid(), expected_owner));
        } else {
            return Ok(path.clone());
        }
    }
    Err(format!(
        "Binary docker trusted tidak ditemukan ({}). Scanner Gitleaks/Trivy tidak bisa dijalankan.",
        reasons.join("; ")
    ))
}

fn docker_base(ctx: &ScanContext) -> Vec<String> {
    vec![
        "run".into(),
        "--rm".into(),
        "--user".into(),
        format!("{}:{}", ctx.uid, ctx.gid),
        "-e".into(),
        "HOME=/tmp".into(),
        "-v".into(),
        format!("{}:/repo:ro", ctx.target.display()),
        "-v".into(),
        format!("{}:/out", ctx.out_dir.display()),
    ]
}

fn read_report(ctx: &ScanContext, name: &str) -> Option<String> {
    std::fs::read_to_string(ctx.out_dir.join(name)).ok()
}

pub fn run_gitleaks(ctx: &ScanContext, runner: &dyn Runner) -> Result<(), String> {
    let report = ctx.out_dir.join("gitleaks.json");
    let _ = std::fs::remove_file(&report);
    let mut args = docker_base(ctx);
    args.extend(
        [
            "--network", "none", GITLEAKS_IMAGE, "detect", "--source=/repo", "--no-git",
            "--redact", "--exit-code", "1", "--report-format", "json",
            "--report-path", "/out/gitleaks.json",
        ]
        .map(String::from),
    );
    let code = runner.run(&ctx.docker, &args)?;
    let body = read_report(ctx, "gitleaks.json").map(|s| s.trim().to_string());
    let well_formed = matches!(&body, Some(b) if b.starts_with('[') && b.ends_with(']'));
    match (code, well_formed) {
        (0, true) if body.as_deref() == Some("[]") => Ok(()),
        (1, true) => Err("Gitleaks mendeteksi kebocoran Secret / API Key / Password".into()),
        (0 | 1, _) => Err(format!(
            "Gitleaks tidak menghasilkan laporan valid (exit {code}) — scanner dianggap TIDAK berjalan"
        )),
        _ => Err(format!("Gitleaks gagal berjalan (exit {code})")),
    }
}

pub fn run_trivy(ctx: &ScanContext, runner: &dyn Runner) -> Result<(), String> {
    let report = ctx.out_dir.join("trivy.json");
    let _ = std::fs::remove_file(&report);
    let mut args = docker_base(ctx);
    args.extend([
        "-v".to_string(),
        format!("{}:/cache", ctx.cache_dir.display()),
    ]);
    args.extend(
        [
            TRIVY_IMAGE, "fs", "--cache-dir", "/cache", "--scanners", "vuln,misconfig",
            "--skip-check-update", "--severity", "CRITICAL", "--exit-code", "1",
            "--format", "json", "--output", "/out/trivy.json", "/repo",
        ]
        .map(String::from),
    );
    let code = runner.run(&ctx.docker, &args)?;
    let well_formed = matches!(read_report(ctx, "trivy.json"), Some(b) if b.trim_start().starts_with('{') && b.contains("\"SchemaVersion\""));
    match (code, well_formed) {
        (0, true) => Ok(()),
        (1, true) => Err("Trivy mendeteksi celah keamanan CRITICAL / misconfiguration".into()),
        (0 | 1, false) => Err(format!(
            "Trivy tidak menghasilkan laporan valid (exit {code}) — scanner dianggap TIDAK berjalan"
        )),
        _ => Err(format!("Trivy gagal berjalan (exit {code})")),
    }
}

/// Real process runner. Inherits stderr so scanner progress shows in CI logs.
pub struct ProcessRunner;

impl Runner for ProcessRunner {
    fn run(&self, program: &Path, args: &[String]) -> Result<i32, String> {
        let status = std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("Gagal menjalankan {}: {e}", program.display()))?;
        status
            .code()
            .ok_or_else(|| format!("{} dihentikan oleh signal", program.display()))
    }
}

/// Build a context (private 0700 report dir, trusted docker) and run both
/// scanners. Any error means the gate must fail.
pub fn run_authoritative_scan(target: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    let docker = resolve_trusted_binary(
        &TRUSTED_DOCKER_PATHS.iter().map(PathBuf::from).collect::<Vec<_>>(),
        0,
    )?;
    let target = target
        .canonicalize()
        .map_err(|e| format!("Path scan tidak valid: {e}"))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let out_dir = std::env::temp_dir().join(format!("autore-scan-{}-{nanos}", std::process::id()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&out_dir) // fails if it already exists (no pre-planted dir)
        .map_err(|e| format!("Gagal membuat direktori laporan: {e}"))?;
    let meta = std::fs::metadata(&out_dir).map_err(|e| e.to_string())?;
    let cache_dir = match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h).join(".cache/autore/trivy"),
        None => out_dir.join("cache"),
    };
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Gagal membuat cache Trivy: {e}"))?;

    let ctx = ScanContext { docker, target, out_dir: out_dir.clone(), cache_dir, uid: meta.uid(), gid: meta.gid() };
    let result = (|| {
        run_gitleaks(&ctx, &ProcessRunner)?;
        println!("  ✔ Gitleaks LULUS (tidak ada secret bocor).");
        run_trivy(&ctx, &ProcessRunner)?;
        println!("  ✔ Trivy LULUS (tidak ada celah CRITICAL).");
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&out_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use tempfile::TempDir;

    /// Fake docker: records calls, optionally writes a report, returns `code`.
    struct FakeRunner {
        code: i32,
        report: Option<&'static str>,
        calls: RefCell<Vec<Vec<String>>>,
    }

    impl Runner for FakeRunner {
        fn run(&self, _program: &Path, args: &[String]) -> Result<i32, String> {
            self.calls.borrow_mut().push(args.to_vec());
            if let Some(body) = self.report {
                // The report lands in out_dir as named by the scanner args.
                let out = args
                    .iter()
                    .find_map(|a| a.strip_suffix(":/out").map(PathBuf::from))
                    .expect("out_dir must be mounted at /out");
                let name = if args.iter().any(|a| a.contains("gitleaks")) {
                    "gitleaks.json"
                } else {
                    "trivy.json"
                };
                fs::write(out.join(name), body).unwrap();
            }
            Ok(self.code)
        }
    }

    fn fake(code: i32, report: Option<&'static str>) -> FakeRunner {
        FakeRunner { code, report, calls: RefCell::new(vec![]) }
    }

    fn ctx(tmp: &TempDir) -> ScanContext {
        let target = tmp.path().join("repo");
        let out_dir = tmp.path().join("out");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&out_dir).unwrap();
        ScanContext {
            docker: PathBuf::from("/usr/bin/docker"),
            target,
            out_dir,
            cache_dir: tmp.path().join("cache"),
            uid: 1000,
            gid: 1000,
        }
    }

    const TRIVY_OK: &str = r#"{"SchemaVersion": 2, "Results": []}"#;

    // ---- trusted docker resolution ----------------------------------------

    #[test]
    fn missing_docker_is_rejected() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_trusted_binary(&[tmp.path().join("nope")], 0).unwrap_err();
        assert!(err.contains("docker"), "{err}");
    }

    #[test]
    fn writable_or_foreign_docker_binary_is_rejected() {
        let tmp = TempDir::new().unwrap();
        let bin = tmp.path().join("docker");
        fs::write(&bin, "#!/bin/sh\n").unwrap();
        let me = fs::metadata(&bin).unwrap().uid();

        fs::set_permissions(&bin, fs::Permissions::from_mode(0o777)).unwrap();
        assert!(resolve_trusted_binary(&[bin.clone()], me).is_err(), "world-writable accepted");

        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(resolve_trusted_binary(&[bin.clone()], me + 1).is_err(), "wrong owner accepted");
        assert_eq!(resolve_trusted_binary(&[bin.clone()], me).unwrap(), bin);
    }

    // ---- gitleaks ---------------------------------------------------------

    #[test]
    fn gitleaks_exit_zero_without_report_fails_closed() {
        let tmp = TempDir::new().unwrap();
        let err = run_gitleaks(&ctx(&tmp), &fake(0, None)).unwrap_err();
        assert!(err.contains("Gitleaks"), "{err}");
    }

    #[test]
    fn gitleaks_findings_block() {
        let tmp = TempDir::new().unwrap();
        assert!(run_gitleaks(&ctx(&tmp), &fake(1, Some(r#"[{"RuleID":"x"}]"#))).is_err());
    }

    #[test]
    fn gitleaks_unexpected_exit_code_fails_closed() {
        let tmp = TempDir::new().unwrap();
        // 125 = docker could not start the container (e.g. image pull failed)
        assert!(run_gitleaks(&ctx(&tmp), &fake(125, None)).is_err());
    }

    #[test]
    fn gitleaks_clean_report_passes_and_uses_pinned_readonly_invocation() {
        let tmp = TempDir::new().unwrap();
        let c = ctx(&tmp);
        let r = fake(0, Some("[]"));
        run_gitleaks(&c, &r).unwrap();
        let args = r.calls.borrow()[0].join(" ");
        assert!(args.contains(GITLEAKS_IMAGE), "{args}");
        assert!(args.contains(&format!("{}:/repo:ro", c.target.display())), "{args}");
        assert!(args.contains("--network none"), "{args}");
        assert!(!args.contains("security-check.sh"), "{args}");
    }

    // ---- trivy ------------------------------------------------------------

    #[test]
    fn trivy_exit_zero_without_report_fails_closed() {
        let tmp = TempDir::new().unwrap();
        let err = run_trivy(&ctx(&tmp), &fake(0, None)).unwrap_err();
        assert!(err.contains("Trivy"), "{err}");
    }

    #[test]
    fn trivy_garbage_report_fails_closed() {
        let tmp = TempDir::new().unwrap();
        assert!(run_trivy(&ctx(&tmp), &fake(0, Some("not json"))).is_err());
    }

    #[test]
    fn trivy_critical_findings_block() {
        let tmp = TempDir::new().unwrap();
        assert!(run_trivy(&ctx(&tmp), &fake(1, Some(TRIVY_OK))).is_err());
    }

    #[test]
    fn trivy_clean_report_passes_and_uses_pinned_readonly_invocation() {
        let tmp = TempDir::new().unwrap();
        let c = ctx(&tmp);
        let r = fake(0, Some(TRIVY_OK));
        run_trivy(&c, &r).unwrap();
        let args = r.calls.borrow()[0].join(" ");
        assert!(args.contains(TRIVY_IMAGE), "{args}");
        assert!(args.contains(&format!("{}:/repo:ro", c.target.display())), "{args}");
        assert!(args.contains("--severity CRITICAL"), "{args}");
    }
}
