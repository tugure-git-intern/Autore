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

    /// Run `program args...`; return (exit code, stdout)
    fn run_capture(&self, program: &Path, args: &[String]) -> Result<(i32, String), String>;
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

pub fn run_trivy(ctx: &ScanContext, runner: &dyn Runner, severity: &str) -> Result<(), String> {
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
            "--skip-check-update", "--severity", severity, "--exit-code", "1",
            "--format", "json", "--output", "/out/trivy.json", "/repo",
        ]
        .map(String::from),
    );
    let code = runner.run(&ctx.docker, &args)?;
    let well_formed = matches!(read_report(ctx, "trivy.json"), Some(b) if b.trim_start().starts_with('{') && b.contains("\"SchemaVersion\""));
    match (code, well_formed) {
        (0, true) => Ok(()),
        (1, true) => Err(format!("Trivy mendeteksi celah keamanan {severity} / misconfiguration")),
        (0 | 1, false) => Err(format!(
            "Trivy tidak menghasilkan laporan valid (exit {code}) — scanner dianggap TIDAK berjalan"
        )),
        _ => Err(format!("Trivy gagal berjalan (exit {code})")),
    }
}

pub struct ImageScanOptions<'a> {
    pub image: &'a str,
    pub severity: &'a str,
    pub sbom_output: Option<&'a Path>,
}

pub fn run_trivy_image(
    docker: &Path,
    opts: &ImageScanOptions,
    runner: &dyn Runner,
) -> Result<(), String> {
    if opts.image == "latest" || opts.image.ends_with(":latest") {
        return Err("Tag :latest dilarang. Gunakan immutable commit tag.".into());
    }

    // 1. Periksa runtime user/UID image (fail-closed jika root / UID 0)
    let (inspect_code, inspect_out) = runner.run_capture(
        docker,
        &[
            "image".into(),
            "inspect".into(),
            "--format".into(),
            "{{.Config.User}}".into(),
            opts.image.into(),
        ],
    )?;
    if inspect_code != 0 {
        return Err(format!(
            "Gagal membaca metadata image {}: inspect exit code {inspect_code}",
            opts.image
        ));
    }
    let user_trimmed = inspect_out.trim();
    let user_lower = user_trimmed.to_ascii_lowercase();
    let is_root = user_lower.is_empty()
        || user_lower == "root"
        || user_lower == "0"
        || user_lower == "0:0"
        || user_lower.starts_with("root:")
        || user_lower.starts_with("0:");
    if is_root {
        let _ = runner.run(docker, &["rmi".into(), opts.image.into()]);
        return Err(format!(
            "Image {} berjalan sebagai root (UID 0, user: '{}'). Wajib menggunakan non-root USER.",
            opts.image, user_trimmed
        ));
    }

    // 2. Jalankan Trivy Image Scan
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let out_dir = std::env::temp_dir().join(format!("autore-image-scan-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Gagal membuat direktori laporan image: {e}"))?;
    let cache_dir = match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h).join(".cache/autore/trivy"),
        None => out_dir.join("cache"),
    };
    let _ = std::fs::create_dir_all(&cache_dir);

    let report_file = out_dir.join("trivy-image.json");
    let args = [
        "run".into(),
        "--rm".into(),
        "-v".into(),
        "/var/run/docker.sock:/var/run/docker.sock".into(),
        "-v".into(),
        format!("{}:/reports", out_dir.display()),
        "-v".into(),
        format!("{}:/cache", cache_dir.display()),
        TRIVY_IMAGE.into(),
        "image".into(),
        "--cache-dir".into(),
        "/cache".into(),
        "--scanners".into(),
        "vuln".into(),
        "--skip-check-update".into(),
        "--severity".into(),
        opts.severity.into(),
        "--exit-code".into(),
        "1".into(),
        "--format".into(),
        "json".into(),
        "--output".into(),
        "/reports/trivy-image.json".into(),
        opts.image.into(),
    ];
    let scan_code = runner.run(docker, &args)?;
    let report_body = std::fs::read_to_string(&report_file).ok();
    let well_formed = matches!(&report_body, Some(b) if b.trim_start().starts_with('{') && b.contains("\"SchemaVersion\""));

    if scan_code != 0 || !well_formed {
        let _ = runner.run(docker, &["rmi".into(), opts.image.into()]);
        let _ = std::fs::remove_dir_all(&out_dir);
        if scan_code == 1 && well_formed {
            return Err(format!(
                "Trivy mendeteksi celah keamanan {} pada image {}",
                opts.severity, opts.image
            ));
        } else {
            return Err(format!(
                "Trivy image scan gagal atau tidak menghasilkan laporan valid (exit {scan_code})"
            ));
        }
    }

    // 3. Generate CycloneDX SBOM jika diminta
    if let Some(sbom_target) = opts.sbom_output {
        let sbom_tmp = out_dir.join("sbom.cdx.json");
        let sbom_args = [
            "run".into(),
            "--rm".into(),
            "-v".into(),
            "/var/run/docker.sock:/var/run/docker.sock".into(),
            "-v".into(),
            format!("{}:/reports", out_dir.display()),
            "-v".into(),
            format!("{}:/cache", cache_dir.display()),
            TRIVY_IMAGE.into(),
            "image".into(),
            "--cache-dir".into(),
            "/cache".into(),
            "--format".into(),
            "cyclonedx".into(),
            "--output".into(),
            "/reports/sbom.cdx.json".into(),
            opts.image.into(),
        ];
        let sbom_code = runner.run(docker, &sbom_args)?;
        let sbom_content = std::fs::read_to_string(&sbom_tmp).ok();
        let sbom_valid = matches!(&sbom_content, Some(b) if b.contains("CycloneDX") || b.contains("bomFormat"));
        if sbom_code != 0 || !sbom_valid {
            let _ = runner.run(docker, &["rmi".into(), opts.image.into()]);
            let _ = std::fs::remove_dir_all(&out_dir);
            return Err("Gagal menghasilkan SBOM CycloneDX yang valid".into());
        }
        if let Some(parent) = sbom_target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(sbom_target, sbom_content.unwrap()) {
            let _ = runner.run(docker, &["rmi".into(), opts.image.into()]);
            let _ = std::fs::remove_dir_all(&out_dir);
            return Err(format!("Gagal menyimpan SBOM ke {}: {e}", sbom_target.display()));
        }
    }

    let _ = std::fs::remove_dir_all(&out_dir);
    Ok(())
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

    fn run_capture(&self, program: &Path, args: &[String]) -> Result<(i32, String), String> {
        let out = std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Gagal menjalankan {}: {e}", program.display()))?;
        let code = out
            .status
            .code()
            .ok_or_else(|| format!("{} dihentikan oleh signal", program.display()))?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        Ok((code, stdout))
    }
}

