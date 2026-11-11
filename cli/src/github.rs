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
    home_dir()
        .join(".config")
        .join("autore")
        .join("github.token")
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
        401 => {
            Err("Token GitHub ditolak (HTTP 401). Buat token baru di GitHub lalu ulangi.".into())
        }
        _ => Err(format!("Gagal membaca akun GitHub (HTTP {code}).")),
    }
}

/// Pastikan repo `owner/name` ada di GitHub. `true` = baru dibuat.
/// Jalur `ensure_repo` dengan lapisan HTTP disuntik, supaya tes bisa membuktikan
/// permintaan apa saja yang benar-benar dikirim tanpa menyentuh jaringan.
pub fn ensure_repo(token: &str, owner: &str, name: &str) -> Result<(String, bool), String> {
    ensure_repo_dengan(&curl_api, token, owner, name)
}

fn ensure_repo_dengan(
    kirim: &dyn Fn(&str, &str, &str, Option<&str>) -> Result<(u16, String), String>,
    token: &str,
    owner: &str,
    name: &str,
) -> Result<(String, bool), String> {
    let full = format!("{owner}/{name}");

    // Cek keberadaan dulu: repo yang sudah ada tidak boleh di-POST ulang. POST
    // berulang ke `/user/repos` kena secondary rate limit GitHub untuk "content
    // creation", dan pembatasan itu datang sebagai HTTP 403 yang gampang salah
    // dibaca sebagai masalah izin token.
    match kirim(token, "GET", &format!("/repos/{full}"), None)?.0 {
        200 => return Ok((full, false)),
        401 => return Err("Token GitHub ditolak (HTTP 401). Periksa token-nya.".into()),
        // 403/404/5xx: hasil cek tidak bisa dipercaya, jadi tempuh jalur lama —
        // POST akan melaporkan penyebab sebenarnya.
        _ => {}
    }

    let payload = format!(
        "{{\"name\":\"{name}\",\"private\":false,\"description\":\"Dibuat otomatis oleh Autore CLI\"}}"
    );
    let (code, body) = kirim(token, "POST", "/user/repos", Some(&payload))?;
    match code {
        201 => Ok((full, true)),
        422 => Ok((full, false)),
        401 => Err("Token GitHub ditolak (HTTP 401). Periksa token-nya.".into()),
        403 => Err(pesan_gagal_buat_repo(&body)),
        _ => {
            let msg = extract_json_string(&body, "message").unwrap_or_default();
            Err(format!("Gagal membuat repo GitHub (HTTP {code}) {msg}"))
        }
    }
}

