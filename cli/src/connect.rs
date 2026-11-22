//! Alur "sambungkan repo": repo GitHub yang sudah dibuat dev didaftarkan ke
//! Autore tanpa dev harus membuka terminal.

use std::path::{Path, PathBuf};
use std::process::Command;

use colored::Colorize;

use crate::templates::{ensure_missing_pipeline_files, InitConfig, TechStack};
use crate::{jenkins, progress, workspace};

const PREFIX: &str = "https://github.com/";

/// Repo GitHub yang sudah dinormalkan: tanpa `.git`, tanpa kredensial.
pub struct RepoRef {
    pub owner: String,
    pub name: String,
    pub url: String,
}

/// URL GitHub dinormalkan ke `https://github.com/<owner>/<repo>`. Bentuk pendek
/// `owner/repo` dan `github.com/owner/repo` diterima supaya sama dengan
/// `kunci-repo`; skema lain tetap ditolak. URL ini masuk ke argv `git clone`,
/// jadi ssh, `file://`, dan URL berkredensial tidak boleh lolos.
pub fn parse_repo_url(input: &str) -> Result<RepoRef, String> {
    let teks = input.trim();
    let penuh = if teks.starts_with(PREFIX) {
        teks.to_string()
    } else if let Some(sisa) = teks.strip_prefix("github.com/") {
        format!("{PREFIX}{sisa}")
    } else if !teks.contains("://") && teks.split('/').count() == 2 {
        format!("{PREFIX}{teks}")
    } else {
        return Err(
            "Repo harus berbentuk <owner>/<repo> atau https://github.com/<owner>/<repo>"
                .to_string(),
        );
    };
    let sisa = penuh
        .strip_prefix(PREFIX)
        .ok_or("URL repo harus berbentuk https://github.com/<owner>/<repo>")?;
    if sisa.contains(['@', ':', '?', '#']) {
        return Err("URL repo tidak boleh memuat kredensial, port, atau query".to_string());
    }
    let mut segmen = sisa.split('/');
    let owner = segmen.next().unwrap_or("");
    let nama_mentah = segmen.next().unwrap_or("");
    if segmen.next().is_some() {
        return Err("URL repo harus tepat dua segmen: <owner>/<repo>".to_string());
    }
    let name = nama_mentah.strip_suffix(".git").unwrap_or(nama_mentah);
    if !nama_sah(owner) || !nama_sah(name) {
        return Err("Owner atau nama repo tidak sah".to_string());
    }
    Ok(RepoRef {
        owner: owner.to_string(),
        name: name.to_string(),
        url: format!("{PREFIX}{owner}/{name}"),
    })
}

