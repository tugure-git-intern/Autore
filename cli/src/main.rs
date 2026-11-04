mod doctor;
mod external;
mod progress;
mod github;
mod hooks;
mod jenkins;
mod scanner;
mod serve;
mod status;
mod pipeline_record;
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
    let orange = Color::Rgb {
        r: 217,
        g: 119,
        b: 87,
    };
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
// Barisnya dipakai bersama TUI (banner tengah atas) — satu sumber kebenaran.
fn print_ascii_banner() {
    println!();
    for (line, (r, g, b)) in tui::BANNER {
        println!("\x1b[38;2;{r};{g};{b}m{line}\x1b[0m");
    }
    println!(
        " \x1b[38;2;217;119;87m●\x1b[0m \x1b[38;2;217;119;87mDevSecOps & CI/CD Platform Tooling — v{}\x1b[0m",
        env!("AUTORE_VERSION")
    );
    println!();
}

pub fn is_autore_project_dir(dir: &std::path::Path) -> bool {
    dir.join(".git").exists() || dir.join("Dockerfile").exists() || dir.join("Jenkinsfile").exists()
}

pub fn has_existing_pipeline_files(dir: &std::path::Path) -> bool {
    dir.join("Dockerfile").exists()
        || dir.join("Jenkinsfile").exists()
        || dir.join(".dockerignore").exists()
}

/// Folder belum punya kode aplikasi sama sekali (isinya cuma file pipeline yang kita buat).
/// Dipakai untuk memperingatkan lebih awal: tanpa kode, tahap deploy akan ditolak.
pub fn tanpa_kode_aplikasi(dir: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    !entries.filter_map(Result::ok).any(|e| {
        let name = e.file_name();
        let name = name.to_string_lossy();
        !matches!(name.as_ref(), "Dockerfile" | "Jenkinsfile" | ".dockerignore" | ".git")
    })
}

/// Cetak peringatan kalau folder tujuan belum berisi kode aplikasi.
pub fn peringatkan_folder_kosong(dir: &std::path::Path) {
    if tanpa_kode_aplikasi(dir) {
        println!(
            "  {} Folder ini belum berisi kode aplikasi. Pipeline tetap jalan sampai image dibuat, tapi tahap deploy akan ditolak sampai ada aplikasi yang bisa dijalankan.",
            "i".yellow().bold()
        );
    }
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
        let canon_target = target
            .canonicalize()
            .unwrap_or_else(|_| target.to_path_buf());
        if canon_cwd.starts_with(&canon_target) {
            if let Some(parent) = canon_target.parent() {
                let _ = std::env::set_current_dir(parent);
                moved_to = Some(parent.to_path_buf());
            }
        }
    }
    if let Some(act) = active_project {
        let canon_act = act.canonicalize().unwrap_or_else(|_| act.clone());
        let canon_target = target
            .canonicalize()
            .unwrap_or_else(|_| target.to_path_buf());
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
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("project");
            format!("{name}  ({})", p.display())
        })
        .collect();
    labels.push(format!("Folder saat ini  ({})", cwd.display()));

    let idx = ui_ask_choose(prompt_title, &labels)?;
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
/// ponytail: sengaja tetap di layar normal — kotak TUI (alternate screen) akan menutupi
/// hasil perintah sebelum sempat dibaca. Pindah ke TUI setelah output tampil di panel log.
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

// ── Jalur prompt interaktif ──────────────────────────────────────────────────
// Sesi TUI hidup -> pertanyaan muncul di baris input bawah, user tidak keluar layar.
// Tanpa sesi (output dipipe, perintah `autore <cmd>` satu kali) -> `inquire` seperti semula.
// ponytail: satu tempat; begitu semua prompt pindah TUI, hapus cabang `inquire`-nya.

/// Ada sesi TUI yang bisa menjawab pertanyaan? (kalau tidak: `inquire` biasa)
fn tui_hidup() -> bool {
    tui::hub_active()
}

fn ui_ask_text(label: &str, default: &str) -> Option<String> {
    if tui_hidup() {
        tui::ask_text(label, default)
    } else {
        Text::new(label).with_default(default).prompt().ok()
    }
}

fn ui_ask_secret(label: &str) -> Option<String> {
    if tui_hidup() {
        tui::ask_secret(label)
    } else {
        Password::new(label)
            .without_confirmation()
            .with_display_mode(PasswordDisplayMode::Masked)
            .prompt()
            .ok()
    }
}

