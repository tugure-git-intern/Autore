mod doctor;
mod external;
mod hooks;
mod scanner;
mod templates;
mod updater;

use clap::{Parser, Subcommand};
use colored::Colorize;
use inquire::ui::{Color, RenderConfig, StyleSheet, Styled};
use inquire::{Confirm, CustomType, Select, Text};
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
        .with_highlighted_option_prefix(Styled::new("❯").with_fg(orange))
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
            format!("• {name}  ({})", p.display())
        })
        .collect();
    labels.push(format!("• Folder saat ini  ({})", cwd.display()));

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

/// Tahan layar setelah aksi di menu selesai supaya hasil bacaan tidak langsung tertutup banner.
fn prompt_after_action() -> bool {
    println!();
    let opts = vec!["• Kembali ke Menu Utama", "• Keluar dari Autore"];
    matches!(
        Select::new("Selanjutnya:", opts)
            .with_help_message("Enter kembali ke menu • Esc keluar")
            .prompt(),
        Ok("• Kembali ke Menu Utama")
    )
}

fn prompt_main_menu(active_project: Option<&std::path::Path>) -> Option<Commands> {
    print_ascii_banner();
    if let Some(dir) = active_project {
        println!(
            " {} Folder project aktif: {}\n",
            "●".cyan().bold(),
            dir.display().to_string().bold()
        );
    }
    let items = vec![
        "• Buat Project Baru (Dockerfile & Jenkinsfile)",
        "• Hapus Project",
        "• Scan Keamanan Kode (Static + Gitleaks + Trivy)",
        "• Pasang Satpam Git (Pre-Commit Hook)",
        "• Copot Satpam Git (Uninstall Hook)",
        "• Cek Kesehatan Sistem (Doctor)",
        "• Update Autore",
    ];
    let choice = Select::new("Pilih:", items)
        .with_help_message("↑/↓ geser • Enter pilih • Esc selesai")
        .prompt()
        .ok()?;

    Some(match choice {
        "• Buat Project Baru (Dockerfile & Jenkinsfile)" => Commands::Init {
            app_name: None,
            stack: None,
            app_port: None,
            deploy_port: None,
            output_dir: PathBuf::from("."),
            force: false,
        },
        "• Hapus Project" => Commands::DeleteProject,
        "• Scan Keamanan Kode (Static + Gitleaks + Trivy)" => Commands::Scan {
            path: PathBuf::from("."),
            severity: "HIGH,CRITICAL".to_string(),
            no_docker: false,
            include_build_dirs: false,
            docker: false,
        },
        "• Pasang Satpam Git (Pre-Commit Hook)" => Commands::Hook {
            action: HookAction::Install { repo: PathBuf::from(".") },
        },
        "• Copot Satpam Git (Uninstall Hook)" => Commands::Hook {
            action: HookAction::Uninstall { repo: PathBuf::from(".") },
        },
        "• Update Autore" => Commands::Update,
        _ => Commands::Doctor,
    })
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
    while let Some(command) = prompt_main_menu(active_project.as_deref()) {
        let _ = execute_command(command, true, &mut active_project);
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
            Ok(()) => 0,
            Err(e) => {
                eprintln!("{} {e}", "ERROR:".red().bold());
                1
            }
        },

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
                        format!("• {name}  ({}, aktif)", p.display())
                    } else {
                        format!("• {name}  ({})", p.display())
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
}
