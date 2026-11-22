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

/// Pengirim request HTTP yang bisa disuntik: (token, method, path, body) ->
/// (status, body). Alias ini juga yang membuat clippy tidak mengeluh soal tipe
/// fungsi yang panjang.
type KirimHttp<'a> = &'a dyn Fn(&str, &str, &str, Option<&str>) -> Result<(u16, String), String>;

/// Pastikan repo `owner/name` ada di GitHub. `true` = baru dibuat.
/// Jalur `ensure_repo` dengan lapisan HTTP disuntik, supaya tes bisa membuktikan
/// permintaan apa saja yang benar-benar dikirim tanpa menyentuh jaringan.
pub fn ensure_repo(
    token: &str,
    owner: &str,
    name: &str,
    org: Option<&str>,
) -> Result<(String, bool), String> {
    ensure_repo_dengan(&curl_api, token, owner, name, org)
}

fn ensure_repo_dengan(
    kirim: KirimHttp<'_>,
    token: &str,
    owner: &str,
    name: &str,
    org: Option<&str>,
) -> Result<(String, bool), String> {
    // Repo organisasi lahir di `/orgs/{org}/repos`; `owner` (akun pemilik token)
    // hanya dipakai bila tidak ada org, supaya `full` selalu pemilik sebenarnya.
    let pemilik = org.unwrap_or(owner);
    let full = format!("{pemilik}/{name}");

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
    let endpoint = match org {
        Some(o) => format!("/orgs/{o}/repos"),
        None => "/user/repos".to_string(),
    };
    let (code, body) = kirim(token, "POST", &endpoint, Some(&payload))?;
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

/// Branch default repo (`main`, `master`, ...). Dibaca dari GitHub, bukan ditebak:
/// repo buatan dev bisa memakai nama apa pun.
pub fn default_branch(token: &str, full: &str) -> Result<String, String> {
    default_branch_dengan(&curl_api, token, full)
}

fn default_branch_dengan(kirim: KirimHttp<'_>, token: &str, full: &str) -> Result<String, String> {
    let (code, body) = kirim(token, "GET", &format!("/repos/{full}"), None)?;
    match code {
        200 => extract_json_string(&body, "default_branch")
            .ok_or_else(|| format!("Respons GitHub untuk {full} tidak memuat default_branch.")),
        401 => Err("Token GitHub ditolak (HTTP 401). Periksa token-nya.".into()),
        404 => Err(format!("Repo {full} tidak ditemukan (HTTP 404).")),
        _ => Err(format!("Gagal membaca repo {full} (HTTP {code}).")),
    }
}

/// Tipe pemilik repo: `User` atau `Organization`. Dipakai memutuskan mode kunci.
pub fn tipe_pemilik(token: &str, login: &str) -> Result<String, String> {
    tipe_pemilik_dengan(&curl_api, token, login)
}

fn tipe_pemilik_dengan(kirim: KirimHttp<'_>, token: &str, login: &str) -> Result<String, String> {
    let (code, body) = kirim(token, "GET", &format!("/users/{login}"), None)?;
    match code {
        200 => extract_json_string(&body, "type")
            .ok_or_else(|| format!("Respons GitHub untuk {login} tidak memuat type.")),
        404 => Err(format!("Akun GitHub '{login}' tidak ditemukan (HTTP 404).")),
        _ => Err(format!("Gagal membaca akun {login} (HTTP {code}).")),
    }
}

/// Jumlah kolaborator repo. `None` = tidak diketahui (token tanpa izin baca
/// kolaborator); pemanggil harus memperlakukan ini sebagai "tidak dihitung",
/// bukan sebagai satu orang.
pub fn jumlah_kolaborator(token: &str, full: &str) -> Result<Option<usize>, String> {
    jumlah_kolaborator_dengan(&curl_api, token, full)
}

fn jumlah_kolaborator_dengan(
    kirim: KirimHttp<'_>,
    token: &str,
    full: &str,
) -> Result<Option<usize>, String> {
    let (code, body) = kirim(
        token,
        "GET",
        &format!("/repos/{full}/collaborators?per_page=100"),
        None,
    )?;
    match code {
        200 => Ok(Some(body.matches("\"login\"").count())),
        403 => Ok(None),
        404 => Err(format!("Repo {full} tidak ditemukan (HTTP 404).")),
        _ => Err(format!("Gagal membaca kolaborator {full} (HTTP {code}).")),
    }
}

/// Hasil memasang kunci branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusKunci {
    /// Belum pernah dikunci; setelan baru dipasang.
    BaruDikunci,
    /// Sudah terkunci dengan setelan yang sama atau lebih ketat.
    SudahTerkunci,
    /// Sudah terkunci lebih longgar; dinaikkan ke mode yang diminta.
    Diperketat,
}