/// Pilih satu dari `options`; hasil = index. `None` = batal.
fn ui_ask_choose(label: &str, options: &[String]) -> Option<usize> {
    if tui_hidup() {
        tui::ask_choice(label, options)
    } else {
        let picked = Select::new(label, options.to_vec()).prompt().ok()?;
        options.iter().position(|o| *o == picked)
    }
}

fn ui_ask_confirm(label: &str, default_ya: bool) -> Option<bool> {
    if tui_hidup() {
        tui::ask_yes_no(label, default_ya)
    } else {
        Confirm::new(label).with_default(default_ya).prompt().ok()
    }
}

/// Angka (port) lewat kotak teks TUI; salah ketik -> tanya ulang.
fn ui_ask_u16(label: &str, default: u16) -> Option<u16> {
    if !tui_hidup() {
        return CustomType::<u16>::new(label)
            .with_default(default)
            .prompt()
            .ok();
    }
    loop {
        let isi = tui::ask_text(label, &default.to_string())?;
        if let Ok(v) = isi.trim().parse::<u16>() {
            return Some(v);
        }
    }
}

/// Label tech stack untuk kotak pilih.
fn stack_labels() -> Vec<String> {
    TechStack::all().iter().map(|s| s.to_string()).collect()
}

/// Tech stack dari index kotak pilih.
fn stack_at(index: usize) -> Option<TechStack> {
    TechStack::all().get(index).copied()
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
            kode: "kosong".to_string(),
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
        format!(
            "✘ terakhir: {} (keluar dengan kode {code})",
            MENU[index].label
        )
    }
}

/// Label folder project aktif untuk segmen kiri baris status.
/// Project aktif saat program dibuka: folder saat ini kalau memang folder project.
fn project_aktif_awal(cwd: &std::path::Path) -> Option<PathBuf> {
    is_autore_project_dir(cwd).then(|| cwd.to_path_buf())
}

fn project_label(active: Option<&std::path::Path>) -> Option<String> {
    active.map(|p| p.display().to_string())
}

/// Menu utama mode teks — dipakai kalau output dipipe atau TUI tak tersedia.
fn prompt_main_menu(
    active_project: Option<&std::path::Path>,
    last_note: Option<&str>,
) -> Option<(usize, Commands)> {
    print_ascii_banner();
    if let Some(dir) = active_project {
        println!(
            " {} Folder project aktif: {}\n",
            "●".cyan().bold(),
            dir.display().to_string().bold()
        );
    }
    if let Some(note) = last_note {
        println!("  {note}\n");
    }
    let labels: Vec<&str> = MENU.iter().map(|i| i.label).collect();
    let picked = Select::new("Pilih:", labels)
        .with_help_message("↑/↓ geser • Enter pilih • Esc selesai")
        .prompt()
        .ok()?;
    Some((label_index(picked)?, commands_for(label_index(picked)?)))
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
    let url = ui_ask_text("URL Jenkins", "http://127.0.0.1:8080")?;
    let user = ui_ask_text("Username Jenkins", "admin")?;
    let token = ui_ask_secret("Password / API Token Jenkins")?;
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

        /// Isi kode contoh kalau folder masih kosong (`contoh`) atau biarkan apa adanya (`kosong`)
        #[arg(long, default_value = "kosong")]
        kode: String,

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

    /// Jalankan dashboard web: satu kotak "Buat" yang menjalankan alur 1-klik
    Serve {
        /// Port dashboard
        #[arg(long, short, default_value_t = 9119)]
        port: u16,

        /// Alamat yang di-bind (127.0.0.1 = hanya mesin ini, 0.0.0.0 = seluruh jaringan)
        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        /// Jangan buka browser otomatis
        #[arg(long, short = 'n')]
        no_browser: bool,
    },

    /// Tampilkan kemampuan mesin ini sebagai data (dipakai dashboard web)
    Kemampuan,

    /// Status sistem & pipeline terakhir dari simpanan pipeline (dipakai dashboard web)
    Status {
        /// Cetak satu objek JSON kanonik sesuai kontrak dashboard
        #[arg(long)]
        json: bool,
    },

    /// Catat kemajuan pipeline ke simpanan status (dipakai pipeline Jenkins)
    Pipeline {
        #[command(subcommand)]
        aksi: PipelineAksi,
    },
}

