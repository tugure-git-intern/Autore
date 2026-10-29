use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const HOOK_MARKER: &str = "# Managed by Autore CLI (pre-commit security gate)";

pub fn install_pre_commit_hook(repo_root: &Path) -> Result<PathBuf, String> {
    let git_dir = repo_root.join(".git");
    if !git_dir.is_dir() {
        return Err(format!(
            "Direktori '{}' bukan repositori Git (.git tidak ditemukan)",
            repo_root.display()
        ));
    }

    let hooks_dir = git_dir.join("hooks");
    fs::create_dir_all(&hooks_dir)
        .map_err(|e| format!("Gagal membuat folder hooks: {}", e))?;

    let hook_path = hooks_dir.join("pre-commit");
    let script = format!(
        r#"#!/usr/bin/env bash
{marker}
set -euo pipefail

printf '==> [Autore Pre-Commit Gate] Memeriksa keamanan kode sebelum commit...\n'

if command -v autore >/dev/null 2>&1; then
  autore scan --no-docker --path "."
elif [ -x "$HOME/.local/bin/autore" ]; then
  "$HOME/.local/bin/autore" scan --no-docker --path "."
elif [ -x "./scripts/security-check.sh" ]; then
  SECURITY_SKIP_DOCKER=1 ./scripts/security-check.sh
else
  printf 'ERROR: binary autore tidak ditemukan di PATH.\n' >&2
  exit 1
fi

printf '==> [Autore Pre-Commit Gate] LULUS! Commit diizinkan.\n'
"#,
        marker = HOOK_MARKER
    );

    fs::write(&hook_path, script)
        .map_err(|e| format!("Gagal menulis file pre-commit hook: {}", e))?;

    let mut perms = fs::metadata(&hook_path)
        .map_err(|e| e.to_string())?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&hook_path, perms).map_err(|e| e.to_string())?;

    Ok(hook_path)
}

pub fn uninstall_pre_commit_hook(repo_root: &Path) -> Result<bool, String> {
    let hook_path = repo_root.join(".git").join("hooks").join("pre-commit");
    if !hook_path.exists() {
        return Ok(false);
    }
    let content = fs::read_to_string(&hook_path).unwrap_or_default();
    if !content.contains(HOOK_MARKER) {
        return Err(
            "File pre-commit yang ada bukan buatan Autore CLI; batal menghapus demi keamanan"
                .to_string(),
        );
    }
    fs::remove_file(&hook_path).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn is_hook_installed(repo_root: &Path) -> bool {
    let hook_path = repo_root.join(".git").join("hooks").join("pre-commit");
    if let Ok(content) = fs::read_to_string(hook_path) {
        content.contains(HOOK_MARKER)
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn install_and_uninstall_hook_lifecycle() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join(".git")).unwrap();

        assert!(!is_hook_installed(tmp.path()));

        let path = install_pre_commit_hook(tmp.path()).unwrap();
        assert!(path.exists());
        assert!(is_hook_installed(tmp.path()));

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o755);

        let removed = uninstall_pre_commit_hook(tmp.path()).unwrap();
        assert!(removed);
        assert!(!is_hook_installed(tmp.path()));
    }
}