/// Build a context (private 0700 report dir, trusted docker) and run both
/// scanners. Any error means the gate must fail.
pub fn run_authoritative_scan(target: &Path, severity: &str) -> Result<(), String> {
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
        run_trivy(&ctx, &ProcessRunner, severity)?;
        println!("  ✔ Trivy LULUS (tidak ada celah {severity}).");
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&out_dir);
    result
}

pub fn run_authoritative_image_scan(opts: &ImageScanOptions) -> Result<(), String> {
    let docker = resolve_trusted_binary(
        &TRUSTED_DOCKER_PATHS.iter().map(PathBuf::from).collect::<Vec<_>>(),
        0,
    )?;
    run_trivy_image(&docker, opts, &ProcessRunner)?;
    println!("  ✔ Image scan LULUS: runtime user non-root & bebas CVE {}.", opts.severity);
    if opts.sbom_output.is_some() {
        println!("  ✔ SBOM CycloneDX berhasil dibuat.");
    }
    Ok(())
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
        inspect_user: Option<String>,
        report: Option<&'static str>,
        sbom: Option<&'static str>,
        calls: RefCell<Vec<Vec<String>>>,
    }

    impl Runner for FakeRunner {
        fn run(&self, _program: &Path, args: &[String]) -> Result<i32, String> {
            self.calls.borrow_mut().push(args.to_vec());
            if let Some(body) = self.report {
                // The report lands in out_dir as named by the scanner args (/out or /reports).
                let out = args
                    .iter()
                    .find_map(|a| a.strip_suffix(":/out").or_else(|| a.strip_suffix(":/reports")).map(PathBuf::from));
                if let Some(out) = out {
                    let name = if args.iter().any(|a| a.contains("gitleaks")) {
                        "gitleaks.json"
                    } else if args.iter().any(|a| a == "image") && args.iter().any(|a| a == "cyclonedx") {
                        "sbom.cdx.json"
                    } else if args.iter().any(|a| a == "image") {
                        "trivy-image.json"
                    } else {
                        "trivy.json"
                    };
                    if name == "sbom.cdx.json" {
                        if let Some(s) = self.sbom {
                            fs::write(out.join(name), s).unwrap();
                        }
                    } else {
                        fs::write(out.join(name), body).unwrap();
                    }
                }
            }
            Ok(self.code)
        }

        fn run_capture(&self, _program: &Path, args: &[String]) -> Result<(i32, String), String> {
            self.calls.borrow_mut().push(args.to_vec());
            if args.iter().any(|a| a == "inspect") {
                let user = self.inspect_user.clone().unwrap_or_else(|| "appuser".to_string());
                Ok((0, user))
            } else {
                Ok((self.code, String::new()))
            }
        }
    }

    fn fake(code: i32, report: Option<&'static str>) -> FakeRunner {
        FakeRunner {
            code,
            inspect_user: None,
            report,
            sbom: None,
            calls: RefCell::new(vec![]),
        }
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
        assert!(resolve_trusted_binary(std::slice::from_ref(&bin), me).is_err(), "world-writable accepted");

        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(resolve_trusted_binary(std::slice::from_ref(&bin), me + 1).is_err(), "wrong owner accepted");
        assert_eq!(resolve_trusted_binary(std::slice::from_ref(&bin), me).unwrap(), bin);
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
        let err = run_trivy(&ctx(&tmp), &fake(0, None), "HIGH,CRITICAL").unwrap_err();
        assert!(err.contains("Trivy"), "{err}");
    }

    #[test]
    fn trivy_garbage_report_fails_closed() {
        let tmp = TempDir::new().unwrap();
        assert!(run_trivy(&ctx(&tmp), &fake(0, Some("not json")), "HIGH,CRITICAL").is_err());
    }

    #[test]
    fn trivy_critical_findings_block() {
        let tmp = TempDir::new().unwrap();
        assert!(run_trivy(&ctx(&tmp), &fake(1, Some(TRIVY_OK)), "HIGH,CRITICAL").is_err());
    }

    #[test]
    fn trivy_clean_report_passes_and_uses_pinned_readonly_invocation() {
        let tmp = TempDir::new().unwrap();
        let c = ctx(&tmp);
        let r = fake(0, Some(TRIVY_OK));
        run_trivy(&c, &r, "HIGH,CRITICAL").unwrap();
        let args = r.calls.borrow()[0].join(" ");
        assert!(args.contains(TRIVY_IMAGE), "{args}");
        assert!(args.contains(&format!("{}:/repo:ro", c.target.display())), "{args}");
        assert!(args.contains("--severity HIGH,CRITICAL"), "{args}");
    }

    // ---- trivy image scan & sbom -------------------------------------------

    #[test]
    fn trivy_image_rejects_latest_tag() {
        let _tmp = TempDir::new().unwrap();
        let docker = PathBuf::from("/usr/bin/docker");
        let opts = ImageScanOptions {
            image: "127.0.0.1:5000/app:latest",
            severity: "HIGH,CRITICAL",
            sbom_output: None,
        };
        let r = fake(0, None);
        let err = run_trivy_image(&docker, &opts, &r).unwrap_err();
        assert!(err.contains("latest"), "{err}");
    }

    #[test]
    fn trivy_image_fails_when_user_is_root_and_removes_image() {
        let _tmp = TempDir::new().unwrap();
        let docker = PathBuf::from("/usr/bin/docker");
        let image = "127.0.0.1:5000/app:build-1-commit-0123456789abcdef0123456789abcdef01234567";
        let opts = ImageScanOptions {
            image,
            severity: "HIGH,CRITICAL",
            sbom_output: None,
        };
        let mut r = fake(0, None);
        r.inspect_user = Some("root".to_string());
        let err = run_trivy_image(&docker, &opts, &r).unwrap_err();
        assert!(err.contains("root") || err.contains("UID 0"), "{err}");
        let calls = r.calls.borrow();
        let rmi_call = calls.iter().find(|args| args.contains(&"rmi".to_string()));
        assert!(rmi_call.is_some(), "failed image must be removed with docker rmi");
    }

    #[test]
    fn trivy_image_cve_failure_removes_image() {
        let _tmp = TempDir::new().unwrap();
        let docker = PathBuf::from("/usr/bin/docker");
        let image = "127.0.0.1:5000/app:build-1-commit-0123456789abcdef0123456789abcdef01234567";
        let opts = ImageScanOptions {
            image,
            severity: "HIGH,CRITICAL",
            sbom_output: None,
        };
        let mut r = fake(1, Some(TRIVY_OK));
        r.inspect_user = Some("1001:1001".to_string());
        let err = run_trivy_image(&docker, &opts, &r).unwrap_err();
        assert!(err.contains("Trivy") || err.contains("keamanan"), "{err}");
        let calls = r.calls.borrow();
        let rmi_call = calls.iter().find(|args| args.contains(&"rmi".to_string()));
        assert!(rmi_call.is_some(), "failed image must be removed with docker rmi on CVE detection");
    }

    #[test]
    fn trivy_image_clean_report_keeps_image_and_generates_sbom() {
        let tmp = TempDir::new().unwrap();
        let docker = PathBuf::from("/usr/bin/docker");
        let image = "127.0.0.1:5000/app:build-1-commit-0123456789abcdef0123456789abcdef01234567";
        let sbom_path = tmp.path().join("sbom.cdx.json");
        let opts = ImageScanOptions {
            image,
            severity: "HIGH,CRITICAL",
            sbom_output: Some(&sbom_path),
        };
        let mut r = fake(0, Some(TRIVY_OK));
        r.inspect_user = Some("appuser".to_string());
        r.sbom = Some(r#"{"bomFormat": "CycloneDX", "specVersion": "1.5"}"#);
        run_trivy_image(&docker, &opts, &r).unwrap();
        let calls = r.calls.borrow();
        let rmi_call = calls.iter().find(|args| args.contains(&"rmi".to_string()));
        assert!(rmi_call.is_none(), "passing image must NOT be removed from local docker");
        assert!(sbom_path.exists(), "sbom file must be created at requested path");
    }
}
