mod doctor;
mod external;
mod github;
mod hooks;
mod jenkins;
mod scanner;
mod templates;
mod tui;
mod updater;

use clap::{Parser, Subcommand};
use colored::Colorize;
use inquire::ui::{Color, RenderConfig, StyleSheet, Styled};
use inquire::{Confirm, CustomType, Password, PasswordDisplayMode, Select, Text};
use std::io::IsTerminal;
use std::path::PathBuf;
use std::process;
use templates::{
    generate_project_files_with, validate_app_name, validate_deploy_port, InitConfig, TechStack,
};

#[derive(Parser)]
#[command(
    name = "autore",
    version = env!("AUTORE_VERSION"),
    about = "Autore CLI — DevSecOps & CI/CD Platform Tooling for Tugu Re IT Team"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

fn claude_render_config() -> RenderConfig<'static> {
    let orange = Color::Rgb { r: 217, g: 119, b: 87 };
    RenderConfig::default_colored()
        .with_prompt_prefix(Styled::new("●").with_fg(orange))
        .with_highlighted_option_prefix(Styled::new("◉").with_fg(orange))
        .with_unhighlighted_option_prefix(Styled::new("○").with_fg(Color::DarkGrey))
        .with_selected_option(Some(StyleSheet::new().with_fg(orange)))
        .with_answer(StyleSheet::new().with_fg(orange))
        .with_help_message(StyleSheet::new().with_fg(Color::DarkGrey))
}

// Palet oranye terakota khas Claude CLI (#D97757 / RGB 217, 119, 87).
// Menggunakan raw ANSI 24-bit (\x1b[38;2;R;G;Bm) agar tetap tampil oranye Claude
// saat dijalankan lewat SSH (tanpa downgrade ke 16-color kuning oleh crate colored).
const BANNER_ROWS: [(&str, (u8, u8, u8)); 6] = [
    ("  █████╗ ██╗   ██╗████████╗ ██████╗ ██████╗ ███████╗", (235, 138, 104)),
    (" ██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██╔══██╗██╔════╝", (229, 131, 98)),
    (" ███████║██║   ██║   ██║   ██║   ██║██████╔╝█████╗  ", (223, 125, 92)),
    (" ██╔══██║██║   ██║   ██║   ██║   ██║██╔══██╗██╔══╝  ", (217, 119, 87)),
    (" ██║  ██║╚██████╔╝   ██║   ╚██████╔╝██║  ██║███████╗", (204, 108, 77)),
    (" ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝", (185, 95, 66)),
];

fn print_ascii_banner() {
    println!();
    for (line, (r, g, b)) in BANNER_ROWS {
        println!("\x1b[38;2;{r};{g};{b}m{line}\x1b[0m");
    }
    println!(
        " \x1b[38;2;217;119;87m●\x1b[0m \x1b[38;2;217;119;87mDevSecOps & CI/CD Platform Tooling — v{}\x1b[0m",
        env!("AUTORE_VERSION")
    );
    println!();
}

pub fn is_autore_project_dir(dir: &std::path::Path) -> bool {
    dir.join(".git").exists()
        || dir.join("Dockerfile").exists()
        || dir.join("Jenkinsfile").exists()
}

pub fn has_existing_pipeline_files(dir: &std::path::Path) -> bool {
    dir.join("Dockerfile").exists()
        || dir.join("Jenkinsfile").exists()
        || dir.join(".dockerignore").exists()
}

/// Tentukan folder target untuk `Buat Project Baru` dari menu interaktif:
/// 1) Jika folder saat ini bernama sama dengan `app_name`, pakai langsung (`cwd`).
/// 2) Jika sedang berada di dalam project lain (ada `.git`/`Dockerfile`/`Jenkinsfile`),
///    taruh sejajar di sebelah project itu (`parent.join(app_name)`), bukan di dalam perutnya.
/// 3) Selain itu, buat subfolder `./<app_name>`.
pub fn resolve_interactive_project_dir(cwd: &std::path::Path, app_name: &str) -> PathBuf {
    if cwd.file_name().and_then(|n| n.to_str()) == Some(app_name) {
        return cwd.to_path_buf();
    }
    if is_autore_project_dir(cwd) {
        if let Some(parent) = cwd.parent() {
            if !parent.as_os_str().is_empty() {
                return parent.join(app_name);
            }
        }
    }
    cwd.join(app_name)
}

/// Bootstrap project lengkap dari menu interaktif:
/// buat folder `./<app_name>` -> `git init -b main` -> generate 3 file -> pasang pre-commit hook.
pub fn bootstrap_interactive_project(
    base_dir: &std::path::Path,
    cfg: &InitConfig,
    force: bool,
) -> Result<(PathBuf, Vec<PathBuf>, PathBuf, bool), String> {
    let project_dir = resolve_interactive_project_dir(base_dir, &cfg.app_name);
    let files = generate_project_files_with(cfg, &project_dir, force)?;
    let git_created = hooks::ensure_git_repo_main(&project_dir)?;
    let hook_path = hooks::install_pre_commit_hook(&project_dir)?;
    Ok((project_dir, files, hook_path, git_created))
}

/// Apakah `dir` adalah repositori Autore CLI itu sendiri (tidak boleh dihapus lewat menu Hapus Project)?
pub fn is_autore_source_repo(dir: &std::path::Path) -> bool {
    dir.join("cli/Cargo.toml").exists() && dir.join("vars/autorePipeline.groovy").exists()
}

/// Apakah `dir` adalah project user yang boleh dihapus?
/// Wajib memiliki `Dockerfile` atau `Jenkinsfile`, bukan root/home, dan bukan repo sumber Autore.
pub fn is_deletable_user_project(dir: &std::path::Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    if !(dir.join("Dockerfile").exists() || dir.join("Jenkinsfile").exists()) {
        return false;
    }
    if is_autore_source_repo(dir) {
        return false;
    }
    if dir.parent().is_none() {
        return false;
    }
    if let Ok(home) = std::env::var("HOME") {
        if dir == std::path::Path::new(&home) {
            return false;
        }
    }
    if let Ok(up) = std::env::var("USERPROFILE") {
        if dir == std::path::Path::new(&up) {
            return false;
        }
    }
    true
}

/// Cari semua folder project user yang bisa dihapus di sekitar `cwd`.
pub fn discover_deletable_projects(cwd: &std::path::Path) -> Vec<PathBuf> {
    let base = if is_autore_project_dir(cwd) {
        cwd.parent().unwrap_or(cwd)
    } else {
        cwd
    };
    let mut found = Vec::new();
    if is_deletable_user_project(cwd) {
        found.push(cwd.to_path_buf());
    }
    if let Ok(entries) = std::fs::read_dir(base) {
        let mut siblings: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| !s.starts_with('.'))
                    .unwrap_or(false)
                    && is_deletable_user_project(p)
            })
            .collect();
        siblings.sort();
        for p in siblings {
            if !found.contains(&p) {
                found.push(p);
            }
        }
    }
    found
}

