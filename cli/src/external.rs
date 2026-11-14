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

#[cfg(unix)]
pub fn resolve_trusted_binary(
    candidates: &[PathBuf],
    expected_owner: u32,
) -> Result<PathBuf, String> {
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
            reasons.push(format!(
                "{}: owner uid {} (harus {})",
                path.display(),
                meta.uid(),
                expected_owner
            ));
        } else {
            return Ok(path.clone());
        }
    }
    Err(format!(
        "Binary docker trusted tidak ditemukan ({}). Scanner Gitleaks/Trivy tidak bisa dijalankan.",
        reasons.join("; ")
    ))
}

#[cfg(not(unix))]
pub fn resolve_trusted_binary(
    _candidates: &[PathBuf],
    _expected_owner: u32,
) -> Result<PathBuf, String> {
    let win_candidates = [PathBuf::from(
        r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    )];
    for path in &win_candidates {
        if path.is_file() {
            return Ok(path.clone());
        }
    }
    Err(r"Docker Desktop (C:\Program Files\Docker\Docker\resources\bin\docker.exe) tidak ditemukan.".to_string())
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

/// Cache Trivy dipisah per uid pemakai container: jalur image scan berjalan
/// sebagai root (perlu docker.sock) sedangkan jalur fs scan sebagai uid
/// pemanggil. Direktori bersama membuat berkas root-owned memblokir update DB
/// di jalur non-root (`open /cache/db/trivy.db: permission denied`).
fn cache_trivy(home: Option<PathBuf>, uid: u32, fallback: PathBuf) -> PathBuf {
    home.map(|h| h.join(format!(".cache/autore/trivy-{uid}")))
        .unwrap_or(fallback)
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
            "--network",
            "none",
            GITLEAKS_IMAGE,
            "detect",
            "--source=/repo",
            "--no-git",
            "--redact",
            "--no-banner",
            "--log-level",
            "error",
            "--exit-code",
            "1",
            "--report-format",
            "json",
            "--report-path",
            "/out/gitleaks.json",
        ]
        .map(String::from),
    );
    let code = runner.run(&ctx.docker, &args)?;
    let body = read_report(ctx, "gitleaks.json").map(|s| s.trim().to_string());
    let well_formed = matches!(&body, Some(b) if b.starts_with('[') && b.ends_with(']'));
    match (code, well_formed) {
        (0, true) if body.as_deref() == Some("[]") => Ok(()),
        (1, true) => Err(summarize_gitleaks(body.as_deref().unwrap_or_default())),
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
            TRIVY_IMAGE,
            "fs",
            "--quiet",
            "--cache-dir",
            "/cache",
            "--scanners",
            "vuln,misconfig",
            "--skip-check-update",
            "--ignore-unfixed",
            "--severity",
            severity,
            "--exit-code",
            "1",
            "--format",
            "json",
            "--output",
            "/out/trivy.json",
            "/repo",
        ]
        .map(String::from),
    );
    let code = runner.run(&ctx.docker, &args)?;
    let well_formed = matches!(&read_report(ctx, "trivy.json"), Some(b) if is_trivy_report(b));
    match (code, well_formed) {
        (0, true) => Ok(()),
        (1, true) => Err(trivy_details(ctx, runner, severity)),
        (0 | 1, false) => Err(format!(
            "Trivy tidak menghasilkan laporan valid (exit {code}) — scanner dianggap TIDAK berjalan"
        )),
        _ => Err(format!("Trivy gagal berjalan (exit {code})")),
    }
}

/// Laporan Trivy yang sah wajib JSON utuh dengan SchemaVersion dan Results.
/// (Trivy selalu menulis kunci "Results", termasuk saat kosong — jadi ini tidak
/// memblokir project bersih; hanya menolak laporan terpotong/asing.)
fn is_trivy_report(body: &str) -> bool {
    let t = body.trim();
    t.starts_with('{')
        && t.ends_with('}')
        && t.contains("\"SchemaVersion\"")
        && t.contains("\"Results\"")
}

/// Go template for `trivy convert`: one TSV row per vuln / misconfig.
const TRIVY_TSV_TEMPLATE: &str = "{{- range . }}{{ $t := .Target }}{{ range .Vulnerabilities }}VULN\t{{ .Severity }}\t{{ $t }}\t{{ .PkgName }}\t{{ .InstalledVersion }}\t{{ .FixedVersion }}\t{{ .VulnerabilityID }}\n{{ end }}{{ range .Misconfigurations }}MISCONF\t{{ .Severity }}\t{{ $t }}\t{{ .ID }}\t{{ .Title }}\t{{ .Resolution }}\n{{ end }}{{ end }}";

