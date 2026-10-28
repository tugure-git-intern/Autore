use regex::Regex;
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

pub fn scan_directory(root: &Path) -> Result<ScanReport, String> {
    if !root.exists() {
        return Err(format!("Direktori '{}' tidak ditemukan", root.display()));
    }

    let dangerous_rules: Vec<(&str, Regex)> = vec![
        ("os.system()", Regex::new(r"os\.system\s*\(").unwrap()),
        ("eval()", Regex::new(r"\beval\s*\(").unwrap()),
        ("exec()", Regex::new(r"\bexec\s*\(").unwrap()),
        (
            "subprocess shell=True",
            Regex::new(r"shell\s*=\s*True").unwrap(),
        ),
        (
            "child_process.exec()",
            Regex::new(r"child_process\.exec\s*\(").unwrap(),
        ),
    ];

    let secret_regex = Regex::new(
        r#"(ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----|(PASSWORD|SECRET|API_KEY|PRIVATE_KEY|BOT_TOKEN)\s*=\s*['"][^'"]{6,}['"])"#,
    )
    .unwrap();

    let mut report = ScanReport::default();
    visit_dir(root, &dangerous_rules, &secret_regex, &mut report)?;
    Ok(report)
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "target" | "node_modules" | "__pycache__" | ".superpowers" | ".venv" | "venv"
    )
}

fn is_test_or_scanner_file(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if file_name.starts_with("test_")
        || file_name.ends_with("_test.py")
        || file_name.ends_with("_test.go")
        || file_name.ends_with(".spec.js")
        || file_name == "security-check.sh"
        || file_name == "scanner.rs"
    {
        return true;
    }
    false
}

fn is_code_extension(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("py" | "js" | "ts" | "sh" | "go" | "java" | "rb" | "php" | "env" | "yml" | "yaml")
    )
}

fn visit_dir(
    dir: &Path,
    dangerous_rules: &[(&str, Regex)],
    secret_regex: &Regex,
    report: &mut ScanReport,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Gagal membaca direktori '{}': {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if path.is_dir() {
            if !should_skip_dir(&name_str) {
                visit_dir(&path, dangerous_rules, secret_regex, report)?;
            }
            continue;
        }

        if name_str == "Dockerfile" || name_str.starts_with("Dockerfile.") {
            report.scanned_files += 1;
            check_dockerfile(&path, report)?;
            continue;
        }

        if is_code_extension(&path) && !is_test_or_scanner_file(&path) {
            report.scanned_files += 1;
            check_code_file(&path, dangerous_rules, secret_regex, report)?;
        }
    }
    Ok(())
}

fn check_code_file(
    path: &Path,
    dangerous_rules: &[(&str, Regex)],
    secret_regex: &Regex,
    report: &mut ScanReport,
) -> Result<(), String> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Ok(()), // skip non-UTF8 files
    };

    for (idx, line) in content.lines().enumerate() {
        let line_no = idx + 1;
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with("//") {
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

    Ok(())
}

fn check_dockerfile(path: &Path, report: &mut ScanReport) -> Result<(), String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Gagal membaca Dockerfile '{}': {}", path.display(), e))?;

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
            Some((_, ref u)) if u != "root" && u != "0" => {}
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
        fs::write(
            tmp.path().join("bad.py"),
            "import os\nos.system('id')\n",
        )
        .unwrap();

        let report = scan_directory(tmp.path()).unwrap();
        assert!(!report.is_clean());
        assert_eq!(report.violations.len(), 1);
        assert!(report.violations[0].rule.contains("os.system()"));
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
}
