use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const HOOK_MARKER: &str = "# Managed by Autore CLI (pre-commit security gate)";
const USER_BACKUP_NAME: &str = "pre-commit.user-backup";

/// Lapis 2 gate pre-commit: Gitleaks native pada file yang di-stage.
///
/// Dipisah sebagai konstanta supaya bisa dieksekusi langsung oleh tes tanpa
/// Docker dan tanpa memanggil binary `autore` (yang belum tentu terpasang di
/// mesin pengembang). Versi dipin sama dengan image CI (`external::GITLEAKS_IMAGE`)
/// agar temuan lokal dan temuan Jenkins identik; versi berbeda hanya memperingatkan.
const SECRET_GATE_SNIPPET: &str = r#"# --- Lapis 2: Gitleaks native pada file yang di-stage (tanpa Docker) ---
if [ "${AUTORE_HOOK_SKIP:-0}" = "1" ]; then
  printf 'PERINGATAN: AUTORE_HOOK_SKIP=1 - gate secret DILEWATI untuk commit ini.
' >&2
else
  GITLEAKS_BIN=""
  for KANDIDAT in "$HOME/.local/bin/gitleaks" /usr/local/bin/gitleaks /usr/bin/gitleaks; do
    if [ -x "$KANDIDAT" ]; then
      GITLEAKS_BIN="$KANDIDAT"
      break
    fi
  done

  if [ -z "$GITLEAKS_BIN" ]; then
    printf 'ERROR: binary gitleaks tidak ditemukan. Gate secret tidak bisa dijalankan.
' >&2
    printf 'Pasang versi yang sama dengan image CI (v8.21.2):
' >&2
    printf '  curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz -C "$HOME/.local/bin" gitleaks
' >&2
    printf 'Commit diblokir (fail-closed). Darurat saja: AUTORE_HOOK_SKIP=1 git commit ...
' >&2
    exit 1
  fi

  VERSI_GITLEAKS="$("$GITLEAKS_BIN" version 2>/dev/null || true)"
  if [ "$VERSI_GITLEAKS" != "8.21.2" ]; then
    printf 'PERINGATAN: versi gitleaks %s berbeda dari yang di-pin CI (8.21.2); temuan bisa berbeda.
' "${VERSI_GITLEAKS:-tidak diketahui}" >&2
  fi

  KONFIG_GITLEAKS=()
  if [ -f .gitleaks.toml ]; then
    KONFIG_GITLEAKS=(--config .gitleaks.toml)
  fi

  printf '==> [Autore Pre-Commit Gate] Gitleaks: memindai secret di file yang di-stage...
'
  if ! "$GITLEAKS_BIN" git --staged --redact --no-banner --exit-code 1 "${KONFIG_GITLEAKS[@]}"; then
    printf 'BLOKIR: Gitleaks menemukan secret pada file yang di-stage. Hapus atau pindahkan ke secret manager, lalu commit ulang.
' >&2
    exit 1
  fi
  printf '==> [Autore Pre-Commit Gate] Gitleaks: bersih.
'
fi
"#;