/// Pasang branch protection. Tidak pernah melonggarkan kunci yang sudah ada:
/// repo yang sudah mewajibkan PR tetap penuh walau pemanggil minta mode ringan.
pub fn protect_branch(
    token: &str,
    full: &str,
    branch: &str,
    ringan: bool,
    review_wajib: u8,
) -> Result<StatusKunci, String> {
    protect_branch_dengan(&curl_api, token, full, branch, ringan, review_wajib)
}

fn protect_branch_dengan(
    kirim: KirimHttp<'_>,
    token: &str,
    full: &str,
    branch: &str,
    ringan: bool,
    review_wajib: u8,
) -> Result<StatusKunci, String> {
    let path = format!("/repos/{full}/branches/{branch}/protection");
    let (code, lama) = kirim(token, "GET", &path, None)?;
    let (ringan, status) = match code {
        200 => {
            let sudah_wajib_pr = lama.contains("\"required_pull_request_reviews\":{");
            // Sudah penuh, atau sudah ringan dan yang diminta ringan: tidak ada
            // yang perlu dipasang ulang. Kunci yang sudah ada tidak pernah
            // dilonggarkan, jadi permintaan ringan pada repo penuh juga berhenti.
            if sudah_wajib_pr || ringan {
                return Ok(StatusKunci::SudahTerkunci);
            }
            (false, StatusKunci::Diperketat)
        }
        404 => (ringan, StatusKunci::BaruDikunci),
        401 => return Err("Token GitHub ditolak (HTTP 401). Periksa token-nya.".into()),
        // 403 dan lainnya: biarkan PUT yang melaporkan penyebab sebenarnya.
        _ => (ringan, StatusKunci::BaruDikunci),
    };
    let payload = payload_kunci(ringan, review_wajib);
    let (code, jawab) = kirim(token, "PUT", &path, Some(&payload))?;
    let pesan = extract_json_string(&jawab, "message").unwrap_or_default();
    match code {
        200 => Ok(status),
        401 => Err("Token GitHub ditolak (HTTP 401). Periksa token-nya.".into()),
        403 => Err(format!(
            "Token GitHub tidak punya hak admin di {full} (HTTP 403). Branch protection butuh izin admin repo. Pesan GitHub: {pesan}"
        )),
        404 => Err(format!(
            "Branch '{branch}' belum ada di {full} (HTTP 404). Push dulu, lalu ulangi."
        )),
        _ => Err(format!("Gagal mengunci {full}@{branch} (HTTP {code}) {pesan}")),
    }
}

/// Payload `PUT /branches/{branch}/protection`. Mode ringan = hanya larangan
/// force-push/hapus; mode penuh menambah PR wajib + review.
fn payload_kunci(ringan: bool, review_wajib: u8) -> String {
    let ulasan = if ringan {
        "null".to_string()
    } else {
        format!(
            "{{\"dismiss_stale_reviews\":true,\"require_code_owner_reviews\":false,\"required_approving_review_count\":{review_wajib}}}"
        )
    };
    format!(
        "{{\"required_status_checks\":null,\"enforce_admins\":true,\"required_pull_request_reviews\":{ulasan},\"restrictions\":null,\"allow_force_pushes\":false,\"allow_deletions\":false,\"required_conversation_resolution\":true}}"
    )
}

/// Nyalakan secret scanning + push protection. Repo publik: cukup `PATCH /repos`.
/// Repo privat butuh GitHub Advanced Security; 422/403 dicatat sebagai pesan
/// (bukan kegagalan alur) karena kunci branch tetap jalan tanpanya.
pub fn aktifkan_secret_scanning(token: &str, full: &str) -> Result<String, String> {
    aktifkan_secret_scanning_dengan(&curl_api, token, full)
}

