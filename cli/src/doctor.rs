use colored::Colorize;
use std::process::Command;

pub struct CheckResult {
    pub name: &'static str,
    pub ok: bool,
    pub detail: String,
}

fn run_cmd(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let e = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let combined = if !s.is_empty() { s } else { e };
    combined.lines().next().map(|l| l.to_string())
}

pub fn collect_checks() -> Vec<CheckResult> {
    let mut results = Vec::new();

    match run_cmd("git", &["--version"]) {
        Some(v) => results.push(CheckResult {
            name: "Git SCM",
            ok: true,
            detail: v,
        }),
        None => results.push(CheckResult {
            name: "Git SCM",
            ok: false,
            detail: "git tidak ditemukan di PATH".to_string(),
        }),
    }

    match run_cmd("java", &["-version"]) {
        Some(v) => results.push(CheckResult {
            name: "Java Runtime (Agent)",
            ok: true,
            detail: v,
        }),
        None => results.push(CheckResult {
            name: "Java Runtime (Agent)",
            ok: false,
            detail: "java tidak ditemukan (jalankan runner/setup-agent.sh)".to_string(),
        }),
    }

    match run_cmd("docker", &["--version"]) {
        Some(v) => results.push(CheckResult {
            name: "Docker Engine",
            ok: true,
            detail: v,
        }),
        None => results.push(CheckResult {
            name: "Docker Engine",
            ok: false,
            detail: "docker tidak ditemukan".to_string(),
        }),
    }

    match run_cmd("docker", &["compose", "version"]) {
        Some(v) => results.push(CheckResult {
            name: "Docker Compose",
            ok: true,
            detail: v,
        }),
        None => results.push(CheckResult {
            name: "Docker Compose",
            ok: false,
            detail: "docker compose v2 tidak ditemukan".to_string(),
        }),
    }

    match run_cmd("systemctl", &["is-active", "jenkins-agent"]) {
        Some(v) if v == "active" => results.push(CheckResult {
            name: "Jenkins Runner Service",
            ok: true,
            detail: "jenkins-agent.service (active / online)".to_string(),
        }),
        _ => results.push(CheckResult {
            name: "Jenkins Runner Service",
            ok: false,
            detail: "jenkins-agent.service tidak aktif".to_string(),
        }),
    }

    match run_cmd(
        "docker",
        &[
            "ps",
            "--filter",
            "name=autore-jenkins",
            "--format",
            "{{.Status}}",
        ],
    ) {
        Some(v) if !v.is_empty() => results.push(CheckResult {
            name: "Jenkins Controller (Sandbox)",
            ok: true,
            detail: format!("autore-jenkins ({})", v),
        }),
        _ => results.push(CheckResult {
            name: "Jenkins Controller (Sandbox)",
            ok: false,
            detail: "container autore-jenkins tidak berjalan di mesin ini".to_string(),
        }),
    }

    if std::path::Path::new("/usr/local/bin/autore").exists() {
        results.push(CheckResult {
            name: "Autore Global CLI (/usr/local/bin)",
            ok: true,
            detail: "/usr/local/bin/autore (tersedia untuk runner)".to_string(),
        });
    } else {
        results.push(CheckResult {
            name: "Autore Global CLI (/usr/local/bin)",
            ok: false,
            detail: "/usr/local/bin/autore belum ada (butuh sudo install)".to_string(),
        });
    }

    match run_cmd("df", &["-h", "/"]) {
        Some(_) => {
            let avail = Command::new("df")
                .args(["-h", "--output=pcent,avail", "/"])
                .output()
                .ok()
                .and_then(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .nth(1)
                        .map(|s| s.trim().to_string())
                })
                .unwrap_or_else(|| "tersedia".to_string());
            results.push(CheckResult {
                name: "Disk Storage (/)",
                ok: true,
                detail: format!("Terpakai / Sisa: {}", avail),
            });
        }
        None => results.push(CheckResult {
            name: "Disk Storage (/)",
            ok: false,
            detail: "gagal mengecek disk".to_string(),
        }),
    }

    results
}

pub fn print_doctor_report() -> bool {
    println!(
        "\n{}",
        "=== AUTORE DOCTOR — Diagnostik Kesiapan Platform CI/CD ==="
            .bold()
            .cyan()
    );
    let checks = collect_checks();
    let mut all_ok = true;

    for item in &checks {
        if item.ok {
            println!(
                "  {} {:<30} {}",
                "✔".green().bold(),
                item.name.bold(),
                item.detail.dimmed()
            );
        } else {
            all_ok = false;
            println!(
                "  {} {:<30} {}",
                "✘".red().bold(),
                item.name.bold(),
                item.detail.yellow()
            );
        }
    }

    println!();
    if all_ok {
        println!(
            "{}",
            "Status Sistem: SEHAT 100% — Runner & Pipeline siap digunakan!"
                .green()
                .bold()
        );
    } else {
        println!(
            "{}",
            "Status Sistem: Beberapa komponen belum aktif (lihat tanda ✘ di atas)."
                .yellow()
                .bold()
        );
    }
    all_ok
}