/// Hapus folder project user dengan aman; jika `cwd` berada di dalam `target`, pindah ke parent dulu.
pub fn delete_project_safely(
    target: &std::path::Path,
    active_project: &mut Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    if !is_deletable_user_project(target) {
        return Err(format!(
            "Direktori '{}' bukan project Autore yang valid untuk dihapus.",
            target.display()
        ));
    }
    let mut moved_to = None;
    if let Ok(cwd) = std::env::current_dir() {
        let canon_cwd = cwd.canonicalize().unwrap_or(cwd);
        let canon_target = target.canonicalize().unwrap_or_else(|_| target.to_path_buf());
        if canon_cwd.starts_with(&canon_target) {
            if let Some(parent) = canon_target.parent() {
                let _ = std::env::set_current_dir(parent);
                moved_to = Some(parent.to_path_buf());
            }
        }
    }
    if let Some(act) = active_project {
        let canon_act = act.canonicalize().unwrap_or_else(|_| act.clone());
        let canon_target = target.canonicalize().unwrap_or_else(|_| target.to_path_buf());
        if canon_act == canon_target {
            *active_project = None;
        }
    }
    std::fs::remove_dir_all(target)
        .map_err(|e| format!("Gagal menghapus '{}': {e}", target.display()))?;
    Ok(moved_to)
}

/// Saat menu Scan atau Hook dipilih dari luar folder project, tampilkan daftar project yang tersedia
/// agar user bisa memilih project mana yang ingin di-scan / dipasang Satpam Git.
fn pick_interactive_target_project(
    default_path: PathBuf,
    prompt_title: &str,
    active_project: &mut Option<PathBuf>,
) -> Option<PathBuf> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| default_path.clone());
    if active_project.is_some() || is_autore_project_dir(&cwd) {
        return Some(cwd);
    }
    let candidates = discover_deletable_projects(&cwd);
    if candidates.is_empty() {
        return Some(cwd);
    }
    let mut labels: Vec<String> = candidates
        .iter()
        .map(|p| {
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project");
            format!("{name}  ({})", p.display())
        })
        .collect();
    labels.push(format!("Folder saat ini  ({})", cwd.display()));

    let picked = Select::new(prompt_title, labels.clone())
        .with_help_message("↑/↓ geser • Enter pilih • Esc batal")
        .prompt()
        .ok()?;
    let idx = labels.iter().position(|l| l == &picked).unwrap_or(0);
    if idx < candidates.len() {
        let target = candidates[idx].clone();
        let _ = std::env::set_current_dir(&target);
        *active_project = Some(target.clone());
        Some(target)
    } else {
        Some(cwd)
    }
}

/// Enter ditekan (bukan tombol lain)? Dipisah supaya bisa diuji tanpa terminal.
fn enter_pressed(event: std::io::Result<crossterm::event::Event>) -> bool {
    matches!(
        event,
        Ok(crossterm::event::Event::Key(crossterm::event::KeyEvent {
            code: crossterm::event::KeyCode::Enter,
            ..
        }))
    )
}

/// Tahan layar setelah aksi selesai: satu tombol, tidak perlu pilih menu lagi.
fn prompt_after_action() -> bool {
    println!(
        "\n{} Enter kembali ke menu  •  {} keluar",
        "●".cyan().bold(),
        "q".cyan().bold()
    );
    let _ = std::io::Write::flush(&mut std::io::stdout());
    if !std::io::stdout().is_terminal() {
        return false;
    }
    enter_pressed(crossterm::event::read())
}

/// Seluruh item menu — satu sumber kebenaran untuk TUI dan mode teks.
const MENU: &[tui::Item] = &[
    tui::Item {
        label: "Mulai Project Baru (1-Klik)",
        desc: "Alur otomatis paling gampang: tulis Dockerfile & Jenkinsfile, buat repo GitHub, push, daftar ke Jenkins, lalu trigger build pertama.",
        hints: "Butuh: token GitHub + akses Jenkins (ditanya sekali, lalu disimpan).",
    },
    tui::Item {
        label: "Buat Project Baru (Dockerfile & Jenkinsfile)",
        desc: "Menulis Dockerfile, Jenkinsfile, dan .dockerignore plus starter /health. Tidak menyentuh GitHub maupun Jenkins.",
        hints: "Cocok kalau mau atur repo & Jenkins sendiri.",
    },
    tui::Item {
        label: "Hapus Project",
        desc: "Menghapus folder project Autore dari disk (dipilih lewat daftar).",
        hints: "Permanen, tidak bisa dibatalkan.",
    },
    tui::Item {
        label: "Scan Keamanan Kode (Static + Gitleaks + Trivy)",
        desc: "Menjalankan Static Byte Guard native, Gitleaks (rahasia), dan Trivy (CVE + misconfig) pada file project.",
        hints: "Mode penuh butuh Docker; tanpa Docker pakai --no-docker.",
    },
    tui::Item {
        label: "Deploy / Sambungkan Project ke Jenkins",
        desc: "Simpan akses Jenkins sekali, siapkan commit & remote Git, buat/perbarui job pipeline, lalu Build Now.",
        hints: "Dipakai kalau project-nya sudah ada dan cuma mau disambungkan.",
    },
    tui::Item {
        label: "Pasang Satpam Git (Pre-Commit Hook)",
        desc: "Memasang hook pre-commit di .git/hooks/pre-commit supaya kode diperiksa sebelum commit.",
        hints: "Otomatis dipasang juga saat project baru dibuat.",
    },
    tui::Item {
        label: "Copot Satpam Git (Uninstall Hook)",
        desc: "Melepas hook pre-commit dan memulihkan backup .pre-commit.bak kalau ada.",
        hints: "Aman, hanya menyentuh .git/hooks.",
    },
    tui::Item {
        label: "Cek Kesehatan Sistem (Doctor)",
        desc: "Memeriksa Git, Java 21, Docker, Docker Compose, service runner, lokasi binary, dan ruang disk.",
        hints: "Jalankan ini kalau ada langkah yang gagal.",
    },
    tui::Item {
        label: "Update Autore",
        desc: "Mengunduh rilis stabil terbaru dari GitHub Releases, memverifikasi SHA-256, lalu mengganti binary ini.",
        hints: "Kalau binary di folder sistem: jalankan sekali dengan sudo.",
    },
];

