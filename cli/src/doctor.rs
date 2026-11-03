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

fn check_cmd(name: &'static str, prog: &str, args: &[&str], missing_msg: &str) -> CheckResult {
    match run_cmd(prog, args) {
        Some(v) => CheckResult {
            name,
            ok: true,
            detail: v,
        },
        None => CheckResult {
            name,
            ok: false,
            detail: missing_msg.to_string(),
        },
    }
}

fn check_container(name: &'static str, container: &str) -> CheckResult {
    let filter = format!("name={container}");
    match run_cmd(
        "docker",
        &["ps", "--filter", &filter, "--format", "{{.Status}}"],
    ) {
        Some(v) if !v.is_empty() => CheckResult {
            name,
            ok: true,
            detail: format!("{container} ({v})"),
        },
        _ => CheckResult {
            name,
            ok: false,
            detail: format!("container {container} tidak berjalan"),
        },
    }
}

pub fn collect_checks() -> Vec<CheckResult> {
    let mut results = vec![
        check_cmd(
            "Git SCM",
            "git",
            &["--version"],
            "git tidak ditemukan di PATH",
        ),
        check_cmd(
            "Java Runtime (Agent)",
            "java",
            &["-version"],
            "java tidak ditemukan (jalankan runner/setup-agent.sh)",
        ),
        check_cmd(
            "Docker Engine",
            "docker",
            &["--version"],
            "docker tidak ditemukan",
        ),
        check_cmd(
            "Docker Compose",
            "docker",
            &["compose", "version"],
            "docker compose v2 tidak ditemukan",
        ),
    ];

    let agent_active = run_cmd("systemctl", &["is-active", "jenkins-agent"])
        .map(|v| v == "active")
        .unwrap_or(false);
    results.push(CheckResult {
        name: "Jenkins Runner Service",
        ok: agent_active,
        detail: if agent_active {
            "jenkins-agent.service (active / online)"
        } else {
            "jenkins-agent.service tidak aktif"
        }
        .to_string(),
    });

    for (label, cname) in [
        ("Jenkins Controller (Sandbox)", "autore-jenkins"),
        ("SonarQube SAST Server", "autore-sonarqube"),
        ("Sonatype Nexus Registry", "autore-nexus"),
    ] {
        results.push(check_container(label, cname));
    }

    let bin_ok = std::path::Path::new("/usr/local/bin/autore").exists();
    results.push(CheckResult {
        name: "Autore Global CLI (/usr/local/bin)",
        ok: bin_ok,
        detail: if bin_ok {
            "/usr/local/bin/autore (tersedia untuk runner)"
        } else {
            "/usr/local/bin/autore belum ada (butuh sudo install)"
        }
        .to_string(),
    });

    let disk_avail = Command::new("df")
        .args(["-h", "--output=pcent,avail", "/"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .nth(1)
                .map(|s| s.trim().to_string())
        });
    results.push(match disk_avail {
        Some(avail) => CheckResult {
            name: "Disk Storage (/)",
            ok: true,
            detail: format!("Terpakai / Sisa: {avail}"),
        },
        None => CheckResult {
            name: "Disk Storage (/)",
            ok: false,
            detail: "gagal mengecek disk".to_string(),
        },
    });

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
    let all_ok = checks.iter().all(|c| c.ok);

    for item in &checks {
        let icon = if item.ok {
            "✔".green().bold()
        } else {
            "✘".red().bold()
        };
        let detail = if item.ok {
            item.detail.dimmed()
        } else {
            item.detail.yellow()
        };
        println!("  {icon} {:<30} {detail}", item.name.bold());
    }

    println!();
    let summary = if all_ok {
        "Status Sistem: SEHAT 100% — Runner & Pipeline siap digunakan!"
            .green()
            .bold()
    } else {
        "Status Sistem: Beberapa komponen belum aktif (lihat tanda ✘ di atas)."
            .yellow()
            .bold()
    };
    println!("{summary}");
    all_ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_checks_includes_sonarqube_and_nexus() {
        let names: Vec<&str> = collect_checks().into_iter().map(|c| c.name).collect();
        assert!(names.contains(&"Jenkins Controller (Sandbox)"));
        assert!(names.contains(&"SonarQube SAST Server"));
        assert!(names.contains(&"Sonatype Nexus Registry"));
    }
}