/// Turn trivy.json into a human summary via the pinned image (offline).
fn trivy_details(ctx: &ScanContext, runner: &dyn Runner, severity: &str) -> String {
    let args: Vec<String> = [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        &format!("{}:{}", ctx.uid, ctx.gid),
        "-e",
        "HOME=/tmp",
        "-v",
        &format!("{}:/out", ctx.out_dir.display()),
        TRIVY_IMAGE,
        "convert",
        "--quiet",
        "--format",
        "template",
        "--template",
        TRIVY_TSV_TEMPLATE,
        "--output",
        "/out/trivy.tsv",
        "/out/trivy.json",
    ]
    .map(String::from)
    .to_vec();
    let _ = runner.run(&ctx.docker, &args);
    match read_report(ctx, "trivy.tsv") {
        Some(t) if !t.trim().is_empty() => summarize_trivy(&t, severity),
        _ => format!("Trivy mendeteksi celah keamanan {severity} / misconfiguration"),
    }
}

fn ver_key(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap_or(0))
        .collect()
}

/// Smallest fixed version that clears every CVE, preferring the installed major.
/// ponytail: numeric-only compare (ignores pre-release tags); swap to a semver crate if hints go wrong.
fn pick_fix(installed: &str, fixed_lists: &[String]) -> String {
    let cur = ver_key(installed);
    let mut best: Option<&str> = None;
    for list in fixed_lists {
        let cands: Vec<&str> = list
            .split(',')
            .map(str::trim)
            .filter(|f| ver_key(f) > cur)
            .collect();
        let same: Vec<&str> = cands
            .iter()
            .copied()
            .filter(|f| ver_key(f).first() == cur.first())
            .collect();
        let pool = if same.is_empty() { cands } else { same };
        if let Some(m) = pool.into_iter().min_by_key(|f| ver_key(f)) {
            if best.is_none_or(|b| ver_key(m) > ver_key(b)) {
                best = Some(m);
            }
        }
    }
    best.unwrap_or("-").to_string()
}

/// Ringkasan per paket: (peringkat terburuk, daftar versi perbaikan, jumlah CVE).
type PkgVulns = std::collections::BTreeMap<(String, String), (usize, Vec<String>, usize)>;

/// First line = short reason (also sent to Telegram); rest = table + fix steps.
pub fn summarize_trivy(tsv: &str, severity: &str) -> String {
    use colored::Colorize;
    use std::collections::BTreeMap;
    let rank = |s: &str| {
        ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
            .iter()
            .position(|x| *x == s)
            .unwrap_or(4)
    };
    let paint = |r: usize, s: String| {
        if r == 0 {
            s.red().bold().to_string()
        } else {
            s.yellow().to_string()
        }
    };
    // target -> (pkg, installed) -> (worst rank, fixed lists, cve count)
    let mut vulns: BTreeMap<String, PkgVulns> = BTreeMap::new();
    let mut misconf = Vec::new();
    let mut n_cve = 0;
    for line in tsv.lines() {
        match line.split('\t').collect::<Vec<_>>().as_slice() {
            ["VULN", sev, target, pkg, ver, fix, _] => {
                n_cve += 1;
                let e = vulns
                    .entry(target.to_string())
                    .or_default()
                    .entry((pkg.to_string(), ver.to_string()))
                    .or_insert((4, vec![], 0));
                e.0 = e.0.min(rank(sev));
                e.1.push(fix.to_string());
                e.2 += 1;
            }
            ["MISCONF", sev, target, id, title, res] => misconf.push((
                rank(sev),
                format!("{sev:<8}"),
                format!("{target}  {id}: {title}\n              Saran: {res}"),
            )),
            _ => {}
        }
    }
    let mut all: Vec<(usize, String)> = vulns
        .values()
        .flatten()
        .map(|((p, v), e)| (e.0, format!("{p}@{v}")))
        .collect();
    all.sort();
    let top: Vec<String> = all.iter().take(5).map(|x| x.1.clone()).collect();
    let more = if all.len() > 5 {
        format!(", +{} lainnya", all.len() - 5)
    } else {
        String::new()
    };
    let mut head = format!(
        "Trivy menemukan {n_cve} celah {severity} di {} paket",
        all.len()
    );
    if !misconf.is_empty() {
        head += &format!(" + {} misconfiguration", misconf.len());
    }
    if !top.is_empty() {
        head += &format!(": {}{more}", top.join(", "));
    }

    let mut out = vec![head, String::new()];
    let mut fixes = Vec::new();
    for (target, pkgs) in &vulns {
        out.push(format!("    {}", target.bold()));
        let mut rows: Vec<_> = pkgs.iter().collect();
        rows.sort_by_key(|((p, _), e)| (e.0, p.clone()));
        for ((p, v), (r, lists, n)) in rows {
            let sev = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"][*r];
            out.push(format!(
                "      {}  {p:<22} {v:<10} -> {:<10} ({n} CVE)",
                paint(*r, format!("{sev:<8}")),
                pick_fix(v, lists)
            ));
        }
        let dir = Path::new(target)
            .parent()
            .map(|d| d.display().to_string())
            .unwrap_or_default();
        let cd = if dir.is_empty() {
            String::new()
        } else {
            format!("cd {dir} && ")
        };
        fixes.push(if target.ends_with("package-lock.json") {
            format!("{cd}npm audit fix")
        } else {
            format!("update paket di {target} ke versi setelah tanda ->")
        });
    }
    if !misconf.is_empty() {
        misconf.sort();
        out.push(format!("    {}", "Misconfiguration".bold()));
        for (r, sev, msg) in &misconf {
            out.push(format!("      {}  {msg}", paint(*r, sev.clone())));
        }
        fixes.push("perbaiki konfigurasi sesuai Saran di atas".into());
    }
    out.push(String::new());
    out.push(format!("    {}", "Cara perbaiki:".bold()));
    out.extend(fixes.iter().map(|f| format!("      {f}")));
    out.join("\n")
}

