use regex::bytes::Regex;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub file: PathBuf,
    pub line: usize,
    pub rule: String,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct ScanReport {
    pub scanned_files: usize,
    pub violations: Vec<Violation>,
}

impl ScanReport {
    pub fn is_clean(&self) -> bool {
        self.violations.is_empty()
    }
}

#[derive(Debug, Clone, Default)]
pub struct ScanOptions {
    pub skip_build_dirs: bool,
}

pub fn scan_directory(root: &Path) -> Result<ScanReport, String> {
    scan_directory_with(root, &ScanOptions::default())
}

pub fn scan_directory_with(root: &Path, opts: &ScanOptions) -> Result<ScanReport, String> {
    if !root.exists() {
        return Err(format!("Direktori '{}' tidak ditemukan", root.display()));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Gagal meresolusi path '{}': {}", root.display(), e))?;

    let dangerous_rules: Vec<(&str, Regex)> = vec![
        (
            concat!("os.sys", "tem()"),
            Regex::new(concat!(r"os\.sys", r"tem\s*\(")).unwrap(),
        ),
        (
            concat!("ev", "al()"),
            Regex::new(concat!(r"\bev", r"al\s*\(")).unwrap(),
        ),
        (
            concat!("ex", "ec()"),
            Regex::new(concat!(r"\bex", r"ec\s*\(")).unwrap(),
        ),
        (
            concat!("subprocess shell=", "True"),
            Regex::new(concat!(r"shell\s*=\s*", r"True")).unwrap(),
        ),
        (
            concat!("child_process.ex", "ec()"),
            Regex::new(concat!(r"child_process\.ex", r"ec\s*\(")).unwrap(),
        ),
        (
            concat!("Command::new(sh/", "bash)"),
            Regex::new(concat!(r#"Command::new\s*\(\s*""#, r#"(ba|z|da|k)?sh""#)).unwrap(),
        ),
    ];

    let secret_regex = Regex::new(concat!(
        r#"(gh"#,
        r#"p_[A-Za-z0-9]{20,}|AK"#,
        r#"IA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----|(PASS"#,
        r#"WORD|SEC"#,
        r#"RET|API_K"#,
        r#"EY|PRIVATE_K"#,
        r#"EY|BOT_TO"#,
        r#"KEN)\s*[:=]\s*['"][^'"]{6,}['"])"#
    ))
    .unwrap();

    let mut report = ScanReport::default();
    visit_dir(
        root,
        &canonical_root,
        opts,
        &dangerous_rules,
        &secret_regex,
        &mut report,
    )?;
    Ok(report)
}

fn should_skip_dir(name: &str, opts: &ScanOptions) -> bool {
    if name == ".git" {
        return true;
    }
    if opts.skip_build_dirs {
        return matches!(
            name,
            "target" | "node_modules" | "__pycache__" | ".superpowers" | ".venv" | "venv" | "dist" | ".cargo-cache" | ".scannerwork"
        );
    }
    false
}

fn is_prose_doc(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if file_name.starts_with("LICENSE") {
        return true;
    }
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("md" | "txt" | "rst")
    )
}

fn visit_dir(
    dir: &Path,
    canonical_root: &Path,
    opts: &ScanOptions,
    dangerous_rules: &[(&str, Regex)],
    secret_regex: &Regex,
    report: &mut ScanReport,
) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(it) => it,
        Err(e) => {
            report.violations.push(Violation {
                file: dir.to_path_buf(),
                line: 1,
                rule: "unreadable-file".to_string(),
                message: format!("Direktori tidak dapat dibaca (fail-closed): {}", e),
            });
            return Ok(());
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                report.violations.push(Violation {
                    file: dir.to_path_buf(),
                    line: 1,
                    rule: "unreadable-file".to_string(),
                    message: format!("Entri direktori tidak dapat dibaca: {}", e),
                });
                continue;
            }
        };
        let path = entry.path();
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        let lmeta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                report.violations.push(Violation {
                    file: path.clone(),
                    line: 1,
                    rule: "unreadable-file".to_string(),
                    message: format!("Metadata file tidak dapat dibaca: {}", e),
                });
                continue;
            }
        };

        if lmeta.file_type().is_symlink() {
            // Do not follow symlinks during traversal (prevents cycles & double-counting).
            // If a symlink resolves outside canonical_root (or is broken/looping), flag it.
            match path.canonicalize() {
                Ok(resolved) if resolved.starts_with(canonical_root) => {}
                Ok(resolved) => {
                    report.violations.push(Violation {
                        file: path.clone(),
                        line: 1,
                        rule: "symlink-escape".to_string(),
                        message: format!(
                            "Symlink menunjuk keluar dari direktori scan ({})",
                            resolved.display()
                        ),
                    });
                }
                Err(e) => {
                    report.violations.push(Violation {
                        file: path.clone(),
                        line: 1,
                        rule: "symlink-escape".to_string(),
                        message: format!("Symlink rusak atau siklik tidak diizinkan: {}", e),
                    });
                }
            }
            continue;
        }

        if lmeta.is_dir() {
            if !should_skip_dir(&name_str, opts) {
                visit_dir(
                    &path,
                    canonical_root,
                    opts,
                    dangerous_rules,
                    secret_regex,
                    report,
                )?;
            }
            continue;
        }

        if !lmeta.is_file() {
            continue;
        }

        if name_str == "Dockerfile" || name_str.starts_with("Dockerfile.") {
            report.scanned_files += 1;
            check_dockerfile(&path, report)?;
            check_file_bytes(&path, &[], secret_regex, report);
            continue;
        }

        report.scanned_files += 1;
        let active_rules: &[(&str, Regex)] = if is_prose_doc(&path) {
            &[]
        } else {
            dangerous_rules
        };
        check_file_bytes(&path, active_rules, secret_regex, report);
    }
    Ok(())
}