pub(crate) fn nama_sah(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Tebak stack dari berkas penanda di repo yang sudah di-clone, supaya dev
/// tidak perlu tahu istilah teknis saat mengisi form.
pub fn deteksi_stack(dir: &Path) -> Option<TechStack> {
    let ada = |nama: &str| dir.join(nama).is_file();
    if ada("go.mod") {
        Some(TechStack::Go)
    } else if ada("pom.xml") || ada("gradlew") {
        Some(TechStack::Java)
    } else if ada("package.json") {
        Some(TechStack::NodeJs)
    } else if ada("requirements.txt") || ada("pyproject.toml") || ada("app.py") || ada("main.py") {
        Some(TechStack::Python)
    } else {
        None
    }
}

/// Pilihan dari form dashboard / flag CLI. Tidak ada `Default`: setiap pemanggil
/// harus menyebut branch dan path secara sadar.
pub struct ConnectOpts {
    pub repo: String,
    pub path: PathBuf,
    pub app_name: Option<String>,
    pub stack: Option<String>,
    pub app_port: Option<u16>,
    pub deploy_port: Option<u16>,
    pub branch: String,
    /// `None` = putuskan dari `kebijakan.conf`.
    pub kunci: Option<crate::kebijakan::Mode>,
    /// `None` = pakai `review_wajib` dari kebijakan.
    pub wajib_review: Option<u8>,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub resume: bool,
}

/// Apakah folder ini (atau salah satu folder di atasnya) sebuah repo git.
/// Dipakai untuk menolak clone yang akan bersarang di dalam repo lain.
fn di_dalam_repo_git(dir: &Path) -> bool {
    dir.ancestors().any(|d| d.join(".git").exists())
}

/// Nama aplikasi yang dipakai Autore: dari `--app-name`, kalau tidak ada dari
/// nama repo. Divalidasi supaya aman dipakai sebagai nama folder/job Jenkins.
pub fn nama_aplikasi(opts: &ConnectOpts) -> Result<String, String> {
    let rr = parse_repo_url(&opts.repo)?;
    let nama = opts
        .app_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(&rr.name)
        .to_string();
    crate::templates::validate_app_name(&nama)?;
    Ok(nama)
}

fn gagal(pesan: &str) -> i32 {
    eprintln!("{} {pesan}", "ERROR:".red().bold());
    1
}

fn gagal_tahap(id: &str, pesan: &str) -> i32 {
    progress::tahap(id, "gagal", pesan);
    gagal(pesan)
}

/// Keluaran stdout git yang sukses. `None` kalau git tidak jalan atau gagal.
fn git_out(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// `--resume` hanya boleh dipakai kalau folder yang sudah ada memang checkout
/// repo dan branch yang diminta. Tanpa pemeriksaan ini, folder aplikasi lain
/// (atau repo lain dengan nama sama) akan di-commit dan di-push.
fn checkout_sesuai(target: &Path, repo_url: &str, branch: &str) -> bool {
    let remote = git_out(target, &["remote", "get-url", "origin"]);
    let remote_sah = remote
        .as_deref()
        .map(|url| url.trim_end_matches(".git") == repo_url)
        .unwrap_or(false);
    remote_sah && git_out(target, &["branch", "--show-current"]).as_deref() == Some(branch)
}

fn clone_repo(url: &str, dir: &Path, branch: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["clone", "--quiet", "--branch", branch, url])
        .arg(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Gagal menjalankan git clone: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    if stderr.contains("Remote branch") && stderr.contains("not found") {
        return Err(format!(
            "Branch '{branch}' tidak ada di {url}. Repo memakai branch default lain — ulangi dengan --branch <nama>."
        ));
    }
    Err(format!(
        "Repo {url} tidak bisa di-clone. Periksa repo-nya ada dan token GitHub di server punya akses ke sana."
    ))
}

/// Commit berkas pipeline di repo yang sudah di-clone. Sengaja tidak memakai
/// `jenkins::ensure_git_committed_and_remote`: fungsi itu me-rename branch ke
/// `main`, sedangkan repo dev boleh memakai branch apa pun.
fn commit_scaffold(dir: &Path, author: Option<&jenkins::Author>) -> Result<(), String> {
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Gagal mengecek status git: {e}"))?;
    if status.stdout.is_empty() {
        return Ok(());
    }
    let jalan = |args: &[&str]| -> Result<(), String> {
        let st = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .map_err(|e| format!("Gagal menjalankan git {}: {e}", args[0]))?;
        if st.success() {
            Ok(())
        } else {
            Err(format!("git {} gagal dijalankan", args[0]))
        }
    };
    jalan(&["add", "."])?;
    if let Some(a) = author {
        jalan(&["config", "user.name", &a.nama])?;
        jalan(&["config", "user.email", &a.email])?;
        jalan(&[
            "commit",
            "-q",
            "--no-verify",
            "-m",
            "chore: sambungkan repo ke Autore (Dockerfile + Jenkinsfile)",
        ])
    } else {
        jalan(&[
            "-c",
            "user.name=Autore CLI",
            "-c",
            "user.email=autore@tugu-re.com",
            "commit",
            "-q",
            "--no-verify",
            "-m",
            "chore: sambungkan repo ke Autore (Dockerfile + Jenkinsfile)",
        ])
    }
}

fn push_branch(dir: &Path, branch: &str) -> bool {
    Command::new("git")
        .args(["push", "-q", "origin"])
        .arg(format!("HEAD:{branch}"))
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn pilih_stack(opts: &ConnectOpts, dir: &Path) -> Result<TechStack, String> {
    if let Some(s) = opts
        .stack
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return TechStack::from_str_loose(s)
            .ok_or_else(|| format!("Stack '{s}' tidak dikenali. Pilih: python, nodejs, java, go"));
    }
    Ok(deteksi_stack(dir).unwrap_or(TechStack::Python))
}

/// Alur lengkap: clone repo dev → tambah pipeline bila belum ada → commit+push
/// → daftarkan job Jenkins. Gagal di tahap mana pun berhenti di situ.
pub fn jalankan(opts: &ConnectOpts, interactive: bool) -> i32 {
    let rr = match parse_repo_url(&opts.repo) {
        Ok(v) => v,
        Err(e) => return gagal(&e),
    };
    let nama = match nama_aplikasi(opts) {
        Ok(n) => n,
        Err(e) => return gagal(&e),
    };
    // Repo yang di-clone ke dalam repo git lain jadi repo bersarang dan
    // mengotori status repo induk. Lebih baik gagal cepat daripada
    // meninggalkan sisa aneh.
    let target = opts.path.join(&nama);
    if di_dalam_repo_git(&opts.path) {
        return gagal(&format!(
            "Folder {} ada di dalam repo git lain, jadi repo akan ter-clone bersarang. \
             Jalankan dari luar repo, atau pakai --path <folder induk> (mis. --path ~/autore-workspace).",
            opts.path.display()
        ));
    }
    if target.exists() {
        // Folder sisa `connect` yang sudah push boleh dilanjutkan: mengulang dari
        // nol akan menolak folder, padahal semua tahap sebelum Jenkins idle.
        if !opts.resume {
            return gagal(&format!(
                "Folder {} sudah ada. Jalankan dari folder lain, atau pakai --path <folder induk> \
                 (mis. --path ~/autore-workspace) supaya folder itu tidak tertimpa. \
                 Kalau folder itu sisa connect yang sudah push, lanjutkan dengan --resume.",
                target.display()
            ));
        }
        if !checkout_sesuai(&target, &rr.url, &opts.branch) {
            return gagal_tahap(
                "klon",
                &format!(
                    "Folder {} tidak bisa dilanjutkan: isinya bukan checkout {} pada branch {} (origin/branch harus sama). Hapus folder itu atau clone ulang tanpa --resume.",
                    target.display(),
                    rr.url,
                    opts.branch
                ),
            );
        }
        println!(
            "  {} Checkout {} dipakai ulang (--resume)",
            "1/4".green().bold(),
            target.display()
        );
        progress::tahap("klon", "selesai", "Checkout yang ada dipakai ulang.");
    } else {
        println!("\n{} Sambungkan repo '{}'", "●".cyan().bold(), nama.bold());
        progress::tahap("klon", "mulai", "Mengambil repo dari GitHub.");
        if let Err(e) = clone_repo(&rr.url, &target, &opts.branch) {
            return gagal_tahap("klon", &e);
        }
        println!(
            "  {} Repo di-clone ke {}",
            "1/4".green().bold(),
            target.display()
        );
        progress::tahap("klon", "selesai", "Repo berhasil diambil.");
    }

    let stack = match pilih_stack(opts, &target) {
        Ok(s) => s,
        Err(e) => return gagal(&e),
    };
    let workspace = workspace::workspace_dir();
    let deploy_port = match workspace::pilih_port(&workspace, &nama, opts.deploy_port) {
        Ok((_, d)) => d,
        Err(e) => return gagal(&e),
    };
    let cfg = InitConfig {
        app_name: nama.clone(),
        stack,
        app_port: opts.app_port.unwrap_or_else(|| stack.default_port()),
        deploy_port,
    };
    // Port staging/production dikunci di awal supaya Jenkinsfile yang dikirim ke
    // repo memakai port yang sama dengan ledger (dan promotion punya container_port).
    let (staging_port, production_port, entri_baru) =
        match crate::lingkungan::pastikan_entri(&workspace, &nama, cfg.app_port) {
            Ok(p) => p,
            Err(e) => return gagal(&e),
        };
    let dibuat = match ensure_missing_pipeline_files(&cfg, &target, staging_port) {
        Ok(paths) => paths,
        Err(e) => {
            batalkan_entri_baru(&workspace, &nama, entri_baru);
            return gagal_tahap("kerangka", &e);
        }
    };
    if dibuat.is_empty() {
        println!(
            "  {} Dockerfile/Jenkinsfile/.dockerignore milik repo dipakai apa adanya",
            "2/4".green().bold()
        );
    } else {
        let names = dibuat
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()))
            .collect::<Vec<_>>()
            .join(", ");
        println!("  {} File pipeline dibuat: {names}", "2/4".green().bold());
    }
    // Peringatan dini lewat jalur yang sama dengan quick-start: repo tanpa kode
    // aplikasi atau tanpa endpoint /health akan gagal di tahap deploy nanti.
    crate::peringatkan_folder_kosong(&target);
    progress::tahap("kerangka", "selesai", "Pipeline siap.");

    let git_url = format!("{}.git", rr.url);
    let author =
        jenkins::validasi_author(opts.author_name.as_deref(), opts.author_email.as_deref());
    if let Err(e) = commit_scaffold(&target, author.as_ref()) {
        batalkan_entri_baru(&workspace, &nama, entri_baru);
        return gagal_tahap("commit", &e);
    }
    if !push_branch(&target, &opts.branch) {
        batalkan_entri_baru(&workspace, &nama, entri_baru);
        return gagal_tahap(
            "kirim",
            &format!(
                "Gagal push ke {git_url} (branch {}). Pastikan token GitHub punya izin tulis dan branch tidak diproteksi.",
                opts.branch
            ),
        );
    }
    println!("  {} Terkirim ke {}", "3/4".green().bold(), git_url);
    progress::tahap("kirim", "selesai", "Kode terkirim ke GitHub.");

    // Urutan penting: push dulu, kunci sesudahnya. Kalau dikunci lebih dulu,
    // commit pipeline pertama akan ditolak karena belum lewat PR.
    let full = format!("{}/{}", rr.owner, rr.name);
    match crate::github::resolve_token() {
        Some(token) => {
            crate::kunci_setelah_push(
                &token,
                &full,
                &opts.branch,
                opts.kunci,
                opts.wajib_review,
            );
        }
        None => println!(
            "  i Token GitHub tidak ada — kunci branch dilewati (ulangi: autore kunci-repo --repo {full})"
        ),
    }

    // Port dikunci setelah push + Jenkins sukses: gagal Jenkins berarti app belum
    // terdaftar di dashboard, jadi port-nya tidak boleh ikut terkunci. Ledger
    // (`environments.json`) tetap dipertahankan karena Jenkinsfile di repo sudah
    // membawa deployPort itu — menghapusnya akan membuat retry memakai port lain.
    let conf_path = jenkins::default_config_path();
    let jk_cfg = match crate::ensure_jenkins_config(&conf_path, interactive, false) {
        Some(c) => c,
        None => {
            return gagal_tahap(
                "jenkins",
                &format!("Push GitHub sukses; konfigurasi Jenkins belum ada di {}. Atur Jenkins, lalu ulangi connect dengan --resume.", conf_path.display()),
            )
        }
    };
    progress::tahap("jenkins", "mulai", "Mendaftarkan job ke Jenkins.");
    let job_url =
        match jenkins::register_and_trigger_jenkins(&jk_cfg, &nama, &git_url, &opts.branch) {
            Ok(url) => url,
            // Repo sudah ter-push: jangan hapus clone/ledger, cukup laporkan tahapnya
            // supaya `--resume` (atau dashboard) tahu apa yang harus diulang.
            Err(e) => return gagal_tahap("jenkins", &e),
        };
    workspace::catat_port(&workspace, &nama, cfg.app_port, cfg.deploy_port);

    println!(
        "\n{} Repo '{}' tersambung & build jalan!",
        "✔".green().bold(),
        nama
    );
    println!("  • Folder project : {}", target.display());
    println!("  • Repo GitHub    {}/{} (tersambung)", rr.owner, rr.name);
    println!("  • Job Jenkins    : {job_url}");
    println!("  • Staging       : http://localhost:{staging_port} (build pertama otomatis)");
    println!(
        "  • Production    : http://localhost:{production_port} (setelah persetujuan promotion)"
    );
    progress::tahap(
        "jenkins",
        "selesai",
        "Terdaftar di Jenkins, build mulai berjalan.",
    );
    0
}