fn aktifkan_secret_scanning_dengan(
    kirim: KirimHttp<'_>,
    token: &str,
    full: &str,
) -> Result<String, String> {
    let payload = "{\"security_and_analysis\":{\"secret_scanning\":{\"status\":\"enabled\"},\"secret_scanning_push_protection\":{\"status\":\"enabled\"}}}";
    let (code, body) = kirim(token, "PATCH", &format!("/repos/{full}"), Some(payload))?;
    match code {
        200 => Ok("secret scanning + push protection aktif".into()),
        403 => Ok("secret scanning dilewati: token tidak punya izin admin repo".into()),
        422 => Ok("secret scanning dilewati: repo privat butuh GitHub Advanced Security".into()),
        401 => Err("Token GitHub ditolak (HTTP 401). Periksa token-nya.".into()),
        _ => {
            let pesan = extract_json_string(&body, "message").unwrap_or_default();
            Err(format!(
                "Gagal menyalakan secret scanning di {full} (HTTP {code}) {pesan}"
            ))
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
            ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "audit-test-app", None)
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

        let (full, baru) =
            ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru", None)
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

        let (_, baru) = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-lama", None)
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

        let (_, baru) = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru", None)
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

        let err = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru", None)
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

        let err = ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru", None)
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

    #[test]
    fn org_membuat_repo_di_endpoint_org_dan_full_name_memakai_org() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (404, r#"{"message":"Not Found"}"#),
                (201, r#"{"full_name":"tugure-reasuransi/uji-org"}"#),
            ],
        );

        let (full, baru) = ensure_repo_dengan(
            &kirim,
            "token",
            "tugure-git-intern",
            "uji-org",
            Some("tugure-reasuransi"),
        )
        .expect("org harus bisa membuat repo");

        assert_eq!(full, "tugure-reasuransi/uji-org");
        assert!(baru);
        assert_eq!(
            *catatan.borrow(),
            vec![
                (
                    "GET".to_string(),
                    "/repos/tugure-reasuransi/uji-org".to_string()
                ),
                (
                    "POST".to_string(),
                    "/orgs/tugure-reasuransi/repos".to_string()
                ),
            ]
        );
    }

    #[test]
    fn tanpa_org_tetap_memakai_user_repos_dan_owner_token() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (404, r#"{"message":"Not Found"}"#),
                (201, r#"{"full_name":"tugure-git-intern/app-baru"}"#),
            ],
        );

        let (full, baru) =
            ensure_repo_dengan(&kirim, "token", "tugure-git-intern", "app-baru", None)
                .expect("tanpa org tetap jalan");

        assert_eq!(full, "tugure-git-intern/app-baru");
        assert!(baru);
        assert_eq!(
            catatan.borrow()[1],
            ("POST".to_string(), "/user/repos".to_string())
        );
    }

    /// Rekaman yang juga menyimpan body, untuk memeriksa payload PUT protection.
    fn kirim_rekaman_body<'a>(
        catatan: &'a std::cell::RefCell<Vec<(String, String, String)>>,
        jawaban: Vec<(u16, &'static str)>,
    ) -> impl Fn(&str, &str, &str, Option<&str>) -> Result<(u16, String), String> + 'a {
        let urut = std::cell::Cell::new(0usize);
        move |_token, method, path, body| {
            catatan.borrow_mut().push((
                method.to_string(),
                path.to_string(),
                body.unwrap_or("").to_string(),
            ));
            let (code, isi) = jawaban
                .get(urut.get())
                .copied()
                .unwrap_or((500, "{\"message\":\"tak terduga\"}"));
            urut.set(urut.get() + 1);
            Ok((code, isi.to_string()))
        }
    }

    #[test]
    fn branch_default_dibaca_dari_github() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![(200, r#"{"default_branch":"master","private":true}"#)],
        );

        assert_eq!(
            default_branch_dengan(&kirim, "token", "tugure-git-intern/app").unwrap(),
            "master"
        );
        assert_eq!(
            catatan.borrow()[0],
            (
                "GET".to_string(),
                "/repos/tugure-git-intern/app".to_string()
            )
        );
    }

    #[test]
    fn protection_pertama_kali_memasang_kunci_penuh() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman_body(
            &catatan,
            vec![
                (404, r#"{"message":"Branch not protected"}"#),
                (200, r#"{"url":"..."}"#),
            ],
        );

        let status =
            protect_branch_dengan(&kirim, "token", "tugure-git-intern/app", "main", false, 1)
                .unwrap();

        assert_eq!(status, StatusKunci::BaruDikunci);
        let rekam = catatan.borrow();
        assert_eq!(rekam[1].0, "PUT");
        assert_eq!(
            rekam[1].1,
            "/repos/tugure-git-intern/app/branches/main/protection"
        );
        assert!(rekam[1].2.contains("\"allow_force_pushes\":false"));
        assert!(rekam[1].2.contains("\"required_pull_request_reviews\":{"));
        assert!(rekam[1].2.contains("\"required_approving_review_count\":1"));
    }

    #[test]
    fn protection_sudah_terkunci_tidak_dipasang_ulang() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman_body(
            &catatan,
            vec![(
                200,
                r#"{"required_pull_request_reviews":{"required_approving_review_count":1}}"#,
            )],
        );

        let status =
            protect_branch_dengan(&kirim, "token", "tugure-git-intern/app", "main", false, 1)
                .unwrap();

        assert_eq!(status, StatusKunci::SudahTerkunci);
        assert_eq!(catatan.borrow().len(), 1, "tidak boleh ada PUT ulang");
    }

    #[test]
    fn mode_ringan_hanya_melarang_force_push_dan_hapus() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman_body(&catatan, vec![(404, "{}"), (200, "{}")]);

        let status =
            protect_branch_dengan(&kirim, "token", "pribadi/app", "main", true, 0).unwrap();

        assert_eq!(status, StatusKunci::BaruDikunci);
        let body = &catatan.borrow()[1].2;
        assert!(body.contains("\"required_pull_request_reviews\":null"));
        assert!(body.contains("\"allow_force_pushes\":false"));
        assert!(body.contains("\"allow_deletions\":false"));
    }

    #[test]
    fn kunci_tidak_pernah_dilonggarkan() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman_body(
            &catatan,
            vec![(
                200,
                r#"{"required_pull_request_reviews":{"required_approving_review_count":1}}"#,
            )],
        );

        let status = protect_branch_dengan(&kirim, "token", "kantor/app", "main", true, 1).unwrap();

        assert_eq!(status, StatusKunci::SudahTerkunci);
        assert_eq!(
            catatan.borrow().len(),
            1,
            "setelan penuh tidak boleh ditimpa"
        );
    }

    #[test]
    fn kunci_yang_lebih_longgar_dinaikkan_ke_penuh() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman_body(
            &catatan,
            vec![(200, r#"{"enforce_admins":{"enabled":true}}"#), (200, "{}")],
        );

        let status =
            protect_branch_dengan(&kirim, "token", "kantor/app", "main", false, 2).unwrap();

        assert_eq!(status, StatusKunci::Diperketat);
        let body = &catatan.borrow()[1].2;
        assert!(body.contains("\"required_approving_review_count\":2"));
    }

    #[test]
    fn kunci_403_menyebut_butuh_admin() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (404, "{}"),
                (
                    403,
                    r#"{"message":"Must have admin rights to Repository."}"#,
                ),
            ],
        );

        let err = protect_branch_dengan(&kirim, "token", "tugure-git-intern/app", "main", false, 1)
            .unwrap_err();

        assert!(err.contains("hak admin"));
    }

    #[test]
    fn kolaborator_403_dianggap_tidak_diketahui() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(&catatan, vec![(403, "{}")]);

        assert_eq!(
            jumlah_kolaborator_dengan(&kirim, "token", "tugure-git-intern/app").unwrap(),
            None
        );
    }

    #[test]
    fn kolaborator_200_menghitung_setiap_login() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![(200, r#"[{"login":"tugure-git-intern"},{"login":"dewi"}]"#)],
        );

        assert_eq!(
            jumlah_kolaborator_dengan(&kirim, "token", "tugure-git-intern/app").unwrap(),
            Some(2)
        );
        assert_eq!(
            catatan.borrow()[0].1,
            "/repos/tugure-git-intern/app/collaborators?per_page=100"
        );
    }

    #[test]
    fn tipe_pemilik_membedakan_organisasi_dari_user() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![
                (
                    200,
                    r#"{"login":"tugure-reasuransi","type":"Organization"}"#,
                ),
                (200, r#"{"login":"MAliffadlan","type":"User"}"#),
            ],
        );

        assert_eq!(
            tipe_pemilik_dengan(&kirim, "token", "tugure-reasuransi").unwrap(),
            "Organization"
        );
        assert_eq!(
            tipe_pemilik_dengan(&kirim, "token", "MAliffadlan").unwrap(),
            "User"
        );
    }

    #[test]
    fn secret_scanning_422_dicatat_bukan_digagalkan() {
        let catatan = std::cell::RefCell::new(Vec::new());
        let kirim = kirim_rekaman(
            &catatan,
            vec![(422, r#"{"message":"Advanced security is not enabled"}"#)],
        );

        let pesan = aktifkan_secret_scanning_dengan(&kirim, "token", "pribadi/app").unwrap();
        assert!(pesan.contains("Advanced Security"));
    }
}