/// Pemetaan index menu -> perintah CLI. Satu tempat, dipakai TUI & mode teks.
fn commands_for(index: usize) -> Commands {
    match index {
        0 => Commands::QuickStart {
            path: PathBuf::from("."),
            app_name: None,
            stack: None,
            app_port: None,
            deploy_port: None,
        },
        1 => Commands::Init {
            app_name: None,
            stack: None,
            app_port: None,
            deploy_port: None,
            output_dir: PathBuf::from("."),
            force: false,
        },
        2 => Commands::DeleteProject,
        3 => Commands::Scan {
            path: PathBuf::from("."),
            severity: "HIGH,CRITICAL".to_string(),
            no_docker: false,
            include_build_dirs: false,
            docker: false,
        },
        4 => Commands::Deploy {
            path: PathBuf::from("."),
            git_url: None,
            reconfigure: false,
        },
        5 => Commands::Hook {
            action: HookAction::Install {
                repo: PathBuf::from("."),
            },
        },
        6 => Commands::Hook {
            action: HookAction::Uninstall {
                repo: PathBuf::from("."),
            },
        },
        8 => Commands::Update,
        _ => Commands::Doctor,
    }
}

/// Label menu -> index-nya. Dipakai mode teks (bukan TUI) supaya pencocokan label
/// tidak tersebar di beberapa tempat.
fn label_index(label: &str) -> Option<usize> {
    MENU.iter().position(|i| i.label == label)
}

/// Catatan status baris terakhir (dipakai TUI): sukses atau gagal + kode keluar.
fn note_for(index: usize, code: i32) -> String {
    if code == 0 {
        format!("✔ terakhir: {}", MENU[index].label)
    } else {
        format!("✘ terakhir: {} (keluar dengan kode {code})", MENU[index].label)
    }
}

/// Menu utama: TUI layar penuh kalau terminal interaktif, daftar teks kalau bukan
/// (mis. output dipipe ke file). Mengembalikan index menu + perintah yang dipilih.
fn prompt_main_menu(
    active_project: Option<&std::path::Path>,
    last_note: Option<&str>,
) -> Option<(usize, Commands)> {
    let project_label = active_project.map(|p| p.display().to_string());

    let index = if std::io::stdout().is_terminal() {
        tui::select_action(MENU, project_label.as_deref(), last_note)?
    } else {
        print_ascii_banner();
        if let Some(dir) = active_project {
            println!(
                " {} Folder project aktif: {}\n",
                "●".cyan().bold(),
                dir.display().to_string().bold()
            );
        }
        let labels: Vec<&str> = MENU.iter().map(|i| i.label).collect();
        let picked = Select::new("Pilih:", labels)
            .with_help_message("↑/↓ geser • Enter pilih • Esc selesai")
            .prompt()
            .ok()?;
        label_index(picked)?
    };

    Some((index, commands_for(index)))
}

fn clear_gate_reason() {
    let _ = std::fs::remove_file(std::path::Path::new(".security-gate-reason"));
}

/// Tulis alasan blokir ke file yang dibaca notifier pipeline.
/// ponytail: hapus dulu — `fs::write` menembus symlink, dan repo bisa meng-commit
/// `.security-gate-reason` -> file lain yang writable oleh user runner.
fn write_gate_reason(contents: &str) {
    clear_gate_reason(); // hapus link-nya sendiri, bukan target
    let _ = std::fs::write(".security-gate-reason", contents);
}

/// Saran perintah saat binary Autore tidak bisa ditimpa (mis. terpasang di /usr/local/bin).
pub(crate) fn elevation_hint(target_exe: &std::path::Path) -> String {
    let shown = target_exe.display();
    if shown.to_string().starts_with("/usr") || shown.to_string().starts_with("/opt") {
        format!(
            "\n  i Binary terpasang di folder sistem ({shown}). Jalankan sekali: sudo autore update\n  i Atau pasang versi user: install -m 0755 <autore-baru> ~/.local/bin/autore"
        )
    } else {
        "\n  i Periksa izin tulis folder tersebut, lalu ulangi `autore update`.".to_string()
    }
}

/// Port host bebas pertama mulai `start` — supaya alur 1-klik tidak bentrok port.
fn pick_free_port(start: u16) -> u16 {
    (start..=start.saturating_add(40))
        .find(|p| std::net::TcpListener::bind(("0.0.0.0", *p)).is_ok())
        .unwrap_or(start)
}