fn is_comment_line(trimmed: &[u8]) -> bool {
    trimmed.starts_with(b"#") || trimmed.starts_with(b"//")
}

fn trim_ascii(mut s: &[u8]) -> &[u8] {
    while let Some((&b, rest)) = s.split_first() {
        if b.is_ascii_whitespace() {
            s = rest;
        } else {
            break;
        }
    }
    while let Some((&b, rest)) = s.split_last() {
        if b.is_ascii_whitespace() {
            s = rest;
        } else {
            break;
        }
    }
    s
}

fn check_file_bytes(
    path: &Path,
    dangerous_rules: &[(&str, Regex)],
    secret_regex: &Regex,
    report: &mut ScanReport,
) {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            report.violations.push(Violation {
                file: path.to_path_buf(),
                line: 1,
                rule: "unreadable-file".to_string(),
                message: format!("File tidak dapat dibaca (fail-closed): {}", e),
            });
            return;
        }
    };

    for (idx, line) in bytes.split(|&b| b == b'\n').enumerate() {
        let line_no = idx + 1;
        let trimmed = trim_ascii(line);
        if is_comment_line(trimmed) {
            continue;
        }

        for (label, regex) in dangerous_rules {
            if regex.is_match(line) {
                report.violations.push(Violation {
                    file: path.to_path_buf(),
                    line: line_no,
                    rule: format!("dangerous-code ({})", label),
                    message: format!(
                        "Terdeteksi fungsi berbahaya {} pada baris {}",
                        label, line_no
                    ),
                });
            }
        }

        if secret_regex.is_match(line) {
            report.violations.push(Violation {
                file: path.to_path_buf(),
                line: line_no,
                rule: "hardcoded-secret".to_string(),
                message: format!(
                    "Terdeteksi kredensial/secret tertulis langsung (hardcoded) pada baris {}",
                    line_no
                ),
            });
        }
    }
}