/// HTTP 403 dari GitHub tidak selalu soal izin: pembatasan sementara (secondary
/// rate limit untuk content creation) juga datang sebagai 403 dengan pesannya
/// sendiri. Membedakannya supaya pesan izin tidak menyesatkan.
fn pesan_gagal_buat_repo(body: &str) -> String {
    let pesan = extract_json_string(body, "message").unwrap_or_default();
    if pesan.to_lowercase().contains("secondary rate limit") {
        format!(
            "GitHub sedang membatasi pembuatan repo sementara (secondary rate limit). Tunggu beberapa menit lalu ulangi. Pesan GitHub: {pesan}"
        )
    } else {
        "Token GitHub tidak punya izin membuat repo (HTTP 403). Tambahkan permission 'Administration: Read and write' pada token.".into()
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

    /// Catatan panggilan + jawaban tetap, dipakai semua tes kontrak di bawah.
    fn kirim_rekaman<'a>(
        catatan: &'a std::cell::RefCell<Vec<(String, String)>>,
        jawaban: Vec<(u16, &'static str)>,
    ) -> impl Fn(&str, &str, &str, Option<&str>) -> Result<(u16, String), String> + 'a {
        let urut = std::cell::Cell::new(0usize);
        move |_token, method, path, _body| {
            catatan
                .borrow_mut()
                .push((method.to_string(), path.to_string()));
            let (code, body) = jawaban
                .get(urut.get())
                .copied()
                .unwrap_or((500, "{\"message\":\"tak terduga\"}"));
            urut.set(urut.get() + 1);
            Ok((code, body.to_string()))
        }
    }

    #[test]
    fn repo_yang_sudah_ada_tidak_pernah_dipost() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![(200, r#"{"full_name":"tugure-git-intern/audit-test-app"}"#)],
        );

        let (full, baru) =
            ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "audit-test-app")
                .expect("repo yang sudah ada harus lolos");

        assert_eq!(full, "tugure-git-intern/audit-test-app");
        assert!(!baru, "repo lama bukan repo baru");
        let panggilan = catatan.borrow();
        assert_eq!(panggilan.len(), 1, "cukup satu permintaan: {panggilan:?}");
        assert_eq!(
            panggilan[0].0, "GET",
            "harus GET cek keberadaan: {panggilan:?}"
        );
        assert_eq!(panggilan[0].1, "/repos/tugure-git-intern/audit-test-app");
        assert!(
            !panggilan.iter().any(|(m, _)| m == "POST"),
            "POST /user/repos tidak boleh dikirim kalau repo sudah ada: {panggilan:?}"
        );
    }

    #[test]
    fn repo_belum_ada_baru_dibuat_lewat_post() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (404, r#"{"message":"Not Found"}"#),
                (201, r#"{"full_name":"tugure-git-intern/app-baru"}"#),
            ],
        );

        let (full, baru) = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru")
            .expect("repo baru harus dibuat");

        assert_eq!(full, "tugure-git-intern/app-baru");
        assert!(baru, "201 berarti repo memang baru");
        let panggilan = catatan.borrow();
        assert_eq!(
            panggilan.as_slice(),
            &[
                (
                    "GET".to_string(),
                    "/repos/tugure-git-intern/app-baru".to_string()
                ),
                ("POST".to_string(), "/user/repos".to_string()),
            ],
            "urutan cek lalu buat"
        );
    }

    #[test]
    fn post_422_berarti_repo_sudah_ada() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (404, r#"{"message":"Not Found"}"#),
                (422, r#"{"message":"Repository creation failed."}"#),
            ],
        );

        let (_, baru) = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-lama")
            .expect("422 = repo sudah ada, bukan kegagalan");

        assert!(!baru);
    }

    #[test]
    fn get_403_tetap_dicoba_post() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (
                    403,
                    r#"{"message":"Resource not accessible by integration"}"#,
                ),
                (201, r#"{"full_name":"tugure-git-intern/app-baru"}"#),
            ],
        );

        let (_, baru) = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru")
            .expect("cek yang tidak bisa dibaca tidak boleh memblokir pembuatan");

        assert!(baru);
        assert!(catatan.borrow().iter().any(|(m, _)| m == "POST"));
    }

    #[test]
    fn error_403_secondary_rate_limit_tidak_disebut_masalah_izin() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (404, r#"{"message":"Not Found"}"#),
                (
                    403,
                    r#"{"message":"You have exceeded a secondary rate limit and have been temporarily blocked from content creation."}"#,
                ),
            ],
        );

        let err = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru")
            .expect_err("403 harus jadi error");

        assert!(
            err.contains("secondary rate limit"),
            "penyebab aslinya harus disebut: {err}"
        );
        assert!(
            !err.contains("Administration"),
            "pesan izin token salah untuk pembatasan sementara: {err}"
        );
    }

    #[test]
    fn error_403_izin_tetap_menyebut_permission_administration() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (404, r#"{"message":"Not Found"}"#),
                (
                    403,
                    r#"{"message":"Resource not accessible by personal access token"}"#,
                ),
            ],
        );

        let err = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru")
            .expect_err("403 harus jadi error");

        assert!(
            err.contains("Administration"),
            "pesan lama tetap dipakai: {err}"
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