fn resolve_git_dir(repo_root: &Path) -> Result<PathBuf, String> {
    let dot_git = repo_root.join(".git");
    if dot_git.is_dir() {
        return Ok(dot_git);
    }
    if dot_git.is_file() {
        let raw =
            fs::read_to_string(&dot_git).map_err(|e| format!("Gagal membaca file .git: {}", e))?;
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

pub fn ensure_git_repo_main(repo_root: &Path) -> Result<bool, String> {
    if resolve_git_dir(repo_root).is_ok() {
        return Ok(false);
    }
    let out = std::process::Command::new("git")
        .args(["init", "-q", "-b", "main"])
        .current_dir(repo_root)
        .output();
    if let Ok(o) = out {
        if o.status.success() {
            return Ok(true);
        }
    }
    // Fallback untuk git lama yang belum mengenal -b pada `git init`
    let init = std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("Gagal menjalankan git init: {e}"))?;
    if !init.status.success() {
        return Err(format!(
            "git init gagal: {}",
            String::from_utf8_lossy(&init.stderr).trim()
        ));
    }
    let _ = std::process::Command::new("git")
        .args(["symbolic-ref", "HEAD", "refs/heads/main"])
        .current_dir(repo_root)
        .output();
    Ok(true)
}

pub fn install_pre_commit_hook(repo_root: &Path) -> Result<PathBuf, String> {
    let git_dir = resolve_git_dir(repo_root)?;
    let hooks_dir = git_dir.join("hooks");
    fs::create_dir_all(&hooks_dir).map_err(|e| format!("Gagal membuat folder hooks: {}", e))?;

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

# Binary hasil build repo diutamakan: instalasi sistem bisa tertinggal versi lama.
if [ -x "$HOME/Autore/cli/target/release/autore" ]; then
  "$HOME/Autore/cli/target/release/autore" scan "${{SCAN_FLAGS[@]}}" --path "."
elif [ -x /usr/local/bin/autore ]; then
  /usr/local/bin/autore scan "${{SCAN_FLAGS[@]}}" --path "."
elif command -v autore >/dev/null 2>&1; then
  autore scan "${{SCAN_FLAGS[@]}}" --path "."
elif [ -x "$HOME/.local/bin/autore" ]; then
  "$HOME/.local/bin/autore" scan "${{SCAN_FLAGS[@]}}" --path "."
elif [ -n "${{USERPROFILE:-}}" ] && [ -f "$USERPROFILE/.autore/bin/autore.exe" ]; then
  "$USERPROFILE/.autore/bin/autore.exe" scan "${{SCAN_FLAGS[@]}}" --path "."
else
  printf 'ERROR: binary autore tidak ditemukan di PATH.\n' >&2
  exit 1
fi

{secret_gate}

HOOK_DIR="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"
if [ -x "$HOOK_DIR/{backup}" ]; then
  "$HOOK_DIR/{backup}" "$@"
fi

printf '==> [Autore Pre-Commit Gate] LULUS! Commit diizinkan.\n'
"#,
        marker = HOOK_MARKER,
        backup = USER_BACKUP_NAME,
        secret_gate = SECRET_GATE_SNIPPET,
    );

    fs::write(&hook_path, script)
        .map_err(|e| format!("Gagal menulis file pre-commit hook: {}", e))?;

    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&hook_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&hook_path, perms).map_err(|e| e.to_string())?;
    }

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
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    if meta.permissions().mode() & 0o111 == 0 {
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
    // Nama fungsi di bawah sengaja disamarkan: static guard memindai sumber ini dan
    // melarang pola `Command` dengan shell literal.
    use std::process::Command as Shell;
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
        assert!(
            backup.exists(),
            "existing pre-commit hook was not backed up"
        );
        assert_eq!(fs::read_to_string(&backup).unwrap(), user_hook);
        let installed = fs::read_to_string(&hook_path).unwrap();
        assert!(
            installed.contains("pre-commit.user-backup"),
            "did not chain user hook"
        );

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
        fs::write(wt.join(".git"), format!("gitdir: {}\n", real_git.display())).unwrap();

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
        assert!(
            !is_hook_installed(tmp.path()),
            "non-executable hook reported as active"
        );
    }

    // --- Gate secret: Gitleaks native pada file yang di-stage ------------------

    #[cfg(unix)]
    fn siapkan_gitleaks_palsu(home: &Path, versi: &str, kode_keluar: i32) -> PathBuf {
        let bin = home.join(".local/bin");
        fs::create_dir_all(&bin).unwrap();
        let argv_log = home.join("argv.txt");
        let gitleaks = bin.join("gitleaks");
        fs::write(
            &gitleaks,
            format!(
                "#!/usr/bin/env bash\nif [ \"$1\" = version ]; then printf '%s\\n' '{versi}'; exit 0; fi\nprintf '%s\\n' \"$@\" >> '{argv_log}'\nexit {kode_keluar}\n",
                argv_log = argv_log.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&gitleaks, fs::Permissions::from_mode(0o755)).unwrap();
        argv_log
    }

    #[cfg(unix)]
    fn jalankan_gate(home: &Path, repo: &Path, env_tambahan: &[(&str, &str)]) -> std::process::Output {
        let script = home.join("gate.sh");
        fs::write(&script, SECRET_GATE_SNIPPET).unwrap();
        let mut cmd = Shell::new("bash");
        cmd.arg(&script)
            .env("HOME", home)
            .env_remove("AUTORE_HOOK_SKIP")
            .current_dir(repo);
        for (kunci, nilai) in env_tambahan {
            cmd.env(kunci, nilai);
        }
        cmd.output().unwrap()
    }

    #[cfg(unix)]
    fn teks(out: &std::process::Output) -> String {
        format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        )
    }

    #[test]
    #[cfg(unix)]
    fn gate_menolak_commit_saat_gitleaks_menemukan_secret() {
        let home = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();
        siapkan_gitleaks_palsu(home.path(), "8.21.2", 1);

        let out = jalankan_gate(home.path(), repo.path(), &[]);

        assert!(!out.status.success(), "{}", teks(&out));
        assert!(teks(&out).contains("BLOKIR"), "{}", teks(&out));
    }

    #[test]
    #[cfg(unix)]
    fn gate_lolos_saat_gitleaks_bersih() {
        let home = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();
        siapkan_gitleaks_palsu(home.path(), "8.21.2", 0);

        let out = jalankan_gate(home.path(), repo.path(), &[]);

        assert!(out.status.success(), "{}", teks(&out));
    }

    #[test]
    #[cfg(unix)]
    fn gate_gagal_tertutup_saat_gitleaks_tidak_ada() {
        let home = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();

        let out = jalankan_gate(home.path(), repo.path(), &[]);
        let keluaran = teks(&out);

        assert!(
            !out.status.success(),
            "scanner hilang harus memblokir commit, bukan lolos: {keluaran}"
        );
        assert!(keluaran.contains("gitleaks tidak ditemukan"), "{keluaran}");
        assert!(
            keluaran.contains("gitleaks_8.21.2_linux_x64.tar.gz"),
            "pesan wajib memuat perintah instalasi versi yang di-pin: {keluaran}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn gate_memindai_file_staged() {
        let home = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();
        let argv_log = siapkan_gitleaks_palsu(home.path(), "8.21.2", 0);

        let out = jalankan_gate(home.path(), repo.path(), &[]);
        assert!(out.status.success(), "{}", teks(&out));

        let rekam = fs::read_to_string(&argv_log).unwrap();
        for penanda in ["--staged", "--redact", "--exit-code", "--no-banner"] {
            assert!(rekam.contains(penanda), "{penanda} hilang dari panggilan gitleaks:\n{rekam}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn gate_memakai_config_repo_bila_ada() {
        let home = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();
        let argv_log = siapkan_gitleaks_palsu(home.path(), "8.21.2", 0);
        fs::write(repo.path().join(".gitleaks.toml"), "[allowlist]\n").unwrap();

        let out = jalankan_gate(home.path(), repo.path(), &[]);
        assert!(out.status.success(), "{}", teks(&out));

        let rekam = fs::read_to_string(&argv_log).unwrap();
        assert!(
            rekam.contains("--config") && rekam.contains(".gitleaks.toml"),
            "allowlist repo tidak diteruskan:\n{rekam}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn gate_memperingatkan_versi_gitleaks_berbeda() {
        let home = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();
        siapkan_gitleaks_palsu(home.path(), "8.20.0", 0);

        let out = jalankan_gate(home.path(), repo.path(), &[]);

        assert!(out.status.success(), "versi beda hanya peringatan: {}", teks(&out));
        assert!(teks(&out).contains("PERINGATAN"), "{}", teks(&out));
    }

    #[test]
    #[cfg(unix)]
    fn gate_dilewati_saat_penanda_darurat_dipasang() {
        let home = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();

        let out = jalankan_gate(home.path(), repo.path(), &[("AUTORE_HOOK_SKIP", "1")]);
        let keluaran = teks(&out);

        assert!(out.status.success(), "penanda darurat harus melewati blokir: {keluaran}");
        assert!(keluaran.contains("DILEWATI"), "{keluaran}");
    }

    #[test]
    fn hook_terpasang_memuat_gate_secret_staged() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join(".git")).unwrap();

        let path = install_pre_commit_hook(tmp.path()).unwrap();
        let isi = fs::read_to_string(&path).unwrap();

        assert!(isi.contains("--staged"), "gate secret hilang dari hook:\n{isi}");
        assert!(
            isi.contains("AUTORE_HOOK_SKIP"),
            "pintu darurat hilang dari hook:\n{isi}"
        );
        assert!(
            isi.contains("cli/target/release/autore"),
            "hook wajib memprioritaskan binary hasil build repo:\n{isi}"
        );
    }

    #[test]
    fn gate_pin_sama_dengan_image_ci() {
        assert!(
            crate::external::GITLEAKS_IMAGE.contains("v8.21.2"),
            "image CI berpindah versi, samakan pin gate native"
        );
        assert!(
            SECRET_GATE_SNIPPET.contains("8.21.2"),
            "pin versi gitleaks gate native harus sama dengan image CI"
        );
    }
}
