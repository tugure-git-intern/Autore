//! github.rs — Utilitas GitHub minimal untuk alur 1-klik (buat repo + push).
//!
//! Semua permintaan API lewat `curl --config -` supaya token tidak pernah
//! muncul di daftar proses (`ps`) atau history shell.
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const API_BASE: &str = "https://api.github.com";

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Lokasi penyimpanan token GitHub (dibuat otomatis saat pertama dipakai).
pub fn default_token_path() -> PathBuf {
    home_dir().join(".config").join("autore").join("github.token")
}

/// Ambil token dari isi `~/.git-credentials` (format `https://user:TOKEN@github.com`).
pub fn parse_token_from_credentials(text: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if !line.contains("github.com") || !line.contains('@') {
            continue;
        }
        let Some(after_scheme) = line.split("//").nth(1) else {
            continue;
        };
        let Some(userinfo) = after_scheme.split('@').next() else {
            continue;
        };
        let Some((_, token)) = userinfo.split_once(':') else {
            continue;
        };
        let token = token.trim();
        if !token.is_empty() {
            return Some(token.to_string());
        }
    }
    None
}

/// Cari token GitHub yang sudah tersedia: env var -> file token -> `~/.git-credentials`.
pub fn resolve_token() -> Option<String> {
    for var in ["AUTORE_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(v) = std::env::var(var) {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    if let Ok(t) = fs::read_to_string(default_token_path()) {
        let t = t.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    fs::read_to_string(home_dir().join(".git-credentials"))
        .ok()
        .and_then(|t| parse_token_from_credentials(&t))
}

pub fn save_token(token: &str) -> Result<PathBuf, String> {
    let path = default_token_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Gagal membuat folder konfigurasi {}: {e}", parent.display()))?;
    }
    fs::write(&path, format!("{}\n", token.trim()))
        .map_err(|e| format!("Gagal menyimpan token GitHub ke {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

/// Ambil nilai string pertama dari body JSON tanpa dependency parser.
/// ponytail: cukup untuk respons API GitHub yang field-nya rata di level atas.
pub fn extract_json_string(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let at = body.find(&needle)?;
    let rest = &body[at + needle.len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn curl_api(
    token: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<(u16, String), String> {
    let url = format!("{API_BASE}{path}");
    let mut args: Vec<String> = vec![
        "-sS".to_string(),
        "--max-time".to_string(),
        "60".to_string(),
        "-X".to_string(),
        method.to_string(),
        "-w".to_string(),
        "\n__HTTP_CODE__:%{http_code}".to_string(),
    ];
    if let Some(b) = body {
        args.push("-H".to_string());
        args.push("Content-Type: application/json".to_string());
        args.push("-d".to_string());
        args.push(b.to_string());
    }
    args.push("--config".to_string());
    args.push("-".to_string());
    args.push(url);

    let mut child = Command::new("curl")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Gagal menjalankan curl: {e}"))?;

    let config = format!(
        "header = \"Authorization: Bearer {token}\"\nheader = \"Accept: application/vnd.github+json\"\nheader = \"User-Agent: autore-cli\"\n"
    );
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(config.as_bytes());
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("Gagal membaca hasil curl: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if !out.status.success() && text.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("Koneksi ke GitHub gagal: {err}"));
    }
    if let Some((body, code_str)) = text.rsplit_once("\n__HTTP_CODE__:") {
        let code = code_str.trim().parse::<u16>().unwrap_or(0);
        Ok((code, body.to_string()))
    } else {
        Ok((200, text))
    }
}

/// Nama akun pemilik token (mis. `tugure-git-intern`).
pub fn whoami(token: &str) -> Result<String, String> {
    let (code, body) = curl_api(token, "GET", "/user", None)?;
    match code {
        200 => extract_json_string(&body, "login")
            .ok_or_else(|| "Respons GitHub tidak memuat nama akun.".to_string()),
        401 => Err("Token GitHub ditolak (HTTP 401). Buat token baru di GitHub lalu ulangi.".into()),
        _ => Err(format!("Gagal membaca akun GitHub (HTTP {code}).")),
    }
}

/// Pastikan repo `owner/name` ada di GitHub. `true` = baru dibuat.
pub fn ensure_repo(token: &str, owner: &str, name: &str) -> Result<(String, bool), String> {
    let payload = format!(
        "{{\"name\":\"{name}\",\"private\":false,\"description\":\"Dibuat otomatis oleh Autore CLI\"}}"
    );
    let (code, body) = curl_api(token, "POST", "/user/repos", Some(&payload))?;
    match code {
        201 => Ok((format!("{owner}/{name}"), true)),
        422 => Ok((format!("{owner}/{name}"), false)),
        401 => Err("Token GitHub ditolak (HTTP 401). Periksa token-nya.".into()),
        403 => Err(
            "Token GitHub tidak punya izin membuat repo (HTTP 403). Tambahkan permission 'Administration: Read and write' pada token.".into(),
        ),
        _ => {
            let msg = extract_json_string(&body, "message").unwrap_or_default();
            Err(format!("Gagal membuat repo GitHub (HTTP {code}) {msg}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_token_from_credentials_reads_first_github_line() {
        let text = "https://user:ghp_abc123@github.com\nhttps://other:zzz@gitlab.com\n";
        assert_eq!(
            parse_token_from_credentials(text).as_deref(),
            Some("ghp_abc123")
        );
    }

    #[test]
    fn parse_token_from_credentials_ignores_non_github_and_empty() {
        assert_eq!(parse_token_from_credentials(""), None);
        assert_eq!(
            parse_token_from_credentials("https://user:tok@gitlab.com\n"),
            None
        );
        assert_eq!(
            parse_token_from_credentials("https://user:@github.com\n"),
            None
        );
    }

    #[test]
    fn extract_json_string_takes_first_value() {
        let body = r#"{"login":"tugure-git-intern","id":1,"user_view_type":"public"}"#;
        assert_eq!(
            extract_json_string(body, "login").as_deref(),
            Some("tugure-git-intern")
        );
        assert_eq!(extract_json_string(body, "full_name"), None);
    }
}
