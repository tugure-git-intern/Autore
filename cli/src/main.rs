mod doctor;
mod hooks;
mod scanner;
mod templates;

use clap::{Parser, Subcommand};
use colored::Colorize;
use inquire::{CustomType, Select, Text};
use std::path::PathBuf;
use std::process::{self, Command};
use templates::{ generate_project_files, InitConfig, TechStack };

#[derive(Parser)]
#[command(
    name = "autore",
    version = "0.1.0",
    about = "Autore CLI — DevSecOps & CI/CD Platform Tooling for Tugu Re IT Team"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
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

        /// Port host untuk deployment container
        #[arg(long, default_value_t = 8081)]
        deploy_port: u16,

        /// Direktori tujuan pembuatan file
        #[arg(long, default_value = ".")]
        output_dir: PathBuf,
    },

    /// Jalankan pemeriksaan keamanan (Static Code Guard, Secret Scan, & Dockerfile Check)
    Scan {
        /// Direktori proyek yang akan dipindai
        #[arg(long, short, default_value = ".")]
        path: PathBuf,

        /// Ikut menjalankan container Gitleaks & Trivy via Docker
        #[arg(long)]
        docker: bool,
    },

    /// Kelola Git Pre-Commit Hook (Satpam Pintu 1 sebelum git commit)
    Hook {
        #[command(subcommand)]
        action: HookAction,
    },

    /// Periksa kesehatan sistem Runner, Docker, Java, dan Jenkins
    Doctor,
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
    let cli = Cli::parse();

    match cli.command {
        Commands::Init {
            app_name,
            stack,
            app_port,
            deploy_port,
            output_dir,
        } => {
            let resolved_name = match app_name {
                Some(n) => n,
                None => Text::new("Nama aplikasi:")
                    .with_default("my-tugure-app")
                    .prompt()
                    .unwrap_or_else(|_| process::exit(1)),
            };

            let resolved_stack = match stack {
                Some(s) => TechStack::from_str_loose(&s).unwrap_or_else(|| {
                    eprintln!(
                        "{} Stack '{}' tidak dikenali. Pilih: python, nodejs, java, go",
                        "ERROR:".red().bold(),
                        s
                    );
                    process::exit(1);
                }),
                None => Select::new("Pilih bahasa / Tech Stack:", TechStack::all())
                    .prompt()
                    .unwrap_or_else(|_| process::exit(1)),
            };

            let resolved_port = match app_port {
                Some(p) => p,
                None => CustomType::<u16>::new("Port aplikasi di dalam container:")
                    .with_default(resolved_stack.default_port())
                    .prompt()
                    .unwrap_or_else(|_| process::exit(1)),
            };

            let cfg = InitConfig {
                app_name: resolved_name,
                stack: resolved_stack,
                app_port: resolved_port,
                deploy_port,
            };

            match generate_project_files(&cfg, &output_dir) {
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
                }
                Err(e) => {
                    eprintln!("{} {}", "ERROR:".red().bold(), e);
                    process::exit(1);
                }
            }
        }

        Commands::Scan { path, docker } => {
            println!(
                "{} Memindai keamanan kode di '{}'...",
                "==>".cyan().bold(),
                path.display()
            );

            match scanner::scan_directory(&path) {
                Ok(report) => {
                    if !report.is_clean() {
                        eprintln!(
                            "\n{}",
                            "🚫 [AUTORE SECURITY GATE — DIBLOKIR]"
                                .red()
                                .bold()
                        );
                        for v in &report.violations {
                            eprintln!(
                                "  {} {}:{} [{}] — {}",
                                "✘".red().bold(),
                                v.file.display(),
                                v.line,
                                v.rule.yellow(),
                                v.message
                            );
                        }
                        process::exit(1);
                    }
                    println!(
                        "  {} Static Code, Secret & Dockerfile Guard LULUS ({} file diperiksa).",
                        "✔".green().bold(),
                        report.scanned_files
                    );
                }
                Err(e) => {
                    eprintln!("{} {}", "ERROR:".red().bold(), e);
                    process::exit(1);
                }
            }

            if docker {
                let abs_path = path.canonicalize().unwrap_or(path);
                let script = abs_path.join("scripts").join("security-check.sh");
                if script.exists() {
                    let status = Command::new("bash")
                        .arg(&script)
                        .current_dir(&abs_path)
                        .status();
                    if !matches!(status, Ok(s) if s.success()) {
                        process::exit(1);
                    }
                }
            }

            println!(
                "{}",
                "✔ SEMUA PEMERIKSAAN KEAMANAN LULUS!".green().bold()
            );
        }

        Commands::Hook { action } => match action {
            HookAction::Install { repo } => match hooks::install_pre_commit_hook(&repo) {
                Ok(hook_path) => {
                    println!(
                        "{} Satpam Pintu 1 (pre-commit hook) aktif di: {}",
                        "✔".green().bold(),
                        hook_path.display()
                    );
                    println!(
                        "  Setiap `git commit` kini otomatis diperiksa oleh `autore scan`!"
                    );
                }
                Err(e) => {
                    eprintln!("{} {}", "ERROR:".red().bold(), e);
                    process::exit(1);
                }
            },
            HookAction::Uninstall { repo } => match hooks::uninstall_pre_commit_hook(&repo) {
                Ok(true) => println!("{} Pre-commit hook berhasil dicopot.", "✔".green().bold()),
                Ok(false) => println!("Info: Pre-commit hook belum terpasang."),
                Err(e) => {
                    eprintln!("{} {}", "ERROR:".red().bold(), e);
                    process::exit(1);
                }
            },
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
            }
        },

        Commands::Doctor => {
            if !doctor::print_doctor_report() {
                process::exit(1);
            }
        }
    }
}