/// Port hanya dikunci kalau push sukses: kalau alur batal, entri yang kita buat
/// dibuang lagi supaya ledger tidak menyisakan slot untuk app yang tidak pernah jadi.
fn batalkan_entri_baru(workspace: &Path, nama: &str, entri_baru: bool) {
    if entri_baru {
        let _ = crate::lingkungan::hapus_app(workspace, nama);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terima_url_github_polos_dan_dengan_git() {
        let a = parse_repo_url("https://github.com/tugure-reasuransi/autore-demo").unwrap();
        assert_eq!(
            (a.owner.as_str(), a.name.as_str()),
            ("tugure-reasuransi", "autore-demo")
        );
        let b = parse_repo_url("https://github.com/tugure-reasuransi/autore-demo.git").unwrap();
        assert_eq!(b.name, "autore-demo");
        assert_eq!(b.url, "https://github.com/tugure-reasuransi/autore-demo");
    }

    /// Bentuk pendek harus diterima sama seperti `kunci-repo`, supaya orang
    /// tidak perlu mengingat dua gaya argumen untuk repo yang sama.
    #[test]
    fn terima_bentuk_pendek_owner_repo() {
        for masukan in [
            "tugure-reasuransi/autore-demo",
            "github.com/tugure-reasuransi/autore-demo",
            "  tugure-reasuransi/autore-demo.git  ",
        ] {
            let r = parse_repo_url(masukan).unwrap();
            assert_eq!(
                r.url, "https://github.com/tugure-reasuransi/autore-demo",
                "gagal untuk {masukan}"
            );
        }
        assert!(
            parse_repo_url("a/b/c").is_err(),
            "tiga segmen harus ditolak"
        );
        assert!(parse_repo_url("gitlab.com/a/b").is_err());
    }

    #[test]
    fn tolak_host_lain_ssh_dan_kredensial() {
        for buruk in [
            "https://gitlab.com/a/b",
            "git@github.com:a/b.git",
            "https://user:tok@github.com/a/b",
            "file:///tmp/repo",
            "https://github.com/a",
            "https://github.com/a/b/c",
            "https://github.com//b",
            "",
        ] {
            assert!(parse_repo_url(buruk).is_err(), "harus ditolak: {buruk}");
        }
    }

    /// Checkout sisa connect hanya boleh dilanjutkan kalau origin DAN branch-nya
    /// sama dengan permintaan; folder lain yang namanya kebetulan sama harus ditolak
    /// supaya `--resume` tidak mem-push isi repo yang salah.
    #[test]
    fn resume_hanya_untuk_checkout_repo_dan_branch_yang_sama() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("app");
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            let status = Command::new("git")
                .args(args)
                .current_dir(&dir)
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?} gagal");
        };
        let url = "https://github.com/tugure-reasuransi/autore-demo";

        assert!(
            !checkout_sesuai(&dir, url, "main"),
            "folder biasa bukan checkout"
        );

        git(&["init", "-q", "-b", "main"]);
        git(&["remote", "add", "origin", &format!("{url}.git")]);
        assert!(
            checkout_sesuai(&dir, url, "main"),
            "origin .git dan branch sama"
        );
        assert!(!checkout_sesuai(&dir, url, "develop"), "branch lain");

        git(&[
            "remote",
            "set-url",
            "origin",
            "https://github.com/lain/repo",
        ]);
        assert!(!checkout_sesuai(&dir, url, "main"), "repo lain");
        assert!(!checkout_sesuai(&tmp.path().join("hilang"), url, "main"));
    }

    fn opts(repo: &str, app_name: Option<&str>) -> ConnectOpts {
        ConnectOpts {
            repo: repo.to_string(),
            path: PathBuf::from("/tmp"),
            app_name: app_name.map(str::to_string),
            stack: None,
            app_port: None,
            deploy_port: None,
            branch: "main".to_string(),
            kunci: None,
            wajib_review: None,
            author_name: None,
            author_email: None,
            resume: false,
        }
    }

    #[test]
    fn tanpa_app_name_memakai_nama_repo() {
        let o = opts("https://github.com/tugure-reasuransi/autore-demo", None);
        assert_eq!(nama_aplikasi(&o).unwrap(), "autore-demo");
    }

    #[test]
    fn menolak_nama_tidak_sah() {
        let o = opts("https://github.com/a/b", Some("Nama Salah"));
        assert!(nama_aplikasi(&o).is_err());
    }

    /// Clone tidak boleh bersarang di dalam repo git lain, jadi deteksi ini
    /// harus naik ke folder induk, bukan cuma melihat folder yang dituju.
    #[test]
    fn mendeteksi_folder_di_dalam_repo_git() {
        let akar = std::env::temp_dir().join(format!("autore-git-nest-{}", std::process::id()));
        let repo = akar.join("repo");
        let dalam = repo.join("src");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(&dalam).unwrap();
        assert!(di_dalam_repo_git(&dalam));
        assert!(di_dalam_repo_git(&repo));
        assert!(!di_dalam_repo_git(&akar));
        std::fs::remove_dir_all(&akar).unwrap();
    }

    #[test]
    fn deteksi_stack_dari_berkas_penanda() {
        let tmp = std::env::temp_dir().join(format!("autore-stack-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        assert_eq!(deteksi_stack(&tmp), None);
        std::fs::write(tmp.join("package.json"), "{}").unwrap();
        assert_eq!(deteksi_stack(&tmp), Some(TechStack::NodeJs));
        std::fs::remove_file(tmp.join("package.json")).unwrap();
        std::fs::write(tmp.join("go.mod"), "module x").unwrap();
        assert_eq!(deteksi_stack(&tmp), Some(TechStack::Go));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
