mod doctor;
mod external;
mod hooks;
mod scanner;
mod templates;

use clap::{Parser, Subcommand};
use colored::Colorize;
use inquire::ui::{Color, RenderConfig, StyleSheet, Styled};
use inquire::{CustomType, Select, Text};
use std::path::PathBuf;
use std::process;
use templates::{generate_project_files_with, validate_app_name, InitConfig, TechStack};

#[derive(Parser)]
#[command(
    name = "autore",
    version = "0.1.0",
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
        " \x1b[38;2;217;119;87m●\x1b[0m \x1b[38;2;217;119;87mDevSecOps & CI/CD Platform Tooling — v0.1.0\x1b[0m"
    );
    println!();
}

fn prompt_main_menu() -> Commands {
    print_ascii_banner();
    let items = vec![
        "• Buat Project Baru (Dockerfile & Jenkinsfile)",
        "• Scan Keamanan Kode (Static + Gitleaks + Trivy)",
        "• Pasang Satpam Git (Pre-Commit Hook)",
        "• Copot Satpam Git (Uninstall Hook)",
        "• Cek Kesehatan Sistem (Doctor)",
    ];
    let choice = Select::new("Pilih aksi:", items)
        .with_help_message("↑/↓ geser • Enter pilih • Esc batal")
        .prompt()
        .unwrap_or_else(|_| process::exit(0));

    match choice {
        "• Buat Project Baru (Dockerfile & Jenkinsfile)" => Commands::Init {
            app_name: None,
            stack: None,
            app_port: None,
            deploy_port: 8081,
            output_dir: PathBuf::from("."),
            force: false,
        },
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
        _ => Commands::Doctor,
    }
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
    inquire::set_global_render_config(claude_render_config());
    let cli = Cli::parse();
    let command = cli.command.unwrap_or_else(prompt_main_menu);

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
                None => Text::new("Nama aplikasi:")
                    .with_default("my-tugure-app")
                    .prompt()
                    .unwrap_or_else(|_| process::exit(1)),
            };
            if let Err(e) = validate_app_name(&resolved_name) {
                eprintln!("{} {}", "ERROR:".red().bold(), e);
                process::exit(1);
            }

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
                }
                Err(e) => {
                    eprintln!("{} {}", "ERROR:".red().bold(), e);
                    process::exit(1);
                }
            }
        }

        Commands::Scan { path, severity, no_docker, include_build_dirs, docker: _ } => {
            println!(
                "{} Memindai keamanan kode di '{}'...",
                "==>".cyan().bold(),
                path.display()
            );

            let scan_res = scanner::scan_directory_with(
                &path,
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
                        let _ = std::fs::write(".security-gate-reason", reasons.join("; "));
                        process::exit(1);
                    }
                    println!(
                        "  {} [1/3] Static Guard LULUS ({} file diperiksa).",
                        "✔".green().bold(),
                        report.scanned_files
                    );
                }
                Err(e) => {
                    eprintln!("{} {}", "ERROR:".red().bold(), e);
                    process::exit(1);
                }
            }

            if no_docker {
                println!(
                    "{}",
                    "⚠ Mode --no-docker: hanya static guard (NON-AUTHORITATIVE, Gitleaks & Trivy TIDAK dijalankan)."
                        .yellow()
                        .bold()
                );
            } else {
                if let Err(e) = external::run_authoritative_scan(&path, &severity) {
                    let (head, body) = e.split_once('\n').unwrap_or((&e, ""));
                    eprintln!("  {} {}", "✘".red().bold(), head);
                    if !body.trim().is_empty() {
                        eprintln!("{body}");
                    }
                    eprintln!(
                        "\n{} Perbaiki temuan di atas, lalu jalankan ulang: autore scan",
                        "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold()
                    );
                    let _ = std::fs::write(".security-gate-reason", head);
                    process::exit(1);
                }
            }

            println!(
                "{}",
                "✔ SEMUA PEMERIKSAAN KEAMANAN LULUS!".green().bold()
            );
        }

        Commands::ScanImage { image, severity, sbom_output, no_docker } => {
            println!(
                "{} Memeriksa keamanan Docker image '{}' (severity: {})...",
                "==>".cyan().bold(),
                image,
                severity
            );
            if image == "latest" || image.ends_with(":latest") {
                eprintln!("\n{} Tag :latest dilarang. Gunakan immutable commit tag.", "🚫 [AUTORE SECURITY GATE — DIBLOKIR]".red().bold());
                process::exit(1);
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
                    let _ = std::fs::write(".security-gate-reason", &e);
                    process::exit(1);
                }
            }
            println!(
                "{}",
                "✔ PEMERIKSAAN DOCKER IMAGE LULUS!".green().bold()
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


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_fits_standard_80_col_terminal() {
        assert_eq!(BANNER_ROWS.len(), 6);
        for (row, _) in BANNER_ROWS {
            assert!(row.chars().count() <= 80);
        }
    }
}