fn is_valid_non_root_user(raw: &str) -> bool {
    if raw.is_empty() || raw.contains('$') {
        return false;
    }
    let user_part = raw.split(':').next().unwrap_or_default().trim();
    if user_part.is_empty() || user_part.eq_ignore_ascii_case("root") {
        return false;
    }
    let digits = user_part.trim_start_matches(['+', '-']);
    if !digits.is_empty() && digits.chars().all(|c| c == '0') {
        return false;
    }
    if matches!(user_part.parse::<i64>(), Ok(n) if n <= 0) {
        return false;
    }
    user_part
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn check_dockerfile(path: &Path, report: &mut ScanReport) -> Result<(), String> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            report.violations.push(Violation {
                file: path.to_path_buf(),
                line: 1,
                rule: "unreadable-file".to_string(),
                message: format!("Gagal membaca Dockerfile (fail-closed): {}", e),
            });
            return Ok(());
        }
    };

    let mut last_from_line = 0usize;
    let mut last_user: Option<(usize, String)> = None;

    for (idx, raw_line) in content.lines().enumerate() {
        let line_no = idx + 1;
        let line = raw_line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let upper = line.to_uppercase();
        if upper.starts_with("FROM ") || upper.starts_with("FROM\t") {
            last_from_line = line_no;
            last_user = None;
        } else if upper.starts_with("USER ") || upper.starts_with("USER\t") {
            let user_val = line
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_string();
            last_user = Some((line_no, user_val));
        }
    }

    if last_from_line > 0 {
        match last_user {
            Some((_, ref u)) if is_valid_non_root_user(u) => {}
            _ => {
                report.violations.push(Violation {
                    file: path.to_path_buf(),
                    line: last_from_line,
                    rule: "dockerfile-non-root-user".to_string(),
                    message:
                        "Dockerfile wajib menggunakan non-root USER pada stage akhir".to_string(),
                });
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn clean_directory_passes() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("app.py"),
            "def hello():\n    return 'safe'\n",
        )
        .unwrap();
        fs::write(
            tmp.path().join("Dockerfile"),
            "FROM python:3.12-slim\nUSER appuser\nCMD [\"python\", \"app.py\"]\n",
        )
        .unwrap();

        let report = scan_directory(tmp.path()).unwrap();
        assert!(report.is_clean(), "Expected clean report, got {:?}", report.violations);
        assert_eq!(report.scanned_files, 2);
    }

    #[test]
    fn dangerous_os_system_is_caught() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("bad.py"), OS_SYSTEM).unwrap();

        let report = scan_directory(tmp.path()).unwrap();
        assert!(!report.is_clean());
        assert_eq!(report.violations.len(), 1);
        assert!(report.violations[0].rule.contains(concat!("os.sys", "tem()")));
        assert_eq!(report.violations[0].line, 2);
    }

    #[test]
    fn hardcoded_secret_is_caught() {
        let tmp = TempDir::new().unwrap();
        let fake_pat = format!("{}{}", "ghp_", "A1b2C3".repeat(6));
        fs::write(
            tmp.path().join("config.py"),
            format!("TOKEN = \"{}\"\n", fake_pat),
        )
        .unwrap();

        let report = scan_directory(tmp.path()).unwrap();
        assert!(!report.is_clean());
        assert_eq!(report.violations[0].rule, "hardcoded-secret");
    }

    #[test]
    fn dockerfile_without_non_root_user_is_caught() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("Dockerfile"),
            "FROM python:3.12-slim\nCMD [\"python\", \"app.py\"]\n",
        )
        .unwrap();

        let report = scan_directory(tmp.path()).unwrap();
        assert!(!report.is_clean());
        assert_eq!(report.violations[0].rule, "dockerfile-non-root-user");
    }

    // ---- H-2 / M-2 regressions -------------------------------------------
    // Fixtures are assembled with concat! so this source file does not itself
    // contain the dangerous patterns (no filename-based exemptions anymore).
    const OS_SYSTEM: &str = concat!("import os\nos.sys", "tem('id')\n");

    fn rules(report: &ScanReport) -> Vec<String> {
        report.violations.iter().map(|v| v.rule.clone()).collect()
    }

    #[test]
    fn latin1_file_is_scanned_as_bytes() {
        let tmp = TempDir::new().unwrap();
        let mut body = b"x = '\xe9t\xe9'\n".to_vec();
        body.extend_from_slice(OS_SYSTEM.as_bytes());
        fs::write(tmp.path().join("app.py"), body).unwrap();
        let report = scan_directory(tmp.path()).unwrap();
        assert!(!report.is_clean(), "invalid UTF-8 treated as clean");
    }

    #[test]
    fn rust_shell_command_is_scanned() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("app.rs"),
            concat!("fn main() { std::process::Command::new(\"s", "h\").arg(\"-c\"); }\n"),
        )
        .unwrap();
        let report = scan_directory(tmp.path()).unwrap();
        assert_eq!(report.scanned_files, 1);
        assert!(!report.is_clean(), "app.rs shell exec not detected");
    }

    #[test]
    fn nested_file_is_scanned() {
        let tmp = TempDir::new().unwrap();
        let deep = tmp.path().join("app/routes/v1");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("api.py"), OS_SYSTEM).unwrap();
        assert!(!scan_directory(tmp.path()).unwrap().is_clean());
    }

    #[test]
    fn test_files_are_scanned() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("test_app.py"), OS_SYSTEM).unwrap();
        assert!(!scan_directory(tmp.path()).unwrap().is_clean(), "test_* skipped");
    }

    #[test]
    fn config_files_without_code_extension_are_scanned_for_secrets() {
        for name in [".env", "settings.toml", "config.json", "app.properties"] {
            let tmp = TempDir::new().unwrap();
            fs::write(tmp.path().join(name), concat!("API_K", "EY = \"abcdef123456\"\n")).unwrap();
            let report = scan_directory(tmp.path()).unwrap();
            assert!(rules(&report).contains(&"hardcoded-secret".to_string()), "{name} not scanned");
        }
    }

    #[test]
    fn dependency_and_build_dirs_are_scanned_in_authoritative_mode() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("node_modules/pkg")).unwrap();
        fs::write(tmp.path().join("node_modules/pkg/index.py"), OS_SYSTEM).unwrap();
        assert!(!scan_directory(tmp.path()).unwrap().is_clean(), "node_modules skipped");
    }

    #[test]
    fn symlink_cycle_terminates_and_counts_once() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("bad.py"), OS_SYSTEM).unwrap();
        std::os::unix::fs::symlink(tmp.path(), tmp.path().join("loop")).unwrap();
        let report = scan_directory(tmp.path()).unwrap();
        let hits = rules(&report).iter().filter(|r| r.contains("os.system")).count();
        assert_eq!(hits, 1, "symlink followed: {:?}", report.violations);
    }

    #[test]
    fn symlink_escaping_root_is_not_followed_and_is_reported() {
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret.py"), OS_SYSTEM).unwrap();
        let tmp = TempDir::new().unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.py"), tmp.path().join("link.py")).unwrap();
        let report = scan_directory(tmp.path()).unwrap();
        let r = rules(&report);
        assert!(!r.iter().any(|x| x.contains("os.system")), "followed symlink outside root");
        assert!(r.contains(&"symlink-escape".to_string()), "{r:?}");
    }

    #[test]
    fn unreadable_file_fails_closed() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("hidden.py");
        fs::write(&f, OS_SYSTEM).unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o000)).unwrap();
        let report = scan_directory(tmp.path()).unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(rules(&report).contains(&"unreadable-file".to_string()), "{:?}", report.violations);
    }

    #[test]
    fn file_with_huge_number_of_matches_is_caught() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("app.py"), OS_SYSTEM.repeat(100_000)).unwrap();
        assert!(!scan_directory(tmp.path()).unwrap().is_clean());
    }

    #[test]
    fn local_mode_may_skip_build_dirs() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("target")).unwrap();
        fs::write(tmp.path().join("target/x.py"), OS_SYSTEM).unwrap();
        let opts = ScanOptions { skip_build_dirs: true };
        assert!(scan_directory_with(tmp.path(), &opts).unwrap().is_clean());
    }

    // ---- H-3 regressions --------------------------------------------------

    #[test]
    fn dockerfile_user_root_or_zero_variants_are_caught() {
        for bad_user in [
            "root:root",
            "root:1000",
            "ROOT:app",
            "0:0",
            "0:1000",
            "00",
            "000:1000",
            "$APP_USER",
            "${APP_USER}",
        ] {
            let tmp = TempDir::new().unwrap();
            fs::write(
                tmp.path().join("Dockerfile"),
                format!("FROM python:3.12-slim\nUSER {bad_user}\nCMD [\"python\", \"app.py\"]\n"),
            )
            .unwrap();
            let report = scan_directory(tmp.path()).unwrap();
            assert!(
                rules(&report).contains(&"dockerfile-non-root-user".to_string()),
                "USER {bad_user} bypassed non-root check"
            );
        }
    }

    #[test]
    fn dockerfile_non_root_user_with_group_passes() {
        for good_user in ["appuser:appgroup", "1000:1000", "65532"] {
            let tmp = TempDir::new().unwrap();
            fs::write(
                tmp.path().join("Dockerfile"),
                format!("FROM python:3.12-slim\nUSER {good_user}\nCMD [\"python\", \"app.py\"]\n"),
            )
            .unwrap();
            let report = scan_directory(tmp.path()).unwrap();
            assert!(
                report.is_clean(),
                "USER {good_user} falsely rejected: {:?}",
                report.violations
            );
        }
    }
}