#[derive(Subcommand)]
enum PipelineAksi {
    /// Rekam satu peristiwa (tahap/status/log) ke dashboard-status.json
    Record(pipeline_record::Rekaman),
}

/// Kemampuan mesin ini sebagai data. Dashboard web menyusun pertanyaannya dari
/// sini, jadi wajah web tidak perlu ditebak-tebak.
///
/// ATURAN: tambah pertanyaan HANYA kalau flag pasangannya (`flag`) benar-benar ada
/// di subcommand dan dihormati. Pertanyaan yang belum bisa dilaksanakan jangan
/// ditampilkan. Serve (`serve.rs`) memetakan `id` -> `flag`; ubah keduanya bersama.
pub(crate) fn kemampuan_json() -> String {
    let pertanyaan = [
        r#"{"id":"nama","flag":"--app-name","jenis":"teks","label":"Nama aplikasi","wajib":true,"pola":"^[a-z0-9][a-z0-9_-]{0,62}$","contoh":"aplikasi-absensi","bantuan":"Huruf kecil, angka, tanda minus. Dipakai untuk nama repo dan nama aplikasi di server."}"#,
        r#"{"id":"kode","flag":"--kode","jenis":"pilihan","label":"Isi kode contoh?","bawaan":"contoh","bantuan":"Kalau folder belum ada kodenya, pipeline tetap jalan tapi tahap pemasangan akan ditolak. Contoh kecil dari Autore langsung bisa dibuka.","pilihan":[{"nilai":"contoh","label":"Ya, taruh contoh kecil (langsung bisa dibuka)"},{"nilai":"kosong","label":"Tidak, saya sudah punya kode sendiri"}]}"#,
        r#"{"id":"alamat","flag":"--deploy-port","jenis":"pilihan","label":"Alamat di server","bawaan":"otomatis","bantuan":"Port di server untuk membuka aplikasinya. Pilih otomatis supaya tidak bentrok dengan aplikasi lain.","pilihan":[{"nilai":"otomatis","label":"Pilih otomatis (paling aman)"},{"nilai":"sendiri","label":"Saya tentukan nomor portnya"}]}"#,
    ];
    format!(
        r#"{{"versi":"{}","perintah":[{{"id":"buat-baru","judul":"Buat aplikasi baru","ringkas":"Autore menyiapkan berkas pipeline, membuat repo GitHub, mendaftarkannya ke Jenkins, lalu memasang aplikasinya di server.","pertanyaan":[{}]}}]}}"#,
        env!("CARGO_PKG_VERSION"),
        pertanyaan.join(",")
    )
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

    // Sudah berdiri di dalam folder project (.git/Dockerfile/Jenkinsfile)? Pakai sebagai project aktif,
    // jadi status bar tidak lagi bilang "(belum ada project)".
    let mut active_project: Option<PathBuf> = std::env::current_dir()
        .ok()
        .and_then(|cwd| project_aktif_awal(&cwd));
    let mut last_note: Option<String> = None;

    // Terminal interaktif -> satu sesi TUI untuk seluruh alur: menu, log proses, dan
    // pertanyaan semua di layar yang sama. Output dipipe -> daftar teks seperti semula.
    if !std::io::stdout().is_terminal() {
        text_menu_loop(&mut active_project, &mut last_note);
        return;
    }
    let Some(mut sesi) = tui::Session::start(MENU, project_label(active_project.as_deref())) else {
        text_menu_loop(&mut active_project, &mut last_note);
        return;
    };

    // Folder project aktif dipakai bareng thread pekerja, jadi dibagi lewat Arc<Mutex>.
    let proyek = std::sync::Arc::new(std::sync::Mutex::new(active_project.clone()));
    while let Some(index) = sesi.pick() {
        if let Some(note) = last_note.take() {
            sesi.set_status(note);
        }
        let command = commands_for(index);
        let label = MENU[index].label;
        let proyek_thread = std::sync::Arc::clone(&proyek);
        let code = sesi.run(label, move || {
            let mut aktif = proyek_thread.lock().unwrap_or_else(|e| e.into_inner());
            execute_command(command, true, &mut aktif)
        });
        last_note = Some(note_for(index, code));
        sesi.set_status(note_for(index, code));
        let kini = proyek.lock().unwrap_or_else(|e| e.into_inner()).clone();
        sesi.set_project(project_label(kini.as_deref()));
    }
    sesi.close();
}

