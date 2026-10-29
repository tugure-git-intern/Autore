use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const HOOK_MARKER: &str = "# Managed by Autore CLI (pre-commit security gate)";
const USER_BACKUP_NAME: &str = "pre-commit.user-backup";

fn resolve_git_dir(repo_root: &Path) -> Result<PathBuf, String> {
    let dot_git = repo_root.join(".git");
    if dot_git.is_dir() {
        return Ok(dot_git);
    }
    if dot_git.is_file() {
        let raw = fs::read_to_string(&dot_git)
            .map_err(|e| format!("Gagal membaca file .git: {}", e))?;
        if let Some(rest) = raw.lines().next().and_then(|l| l.strip_prefix("gitdir:")) {
            let target = PathBuf::from(rest.trim());
            let resolved = if target.is_absolute() {
                target
            } else {
                repo_root.join(target)
            };
            if resolved.is_dir() {
                return Ok(resolved);
            }
        }
    }
    Err(format!(
        "Direktori '{}' bukan repositori Git (.git tidak ditemukan)",
        repo_root.display()
    ))
}

pub fn install_pre_commit_hook(repo_root: &Path) -> Result<PathBuf, String> {
    let git_dir = resolve_git_dir(repo_root)?;
    let hooks_dir = git_dir.join("hooks");
    fs::create_dir_all(&hooks_dir)
        .map_err(|e| format!("Gagal membuat folder hooks: {}", e))?;

    let hook_path = hooks_dir.join("pre-commit");
    let backup_path = hooks_dir.join(USER_BACKUP_NAME);

    if hook_path.exists() {
        let existing = fs::read_to_string(&hook_path).unwrap_or_default();
        if !existing.contains(HOOK_MARKER) && !backup_path.exists() {
            fs::rename(&hook_path, &backup_path)
                .map_err(|e| format!("Gagal mem-backup pre-commit lama: {}", e))?;
        }
    }

    let script = format!(
        r#"#!/usr/bin/env bash
{marker}
set -euo pipefail

printf '==> [Autore Pre-Commit Gate] Memeriksa keamanan kode sebelum commit...\n'

SCAN_FLAGS=(--no-docker)
if [ "${{AUTORE_HOOK_DOCKER:-0}}" = "1" ]; then
  SCAN_FLAGS=()
fi

if [ -x /usr/local/bin/autore ]; then
  /usr/local/bin/autore scan "${{SCAN_FLAGS[@]}}" --path "."
elif command -v autore >/dev/null 2>&1; then
  autore scan "${{SCAN_FLAGS[@]}}" --path "."
elif [ -x "$HOME/.local/bin/autore" ]; then
  "$HOME/.local/bin/autore" scan "${{SCAN_FLAGS[@]}}" --path "."
else
  printf 'ERROR: binary autore tidak ditemukan di PATH.\n' >&2
  exit 1
fi

HOOK_DIR="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"
if [ -x "$HOOK_DIR/{backup}" ]; then
  "$HOOK_DIR/{backup}" "$@"
fi

printf '==> [Autore Pre-Commit Gate] LULUS! Commit diizinkan.\n'
"#,
        marker = HOOK_MARKER,
        backup = USER_BACKUP_NAME,
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
    let git_dir = resolve_git_dir(repo_root)?;
    let hooks_dir = git_dir.join("hooks");
    let hook_path = hooks_dir.join("pre-commit");
    let backup_path = hooks_dir.join(USER_BACKUP_NAME);
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
    if backup_path.exists() {
        fs::rename(&backup_path, &hook_path)
            .map_err(|e| format!("Gagal memulihkan backup pre-commit: {}", e))?;
    }
    Ok(true)
}

pub fn is_hook_installed(repo_root: &Path) -> bool {
    let Ok(git_dir) = resolve_git_dir(repo_root) else {
        return false;
    };
    let hook_path = git_dir.join("hooks").join("pre-commit");
    let Ok(meta) = fs::metadata(&hook_path) else {
        return false;
    };
    if !meta.is_file() || (meta.permissions().mode() & 0o111 == 0) {
        return false;
    }
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

    #[test]
    fn preserves_and_chains_existing_user_hook_and_restores_on_uninstall() {
        let tmp = TempDir::new().unwrap();
        let hooks = tmp.path().join(".git/hooks");
        fs::create_dir_all(&hooks).unwrap();
        let user_hook = "#!/bin/sh\necho custom-linter\n";
        let hook_path = hooks.join("pre-commit");
        fs::write(&hook_path, user_hook).unwrap();
        fs::set_permissions(&hook_path, fs::Permissions::from_mode(0o755)).unwrap();

        install_pre_commit_hook(tmp.path()).unwrap();
        let backup = hooks.join("pre-commit.user-backup");
        assert!(backup.exists(), "existing pre-commit hook was not backed up");
        assert_eq!(fs::read_to_string(&backup).unwrap(), user_hook);
        let installed = fs::read_to_string(&hook_path).unwrap();
        assert!(installed.contains("pre-commit.user-backup"), "did not chain user hook");

        uninstall_pre_commit_hook(tmp.path()).unwrap();
        assert!(!backup.exists(), "backup should be moved back on uninstall");
        assert_eq!(fs::read_to_string(&hook_path).unwrap(), user_hook);
    }

    #[test]
    fn supports_git_worktree_file_pointer() {
        let tmp = TempDir::new().unwrap();
        let real_git = tmp.path().join("real-git-dir");
        let wt = tmp.path().join("worktree");
        fs::create_dir_all(&real_git).unwrap();
        fs::create_dir_all(&wt).unwrap();
        fs::write(
            wt.join(".git"),
            format!("gitdir: {}\n", real_git.display()),
        )
        .unwrap();

        let path = install_pre_commit_hook(&wt).unwrap();
        assert!(path.starts_with(&real_git));
        assert!(is_hook_installed(&wt));
        assert!(uninstall_pre_commit_hook(&wt).unwrap());
        assert!(!is_hook_installed(&wt));
    }

    #[test]
    fn hook_status_is_false_when_not_executable() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join(".git")).unwrap();
        let path = install_pre_commit_hook(tmp.path()).unwrap();
        assert!(is_hook_installed(tmp.path()));

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!is_hook_installed(tmp.path()), "non-executable hook reported as active");
    }
}
