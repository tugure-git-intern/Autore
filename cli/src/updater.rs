use colored::Colorize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_REPO: &str = "tugure-git-intern/Autore";
const CURRENT_VERSION: &str = env!("AUTORE_VERSION");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformTarget {
    pub os: &'static str,
    pub arch: &'static str,
    pub asset_name: &'static str,
}

/// Pemetaan OS + arsitektur ke nama aset di GitHub Releases.
pub fn resolve_platform_for(os: &str, arch: &str) -> Result<PlatformTarget, String> {
    match (os, arch) {
        ("linux", "x86_64") => Ok(PlatformTarget {
            os: "linux",
            arch: "x86_64",
            asset_name: "autore-linux-x86_64-musl",
        }),
        ("windows", "x86_64") => Ok(PlatformTarget {
            os: "windows",
            arch: "x86_64",
            asset_name: "autore-windows-x86_64.exe",
        }),
        _ => Err(format!(
            "OS/arsitektur '{os}/{arch}' belum didukung oleh Update Autore (hanya linux/x86_64 & windows/x86_64)."
        )),
    }
}

pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let s = raw.trim().trim_start_matches('v');
    let mut parts = s.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch_str = parts.next()?.split(['-', '+']).next()?;
    let patch = patch_str.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

pub fn is_newer_version(current: &str, remote: &str) -> Result<bool, String> {
    let cur =
        parse_semver(current).ok_or_else(|| format!("Versi lokal tidak valid: '{current}'"))?;
    let rem = parse_semver(remote)
        .ok_or_else(|| format!("Versi rilis GitHub tidak valid: '{remote}'"))?;
    Ok(rem > cur)
}

/// Ambil hash yang diharapkan untuk `asset_name` dari isi file `SHA256SUMS`.
pub fn parse_expected_sha256(sums_text: &str, asset_name: &str) -> Result<String, String> {
    for line in sums_text.lines() {
        let mut cols = line.split_whitespace();
        let Some(hash) = cols.next() else { continue };
        let Some(name_raw) = cols.next() else {
            continue;
        };
        let name = name_raw.trim_start_matches('*');
        if name == asset_name && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(hash.to_ascii_lowercase());
        }
    }
    Err(format!(
        "Checksum untuk '{asset_name}' tidak ditemukan atau tidak valid di SHA256SUMS"
    ))
}

/// Ekstrak `tag_name` dari JSON GitHub `/releases/latest`.
pub fn extract_tag_from_release_json(json: &str) -> Option<String> {
    let key = "\"tag_name\"";
    let idx = json.find(key)?;
    let rest = &json[idx + key.len()..];
    let colon = rest.find(':')?;
    let after = rest[colon + 1..].trim_start();
    let stripped = after.strip_prefix('"')?;
    let end = stripped.find('"')?;
    let tag = stripped[..end].trim();
    if tag.is_empty() {
        None
    } else {
        Some(tag.to_string())
    }
}

/// Bersihkan sisa `.old` dari update sebelumnya (Windows tidak mengizinkan hapus saat proses hidup).
pub fn cleanup_stale_old_binary(exe_path: &Path) {
    let old_path = old_backup_path(exe_path);
    if old_path.exists() {
        let _ = fs::remove_file(old_path);
    }
}

fn old_backup_path(exe_path: &Path) -> PathBuf {
    let mut p = exe_path.as_os_str().to_os_string();
    p.push(".old");
    PathBuf::from(p)
}

fn staged_new_path(exe_path: &Path) -> PathBuf {
    let mut p = exe_path.as_os_str().to_os_string();
    p.push(".new");
    PathBuf::from(p)
}