/// Menu utama mode teks sampai user keluar (dipakai kalau TUI tidak bisa dipakai).
fn text_menu_loop(active_project: &mut Option<PathBuf>, last_note: &mut Option<String>) {
    while let Some((index, command)) =
        prompt_main_menu(active_project.as_deref(), last_note.as_deref())
    {
        let code = execute_command(command, true, active_project);
        *last_note = Some(note_for(index, code));
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
                None => match ui_ask_text("Nama aplikasi", "") {
                    Some(n) => n.trim().to_string(),
                    None => return 1,
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
                None => match ui_ask_choose("Pilih bahasa / Tech Stack", &stack_labels())
                    .and_then(stack_at)
                {
                    Some(st) => st,
                    None => return 1,
                },
            };

            let resolved_port = match app_port {
                Some(p) => p,
                None => match ui_ask_u16(
                    "Port aplikasi di dalam container",
                    resolved_stack.default_port(),
                ) {
                    Some(p) => p,
                    None => return 1,
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
                    match ui_ask_u16("Port deploy di server (host)", 8081) {
                        Some(p) => match validate_deploy_port(p) {
                            Ok(()) => break p,
                            Err(e) => eprintln!("{} {e}", "ERROR:".red().bold()),
                        },
                        None => return 1,
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
                    if ui_ask_confirm(&prompt_msg, false) == Some(true) {
                        effective_force = true;
                    } else {
                        println!(
                            "{}",
                            "  i Dibatalkan — file project lama tidak diubah.".yellow()
                        );
                        return 0;
                    }
                }
                match bootstrap_interactive_project(&cwd, &cfg, effective_force) {
                    Ok((project_dir, files, hook_path, git_created)) => {
                        let _ = std::env::set_current_dir(&project_dir);
                        *active_project = Some(project_dir.clone());
                        println!(
                            "\n{}",
                            "✔ Project baru berhasil disiapkan otomatis:".green().bold()
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
                        peringatkan_folder_kosong(&output_dir);
                        0
                    }
                    Err(e) => {
                        eprintln!("{} {}", "ERROR:".red().bold(), e);
                        1
                    }
                }
            }
        }

        Commands::Scan {
            path,
            severity,
            no_docker,
            include_build_dirs,
            docker: _,
        } => {
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
                &scanner::ScanOptions {
                    skip_build_dirs: !include_build_dirs,
                },
            );
            match scan_res {
                Ok(report) => {
                    if !report.is_clean() {
                        eprintln!("\n{}", "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold());
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

            println!("{}", "✔ SEMUA PEMERIKSAAN KEAMANAN LULUS!".green().bold());
            0
        }

        Commands::ScanImage {
            image,
            severity,
            sbom_output,
            no_docker,
        } => {
            clear_gate_reason();
            println!(
                "{} Memeriksa keamanan Docker image '{}' (severity: {})...",
                "==>".cyan().bold(),
                image,
                severity
            );
            if image == "latest" || image.ends_with(":latest") {
                eprintln!(
                    "\n{} Tag :latest dilarang. Gunakan immutable commit tag.",
                    "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold()
                );
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
                    eprintln!(
                        "\n{} {}",
                        "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold(),
                        e
                    );
                    write_gate_reason(e.lines().next().unwrap_or(&e));
                    return 1;
                }
            }
            println!("{}", "✔ PEMERIKSAAN DOCKER IMAGE LULUS!".green().bold());
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
                // Di sesi TUI jangan exit dari thread pekerja: terminal belum dipulihkan.
                // ponytail: belum restart otomatis; tambah kalau sesi bisa di-close dari sini.
                if tui_hidup() {
                    println!(
                        "  {} Update terpasang. Tekan q lalu jalankan `autore` lagi.",
                        "↻".cyan().bold()
                    );
                    return 0;
                }
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
                // Menu interaktif: batal memilih = keluar tenang. Jalur satu-perintah
                // (dipakai dashboard lewat API) tidak boleh mengaku sukses saat tidak ada
                // yang dikerjakan — pemanggil butuh membedakan gagal dan berhasil.
                None => return if interactive { 0 } else { 1 },
            };

            let job_name = jenkins::infer_project_job_name(&target_dir);
            let existing_remote = jenkins::read_git_remote_origin(&target_dir);
            let resolved_git_url = match (git_url, existing_remote) {
                (Some(u), _) => u,
                (None, Some(u)) => u,
                (None, None) if interactive => {
                    let default_repo =
                        format!("https://github.com/tugure-git-intern/{job_name}.git");
                    match ui_ask_text("URL repositori GitHub", &default_repo) {
                        Some(u) => u.trim().to_string(),
                        None => return 0,
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
            if let Err(e) = jenkins::ensure_git_committed_and_remote(&target_dir, &resolved_git_url)
            {
                eprintln!("{} {e}", "ERROR:".red().bold());
                return 1;
            }
            let _ = git_push_main(&target_dir);

            match jenkins::register_and_trigger_jenkins(
                &jk_cfg,
                &job_name,
                &resolved_git_url,
                "main",
            ) {
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

        Commands::Kemampuan => {
            println!("{}", kemampuan_json());
            0
        }

        Commands::Status { json } => {
            // Satu sumber: apa yang ditulis pipeline (serve) + registry + docker.
            // Peringatan (kalau ada) harus ke stderr supaya stdout tetap satu JSON.
            let snap = status::build(&serve::workspace_dir());
            if json {
                println!("{}", status::canonical(&snap));
                return 0;
            }
            println!(
                "\n{} Status Sistem: {}\n",
                "==>".cyan().bold(),
                snap.system_status
            );
            println!(
                "  • Infrastruktur : jenkins={} nexus={}",
                snap.infra.jenkins, snap.infra.nexus
            );
            println!(
                "  • Aplikasi      : {} terdaftar, {} container jalan",
                snap.stats.total_apps, snap.stats.running_containers
            );
            if snap.applications.is_empty() {
                println!("  • (belum ada aplikasi yang didaftarkan)");
            }
            for a in &snap.applications {
                println!("    - {:<28} {}", a.name, a.status);
            }
            println!(
                "  • Pipeline      : {} ({} tahap)",
                snap.latest_pipeline.status,
                snap.latest_pipeline.stages.len()
            );
            if !snap.latest_pipeline.failure_reason.is_empty() {
                println!(
                    "    {} {}",
                    "SEBAB:".red().bold(),
                    snap.latest_pipeline.failure_reason
                );
            }
            0
        }

        Commands::Pipeline {
            aksi: PipelineAksi::Record(rekaman),
        } => pipeline_record::jalankan(&rekaman),

        Commands::QuickStart {
            path,
            app_name,
            stack,
            app_port,
            deploy_port,
            kode,
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
                None if interactive => match ui_ask_text("Nama project", &default_name) {
                    Some(n) => n.trim().to_string(),
                    None => return 0,
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
                    match ui_ask_choose("Teknologi project", &stack_labels()).and_then(stack_at) {
                        Some(st) => st,
                        None => return 0,
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

            let pilihan_kode = kode.trim().to_lowercase();
            if pilihan_kode != "contoh" && pilihan_kode != "kosong" {
                eprintln!(
                    "{} Pilihan kode '{}' tidak dikenal. Pakai: contoh atau kosong",
                    "ERROR:".red().bold(),
                    kode
                );
                return 1;
            }
            // Ditulis lebih dulu supaya tahap pemasangan tidak ditolak karena folder
            // kosong. `tulis_kode_contoh` tidak pernah menimpa berkas yang sudah ada,
            // jadi aman dipanggil walau folder sudah berisi aplikasi sendiri.
            if pilihan_kode == "contoh" {
                match templates::tulis_kode_contoh(&target_dir, cfg.stack) {
                    Ok(dibuat) if !dibuat.is_empty() => {
                        println!("  • Kode contoh : {} ditulis", dibuat.join(", "))
                    }
                    Ok(_) => println!(
                        "  • Kode contoh : sudah ada, tidak ditimpa ({})",
                        target_dir.display()
                    ),
                    Err(e) => {
                        eprintln!("{} Gagal menulis kode contoh: {e}", "ERROR:".red().bold());
                        return 1;
                    }
                }
            }

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
                if ui_ask_confirm(&msg, false) == Some(true) {
                    effective_force = true;
                } else {
                    println!("{}", "  i Dibatalkan — file lama tidak diubah.".yellow());
                    return 0;
                }
            }
            match generate_project_files_with(&cfg, &target_dir, effective_force) {
                Ok(files) => {
                    println!("  {} File pipeline dibuat:", "1/4".green().bold());
                    for f in files {
                        println!("      • {}", f.display());
                    }
                    peringatkan_folder_kosong(&target_dir);
                    progress::tahap("kerangka", "selesai", "Kerangka aplikasi & pipeline siap.");
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
                    match ui_ask_secret("Token GitHub") {
                        Some(t) => match github::save_token(&t) {
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
                        None => return 0,
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
                if created {
                    "(baru dibuat)"
                } else {
                    "(sudah ada)"
                }
            );
            progress::tahap("repo", "selesai", &format!("Repo GitHub {full_name} siap."));

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
            progress::tahap("kirim", "selesai", "Kode terkirim ke GitHub.");

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
                    progress::tahap(
                        "jenkins",
                        "selesai",
                        "Terdaftar di Jenkins, build mulai berjalan.",
                    );
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

        Commands::Serve {
            port,
            host,
            no_browser,
        } => serve::run(port, host, !no_browser),

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
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("project");
                    if active_project.as_deref() == Some(p.as_path()) || p == &cwd {
                        format!("{name}  ({}, aktif)", p.display())
                    } else {
                        format!("{name}  ({})", p.display())
                    }
                })
                .collect();

            let idx = match ui_ask_choose("Pilih project yang ingin dihapus", &labels) {
                Some(i) => i,
                None => return 0,
            };
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
            if ui_ask_confirm(&confirm_msg, false) == Some(true) {
                match delete_project_safely(target, active_project) {
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
                }
            } else {
                println!("  {}", "i Penghapusan dibatalkan.".yellow());
                0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn project_aktif_awal_mengikuti_folder_saat_ini() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(
            project_aktif_awal(tmp.path()),
            None,
            "folder kosong bukan project"
        );
        std::fs::create_dir(tmp.path().join(".git")).unwrap();
        assert_eq!(
            project_aktif_awal(tmp.path()),
            Some(tmp.path().to_path_buf())
        );
        let lain = TempDir::new().unwrap();
        std::fs::write(lain.path().join("Jenkinsfile"), "pipeline {}").unwrap();
        assert_eq!(
            project_aktif_awal(lain.path()),
            Some(lain.path().to_path_buf())
        );
    }

    #[test]
    fn stack_kotak_pilih_cocok_dengan_techstack() {
        let labels = stack_labels();
        assert_eq!(labels.len(), TechStack::all().len());
        assert_eq!(stack_at(0), Some(TechStack::Python));
        assert_eq!(labels[0], TechStack::Python.to_string());
        assert_eq!(
            stack_at(99),
            None,
            "index di luar daftar = batal, bukan panic"
        );
    }

    #[test]
    fn prompt_interaktif_menyerah_rapi_tanpa_terminal() {
        // `cargo test` tanpa TTY: jalur prompt harus balik None, bukan panic/menggantung.
        assert_eq!(ui_ask_text("Nama", "x"), None);
        assert_eq!(ui_ask_secret("Token"), None);
        assert_eq!(ui_ask_choose("Pilih", &["a".to_string()]), None);
        assert_eq!(ui_ask_confirm("Yakin?", false), None);
        assert_eq!(ui_ask_u16("Port", 8081), None);
    }

    fn init_cmd(stack: Option<&str>, app_port: Option<u16>) -> Commands {
        Commands::Init {
            app_name: Some("demo-app".to_string()),
            stack: stack.map(str::to_string),
            app_port,
            deploy_port: None,
            output_dir: PathBuf::from("."),
            force: false,
        }
    }

    #[test]
    fn init_interaktif_berhenti_saat_prompt_batal() {
        // Tanpa TTY setiap kotak tanya = batal -> alur berhenti (kode 1), tidak menulis file.
        let mut act = None;
        let tanpa_nama = Commands::Init {
            app_name: None,
            stack: None,
            app_port: None,
            deploy_port: None,
            output_dir: PathBuf::from("."),
            force: false,
        };
        assert_eq!(execute_command(tanpa_nama, true, &mut act), 1);
        assert_eq!(execute_command(init_cmd(None, None), true, &mut act), 1);
        assert_eq!(
            execute_command(init_cmd(Some("python"), None), true, &mut act),
            1
        );
        assert_eq!(
            execute_command(init_cmd(Some("python"), Some(8000)), true, &mut act),
            1
        );
        assert!(act.is_none());
    }

    #[test]
    fn kemampuan_cuma_menjanjikan_flag_yang_benar_benar_ada() {
        use clap::CommandFactory;
        let json = kemampuan_json();
        let mut quick = Cli::command()
            .get_subcommands()
            .find(|c| c.get_name() == "quick-start")
            .expect("subcommand quick-start ada")
            .clone();
        let bantuan = quick.render_long_help().to_string();
        for flag in ["--app-name", "--kode", "--deploy-port"] {
            assert!(json.contains(flag), "{flag} hilang dari kemampuan");
            assert!(
                bantuan.contains(flag),
                "{flag} dijanjikan ke web tapi tidak ada di CLI"
            );
        }
        assert!(json.contains("buat-baru"));
        assert_eq!(json.matches("\"id\":\"").count(), 4, "3 pertanyaan + 1 perintah");
    }

    #[test]
    fn kemampuan_json_utuh() {
        let json = kemampuan_json();
        assert!(json.starts_with('{') && json.ends_with('}'));
        assert_eq!(
            json.matches('{').count(),
            json.matches('}').count(),
            "kurung kurawal tidak seimbang"
        );
        assert_eq!(json.matches('[').count(), json.matches(']').count());
    }

    #[test]
    fn quickstart_interaktif_batal_tidak_menimpa_file_lama() {
        let tmp = TempDir::new().unwrap();
        let qs = |name: Option<&str>, stack: Option<&str>| Commands::QuickStart {
            path: tmp.path().to_path_buf(),
            app_name: name.map(str::to_string),
            stack: stack.map(str::to_string),
            app_port: None,
            deploy_port: None,
            kode: "kosong".to_string(),
        };
        let mut act = None;
        assert_eq!(execute_command(qs(None, None), true, &mut act), 0);
        assert_eq!(
            execute_command(qs(Some("demo-app"), None), true, &mut act),
            0
        );

        let dir = tmp.path().join("demo-app");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Dockerfile"), "FROM lama").unwrap();
        assert_eq!(
            execute_command(qs(Some("demo-app"), Some("python")), true, &mut act),
            0
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("Dockerfile")).unwrap(),
            "FROM lama",
            "konfirmasi batal = file lama utuh"
        );
        assert!(act.is_none());
    }

    #[test]
    fn setup_jenkins_interaktif_batal_tidak_menyimpan() {
        let tmp = TempDir::new().unwrap();
        let conf = tmp.path().join("jenkins.toml");
        assert!(ensure_jenkins_config(&conf, true, false).is_none());
        assert!(!conf.exists());
    }

    #[test]
    fn banner_fits_standard_80_col_terminal() {
        assert_eq!(tui::BANNER.len(), 6);
        for (row, _) in tui::BANNER {
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
        assert_eq!(resolve_interactive_project_dir(&same, "klaim-api"), same);
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
    fn deteksi_folder_tanpa_kode_aplikasi() {
        let tmp = TempDir::new().unwrap();
        // Folder baru: belum ada kode sama sekali.
        assert!(tanpa_kode_aplikasi(tmp.path()));

        // Cuma file pipeline yang kita generate -> masih dianggap kosong.
        std::fs::write(tmp.path().join("Dockerfile"), "FROM python:3.12-slim\n").unwrap();
        std::fs::write(tmp.path().join("Jenkinsfile"), "// pipeline\n").unwrap();
        std::fs::create_dir(tmp.path().join(".git")).unwrap();
        assert!(tanpa_kode_aplikasi(tmp.path()));

        // Begitu ada kode aplikasi -> tidak kosong lagi.
        std::fs::write(tmp.path().join("app.py"), "print('halo')\n").unwrap();
        assert!(!tanpa_kode_aplikasi(tmp.path()));
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
        assert!(
            head.contains("refs/heads/main"),
            "expected branch main, got {head}"
        );
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

    #[test]
    fn status_mendukung_flag_json_lewat_cli() {
        use clap::CommandFactory;
        let mut status = Cli::command()
            .get_subcommands()
            .find(|c| c.get_name() == "status")
            .expect("subcommand status ada")
            .clone();
        let bantuan = status.render_long_help().to_string();
        assert!(bantuan.contains("--json"), "{bantuan}");
    }
}