/// Push branch `main` ke `origin`. `false` = gagal (pemanggil yang memutuskan).
fn git_push_main(dir: &std::path::Path) -> bool {
    std::process::Command::new("git")
        .args(["push", "-q", "-u", "origin", "main"])
        .current_dir(dir)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Konfigurasi Jenkins: pakai yang tersimpan, atau tanya sekali di sesi interaktif.
fn ensure_jenkins_config(
    conf_path: &std::path::Path,
    interactive: bool,
    reconfigure: bool,
) -> Option<jenkins::JenkinsConfig> {
    if !reconfigure {
        if let Some(cfg) = jenkins::load_config_from(conf_path) {
            return Some(cfg);
        }
    }
    if !interactive {
        eprintln!(
            "{} Konfigurasi Jenkins belum ada di {}. Jalankan `autore` lewat menu untuk mengisi sekali.",
            "ERROR:".red().bold(),
            conf_path.display()
        );
        return None;
    }
    println!(
        "  {} Setup akses Jenkins pertama kali (akan disimpan aman di {}):",
        "i".cyan().bold(),
        conf_path.display()
    );
    let url = Text::new("URL Jenkins:")
        .with_default("http://127.0.0.1:8080")
        .prompt()
        .ok()?;
    let user = Text::new("Username Jenkins:")
        .with_default("admin")
        .prompt()
        .ok()?;
    let token = Password::new("Password / API Token Jenkins:")
        .without_confirmation()
        .with_display_mode(PasswordDisplayMode::Masked)
        .prompt()
        .ok()?;
    let new_cfg = jenkins::JenkinsConfig { url, user, token };
    if let Err(e) = jenkins::save_config_to(conf_path, &new_cfg) {
        eprintln!("{} {e}", "ERROR:".red().bold());
        return None;
    }
    println!(
        "  {} Akses Jenkins tersimpan di {} (klik berikutnya langsung jalan otomatis).",
        "✔".green().bold(),
        conf_path.display()
    );
    jenkins::load_config_from(conf_path)
}

#[derive(Subcommand)]
enum Commands {
    /// Generate Dockerfile & Jenkinsfile standar kantor untuk aplikasi baru
    Init {
        /// Nama aplikasi (jika dikosongkan, akan muncul prompt interaktif)
        #[arg(long)]
        app_name: Option<String>,

        /// Tech stack: python, nodejs, java, go
        #[arg(long)]
        stack: Option<String>,

        /// Port internal aplikasi di dalam container
        #[arg(long)]
        app_port: Option<u16>,

        /// Port host untuk deployment container (default: 8081)
        #[arg(long)]
        deploy_port: Option<u16>,

        /// Direktori tujuan pembuatan file
        #[arg(long, default_value = ".")]
        output_dir: PathBuf,

        /// Timpa file Dockerfile / Jenkinsfile / .dockerignore jika sudah ada
        #[arg(long)]
        force: bool,
    },

    /// Jalankan Security Gate: Static Guard + Gitleaks + Trivy (via Docker).
    /// Gagal (exit 1) jika salah satu scanner tidak benar-benar berjalan.
    Scan {
        /// Direktori proyek yang akan dipindai
        #[arg(long, short, default_value = ".")]
        path: PathBuf,

        /// Tingkat severity Trivy yang diblokir (default: HIGH,CRITICAL)
        #[arg(long, default_value = "HIGH,CRITICAL")]
        severity: String,

        /// Hanya static guard (untuk pre-commit lokal). NON-AUTHORITATIVE: jangan dipakai di CI.
        #[arg(long)]
        no_docker: bool,

        /// Pindai juga direktori build/dependensi (target, node_modules, dist)
        #[arg(long)]
        include_build_dirs: bool,

        /// [Deprecated] Gitleaks & Trivy sekarang selalu dijalankan; flag ini diabaikan.
        #[arg(long, hide = true)]
        docker: bool,
    },

    /// Jalankan Security Gate Post-Build pada Docker Image: periksa UID non-root + Trivy Image Scan + SBOM CycloneDX.
    ScanImage {
        /// Referensi image Docker lokal (contoh: 127.0.0.1:5000/app:build-1-commit-sha)
        #[arg(long)]
        image: String,

        /// Tingkat severity Trivy yang diblokir (default: HIGH,CRITICAL)
        #[arg(long, default_value = "HIGH,CRITICAL")]
        severity: String,

        /// Path output untuk file SBOM CycloneDX (contoh: dist/sbom.cdx.json)
        #[arg(long)]
        sbom_output: Option<PathBuf>,

        /// Mode non-authoritative untuk testing tanpa Docker daemon
        #[arg(long)]
        no_docker: bool,
    },

    /// Kelola Git Pre-Commit Hook (Satpam Pintu 1 sebelum git commit)
    Hook {
        #[command(subcommand)]
        action: HookAction,
    },

    /// Periksa kesehatan sistem Runner, Docker, Java, dan Jenkins
    Doctor,

    /// Update Autore ke versi rilis stabil terbaru di GitHub Releases
    Update,

    /// Daftarkan project ke Jenkins CI/CD & langsung jalankan build otomatis
    Deploy {
        /// Direktori project yang akan dihubungkan ke Jenkins
        #[arg(long, default_value = ".")]
        path: PathBuf,

        /// URL repositori Git (opsional; otomatis dibaca dari `git remote get-url origin`)
        #[arg(long)]
        git_url: Option<String>,

        /// Ubah kredensial Jenkins yang tersimpan di ~/.config/autore/jenkins.conf
        #[arg(long)]
        reconfigure: bool,
    },

    /// Alur 1-klik: buat file pipeline, buat repo GitHub, push, daftar ke Jenkins, trigger build
    QuickStart {
        /// Direktori induk tempat project baru dibuat
        #[arg(long, default_value = ".")]
        path: PathBuf,

        /// Nama project (default: nama folder saat ini)
        #[arg(long)]
        app_name: Option<String>,

        /// Tech stack: python, nodejs, java, go
        #[arg(long)]
        stack: Option<String>,

        /// Port internal aplikasi di dalam container
        #[arg(long)]
        app_port: Option<u16>,

        /// Port host untuk deployment (default: port bebas pertama mulai 8081)
        #[arg(long)]
        deploy_port: Option<u16>,
    },

    /// Hapus folder project Autore secara interaktif
    #[command(hide = true)]
    DeleteProject,
}

#[derive(Subcommand)]
enum HookAction {
    /// Pasang pre-commit hook otomatis pada repositori Git
    Install {
        #[arg(long, default_value = ".")]
        repo: PathBuf,
    },
    /// Copot pre-commit hook dari repositori Git
    Uninstall {
        #[arg(long, default_value = ".")]
        repo: PathBuf,
    },
    /// Cek status apakah pre-commit hook sudah terpasang
    Status {
        #[arg(long, default_value = ".")]
        repo: PathBuf,
    },
}

fn main() {
    if let Ok(exe) = std::env::current_exe() {
        updater::cleanup_stale_old_binary(&exe);
    }
    inquire::set_global_render_config(claude_render_config());
    let cli = Cli::parse();
    if let Some(command) = cli.command {
        let code = execute_command(command, false, &mut None);
        if code != 0 {
            process::exit(code);
        }
        return;
    }

    let mut active_project: Option<PathBuf> = None;
    let mut last_note: Option<String> = None;
    while let Some((index, command)) = prompt_main_menu(active_project.as_deref(), last_note.as_deref())
    {
        let code = execute_command(command, true, &mut active_project);
        last_note = Some(note_for(index, code));
        if !prompt_after_action() {
            break;
        }
    }
}

fn execute_command(
    command: Commands,
    interactive: bool,
    active_project: &mut Option<PathBuf>,
) -> i32 {
    match command {
        Commands::Init {
            app_name,
            stack,
            app_port,
            deploy_port,
            output_dir,
            force,
        } => {
            let resolved_name = match app_name {
                Some(n) => n,
                None => match Text::new("Nama aplikasi:").prompt() {
                    Ok(n) => n.trim().to_string(),
                    Err(_) => return 1,
                },
            };
            if let Err(e) = validate_app_name(&resolved_name) {
                eprintln!("{} {}", "ERROR:".red().bold(), e);
                return 1;
            }

            let resolved_stack = match stack {
                Some(s) => match TechStack::from_str_loose(&s) {
                    Some(st) => st,
                    None => {
                        eprintln!(
                            "{} Stack '{}' tidak dikenali. Pilih: python, nodejs, java, go",
                            "ERROR:".red().bold(),
                            s
                        );
                        return 1;
                    }
                },
                None => match Select::new("Pilih bahasa / Tech Stack:", TechStack::all()).prompt() {
                    Ok(st) => st,
                    Err(_) => return 1,
                },
            };

            let resolved_port = match app_port {
                Some(p) => p,
                None => match CustomType::<u16>::new("Port aplikasi di dalam container:")
                    .with_default(resolved_stack.default_port())
                    .prompt()
                {
                    Ok(p) => p,
                    Err(_) => return 1,
                },
            };

            let resolved_deploy_port = match deploy_port {
                Some(p) => {
                    if let Err(e) = validate_deploy_port(p) {
                        eprintln!("{} {}", "ERROR:".red().bold(), e);
                        return 1;
                    }
                    p
                }
                None if interactive => loop {
                    match CustomType::<u16>::new("Port deploy di server (host):")
                        .with_default(8081)
                        .with_help_message("Enter pakai 8081 • isi 8083, 8084, dst untuk project berikutnya")
                        .prompt()
                    {
                        Ok(p) => match validate_deploy_port(p) {
                            Ok(()) => break p,
                            Err(e) => eprintln!("{} {}", "ERROR:".red().bold(), e),
                        },
                        Err(_) => return 1,
                    }
                },
                None => 8081,
            };

            let cfg = InitConfig {
                app_name: resolved_name,
                stack: resolved_stack,
                app_port: resolved_port,
                deploy_port: resolved_deploy_port,
            };

            if interactive {
                let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                let target_dir = resolve_interactive_project_dir(&cwd, &cfg.app_name);
                let mut effective_force = force;
                if !effective_force && has_existing_pipeline_files(&target_dir) {
                    let prompt_msg = format!(
                        "Project '{}' ({}) sudah punya Dockerfile/Jenkinsfile. Timpa dengan yang baru?",
                        cfg.app_name,
                        target_dir.display()
                    );
                    match Confirm::new(&prompt_msg).with_default(false).prompt() {
                        Ok(true) => effective_force = true,
                        _ => {
                            println!(
                                "{}",
                                "  ℹ Dibatalkan — file project lama tidak diubah.".yellow()
                            );
                            return 0;
                        }
                    }
                }
                match bootstrap_interactive_project(&cwd, &cfg, effective_force) {
                    Ok((project_dir, files, hook_path, git_created)) => {
                        let _ = std::env::set_current_dir(&project_dir);
                        *active_project = Some(project_dir.clone());
                        println!(
                            "\n{}",
                            "✔ Project baru berhasil disiapkan otomatis:"
                                .green()
                                .bold()
                        );
                        println!("  • Folder project : {}", project_dir.display());
                        if git_created {
                            println!("  • Git repository : aktif (branch 'main')");
                        } else {
                            println!("  • Git repository : sudah ada");
                        }
                        for f in files {
                            println!("  • File pipeline  : {}", f.display());
                        }
                        println!("  • Satpam Git     : aktif ({})", hook_path.display());
                        0
                    }
                    Err(e) => {
                        eprintln!("{} {}", "ERROR:".red().bold(), e);
                        1
                    }
                }
            } else {
                match generate_project_files_with(&cfg, &output_dir, force) {
                    Ok(files) => {
                        println!(
                            "\n{}",
                            "✔ Berhasil men-generate file pipeline standar kantor:"
                                .green()
                                .bold()
                        );
                        for f in files {
                            println!("  • {}", f.display());
                        }
                        0
                    }
                    Err(e) => {
                        eprintln!("{} {}", "ERROR:".red().bold(), e);
                        1
                    }
                }
            }
        }

        Commands::Scan { path, severity, no_docker, include_build_dirs, docker: _ } => {
            let target_path = if interactive {
                match pick_interactive_target_project(
                    path,
                    "Pilih project yang ingin di-scan:",
                    active_project,
                ) {
                    Some(p) => p,
                    None => return 0,
                }
            } else {
                path
            };
            clear_gate_reason();
            println!(
                "{} Memindai keamanan kode di '{}'...",
                "==>".cyan().bold(),
                target_path.display()
            );

            let scan_res = scanner::scan_directory_with(
                &target_path,
                &scanner::ScanOptions { skip_build_dirs: !include_build_dirs },
            );
            match scan_res {
                Ok(report) => {
                    if !report.is_clean() {
                        eprintln!(
                            "\n{}",
                            "🚫 [AUTORE SECURITY GATE — DIBLOKIR]"
                                .red()
                                .bold()
                        );
                        let mut reasons = Vec::new();
                        for v in &report.violations {
                            eprintln!(
                                "  {} {}:{} [{}] — {}",
                                "✘".red().bold(),
                                v.file.display(),
                                v.line,
                                v.rule.yellow(),
                                v.message
                            );
                            reasons.push(format!(
                                "{}:{} [{}] — {}",
                                v.file.display(),
                                v.line,
                                v.rule,
                                v.message
                            ));
                        }
                        write_gate_reason(&reasons.join("; "));
                        return 1;
                    }
                    println!(
                        "  {} [1/3] Static Guard LULUS ({} file diperiksa).",
                        "✔".green().bold(),
                        report.scanned_files
                    );
                }
                Err(e) => {
                    eprintln!("{} {}", "ERROR:".red().bold(), e);
                    return 1;
                }
            }

            if no_docker {
                println!(
                    "{}",
                    "⚠ Mode --no-docker: hanya static guard (NON-AUTHORITATIVE, Gitleaks & Trivy TIDAK dijalankan)."
                        .yellow()
                        .bold()
                );
            } else if let Err(e) = external::run_authoritative_scan(&target_path, &severity) {
                let (head, body) = e.split_once('\n').unwrap_or((&e, ""));
                eprintln!("  {} {}", "✘".red().bold(), head);
                if !body.trim().is_empty() {
                    eprintln!("{body}");
                }
                eprintln!(
                    "\n{} Perbaiki temuan di atas, lalu jalankan ulang: autore scan",
                    "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold()
                );
                write_gate_reason(head);
                return 1;
            }

            println!(
                "{}",
                "✔ SEMUA PEMERIKSAAN KEAMANAN LULUS!".green().bold()
            );
            0
        }

        Commands::ScanImage { image, severity, sbom_output, no_docker } => {
            clear_gate_reason();
            println!(
                "{} Memeriksa keamanan Docker image '{}' (severity: {})...",
                "==>".cyan().bold(),
                image,
                severity
            );
            if image == "latest" || image.ends_with(":latest") {
                eprintln!("\n{} Tag :latest dilarang. Gunakan immutable commit tag.", "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold());
                write_gate_reason("Tag :latest dilarang. Gunakan immutable commit tag.");
                return 1;
            }
            if no_docker {
                println!(
                    "{}",
                    "⚠ Mode --no-docker: pemeriksaan image dilewati (NON-AUTHORITATIVE)."
                        .yellow()
                        .bold()
                );
            } else {
                let opts = external::ImageScanOptions {
                    image: &image,
                    severity: &severity,
                    sbom_output: sbom_output.as_deref(),
                };
                if let Err(e) = external::run_authoritative_image_scan(&opts) {
                    eprintln!("\n{} {}", "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold(), e);
                    write_gate_reason(e.lines().next().unwrap_or(&e));
                    return 1;
                }
            }
            println!(
                "{}",
                "✔ PEMERIKSAAN DOCKER IMAGE LULUS!".green().bold()
            );
            0
        }

        Commands::Hook { action } => match action {
            HookAction::Install { repo } => {
                let target_repo = if interactive {
                    match pick_interactive_target_project(
                        repo,
                        "Pilih project yang ingin dipasang Satpam Git:",
                        active_project,
                    ) {
                        Some(p) => p,
                        None => return 0,
                    }
                } else {
                    repo
                };
                match hooks::install_pre_commit_hook(&target_repo) {
                    Ok(hook_path) => {
                        println!(
                            "{} Satpam Pintu 1 (pre-commit hook) aktif di: {}",
                            "✔".green().bold(),
                            hook_path.display()
                        );
                        println!(
                            "  Setiap `git commit` kini otomatis diperiksa oleh `autore scan`!"
                        );
                        0
                    }
                    Err(e) => {
                        eprintln!("{} {}", "ERROR:".red().bold(), e);
                        1
                    }
                }
            }
            HookAction::Uninstall { repo } => {
                let target_repo = if interactive {
                    match pick_interactive_target_project(
                        repo,
                        "Pilih project yang ingin dicopot Satpam Git-nya:",
                        active_project,
                    ) {
                        Some(p) => p,
                        None => return 0,
                    }
                } else {
                    repo
                };
                match hooks::uninstall_pre_commit_hook(&target_repo) {
                    Ok(true) => {
                        println!("{} Pre-commit hook berhasil dicopot.", "✔".green().bold());
                        0
                    }
                    Ok(false) => {
                        println!("Info: Pre-commit hook belum terpasang.");
                        0
                    }
                    Err(e) => {
                        eprintln!("{} {}", "ERROR:".red().bold(), e);
                        1
                    }
                }
            }
            HookAction::Status { repo } => {
                if hooks::is_hook_installed(&repo) {
                    println!(
                        "{} Pre-commit hook Autore: {}",
                        "✔".green().bold(),
                        "AKTIF".green().bold()
                    );
                } else {
                    println!(
                        "{} Pre-commit hook Autore: {}",
                        "•".yellow().bold(),
                        "BELUM TERPASANG (jalankan `autore hook install`)".yellow()
                    );
                }
                0
            }
        },

        Commands::Doctor => {
            if doctor::print_doctor_report() {
                0
            } else {
                1
            }
        }

        Commands::Update => match updater::run_self_update() {
            Ok(Some(exe_path)) => {
                if interactive {
                    println!(
                        "  {} Memuat ulang Autore ke versi terbaru...",
                        "↻".cyan().bold()
                    );
                    if prompt_after_action() {
                        updater::restart_into(&exe_path);
                    }
                    process::exit(0);
                }
                0
            }
            Ok(None) => 0,
            Err(e) => {
                eprintln!("{} {e}", "ERROR:".red().bold());
                1
            }
        },

        Commands::Deploy {
            path,
            git_url,
            reconfigure,
        } => {
            let target_dir = if interactive {
                match pick_interactive_target_project(
                    path,
                    "Pilih project yang ingin disambungkan ke Jenkins:",
                    active_project,
                ) {
                    Some(p) => p,
                    None => return 0,
                }
            } else {
                path
            };

            let conf_path = jenkins::default_config_path();
            let jk_cfg = match ensure_jenkins_config(&conf_path, interactive, reconfigure) {
                Some(c) => c,
                None => return 0,
            };

            let job_name = jenkins::infer_project_job_name(&target_dir);
            let existing_remote = jenkins::read_git_remote_origin(&target_dir);
            let resolved_git_url = match (git_url, existing_remote) {
                (Some(u), _) => u,
                (None, Some(u)) => u,
                (None, None) if interactive => {
                    let default_repo = format!("https://github.com/tugure-git-intern/{job_name}.git");
                    match Text::new("URL repositori GitHub:")
                        .with_default(&default_repo)
                        .with_help_message("Enter pakai default • atau tempel URL repo GitHub")
                        .prompt()
                    {
                        Ok(u) => u.trim().to_string(),
                        Err(_) => return 0,
                    }
                }
                (None, None) => {
                    eprintln!(
                        "{} Remote git `origin` belum diatur. Gunakan `--git-url <URL>`.",
                        "ERROR:".red().bold()
                    );
                    return 1;
                }
            };

            println!(
                "{} Menyiapkan Git & mendaftarkan project '{}' ke Jenkins ({})...",
                "==>".cyan().bold(),
                job_name,
                jk_cfg.url
            );
            if let Err(e) = jenkins::ensure_git_committed_and_remote(&target_dir, &resolved_git_url) {
                eprintln!("{} {e}", "ERROR:".red().bold());
                return 1;
            }
            let _ = git_push_main(&target_dir);

            match jenkins::register_and_trigger_jenkins(&jk_cfg, &job_name, &resolved_git_url, "main")
            {
                Ok(job_url) => {
                    println!(
                        "\n{} Project '{}' berhasil disambungkan & di-build di Jenkins!",
                        "✔".green().bold(),
                        job_name
                    );
                    println!("  • Folder project : {}", target_dir.display());
                    println!("  • Repo Git       : {resolved_git_url}");
                    println!("  • Job Jenkins    : {job_url}");
                    println!("  • Status Build   : Sedang berjalan (notifikasi hasil akan dikirim ke Telegram)");
                    0
                }
                Err(e) => {
                    eprintln!("{} {e}", "ERROR:".red().bold());
                    if e.contains("401/403") {
                        let _ = std::fs::remove_file(&conf_path);
                        eprintln!(
                            "  {} Kredensial lama dihapus. Pilih menu ini lagi untuk memasukkan password baru.",
                            "ℹ".yellow()
                        );
                    }
                    1
                }
            }
        }

        Commands::QuickStart {
            path,
            app_name,
            stack,
            app_port,
            deploy_port,
        } => {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let base_dir = if path == std::path::Path::new(".") {
                cwd.clone()
            } else {
                path
            };

            let default_name = cwd
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.to_ascii_lowercase().replace(' ', "-"))
                .filter(|n| validate_app_name(n).is_ok())
                .unwrap_or_else(|| "project-baru".to_string());

            let resolved_name = match app_name {
                Some(n) => n.trim().to_string(),
                None if interactive => match Text::new("Nama project:")
                    .with_default(&default_name)
                    .with_help_message("Enter pakai nama folder saat ini")
                    .prompt()
                {
                    Ok(n) => n.trim().to_string(),
                    Err(_) => return 0,
                },
                None => default_name,
            };
            if let Err(e) = validate_app_name(&resolved_name) {
                eprintln!("{} {}", "ERROR:".red().bold(), e);
                return 1;
            }

            let resolved_stack = match stack {
                Some(s) => match TechStack::from_str_loose(&s) {
                    Some(st) => st,
                    None => {
                        eprintln!(
                            "{} Stack '{}' tidak dikenali. Pilih: python, nodejs, java, go",
                            "ERROR:".red().bold(),
                            s
                        );
                        return 1;
                    }
                },
                None if interactive => {
                    match Select::new("Teknologi project:", TechStack::all()).prompt() {
                        Ok(st) => st,
                        Err(_) => return 0,
                    }
                }
                None => TechStack::Python,
            };

            let resolved_app_port = app_port.unwrap_or_else(|| resolved_stack.default_port());
            let resolved_deploy_port = match deploy_port {
                Some(p) => {
                    if let Err(e) = validate_deploy_port(p) {
                        eprintln!("{} {}", "ERROR:".red().bold(), e);
                        return 1;
                    }
                    p
                }
                None => pick_free_port(8081),
            };

            let cfg = InitConfig {
                app_name: resolved_name,
                stack: resolved_stack,
                app_port: resolved_app_port,
                deploy_port: resolved_deploy_port,
            };
            let target_dir = resolve_interactive_project_dir(&base_dir, &cfg.app_name);

            println!(
                "\n{} Alur 1-klik — project '{}'",
                "●".cyan().bold(),
                cfg.app_name.bold()
            );
            println!("  • Folder      : {}", target_dir.display());
            println!("  • Teknologi   : {}", cfg.stack);
            println!("  • Port app    : {}", cfg.app_port);
            println!("  • Port deploy : {}\n", cfg.deploy_port);

            let mut effective_force = false;
            if has_existing_pipeline_files(&target_dir) {
                if !interactive {
                    eprintln!(
                        "{} Folder {} sudah punya Dockerfile/Jenkinsfile. Pilih folder lain.",
                        "ERROR:".red().bold(),
                        target_dir.display()
                    );
                    return 1;
                }
                let msg = format!(
                    "Folder {} sudah punya Dockerfile/Jenkinsfile. Timpa dengan yang baru?",
                    target_dir.display()
                );
                match Confirm::new(&msg).with_default(false).prompt() {
                    Ok(true) => effective_force = true,
                    _ => {
                        println!("{}", "  i Dibatalkan — file lama tidak diubah.".yellow());
                        return 0;
                    }
                }
            }
            match generate_project_files_with(&cfg, &target_dir, effective_force) {
                Ok(files) => {
                    println!("  {} File pipeline dibuat:", "1/4".green().bold());
                    for f in files {
                        println!("      • {}", f.display());
                    }
                }
                Err(e) => {
                    eprintln!("{} {e}", "ERROR:".red().bold());
                    return 1;
                }
            }
            let _ = std::env::set_current_dir(&target_dir);
            *active_project = Some(target_dir.clone());

            let token = match github::resolve_token() {
                Some(t) => t,
                None if interactive => {
                    println!(
                        "  {} Belum ada token GitHub. Buat sekali di https://github.com/settings/tokens (centang scope 'repo').",
                        "i".cyan().bold()
                    );
                    match Password::new("Token GitHub:")
                        .without_confirmation()
                        .with_display_mode(PasswordDisplayMode::Masked)
                        .prompt()
                    {
                        Ok(t) => match github::save_token(&t) {
                            Ok(p) => {
                                println!(
                                    "  {} Token GitHub tersimpan di {}",
                                    "✔".green().bold(),
                                    p.display()
                                );
                                t
                            }
                            Err(e) => {
                                eprintln!("{} {e}", "ERROR:".red().bold());
                                return 1;
                            }
                        },
                        Err(_) => return 0,
                    }
                }
                None => {
                    eprintln!(
                        "{} Token GitHub tidak ditemukan. Set AUTORE_GITHUB_TOKEN atau jalankan lewat menu.",
                        "ERROR:".red().bold()
                    );
                    return 1;
                }
            };

            let owner = match github::whoami(&token) {
                Ok(o) => o,
                Err(e) => {
                    eprintln!("{} {e}", "ERROR:".red().bold());
                    return 1;
                }
            };
            let (full_name, created) = match github::ensure_repo(&token, &owner, &cfg.app_name) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("{} {e}", "ERROR:".red().bold());
                    return 1;
                }
            };
            println!(
                "  {} Repo GitHub {} {}",
                "2/4".green().bold(),
                full_name,
                if created { "(baru dibuat)" } else { "(sudah ada)" }
            );

            let git_url = format!("https://github.com/{full_name}.git");
            if let Err(e) = jenkins::ensure_git_committed_and_remote(&target_dir, &git_url) {
                eprintln!("{} {e}", "ERROR:".red().bold());
                return 1;
            }
            println!("  {} Push ke Git...", "3/4".green().bold());
            if !git_push_main(&target_dir) {
                eprintln!(
                    "{} Gagal push ke {}. Pastikan token GitHub punya izin tulis ke repo itu.",
                    "ERROR:".red().bold(),
                    git_url
                );
                return 1;
            }
            println!("      • {} terkirim", git_url);

            let conf_path = jenkins::default_config_path();
            let jk_cfg = match ensure_jenkins_config(&conf_path, interactive, false) {
                Some(c) => c,
                None => return 1,
            };

            match jenkins::register_and_trigger_jenkins(&jk_cfg, &cfg.app_name, &git_url, "main") {
                Ok(job_url) => {
                    println!(
                        "\n{} Project '{}' siap & build-nya sudah jalan!",
                        "✔".green().bold(),
                        cfg.app_name
                    );
                    println!("  • Folder project : {}", target_dir.display());
                    println!("  • Repo GitHub    : {full_name}");
                    println!("  • Job Jenkins    : {job_url}");
                    println!("  • Status build   : berjalan (hasil dikirim ke Telegram)");
                    0
                }
                Err(e) => {
                    eprintln!("{} {e}", "ERROR:".red().bold());
                    if e.contains("401/403") {
                        let _ = std::fs::remove_file(&conf_path);
                        eprintln!(
                            "  {} Kredensial Jenkins lama dihapus. Ulangi menu ini untuk memasukkan password baru.",
                            "i".yellow()
                        );
                    }
                    1
                }
            }
        }

        Commands::DeleteProject => {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let candidates = discover_deletable_projects(&cwd);
            if candidates.is_empty() {
                println!(
                    "{}",
                    "  ℹ Tidak ada folder project Autore yang ditemukan di sekitar sini.".yellow()
                );
                return 0;
            }
            let labels: Vec<String> = candidates
                .iter()
                .map(|p| {
                    let name = p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("project");
                    if active_project.as_deref() == Some(p.as_path()) || p == &cwd {
                        format!("{name}  ({}, aktif)", p.display())
                    } else {
                        format!("{name}  ({})", p.display())
                    }
                })
                .collect();

            let picked = match Select::new("Pilih project yang ingin dihapus:", labels.clone())
                .with_help_message("↑/↓ geser • Enter pilih • Esc batal")
                .prompt()
            {
                Ok(choice) => choice,
                Err(_) => return 0,
            };
            let idx = labels.iter().position(|l| l == &picked).unwrap_or(0);
            let target = &candidates[idx];
            let name = target
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project");

            let confirm_msg = format!(
                "Yakin hapus permanen project '{}' ({})?",
                name,
                target.display()
            );
            match Confirm::new(&confirm_msg).with_default(false).prompt() {
                Ok(true) => match delete_project_safely(target, active_project) {
                    Ok(moved) => {
                        println!(
                            "\n{} Project '{}' berhasil dihapus ({})",
                            "✔".green().bold(),
                            name,
                            target.display()
                        );
                        if let Some(parent) = moved {
                            println!("  • Fokus direktori kembali ke: {}", parent.display());
                        }
                        0
                    }
                    Err(e) => {
                        eprintln!("{} {e}", "ERROR:".red().bold());
                        1
                    }
                },
                _ => {
                    println!("  {}", "ℹ Penghapusan dibatalkan.".yellow());
                    0
                }
            }
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn banner_fits_standard_80_col_terminal() {
        assert_eq!(BANNER_ROWS.len(), 6);
        for (row, _) in BANNER_ROWS {
            assert!(row.chars().count() <= 80);
        }
    }

    #[test]
    fn interactive_project_dir_creates_subfolder_unless_already_in_matching_dir() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().join("workspace");
        std::fs::create_dir_all(&base).unwrap();
        assert_eq!(
            resolve_interactive_project_dir(&base, "klaim-api"),
            base.join("klaim-api")
        );

        let same = base.join("klaim-api");
        std::fs::create_dir_all(&same).unwrap();
        assert_eq!(
            resolve_interactive_project_dir(&same, "klaim-api"),
            same
        );
    }

    #[test]
    fn interactive_project_dir_places_second_project_as_sibling_not_nested() {
        let tmp = TempDir::new().unwrap();
        let cfg_a = InitConfig {
            app_name: "project-a".to_string(),
            stack: TechStack::Python,
            app_port: 8000,
            deploy_port: 8081,
        };
        let (dir_a, _, _, _) = bootstrap_interactive_project(tmp.path(), &cfg_a, false).unwrap();
        assert_eq!(dir_a, tmp.path().join("project-a"));

        // Saat sudah berada di dalam project-a lalu buat project-b, harus sejajar di samping project-a
        let dir_b = resolve_interactive_project_dir(&dir_a, "project-b");
        assert_eq!(dir_b, tmp.path().join("project-b"));

        // Kalau ketik project-a lagi dari dalam project-a, tetap menunjuk ke project-a
        let dir_a_again = resolve_interactive_project_dir(&dir_a, "project-a");
        assert_eq!(dir_a_again, tmp.path().join("project-a"));
        assert!(has_existing_pipeline_files(&dir_a_again));
    }

    #[test]
    fn bootstrap_interactive_project_creates_dir_git_main_files_and_hook() {
        let tmp = TempDir::new().unwrap();
        let cfg = InitConfig {
            app_name: "klaim-api".to_string(),
            stack: TechStack::Python,
            app_port: 8000,
            deploy_port: 8081,
        };
        let (project_dir, files, hook_path, git_created) =
            bootstrap_interactive_project(tmp.path(), &cfg, false).unwrap();

        assert_eq!(project_dir, tmp.path().join("klaim-api"));
        assert!(git_created);
        assert_eq!(files.len(), 3);
        assert!(project_dir.join("Dockerfile").exists());
        assert!(project_dir.join("Jenkinsfile").exists());
        assert!(project_dir.join(".dockerignore").exists());
        assert!(hook_path.exists());
        assert!(hooks::is_hook_installed(&project_dir));

        let head = std::fs::read_to_string(project_dir.join(".git/HEAD")).unwrap();
        assert!(head.contains("refs/heads/main"), "expected branch main, got {head}");
    }

    #[test]
    fn discover_and_delete_project_safely_only_touches_valid_projects() {
        let tmp = TempDir::new().unwrap();
        let cfg_a = InitConfig {
            app_name: "project-a".to_string(),
            stack: TechStack::Python,
            app_port: 8000,
            deploy_port: 8081,
        };
        let cfg_b = InitConfig {
            app_name: "project-b".to_string(),
            stack: TechStack::NodeJs,
            app_port: 3000,
            deploy_port: 8081,
        };
        let (dir_a, _, _, _) = bootstrap_interactive_project(tmp.path(), &cfg_a, false).unwrap();
        let (dir_b, _, _, _) = bootstrap_interactive_project(tmp.path(), &cfg_b, false).unwrap();
        // Folder biasa tanpa Dockerfile/Jenkinsfile tidak boleh ikut muncul
        let plain = tmp.path().join("dokumen-biasa");
        std::fs::create_dir_all(&plain).unwrap();

        let found_from_root = discover_deletable_projects(tmp.path());
        assert_eq!(found_from_root, vec![dir_a.clone(), dir_b.clone()]);

        // Dari dalam project-a tetap bisa melihat project-a dan project-b
        let found_from_a = discover_deletable_projects(&dir_a);
        assert_eq!(found_from_a, vec![dir_a.clone(), dir_b.clone()]);

        let mut active = Some(dir_a.clone());
        delete_project_safely(&dir_a, &mut active).unwrap();
        assert!(!dir_a.exists());
        assert!(active.is_none());
        assert!(dir_b.exists());
        assert!(plain.exists());

        // Menolak menghapus folder yang bukan project Autore
        assert!(delete_project_safely(&plain, &mut active).is_err());
    }

    #[test]
    fn setiap_index_menu_dipetakan_ke_perintah_yang_benar() {
        assert!(matches!(commands_for(0), Commands::QuickStart { .. }));
        assert!(matches!(commands_for(1), Commands::Init { .. }));
        assert!(matches!(commands_for(2), Commands::DeleteProject));
        assert!(matches!(commands_for(3), Commands::Scan { .. }));
        assert!(matches!(commands_for(4), Commands::Deploy { .. }));
        assert!(matches!(
            commands_for(5),
            Commands::Hook {
                action: HookAction::Install { .. }
            }
        ));
        assert!(matches!(
            commands_for(6),
            Commands::Hook {
                action: HookAction::Uninstall { .. }
            }
        ));
        // 7 = Cek Kesehatan Sistem, lewat jalur default; index asing juga Doctor.
        assert!(matches!(commands_for(7), Commands::Doctor));
        assert!(matches!(commands_for(99), Commands::Doctor));
    }

    #[test]
    fn label_menu_selalu_bisa_dikembalikan_ke_index() {
        for (i, item) in MENU.iter().enumerate() {
            assert_eq!(label_index(item.label), Some(i), "label: {}", item.label);
        }
        assert_eq!(label_index("menu yang tidak ada"), None);
    }

    #[test]
    fn catatan_status_membedakan_sukses_dan_gagal() {
        assert_eq!(note_for(0, 0), format!("✔ terakhir: {}", MENU[0].label));

        let gagal = note_for(7, 1);
        assert!(gagal.starts_with("✘ terakhir: "), "{gagal}");
        assert!(gagal.contains(MENU[7].label), "{gagal}");
        assert!(gagal.ends_with("(keluar dengan kode 1)"), "{gagal}");
    }

    #[test]
    fn hanya_tombol_enter_yang_dianggap_lanjut() {
        use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
        let key = |code: KeyCode| Event::Key(KeyEvent::new(code, KeyModifiers::empty()));

        assert!(enter_pressed(Ok(key(KeyCode::Enter))));
        assert!(!enter_pressed(Ok(key(KeyCode::Char('q')))));
        assert!(!enter_pressed(Ok(key(KeyCode::Esc))));
        assert!(!enter_pressed(Ok(Event::Resize(80, 24))));
        assert!(!enter_pressed(Err(std::io::Error::other("stdin habis"))));
    }

    #[test]
    fn jeda_setelah_aksi_tidak_menggantung_kalau_bukan_terminal() {
        // Di dalam cargo test stdout bukan TTY: harus langsung false tanpa menunggu tombol.
        assert!(!prompt_after_action());
    }
}