/// Gitleaks report (pretty JSON) -> short reason + file:line list. Secrets stay redacted.
pub fn summarize_gitleaks(json: &str) -> String {
    let grab = |pat: &str| -> Vec<String> {
        regex::Regex::new(pat)
            .unwrap()
            .captures_iter(json)
            .map(|c| c[1].to_string())
            .collect()
    };
    let files = grab(r#""File":\s*"([^"]*)""#);
    let lines = grab(r#""StartLine":\s*(\d+)"#);
    let rules = grab(r#""RuleID":\s*"([^"]*)""#);
    let mut out = vec![
        format!("Gitleaks menemukan {} secret bocor", rules.len()),
        String::new(),
    ];
    for ((f, l), r) in files.iter().zip(&lines).zip(&rules) {
        out.push(format!(
            "      {}:{l}  [{r}]",
            f.trim_start_matches("/repo/")
        ));
    }
    out.push(String::new());
    out.push("    Cara perbaiki:".into());
    out.push(
        "      hapus secret dari kode, simpan di environment variable / Jenkins Credentials,"
            .into(),
    );
    out.push("      lalu ganti (rotate) secret yang terlanjur bocor.".into());
    out.join("\n")
}

/// Ringkas temuan Trivy (maksimal lima, CRITICAL lebih dulu) supaya log gate
/// menyebut ID CVE, paket, dan versi tambalan. Tanpa ini build merah tidak bisa
/// ditindaklanjuti tanpa menebak.
pub fn ringkas_temuan(report_json: &str) -> String {
    let doc: serde_json::Value = match serde_json::from_str(report_json) {
        Ok(v) => v,
        Err(_) => return String::new(),
    };
    let mut baris: Vec<(u8, String)> = Vec::new();
    let mut total = 0usize;
    let kosong = Vec::new();
    for hasil in doc
        .get("Results")
        .and_then(|r| r.as_array())
        .unwrap_or(&kosong)
    {
        for v in hasil
            .get("Vulnerabilities")
            .and_then(|x| x.as_array())
            .unwrap_or(&kosong)
        {
            total += 1;
            let teks = |kunci: &str| v.get(kunci).and_then(|x| x.as_str()).unwrap_or("-");
            let tingkat = match teks("Severity") {
                "CRITICAL" => 0u8,
                "HIGH" => 1,
                _ => 2,
            };
            baris.push((
                tingkat,
                format!(
                    "      {}  {}  {} -> tambalan {}",
                    teks("VulnerabilityID"),
                    teks("PkgName"),
                    teks("InstalledVersion"),
                    teks("FixedVersion")
                ),
            ));
        }
    }
    if total == 0 {
        return String::new();
    }
    baris.sort_by_key(|(tingkat, _)| *tingkat);
    let tampil = baris.len().min(5);
    let mut out = format!("  Temuan ({total}):");
    for (_, b) in baris.iter().take(tampil) {
        out.push('\n');
        out.push_str(b);
    }
    if total > tampil {
        out.push_str(&format!("\n      ... dan {} temuan lain", total - tampil));
    }
    out
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
    // Pakai predikat yang sama dengan scanner Dockerfile: "00"/"000"/"000:000" juga uid 0.
    if !crate::scanner::is_valid_non_root_user(user_trimmed) {
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
    let out_dir =
        std::env::temp_dir().join(format!("autore-image-scan-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Gagal membuat direktori laporan image: {e}"))?;
    let cache_dir = cache_trivy(
        std::env::var_os("HOME").map(PathBuf::from),
        0,
        out_dir.join("cache"),
    );
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
        "--ignore-unfixed".into(),
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
            let rincian = report_body
                .as_deref()
                .map(ringkas_temuan)
                .unwrap_or_default();
            let mut pesan = format!(
                "Trivy mendeteksi celah keamanan {} pada image {}",
                opts.severity, opts.image
            );
            if !rincian.is_empty() {
                pesan.push('\n');
                pesan.push_str(&rincian);
                pesan.push_str(
                    "\n    Cara perbaiki: segarkan layer paket OS (apt-get upgrade) atau pakai base image yang sudah memuat tambalan.",
                );
            }
            return Err(pesan);
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
        let sbom_valid =
            matches!(&sbom_content, Some(b) if b.contains("CycloneDX") || b.contains("bomFormat"));
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
            return Err(format!(
                "Gagal menyimpan SBOM ke {}: {e}",
                sbom_target.display()
            ));
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
    let docker = resolve_trusted_binary(
        &TRUSTED_DOCKER_PATHS
            .iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>(),
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
    #[cfg(unix)]
    let (uid, gid) = {
        use std::os::unix::fs::{DirBuilderExt, MetadataExt};
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&out_dir)
            .map_err(|e| format!("Gagal membuat direktori laporan: {e}"))?;
        let meta = std::fs::metadata(&out_dir).map_err(|e| e.to_string())?;
        (meta.uid(), meta.gid())
    };
    #[cfg(not(unix))]
    let (uid, gid) = {
        std::fs::create_dir(&out_dir)
            .map_err(|e| format!("Gagal membuat direktori laporan: {e}"))?;
        (1000u32, 1000u32)
    };
    let cache_dir = cache_trivy(
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from),
        uid,
        out_dir.join("cache"),
    );
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Gagal membuat cache Trivy: {e}"))?;

    let first_run = !cache_dir.join("db/trivy.db").exists();
    let ctx = ScanContext {
        docker,
        target,
        out_dir: out_dir.clone(),
        cache_dir,
        uid,
        gid,
    };
    let result = (|| {
        run_gitleaks(&ctx, &ProcessRunner)?;
        println!("  ✔ [2/3] Gitleaks LULUS (tidak ada secret bocor).");
        if first_run {
            println!(
                "  • Pertama kali: download database celah keamanan (~130 MB), mohon tunggu..."
            );
        }
        run_trivy(&ctx, &ProcessRunner, severity)?;
        println!("  ✔ [3/3] Trivy LULUS (tidak ada celah {severity}).");
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&out_dir);
    result
}

pub fn run_authoritative_image_scan(opts: &ImageScanOptions) -> Result<(), String> {
    let docker = resolve_trusted_binary(
        &TRUSTED_DOCKER_PATHS
            .iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>(),
        0,
    )?;
    run_trivy_image(&docker, opts, &ProcessRunner)?;
    println!(
        "  ✔ Image scan LULUS: runtime user non-root & bebas CVE {}.",
        opts.severity
    );
    if opts.sbom_output.is_some() {
        println!("  ✔ SBOM CycloneDX berhasil dibuat.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn cache_trivy_dipisah_per_uid() {
        let home = Some(PathBuf::from("/home/uji"));
        let non_root = cache_trivy(home.clone(), 1000, PathBuf::from("/tmp/x"));
        let root = cache_trivy(home, 0, PathBuf::from("/tmp/x"));
        assert!(non_root.ends_with(".cache/autore/trivy-1000"), "{non_root:?}");
        assert!(root.ends_with(".cache/autore/trivy-0"), "{root:?}");
        assert_ne!(non_root, root);
        assert_eq!(
            cache_trivy(None, 1000, PathBuf::from("/tmp/x")),
            PathBuf::from("/tmp/x")
        );
    }

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
                let out = args.iter().find_map(|a| {
                    a.strip_suffix(":/out")
                        .or_else(|| a.strip_suffix(":/reports"))
                        .map(PathBuf::from)
                });
                if let Some(out) = out {
                    let name = if args.iter().any(|a| a.ends_with("trivy.tsv")) {
                        "trivy.tsv"
                    } else if args.iter().any(|a| a.contains("gitleaks")) {
                        "gitleaks.json"
                    } else if args.iter().any(|a| a == "image")
                        && args.iter().any(|a| a == "cyclonedx")
                    {
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
                let user = self
                    .inspect_user
                    .clone()
                    .unwrap_or_else(|| "appuser".to_string());
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
        assert!(
            resolve_trusted_binary(std::slice::from_ref(&bin), me).is_err(),
            "world-writable accepted"
        );

        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            resolve_trusted_binary(std::slice::from_ref(&bin), me + 1).is_err(),
            "wrong owner accepted"
        );
        assert_eq!(
            resolve_trusted_binary(std::slice::from_ref(&bin), me).unwrap(),
            bin
        );
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
        assert!(
            args.contains(&format!("{}:/repo:ro", c.target.display())),
            "{args}"
        );
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
    fn ver_key_parses_numeric_segments() {
        assert_eq!(ver_key("1.2.3"), vec![1, 2, 3]);
        assert_eq!(ver_key("0:1.4.2-r0"), vec![0, 1, 4, 2, 0]);
        assert_eq!(ver_key("v10"), vec![10]);
        assert_eq!(ver_key(""), Vec::<u64>::new());
    }

    #[test]
    fn pick_fix_prefers_smallest_fix_in_same_major() {
        assert_eq!(pick_fix("1.2.3", &["1.2.4".to_string()]), "1.2.4");
        // kandidat tidak lebih baru dari versi terpasang -> tidak ada saran
        assert_eq!(
            pick_fix("1.2.3", &["1.2.3".to_string(), "1.0.0".to_string()]),
            "-"
        );
        // satu daftar berisi banyak kandidat: ambil terkecil di major yang sama
        assert_eq!(
            pick_fix("1.2.3", &["1.9.0,1.2.4,2.0.0".to_string()]),
            "1.2.4"
        );
        // dua CVE pada paket sama: harus versi yang menutup keduanya (maksimum dari minimum)
        assert_eq!(
            pick_fix("1.0.0", &["1.1.0".to_string(), "1.3.0".to_string()]),
            "1.3.0"
        );
        // tidak ada major yang sama -> pakai kandidat tertinggi
        assert_eq!(pick_fix("1.2.3", &["2.0.0".to_string()]), "2.0.0");
        // perbandingan numerik, bukan leksikografis
        assert_eq!(pick_fix("1.9.0", &["1.10.0".to_string()]), "1.10.0");
        assert_eq!(pick_fix("1.2.3", &[]), "-");
    }

    #[test]
    fn trivy_details_uses_tsv_summary_and_falls_back_when_empty() {
        let tmp = TempDir::new().unwrap();
        let tsv = "VULN\tHIGH\tsandbox/dummy-app/requirements.txt\tpillow\t9.0.0\t9.3.0\tCVE-2021-25289\n";
        let out = trivy_details(&ctx(&tmp), &fake(1, Some(tsv)), "HIGH,CRITICAL");
        assert!(
            out.starts_with("Trivy menemukan 1 celah HIGH,CRITICAL di 1 paket"),
            "{out}"
        );
        assert!(out.contains("pillow@9.0.0"), "{out}");
        assert!(out.contains("9.3.0"), "saran versi perbaikan hilang: {out}");

        let empty = TempDir::new().unwrap();
        let out2 = trivy_details(&ctx(&empty), &fake(1, Some("")), "HIGH,CRITICAL");
        assert_eq!(
            out2,
            "Trivy mendeteksi celah keamanan HIGH,CRITICAL / misconfiguration"
        );
    }

    #[test]
    fn summarize_trivy_first_line_is_short_reason() {
        let tsv =
            "VULN\tCRITICAL\tapp/package-lock.json\tlodash\t4.17.11\t4.17.21\tCVE-2019-10744\n\
                   VULN\tHIGH\tapp/package-lock.json\tlodash\t4.17.11\t4.17.21\tCVE-2020-8203\n";
        let out = summarize_trivy(tsv, "HIGH,CRITICAL");
        let head = out.lines().next().unwrap();
        assert_eq!(
            head,
            "Trivy menemukan 2 celah HIGH,CRITICAL di 1 paket: lodash@4.17.11"
        );
        assert!(
            out.contains("npm audit fix"),
            "langkah perbaikan npm hilang: {out}"
        );
    }

    #[test]
    fn trivy_truncated_or_schema_only_report_fails_closed() {
        let tmp = TempDir::new().unwrap();
        for bad in [
            r#"{"SchemaVersion": 2, "Results": [{"Tar"#,
            r#"{"SchemaVersion": 2}"#,
            r#"{"Results": []}"#,
            "[]",
        ] {
            let err = run_trivy(&ctx(&tmp), &fake(0, Some(bad)), "HIGH,CRITICAL").unwrap_err();
            assert!(
                err.contains("laporan valid"),
                "report {bad:?} harus ditolak: {err}"
            );
        }
    }

    #[test]
    fn trivy_clean_report_with_empty_results_passes() {
        let tmp = TempDir::new().unwrap();
        let ok = r#"{"SchemaVersion": 2, "Results": []}"#;
        run_trivy(&ctx(&tmp), &fake(0, Some(ok)), "HIGH,CRITICAL").unwrap();
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
        assert!(
            args.contains(&format!("{}:/repo:ro", c.target.display())),
            "{args}"
        );
        assert!(args.contains("--severity HIGH,CRITICAL"), "{args}");
    }

    #[test]
    fn trivy_summary_groups_packages_and_suggests_fix() {
        colored::control::set_override(false);
        let tsv = "VULN\tHIGH\tserver/package-lock.json\tbrace-expansion\t5.0.4\t5.0.10, 3.0.7\tCVE-1\n\
                   VULN\tHIGH\tserver/package-lock.json\tbrace-expansion\t5.0.4\t5.0.11, 3.0.8\tCVE-2\n\
                   VULN\tCRITICAL\tserver/package-lock.json\tform-data\t2.3.3\t2.5.4, 3.0.4, 4.0.4\tCVE-3\n\
                   MISCONF\tHIGH\tDockerfile\tDS002\tImage user should not be root\tAdd USER\n";
        let s = summarize_trivy(tsv, "HIGH,CRITICAL");
        let head = s.lines().next().unwrap();
        assert_eq!(head, "Trivy menemukan 3 celah HIGH,CRITICAL di 2 paket + 1 misconfiguration: form-data@2.3.3, brace-expansion@5.0.4");
        assert!(
            s.contains("brace-expansion        5.0.4      -> 5.0.11"),
            "{s}"
        );
        assert!(
            s.contains("form-data              2.3.3      -> 2.5.4"),
            "{s}"
        );
        assert!(s.contains("cd server && npm audit fix"), "{s}");
        assert!(s.contains("DS002"), "{s}");
    }

    #[test]
    fn gitleaks_summary_lists_locations_without_secrets() {
        let json = r#"[{"File": "/repo/app/x.py", "StartLine": 3, "Secret": "REDACTED", "RuleID": "github-pat"}]"#;
        let s = summarize_gitleaks(json);
        assert!(s.starts_with("Gitleaks menemukan 1 secret bocor"), "{s}");
        assert!(s.contains("app/x.py:3  [github-pat]"), "{s}");
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
    fn trivy_image_fails_when_user_is_all_zero_digits() {
        let _tmp = TempDir::new().unwrap();
        let docker = PathBuf::from("/usr/bin/docker");
        let opts = ImageScanOptions {
            image: "127.0.0.1:5000/app:build-1-0000000000000000000000000000000000000000",
            severity: "HIGH,CRITICAL",
            sbom_output: None,
        };
        for user in ["00", "000", "000:000", "0:0", "+0", "-0"] {
            let mut r = fake(0, None);
            r.inspect_user = Some(user.to_string());
            let err = run_trivy_image(&docker, &opts, &r).unwrap_err();
            assert!(err.contains("root"), "USER {user} must be rejected: {err}");
        }
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
        assert!(
            rmi_call.is_some(),
            "failed image must be removed with docker rmi"
        );
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
        assert!(
            rmi_call.is_some(),
            "failed image must be removed with docker rmi on CVE detection"
        );
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
        assert!(
            rmi_call.is_none(),
            "passing image must NOT be removed from local docker"
        );
        assert!(
            sbom_path.exists(),
            "sbom file must be created at requested path"
        );
    }

    // ---- pesan gate image: wajib menyebut CVE, paket, dan versi tambalan ----

    const TRIVY_VULN: &str = r#"{"SchemaVersion": 2, "Results": [
        {"Target": "app (debian 13.7)", "Class": "os-pkgs", "Type": "debian", "Vulnerabilities": [
            {"VulnerabilityID": "CVE-2026-76844", "PkgName": "zlib1g",
             "InstalledVersion": "1:1.3.dfsg+really1.3.1-1+b1",
             "FixedVersion": "1:1.3.dfsg+really1.3.1-1+deb13u1", "Severity": "HIGH"},
            {"VulnerabilityID": "CVE-2026-85091", "PkgName": "zlib1g",
             "InstalledVersion": "1:1.3.dfsg+really1.3.1-1+b1",
             "FixedVersion": "1:1.3.dfsg+really1.3.1-1+deb13u1", "Severity": "HIGH"}
        ]}
    ]}"#;

    #[test]
    fn image_gate_message_names_cve_package_and_fix() {
        let opts = ImageScanOptions {
            image: "app:build-99-commit-abc",
            severity: "HIGH,CRITICAL",
            sbom_output: None,
        };
        let mut r = fake(1, Some(TRIVY_VULN));
        r.inspect_user = Some("appuser".to_string());
        let err = run_trivy_image(Path::new("/usr/bin/docker"), &opts, &r).unwrap_err();
        assert!(
            err.contains("CVE-2026-76844"),
            "ID CVE tidak disebut: {err}"
        );
        assert!(err.contains("zlib1g"), "nama paket tidak disebut: {err}");
        assert!(
            err.contains("1+deb13u1"),
            "versi tambalan tidak disebut: {err}"
        );
        assert!(
            err.contains("Temuan (2)"),
            "jumlah temuan tidak disebut: {err}"
        );
    }

    fn temuan(n: usize, tingkat: &str) -> String {
        let mut hasil = Vec::new();
        for i in 0..n {
            hasil.push(format!(
                r#"{{"VulnerabilityID":"CVE-2026-1{i:04}","PkgName":"paket{i}","InstalledVersion":"1.0","FixedVersion":"1.1","Severity":"{tingkat}"}}"#
            ));
        }
        format!(
            r#"{{"SchemaVersion":2,"Results":[{{"Target":"app","Vulnerabilities":[{}]}}]}}"#,
            hasil.join(",")
        )
    }

    #[test]
    fn ringkas_temuan_membatasi_lima_dan_menyebut_sisa() {
        let ringkas = ringkas_temuan(&temuan(7, "HIGH"));
        assert_eq!(ringkas.matches("CVE-").count(), 5, "{ringkas}");
        assert!(ringkas.contains("Temuan (7)"), "{ringkas}");
        assert!(ringkas.contains("... dan 2 temuan lain"), "{ringkas}");
    }

    #[test]
    fn ringkas_temuan_menaruh_critical_di_atas() {
        let json = r#"{"SchemaVersion":2,"Results":[{"Target":"app","Vulnerabilities":[
            {"VulnerabilityID":"CVE-2026-20000","PkgName":"tinggi","InstalledVersion":"1.0","FixedVersion":"1.1","Severity":"HIGH"},
            {"VulnerabilityID":"CVE-2026-30000","PkgName":"kritikal","InstalledVersion":"2.0","FixedVersion":"2.1","Severity":"CRITICAL"}
        ]}]}"#;
        let ringkas = ringkas_temuan(json);
        let baris: Vec<&str> = ringkas.lines().collect();
        assert!(
            baris[1].contains("CVE-2026-30000"),
            "CRITICAL harus di baris pertama: {ringkas}"
        );
        assert!(baris[2].contains("CVE-2026-20000"), "{ringkas}");
    }

    #[test]
    fn ringkas_temuan_json_rusak_kosong() {
        assert!(ringkas_temuan("bukan json").is_empty());
        assert!(ringkas_temuan(r#"{"SchemaVersion":2,"Results":[]}"#).is_empty());
    }
}