/// Ganti binary target secara atomik tanpa bentrok dengan proses yang sedang berjalan.
/// - Linux/Unix: tulis ke `<exe>.new`, set mode 0755, lalu `rename` ke `<exe>`.
/// - Windows: `rename` `<exe>` yang sedang jalan ke `<exe>.old`, lalu `rename` `<exe>.new` ke `<exe>`.
pub fn replace_binary_safely_for_os(
    downloaded_file: &Path,
    target_exe: &Path,
    os: &str,
) -> Result<(), String> {
    let staged = staged_new_path(target_exe);
    fs::copy(downloaded_file, &staged).map_err(|e| {
        let hint = if e.kind() == std::io::ErrorKind::PermissionDenied {
            crate::elevation_hint(target_exe)
        } else {
            String::new()
        };
        format!(
            "Gagal menulis file baru '{}' (cek izin tulis folder): {e}{hint}",
            staged.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&staged, fs::Permissions::from_mode(0o755));
    }

    if os == "windows" {
        let backup = old_backup_path(target_exe);
        let _ = fs::remove_file(&backup);
        if target_exe.exists() {
            fs::rename(target_exe, &backup).map_err(|e| {
                let _ = fs::remove_file(&staged);
                format!(
                    "Gagal memindahkan binary lama '{}' ke '{}': {e}",
                    target_exe.display(),
                    backup.display()
                )
            })?;
        }
        if let Err(e) = fs::rename(&staged, target_exe) {
            let _ = fs::rename(&backup, target_exe);
            let _ = fs::remove_file(&staged);
            return Err(format!(
                "Gagal mengaktifkan binary baru '{}': {e}",
                target_exe.display()
            ));
        }
        Ok(())
    } else {
        fs::rename(&staged, target_exe).map_err(|e| {
            let _ = fs::remove_file(&staged);
            format!(
                "Gagal mengganti '{}' secara atomik: {e}",
                target_exe.display()
            )
        })
    }
}

fn fetch_latest_tag(repo: &str, api_base: &str) -> Result<String, String> {
    let url = format!("{api_base}/repos/{repo}/releases/latest");
    let out = Command::new("curl")
        .args(["-fsSL", "-H", "Accept: application/vnd.github+json", &url])
        .output()
        .map_err(|e| format!("Gagal menjalankan curl untuk cek rilis terbaru: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Gagal menghubungi GitHub Releases ({url}): {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let body = String::from_utf8_lossy(&out.stdout);
    extract_tag_from_release_json(&body)
        .ok_or_else(|| "Respons GitHub Releases tidak memuat tag_name".to_string())
}

fn download_to(url: &str, dest: &Path) -> Result<(), String> {
    let dest_str = dest
        .to_str()
        .ok_or("Path tujuan unduhan bukan UTF-8 valid")?;
    let out = Command::new("curl")
        .args(["-fsSL", url, "-o", dest_str])
        .output()
        .map_err(|e| format!("Gagal menjalankan curl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Gagal mengunduh {url}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let path_str = path.to_str().ok_or("Path file bukan UTF-8 valid")?;
    // Linux/macOS: sha256sum; Windows: certutil -hashfile <file> SHA256
    if let Ok(out) = Command::new("sha256sum").arg(path_str).output() {
        if out.status.success() {
            if let Some(h) = String::from_utf8_lossy(&out.stdout)
                .split_whitespace()
                .next()
            {
                if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Ok(h.to_ascii_lowercase());
                }
            }
        }
    }
    if let Ok(out) = Command::new("certutil")
        .args(["-hashfile", path_str, "SHA256"])
        .output()
    {
        if out.status.success() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
                if compact.len() == 64 && compact.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Ok(compact.to_ascii_lowercase());
                }
            }
        }
    }
    Err("Tidak dapat menghitung SHA-256 (sha256sum / certutil tidak tersedia)".to_string())
}

pub fn clean_exe_path(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_suffix(" (deleted)") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

pub fn restart_into(exe_path: &Path) {
    if let Ok(status) = Command::new(exe_path).status() {
        std::process::exit(status.code().unwrap_or(0));
    }
}

pub fn run_self_update() -> Result<Option<PathBuf>, String> {
    let raw_exe = std::env::current_exe()
        .and_then(|p| p.canonicalize().or(Ok(p)))
        .map_err(|e| format!("Gagal mendeteksi lokasi binary autore: {e}"))?;
    let was_deleted_in_ram = raw_exe.to_string_lossy().ends_with(" (deleted)");
    let exe_path = clean_exe_path(raw_exe);
    let repo = std::env::var("AUTORE_GITHUB_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string());
    let api_base =
        std::env::var("AUTORE_GITHUB_API").unwrap_or_else(|_| "https://api.github.com".to_string());
    let dl_base = std::env::var("AUTORE_RELEASE_BASE")
        .unwrap_or_else(|_| format!("https://github.com/{repo}/releases/download"));
    let updated = run_self_update_with(
        std::env::consts::OS,
        std::env::consts::ARCH,
        CURRENT_VERSION,
        &exe_path,
        &repo,
        &api_base,
        &dl_base,
    )?;
    if updated || was_deleted_in_ram {
        Ok(Some(exe_path))
    } else {
        Ok(None)
    }
}

pub fn run_self_update_with(
    os: &str,
    arch: &str,
    current_version: &str,
    exe_path: &Path,
    repo: &str,
    api_base: &str,
    dl_base: &str,
) -> Result<bool, String> {
    let platform = resolve_platform_for(os, arch)?;
    cleanup_stale_old_binary(exe_path);

    println!(
        "{} Sistem terdeteksi: {}/{} (aset: {})",
        "==>".cyan().bold(),
        platform.os,
        platform.arch,
        platform.asset_name
    );
    println!("  • Lokasi binary : {}", exe_path.display());
    println!("  • Versi terpasang: v{current_version}");

    println!(
        "{} Mengecek rilis stabil terbaru di GitHub ({repo})...",
        "==>".cyan().bold()
    );
    let latest_tag = fetch_latest_tag(repo, api_base)?;
    let latest_clean = latest_tag.trim_start_matches('v');
    let current_clean = current_version.trim_start_matches('v');
    let version_is_newer = is_newer_version(current_clean, latest_clean)?;

    if !version_is_newer && current_clean != latest_clean {
        println!(
            "{} Sudah versi stabil terbaru (v{current_clean}). Tidak ada yang perlu di-update.",
            "✔".green().bold()
        );
        return Ok(false);
    }

    let tmp_dir = std::env::temp_dir().join(format!("autore-update-{}", std::process::id()));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Gagal membuat folder sementara: {e}"))?;

    let result = (|| -> Result<bool, String> {
        let bin_url = format!("{dl_base}/{latest_tag}/{}", platform.asset_name);
        let sums_url = format!("{dl_base}/{latest_tag}/SHA256SUMS");
        let tmp_bin = tmp_dir.join(platform.asset_name);
        let tmp_sums = tmp_dir.join("SHA256SUMS");

        download_to(&sums_url, &tmp_sums)?;
        let sums_text =
            fs::read_to_string(&tmp_sums).map_err(|e| format!("Gagal membaca SHA256SUMS: {e}"))?;
        let expected = parse_expected_sha256(&sums_text, platform.asset_name)?;

        if !version_is_newer {
            let local_sha = compute_file_sha256(exe_path).unwrap_or_default();
            if local_sha == expected {
                println!(
                    "{} Sudah versi & build terbaru (v{current_clean}, sha256: {}...). Tidak ada yang perlu di-update.",
                    "✔".green().bold(),
                    &expected[..12]
                );
                return Ok(false);
            }
            println!(
                "{} Build baru terdeteksi di rilis v{latest_clean} (sha256: {}...). Mengunduh & memverifikasi...",
                "==>".cyan().bold(),
                &expected[..12]
            );
        } else {
            println!(
                "{} Versi baru tersedia: v{current_clean} -> v{latest_clean}. Mengunduh & memverifikasi...",
                "==>".cyan().bold()
            );
        }

        download_to(&bin_url, &tmp_bin)?;
        let actual = compute_file_sha256(&tmp_bin)?;
        if expected != actual {
            return Err(format!(
                "Verifikasi SHA-256 GAGAL! Diharapkan {expected}, didapat {actual}. Update dibatalkan."
            ));
        }
        println!(
            "  {} Integritas SHA-256 cocok ({}...).",
            "✔".green().bold(),
            &actual[..12]
        );

        replace_binary_safely_for_os(&tmp_bin, exe_path, platform.os)?;
        Ok(true)
    })();

    let _ = fs::remove_dir_all(&tmp_dir);
    let did_update = result?;
    if !did_update {
        return Ok(false);
    }

    println!(
        "\n{} Autore berhasil di-update ke v{latest_clean} di {}",
        "✔".green().bold(),
        exe_path.display()
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn resolves_linux_and_windows_x86_64_and_rejects_others() {
        let lin = resolve_platform_for("linux", "x86_64").unwrap();
        assert_eq!(lin.asset_name, "autore-linux-x86_64-musl");

        let win = resolve_platform_for("windows", "x86_64").unwrap();
        assert_eq!(win.asset_name, "autore-windows-x86_64.exe");

        assert_eq!(
            clean_exe_path(PathBuf::from("/home/tugure/.local/bin/autore (deleted)")),
            PathBuf::from("/home/tugure/.local/bin/autore")
        );
        assert!(resolve_platform_for("macos", "aarch64").is_err());
        assert!(resolve_platform_for("linux", "aarch64").is_err());
    }

    #[test]
    fn compares_semver_strictly_without_sha() {
        assert!(is_newer_version("0.1.0", "0.2.0").unwrap());
        assert!(is_newer_version("v0.1.0", "v0.1.1").unwrap());
        assert!(!is_newer_version("0.2.0", "0.2.0").unwrap());
        assert!(!is_newer_version("0.2.0", "0.1.9").unwrap());
        assert!(is_newer_version("invalid", "0.2.0").is_err());
    }

    #[test]
    fn extracts_tag_and_sha256_entry() {
        let json = r#"{"url":"x","tag_name": "v0.2.0","name":"Autore v0.2.0"}"#;
        assert_eq!(
            extract_tag_from_release_json(json).as_deref(),
            Some("v0.2.0")
        );

        let sums = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  autore-linux-x86_64-musl\n\
                    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *autore-windows-x86_64.exe\n";
        assert_eq!(
            parse_expected_sha256(sums, "autore-linux-x86_64-musl").unwrap(),
            "a".repeat(64)
        );
        assert_eq!(
            parse_expected_sha256(sums, "autore-windows-x86_64.exe").unwrap(),
            "b".repeat(64)
        );
        assert!(parse_expected_sha256(sums, "tidak-ada").is_err());
    }

    #[test]
    fn replaces_binary_safely_on_both_unix_and_windows_modes() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("autore");
        let downloaded = tmp.path().join("downloaded");
        fs::write(&target, b"old-binary").unwrap();
        fs::write(&downloaded, b"new-binary-v0.2.0").unwrap();

        replace_binary_safely_for_os(&downloaded, &target, "linux").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new-binary-v0.2.0");

        // Simulasi mode Windows: file lama dipindah ke .old, lalu dibersihkan saat startup
        fs::write(&downloaded, b"new-binary-v0.3.0").unwrap();
        replace_binary_safely_for_os(&downloaded, &target, "windows").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new-binary-v0.3.0");
        assert!(old_backup_path(&target).exists());
        cleanup_stale_old_binary(&target);
        assert!(!old_backup_path(&target).exists());
    }

    #[test]
    fn updates_end_to_end_when_newer_and_skips_when_same() {
        let tmp = TempDir::new().unwrap();
        let api_dir = tmp.path().join("repos/tugure-git-intern/Autore/releases");
        let dl_dir = tmp.path().join("dl/v99.0.0");
        fs::create_dir_all(&api_dir).unwrap();
        fs::create_dir_all(&dl_dir).unwrap();

        let new_bin = dl_dir.join("autore-linux-x86_64-musl");
        fs::write(&new_bin, b"binary-v99").unwrap();
        let sha = compute_file_sha256(&new_bin).unwrap();
        fs::write(
            dl_dir.join("SHA256SUMS"),
            format!("{sha}  autore-linux-x86_64-musl\n"),
        )
        .unwrap();

        // Versi sama & hash sama -> tidak download ulang
        let cur_dl_dir = tmp.path().join(format!("dl/v{CURRENT_VERSION}"));
        fs::create_dir_all(&cur_dl_dir).unwrap();
        let target_exe = tmp.path().join("installed-autore");
        fs::write(&target_exe, b"old").unwrap();
        let old_sha = compute_file_sha256(&target_exe).unwrap();
        fs::write(
            cur_dl_dir.join("SHA256SUMS"),
            format!("{old_sha}  autore-linux-x86_64-musl\n"),
        )
        .unwrap();
        fs::write(
            api_dir.join("latest"),
            format!(r#"{{"tag_name":"v{CURRENT_VERSION}"}}"#),
        )
        .unwrap();
        let api_url = format!("file://{}", tmp.path().display());
        let dl_url = format!("file://{}/dl", tmp.path().display());
        assert!(!run_self_update_with(
            "linux",
            "x86_64",
            CURRENT_VERSION,
            &target_exe,
            "tugure-git-intern/Autore",
            &api_url,
            &dl_url,
        )
        .unwrap());
        assert_eq!(fs::read(&target_exe).unwrap(), b"old");

        // Versi sama (mis. tetap v0.3.0) TAPI hash di GitHub berubah -> tetap update!
        let hotfix_bin = cur_dl_dir.join("autore-linux-x86_64-musl");
        fs::write(&hotfix_bin, b"same-version-new-build").unwrap();
        let hotfix_sha = compute_file_sha256(&hotfix_bin).unwrap();
        fs::write(
            cur_dl_dir.join("SHA256SUMS"),
            format!("{hotfix_sha}  autore-linux-x86_64-musl\n"),
        )
        .unwrap();
        assert!(run_self_update_with(
            "linux",
            "x86_64",
            CURRENT_VERSION,
            &target_exe,
            "tugure-git-intern/Autore",
            &api_url,
            &dl_url,
        )
        .unwrap());
        assert_eq!(fs::read(&target_exe).unwrap(), b"same-version-new-build");

        // Versi lebih baru -> download + verifikasi SHA-256 + replace atomik
        fs::write(api_dir.join("latest"), r#"{"tag_name":"v99.0.0"}"#).unwrap();
        run_self_update_with(
            "linux",
            "x86_64",
            CURRENT_VERSION,
            &target_exe,
            "tugure-git-intern/Autore",
            &api_url,
            &dl_url,
        )
        .unwrap();
        assert_eq!(fs::read(&target_exe).unwrap(), b"binary-v99");

        // Checksum rusak -> gagal & binary lama tetap utuh
        fs::write(&new_bin, b"tampered-binary").unwrap();
        fs::write(&target_exe, b"untouched").unwrap();
        assert!(run_self_update_with(
            "linux",
            "x86_64",
            CURRENT_VERSION,
            &target_exe,
            "tugure-git-intern/Autore",
            &api_url,
            &dl_url,
        )
        .is_err());
        assert_eq!(fs::read(&target_exe).unwrap(), b"untouched");
    }
}
