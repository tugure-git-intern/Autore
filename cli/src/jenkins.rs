use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JenkinsConfig {
    pub url: String,
    pub user: String,
    pub token: String,
}

pub fn default_config_path() -> PathBuf {
    let base = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(".config").join("autore").join("jenkins.conf")
}

pub fn normalize_jenkins_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("URL Jenkins harus diawali http:// atau https://".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn save_config_to(path: &Path, cfg: &JenkinsConfig) -> Result<(), String> {
    let url = normalize_jenkins_url(&cfg.url)?;
    if cfg.user.trim().is_empty() || cfg.token.trim().is_empty() {
        return Err("Username dan token/password Jenkins tidak boleh kosong".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Gagal membuat folder konfigurasi {}: {e}", parent.display()))?;
    }
    let body = format!(
        "url={}\nuser={}\ntoken={}\n",
        url,
        cfg.user.trim(),
        cfg.token.trim()
    );
    fs::write(path, body).map_err(|e| {
        format!(
            "Gagal menyimpan konfigurasi Jenkins ke {}: {e}",
            path.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn load_config_from(path: &Path) -> Option<JenkinsConfig> {
    let text = fs::read_to_string(path).ok()?;
    let mut url = String::new();
    let mut user = String::new();
    let mut token = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            match k.trim() {
                "url" => url = v.trim().to_string(),
                "user" => user = v.trim().to_string(),
                "token" => token = v.trim().to_string(),
                _ => {}
            }
        }
    }
    let normalized = normalize_jenkins_url(&url).ok()?;
    if user.is_empty() || token.is_empty() {
        return None;
    }
    Some(JenkinsConfig {
        url: normalized,
        user,
        token,
    })
}

pub fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn render_pipeline_job_xml(git_url: &str, branch: &str) -> String {
    let safe_url = xml_escape(git_url.trim());
    let safe_branch = xml_escape(branch.trim().trim_start_matches("*/"));
    format!(
        r#"<?xml version="1.1" encoding="UTF-8"?>
<flow-definition plugin="workflow-job">
  <description>Autore DevSecOps CI/CD Pipeline ({safe_url})</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <jenkins.model.BuildDiscarderProperty>
      <strategy class="hudson.tasks.LogRotator">
        <daysToKeep>-1</daysToKeep>
        <numToKeep>30</numToKeep>
        <artifactDaysToKeep>-1</artifactDaysToKeep>
        <artifactNumToKeep>-1</artifactNumToKeep>
        <removeLastBuild>false</removeLastBuild>
      </strategy>
    </jenkins.model.BuildDiscarderProperty>
    <org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty>
      <abortPrevious>false</abortPrevious>
    </org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty>
    <org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
      <triggers>
        <hudson.triggers.SCMTrigger>
          <spec>H/5 * * * *</spec>
          <ignorePostCommitHooks>false</ignorePostCommitHooks>
        </hudson.triggers.SCMTrigger>
      </triggers>
    </org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>{safe_url}</url>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>*/{safe_branch}</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
      <submoduleCfg class="empty-list"/>
      <extensions/>
    </scm>
    <scriptPath>Jenkinsfile</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <disabled>false</disabled>
</flow-definition>
"#
    )
}

pub fn infer_project_job_name(project_dir: &Path) -> String {
    let jf = project_dir.join("Jenkinsfile");
    if let Ok(content) = fs::read_to_string(&jf) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("appName:") {
                let cleaned = rest
                    .trim()
                    .trim_end_matches(',')
                    .trim()
                    .trim_matches('\'')
                    .trim_matches('"');
                if !cleaned.is_empty() {
                    return cleaned.to_string();
                }
            }
        }
    }
    project_dir
        .canonicalize()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .or_else(|| {
            project_dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "autore-app".to_string())
}

pub fn extract_crumb_pair(json: &str) -> Option<(String, String)> {
    let field = extract_json_string_field(json, "crumbRequestField")
        .unwrap_or_else(|| "Jenkins-Crumb".to_string());
    let crumb = extract_json_string_field(json, "crumb")?;
    Some((field, crumb))
}

fn extract_json_string_field(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let pos = json.find(&needle)?;
    let after = &json[pos + needle.len()..];
    let colon = after.find(':')?;
    let rest = after[colon + 1..].trim_start();
    let stripped = rest.strip_prefix('"')?;
    let end = stripped.find('"')?;
    Some(stripped[..end].to_string())
}

/// Hasil build terakhir sebuah job. `Ok(None)` = masih berjalan / belum ada build.
pub fn last_build_result(cfg: &JenkinsConfig, job_name: &str) -> Result<Option<String>, String> {
    let base = normalize_jenkins_url(&cfg.url)?;
    let url = format!("{base}/job/{job_name}/lastBuild/api/json?tree=number,result,building");
    let user_cfg = format!("user = \"{}:{}\"\n", cfg.user, cfg.token);
    let (code, body) = curl_with_stdin_config(
        &[
            "-sS",
            "--max-time",
            "15",
            "-w",
            "\n__HTTP_CODE__:%{http_code}",
            "--config",
            "-",
            &url,
        ],
        &user_cfg,
    )?;
    if code == 404 {
        // Jenkins membalas 404 untuk `lastBuild` selama build pertama belum mulai.
        // Bedakan "belum ada build" dari "job tidak ada".
        let job_url = format!("{base}/job/{job_name}/api/json?tree=name");
        let (jcode, _) = curl_with_stdin_config(
            &[
                "-sS",
                "--max-time",
                "15",
                "-w",
                "\n__HTTP_CODE__:%{http_code}",
                "--config",
                "-",
                &job_url,
            ],
            &user_cfg,
        )?;
        if jcode == 404 {
            return Err("job belum terdaftar di Jenkins".into());
        }
        return Ok(None);
    }
    if code >= 400 {
        return Err(format!("Jenkins membalas HTTP {code}"));
    }
    if body.contains("\"building\":true") || body.contains("\"number\":0") {
        return Ok(None);
    }
    Ok(Some(
        extract_json_string_field(&body, "result").unwrap_or_else(|| "UNKNOWN".to_string()),
    ))
}

pub fn read_git_remote_origin(project_dir: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(project_dir)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

/// Identitas commit dari sesi dashboard (audit trail). Bukan input browser: API
/// hanya meneruskan `name`/`email` milik akun GitHub yang login.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Author {
    pub nama: String,
    pub email: String,
}

const NAMA_AUTHOR_MAKS: usize = 100;

/// Pesan commit scaffold; identitasnya yang berbeda, isinya tidak.
const PESAN_COMMIT_SCAFFOLD: &str = "chore: setup project for Jenkins CI/CD via Autore";

/// Pesan commit saat `deploy`/`Jalankan Ulang` dijalankan tanpa perubahan file.
/// Dibedakan dari pesan scaffold supaya history aplikasi terbaca: kapan dibuat,
/// kapan diulang, dan oleh siapa.
pub fn pesan_commit_ulang(nama: &str) -> String {
    format!("chore(deploy): dijalankan ulang oleh {nama}")
}

/// Nilai tidak sah dibuang ke `None` (= identitas bot), bukan digagalkan: aplikasi
/// tetap harus jadi walau nama GitHub-nya aneh. Karakter kontrol dibuang karena
/// nilai ini ditulis ke `.git/config`.
pub fn validasi_author(nama: Option<&str>, email: Option<&str>) -> Option<Author> {
    let bersih = |teks: Option<&str>| -> String {
        teks.unwrap_or("")
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect::<String>()
            .trim()
            .to_string()
    };
    let nama = bersih(nama);
    let email = bersih(email);
    if nama.is_empty() || !email_polos(&email) {
        return None;
    }
    Some(Author {
        nama: nama.chars().take(NAMA_AUTHOR_MAKS).collect(),
        email,
    })
}

/// Cermin `EMAIL_POLOS` di `web/apps/api/src/session.ts`: satu `@`, tanpa spasi
/// atau kurung sudut, panjang wajar.
fn email_polos(email: &str) -> bool {
    match email.split_once('@') {
        Some((user, domain)) => {
            !user.is_empty()
                && !domain.is_empty()
                && !domain.contains('@')
                && user.len() <= 64
                && domain.len() <= 190
                && !email.chars().any(|c| c.is_whitespace() || c == '<' || c == '>')
        }
        None => false,
    }
}

pub fn ensure_git_committed_and_remote(
    project_dir: &Path,
    remote_url: &str,
    author: Option<&Author>,
) -> Result<(), String> {
    if !project_dir.join(".git").exists() {
        let st = Command::new("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(project_dir)
            .status()
            .map_err(|e| format!("Gagal menjalankan git init: {e}"))?;
        if !st.success() {
            return Err("git init gagal dijalankan".to_string());
        }
    }
    let _ = Command::new("git")
        .args(["branch", "-M", "main"])
        .current_dir(project_dir)
        .status();

    let status_out = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(project_dir)
        .output()
        .map_err(|e| format!("Gagal mengecek status git: {e}"))?;
    let has_head = Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(project_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !has_head || !status_out.stdout.is_empty() {
        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(project_dir)
            .status();
        // Identitas dulu, commit kemudian: config lokal folder aplikasi ditulis
        // supaya siapa pembuatnya tetap terbaca setelah ini (dashboard membaca
        // config ini, bukan `-c` yang cuma berlaku sekali jalan).
        if let Some(a) = author {
            for (kunci, nilai) in [
                ("user.name", a.nama.as_str()),
                ("user.email", a.email.as_str()),
            ] {
                let st = Command::new("git")
                    .args(["config", kunci, nilai])
                    .current_dir(project_dir)
                    .status()
                    .map_err(|e| format!("Gagal menjalankan git config {kunci}: {e}"))?;
                if !st.success() {
                    return Err(format!("git config {kunci} gagal dijalankan"));
                }
            }
        }
        let mut cmd = Command::new("git");
        if author.is_none() {
            // Tanpa sesi (CLI dipanggil langsung): identitas bot seperti sebelumnya.
            cmd.args([
                "-c",
                "user.name=Autore CLI",
                "-c",
                "user.email=autore@tugu-re.com",
            ]);
        }
        let _ = cmd
            .args([
                "commit",
                "-q",
                "--no-verify",
                "-m",
                PESAN_COMMIT_SCAFFOLD,
            ])
            .current_dir(project_dir)
            .status();
    } else if let Some(a) = author {
        // Repo sudah bersih, tapi "Jalankan Ulang" tetap harus meninggalkan jejak.
        // Dulu cabang ini cuma `git branch -M main` + push, jadi tidak ada satu pun
        // record siapa yang menekan tombol — Jenkins hanya bisa menampilkan commit
        // lama. Commit kosong atas nama penekan tombol menaruh jejaknya di history.
        // Identitas dipasang per-commit (`-c`), bukan `git config`: config lokal
        // adalah PEMBUAT aplikasi dan tidak boleh ditimpa oleh yang mengulang.
        let _ = Command::new("git")
            .args([
                "-c",
                &format!("user.name={}", a.nama),
                "-c",
                &format!("user.email={}", a.email),
                "commit",
                "-q",
                "--allow-empty",
                "--no-verify",
                "-m",
                &pesan_commit_ulang(&a.nama),
            ])
            .current_dir(project_dir)
            .status();
    }

    let trimmed = remote_url.trim();
    if !trimmed.is_empty() {
        if read_git_remote_origin(project_dir).is_some() {
            let _ = Command::new("git")
                .args(["remote", "set-url", "origin", trimmed])
                .current_dir(project_dir)
                .status();
        } else {
            let _ = Command::new("git")
                .args(["remote", "add", "origin", trimmed])
                .current_dir(project_dir)
                .status();
        }
    }
    Ok(())
}

/// GET/POST ke Jenkins lewat curl dengan kredensial dari stdin (tidak pernah di
/// argv, jadi tidak muncul di `ps`). Dipakai juga oleh `runs` untuk daftar build.
pub(crate) fn curl_with_stdin_config(
    args: &[&str],
    config_stdin: &str,
) -> Result<(u16, String), String> {
    let mut child = Command::new("curl")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Gagal menjalankan curl: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(config_stdin.as_bytes());
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("Gagal membaca hasil curl: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("Koneksi ke Jenkins gagal: {err}"));
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if let Some((body, code_str)) = text.rsplit_once("\n__HTTP_CODE__:") {
        let code = code_str.trim().parse::<u16>().unwrap_or(0);
        Ok((code, body.to_string()))
    } else {
        Ok((200, text))
    }
}

pub fn register_and_trigger_jenkins(
    cfg: &JenkinsConfig,
    job_name: &str,
    git_url: &str,
    branch: &str,
) -> Result<String, String> {
    let base = normalize_jenkins_url(&cfg.url)?;
    let tmp_dir = std::env::temp_dir().join(format!("autore-jk-{}", std::process::id()));
    fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Gagal menyiapkan direktori sementara: {e}"))?;
    let cookie_jar = tmp_dir.join("cookies.txt");
    let xml_file = tmp_dir.join("config.xml");

    let xml = render_pipeline_job_xml(git_url, branch);
    fs::write(&xml_file, &xml)
        .map_err(|e| format!("Gagal menulis XML konfigurasi Jenkins: {e}"))?;

    let result = (|| -> Result<String, String> {
        let user_cfg = format!("user = \"{}:{}\"\n", cfg.user, cfg.token);
        let jar_str = cookie_jar.to_string_lossy().to_string();
        let xml_str = xml_file.to_string_lossy().to_string();

        // 1. Ambil Crumb CSRF (opsional bila CSRF dimatikan)
        let crumb_url = format!("{base}/crumbIssuer/api/json");
        let (crumb_code, crumb_body) = curl_with_stdin_config(
            &[
                "-sS",
                "--max-time",
                "15",
                "-c",
                &jar_str,
                "-w",
                "\n__HTTP_CODE__:%{http_code}",
                "--config",
                "-",
                &crumb_url,
            ],
            &user_cfg,
        )?;
        if crumb_code == 401 || crumb_code == 403 {
            return Err(
                "Autentikasi Jenkins ditolak (HTTP 401/403). Periksa username/password."
                    .to_string(),
            );
        }
        let crumb_header = if crumb_code == 200 {
            extract_crumb_pair(&crumb_body).map(|(k, v)| format!("{k}: {v}"))
        } else {
            None
        };

        // 2. Cek apakah job sudah ada
        let check_url = format!("{base}/job/{job_name}/api/json");
        let (check_code, _) = curl_with_stdin_config(
            &[
                "-sS",
                "--max-time",
                "15",
                "-b",
                &jar_str,
                "-w",
                "\n__HTTP_CODE__:%{http_code}",
                "--config",
                "-",
                &check_url,
            ],
            &user_cfg,
        )?;

        let post_url = if check_code == 200 {
            format!("{base}/job/{job_name}/config.xml")
        } else {
            format!("{base}/createItem?name={job_name}")
        };

        let mut post_args = vec![
            "-sS",
            "--max-time",
            "20",
            "-b",
            &jar_str,
            "-X",
            "POST",
            "-H",
            "Content-Type: application/xml; charset=UTF-8",
            "--data-binary",
        ];
        let data_arg = format!("@{xml_str}");
        post_args.push(&data_arg);
        if let Some(ref h) = crumb_header {
            post_args.push("-H");
            post_args.push(h);
        }
        post_args.extend_from_slice(&[
            "-w",
            "\n__HTTP_CODE__:%{http_code}",
            "--config",
            "-",
            &post_url,
        ]);

        let (save_code, save_body) = curl_with_stdin_config(&post_args, &user_cfg)?;
        if save_code >= 400 {
            return Err(format!(
                "Gagal mendaftarkan job '{job_name}' di Jenkins (HTTP {save_code}): {}",
                save_body.lines().next().unwrap_or("")
            ));
        }

        // 3. Trigger Build Now
        let build_url = format!("{base}/job/{job_name}/build");
        let mut build_args = vec!["-sS", "--max-time", "15", "-b", &jar_str, "-X", "POST"];
        if let Some(ref h) = crumb_header {
            build_args.push("-H");
            build_args.push(h);
        }
        build_args.extend_from_slice(&[
            "-w",
            "\n__HTTP_CODE__:%{http_code}",
            "--config",
            "-",
            &build_url,
        ]);

        let (b_code, _) = curl_with_stdin_config(&build_args, &user_cfg)?;
        if b_code >= 400 && b_code != 409 {
            return Err(format!(
                "Job '{job_name}' terdaftar, tetapi gagal memicu build otomatis (HTTP {b_code})"
            ));
        }

        Ok(format!("{base}/job/{job_name}/"))
    })();

    let _ = fs::remove_dir_all(&tmp_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Output git di folder uji (tanpa shell, argumen array).
    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git harus ada di mesin uji");
        assert!(out.status.success(), "git {args:?} gagal");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn repo_uji(nama: &str) -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().join(nama);
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("app.py"), "print('hai')\n").unwrap();
        (tmp, repo)
    }

    #[test]
    fn author_dari_dashboard_dipakai_di_commit() {
        let (_tmp, repo) = repo_uji("audit-uji");
        let author = validasi_author(Some("Alif Fadlan"), Some("alif@example.com")).unwrap();

        ensure_git_committed_and_remote(&repo, "", Some(&author)).unwrap();

        assert_eq!(
            git(&repo, &["log", "-1", "--format=%an <%ae>"]),
            "Alif Fadlan <alif@example.com>"
        );
        // Config lokal ditulis supaya dashboard bisa membaca pembuatnya tanpa GitHub API.
        assert_eq!(git(&repo, &["config", "--get", "user.name"]), "Alif Fadlan");
        assert_eq!(git(&repo, &["config", "--get", "user.email"]), "alif@example.com");
    }

    #[test]
    fn tanpa_author_identitas_bot_tetap_dipakai() {
        let (_tmp, repo) = repo_uji("tanpa-author");

        ensure_git_committed_and_remote(&repo, "", None).unwrap();

        assert_eq!(
            git(&repo, &["log", "-1", "--format=%an <%ae>"]),
            "Autore CLI <autore@tugu-re.com>"
        );
        // Config LOKAL tidak ditulis: identitas bot dipasang per-commit (`-c`),
        // jadi config global user tidak pernah tertimpa.
        assert!(!git(&repo, &["config", "--local", "--list"]).contains("user.name"));
    }

    #[test]
    fn rerun_repo_bersih_dengan_author_bikin_commit_kosong() {
        let (_tmp, repo) = repo_uji("ulang-author");
        let pembuat = validasi_author(Some("Pembuat"), Some("pembuat@example.com")).unwrap();
        ensure_git_committed_and_remote(&repo, "", Some(&pembuat)).unwrap();

        let pengulang = validasi_author(Some("Alif Fadlan"), Some("alif@example.com")).unwrap();
        ensure_git_committed_and_remote(&repo, "", Some(&pengulang)).unwrap();

        assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
        assert_eq!(
            git(&repo, &["log", "-1", "--format=%an <%ae>"]),
            "Alif Fadlan <alif@example.com>"
        );
        assert_eq!(
            git(&repo, &["log", "-1", "--format=%s"]),
            "chore(deploy): dijalankan ulang oleh Alif Fadlan"
        );
        // Yang menempel di folder tetap PEMBUATNYA, bukan yang terakhir klik.
        assert_eq!(git(&repo, &["config", "--get", "user.name"]), "Pembuat");
    }

    #[test]
    fn rerun_repo_bersih_tanpa_author_tidak_bikin_commit() {
        let (_tmp, repo) = repo_uji("ulang-tanpa-author");
        ensure_git_committed_and_remote(&repo, "", None).unwrap();
        assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "1");

        ensure_git_committed_and_remote(&repo, "", None).unwrap();

        // CLI dipanggil langsung (tanpa sesi dashboard): perilaku lama tidak berubah.
        assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "1");
    }

    #[test]
    fn rerun_repo_kotor_tetap_satu_commit_scaffold() {
        let (_tmp, repo) = repo_uji("ulang-kotor");
        let author = validasi_author(Some("Alif Fadlan"), Some("alif@example.com")).unwrap();
        ensure_git_committed_and_remote(&repo, "", Some(&author)).unwrap();

        fs::write(repo.join("app.py"), "print('berubah')\n").unwrap();
        ensure_git_committed_and_remote(&repo, "", Some(&author)).unwrap();

        assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
        assert_eq!(git(&repo, &["log", "-1", "--format=%s"]), PESAN_COMMIT_SCAFFOLD);
    }

    #[test]
    fn author_kotor_dibuang_bukan_digagalkan() {
        let kotor = validasi_author(Some("Alif\n[user]\nevil = 1"), Some("alif@example.com")).unwrap();
        assert_eq!(kotor.nama, "Alif [user] evil = 1");

        // Email tidak sah atau nama kosong = jatuh ke identitas bot, bukan error.
        assert!(validasi_author(Some("Alif"), Some("bukan-email")).is_none());
        assert!(validasi_author(Some("Alif"), Some("a@b c")).is_none());
        assert!(validasi_author(Some("Alif"), Some("a@@b.com")).is_none());
        assert!(validasi_author(None, Some("alif@example.com")).is_none());
        assert!(validasi_author(Some(""), Some("")).is_none());
    }

    #[test]
    fn nama_author_kepanjangan_dipotong() {
        let panjang = "x".repeat(300);
        let author = validasi_author(Some(&panjang), Some("alif@example.com")).unwrap();

        assert_eq!(author.nama.chars().count(), 100);
    }

    #[test]
    fn saves_and_loads_jenkins_config_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let conf_path = tmp.path().join("autore/jenkins.conf");
        let cfg = JenkinsConfig {
            url: "http://127.0.0.1:8080/".to_string(),
            user: "admin".to_string(),
            token: "tok-123".to_string(),
        };
        save_config_to(&conf_path, &cfg).unwrap();
        let loaded = load_config_from(&conf_path).unwrap();
        assert_eq!(loaded.url, "http://127.0.0.1:8080");
        assert_eq!(loaded.user, "admin");
        assert_eq!(loaded.token, "tok-123");

        assert!(normalize_jenkins_url("ftp://bad").is_err());
        assert!(save_config_to(
            &conf_path,
            &JenkinsConfig {
                url: "http://127.0.0.1:8080".to_string(),
                user: "".to_string(),
                token: "x".to_string(),
            }
        )
        .is_err());
    }

    #[test]
    fn renders_valid_pipeline_xml_and_escapes_special_chars() {
        let xml = render_pipeline_job_xml(
            "https://github.com/tugure-git-intern/klaim-api.git?a=1&b=2",
            "*/main",
        );
        assert!(xml.contains("https://github.com/tugure-git-intern/klaim-api.git?a=1&amp;b=2"));
        assert!(xml.contains("<name>*/main</name>"));
        assert!(xml.contains("<scriptPath>Jenkinsfile</scriptPath>"));
    }

    #[test]
    fn infers_job_name_from_jenkinsfile_or_directory() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("folder-fallback");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(infer_project_job_name(&dir), "folder-fallback");

        fs::write(
            dir.join("Jenkinsfile"),
            "@Library('autore') _\nautorePipeline(\n    appName: 'klaim-service',\n    appPort: 8000\n)\n",
        )
        .unwrap();
        assert_eq!(infer_project_job_name(&dir), "klaim-service");
    }

    #[test]
    fn extracts_csrf_crumb_and_initializes_git_remote() {
        let json = r#"{"_class":"hudson.security.csrf.DefaultCrumbIssuer","crumb":"abc123xyz","crumbRequestField":"Jenkins-Crumb"}"#;
        assert_eq!(
            extract_crumb_pair(json),
            Some(("Jenkins-Crumb".to_string(), "abc123xyz".to_string()))
        );
        assert!(extract_crumb_pair("{}").is_none());

        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("README.md"), "# test\n").unwrap();
        ensure_git_committed_and_remote(
            tmp.path(),
            "https://github.com/tugure-git-intern/test-app.git",
            None,
        )
        .unwrap();
        assert_eq!(
            read_git_remote_origin(tmp.path()).as_deref(),
            Some("https://github.com/tugure-git-intern/test-app.git")
        );
        // Update remote URL when already present
        ensure_git_committed_and_remote(
            tmp.path(),
            "https://github.com/tugure-git-intern/test-app-v2.git",
            None,
        )
        .unwrap();
        assert_eq!(
            read_git_remote_origin(tmp.path()).as_deref(),
            Some("https://github.com/tugure-git-intern/test-app-v2.git")
        );
        assert!(default_config_path().ends_with("jenkins.conf"));
    }

    #[test]
    fn registers_and_triggers_against_local_http_mock() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            for i in 0..4 {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf);
                    let resp = match i {
                        0 => "HTTP/1.1 200 OK\r\nContent-Length: 62\r\n\r\n{\"crumb\":\"c123\",\"crumbRequestField\":\"Jenkins-Crumb\"}          ",
                        1 => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n",
                        2 => "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK",
                        _ => "HTTP/1.1 201 Created\r\nContent-Length: 0\r\n\r\n",
                    };
                    let _ = stream.write_all(resp.as_bytes());
                }
            }
        });

        let cfg = JenkinsConfig {
            url: format!("http://{addr}"),
            user: "admin".to_string(),
            token: "tok".to_string(),
        };
        let job_url = register_and_trigger_jenkins(
            &cfg,
            "klaim-api",
            "https://github.com/tugure-git-intern/klaim-api.git",
            "main",
        )
        .unwrap();
        assert_eq!(job_url, format!("http://{addr}/job/klaim-api/"));
        let _ = handle.join();
    }
}
