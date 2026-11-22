//! `autore dev` — jalankan project di laptop tanpa ribet: Dockerfile dibuat kalau
//! belum ada, image dibangun, container jalan di foreground. Repo GitHub, Jenkins,
//! dan deploy VPS tetap di luar cakupan perintah ini.

use crate::connect::deteksi_stack;
use crate::templates::{
    render_dockerfile, render_dockerignore, validate_app_name, InitConfig, TechStack,
};
use crate::workspace;
use colored::Colorize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Rentang port host untuk `dev`, dijauhkan dari port deploy (8003-9000) supaya
/// tidak bertabrakan dengan container staging/production di mesin yang sama.
pub(crate) const PORT_AWAL: u16 = 8300;
pub(crate) const PORT_AKHIR: u16 = 8400;

pub(crate) struct DevArgs {
    pub(crate) app_name: Option<String>,
    pub(crate) stack: Option<String>,
    pub(crate) app_port: Option<u16>,
    pub(crate) port: Option<u16>,
}

pub(crate) fn jalankan(args: DevArgs) -> i32 {
    let dir = match std::env::current_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!(
                "{} tidak bisa membaca folder ini: {e}",
                "ERROR:".red().bold()
            );
            return 1;
        }
    };
    let nama = match nama_app(&dir, args.app_name.as_deref()) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("{} {e}", "ERROR:".red().bold());
            return 1;
        }
    };
    let stack = match stack_pilihan(&dir, args.stack.as_deref()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{} {e}", "ERROR:".red().bold());
            return 1;
        }
    };
    let app_port = args.app_port.unwrap_or_else(|| stack.default_port());
    if app_port == 0 {
        eprintln!("{} --app-port harus antara 1-65535", "ERROR:".red().bold());
        return 1;
    }

    let cfg = InitConfig {
        app_name: nama.clone(),
        stack,
        app_port,
        deploy_port: args.port.unwrap_or(PORT_AWAL),
    };
    match tulis_pipeline_kurang(&dir, &cfg) {
        Ok(dibuat) if dibuat.is_empty() => {
            println!("{} pakai Dockerfile & .dockerignore yang ada", "i".dimmed());
        }
        Ok(dibuat) => {
            for f in dibuat {
                println!("  • dibuat: {}", f.display());
            }
        }
        Err(e) => {
            eprintln!("{} {e}", "ERROR:".red().bold());
            return 1;
        }
    }

    let tag = format!("{nama}:dev");
    let container = format!("{nama}-dev");
    match Command::new("docker")
        .args(arg_build(&tag))
        .current_dir(&dir)
        .status()
    {
        Ok(s) if s.success() => {}
        Ok(_) => {
            eprintln!(
                "\n{} docker build gagal — periksa Dockerfile di {}",
                "ERROR:".red().bold(),
                dir.display()
            );
            return 1;
        }
        Err(e) => {
            eprintln!(
                "{} docker tidak bisa dijalankan: {e}",
                "ERROR:".red().bold()
            );
            return 1;
        }
    }

    // Build sukses dulu sebelum menghentikan container lama, agar kegagalan build
    // tidak mematikan project yang sedang dipakai.
    if workspace::container_ada(&container) {
        println!("  • container lama {container} dihapus dulu");
        if !workspace::hapus_container(&container) {
            eprintln!(
                "{} gagal menghapus container {container}",
                "ERROR:".red().bold()
            );
            return 1;
        }
    }
    let host_port = match args.port {
        Some(p) if p > 0 && workspace::port_bebas(p) => p,
        Some(p) => {
            eprintln!(
                "{} port {p} tidak valid atau sedang dipakai; pilih port bebas",
                "ERROR:".red().bold()
            );
            return 1;
        }
        None => match cari_port_host(workspace::port_bebas) {
            Some(p) => p,
            None => {
                eprintln!(
                    "{} tidak ada port bebas di {PORT_AWAL}-{PORT_AKHIR}",
                    "ERROR:".red().bold()
                );
                return 1;
            }
        },
    };

    println!("{} http://localhost:{host_port}", "➜".green().bold());
    println!("  Ctrl+C untuk berhenti (container ikut berhenti)\n");

    match Command::new("docker")
        .args(arg_run(&container, host_port, app_port, &tag))
        .current_dir(&dir)
        .status()
    {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("{} docker run gagal: {e}", "ERROR:".red().bold());
            1
        }
    }
}

/// Nama aplikasi: `--app-name` bila diisi, kalau tidak nama folder (huruf kecil).
/// Ditolak sebelum docker disentuh, dengan saran flag-nya.
fn nama_app(dir: &Path, pilihan: Option<&str>) -> Result<String, String> {
    let nama = match pilihan {
        Some(n) => n.trim().to_string(),
        None => dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase(),
    };
    validate_app_name(&nama).map_err(|e| format!("{e}; sebut namanya: --app-name <nama>"))?;
    Ok(nama)
}

fn stack_pilihan(dir: &Path, pilihan: Option<&str>) -> Result<TechStack, String> {
    if let Some(s) = pilihan {
        return TechStack::from_str_loose(s)
            .ok_or_else(|| format!("Stack '{s}' tidak dikenali. Pilih: python, nodejs, java, go"));
    }
    deteksi_stack(dir).ok_or_else(|| {
        "tidak menemukan kode aplikasi di folder ini; sebut stack-nya: --stack python|nodejs|java|go"
            .to_string()
    })
}

fn cari_port_host(bebas: impl Fn(u16) -> bool) -> Option<u16> {
    (PORT_AWAL..=PORT_AKHIR).find(|p| bebas(*p))
}

/// Tulis hanya berkas pipeline yang belum ada: `Dockerfile` dan `.dockerignore`.
/// `Jenkinsfile` tidak dibuat di sini — `connect`/`deploy` yang menambahkannya
/// saat repo didaftarkan ke Jenkins.
fn tulis_pipeline_kurang(dir: &Path, cfg: &InitConfig) -> Result<Vec<PathBuf>, String> {
    let mut dibuat = Vec::new();
    let dockerfile = dir.join("Dockerfile");
    if !dockerfile.is_file() {
        std::fs::write(&dockerfile, render_dockerfile(cfg))
            .map_err(|e| format!("gagal menulis {}: {e}", dockerfile.display()))?;
        dibuat.push(dockerfile);
    }
    let dockerignore = dir.join(".dockerignore");
    if !dockerignore.is_file() {
        std::fs::write(&dockerignore, render_dockerignore())
            .map_err(|e| format!("gagal menulis {}: {e}", dockerignore.display()))?;
        dibuat.push(dockerignore);
    }
    Ok(dibuat)
}

fn arg_build(tag: &str) -> Vec<String> {
    vec!["build".into(), "-t".into(), tag.into(), ".".into()]
}

fn arg_run(container: &str, host: u16, app: u16, tag: &str) -> Vec<String> {
    vec![
        "run".into(),
        "--rm".into(),
        "--name".into(),
        container.into(),
        "-p".into(),
        format!("{host}:{app}"),
        tag.into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nama_folder_jadi_nama_aplikasi_huruf_kecil() {
        assert_eq!(
            nama_app(&PathBuf::from("/tmp/Hello-App"), None).unwrap(),
            "hello-app"
        );
        assert_eq!(
            nama_app(&PathBuf::from("/tmp/hello"), Some("nama-lain")).unwrap(),
            "nama-lain",
            "--app-name menang atas nama folder"
        );
    }

    #[test]
    fn nama_tidak_sah_ditolak_sebelum_docker_dipanggil() {
        let e = nama_app(&PathBuf::from("/tmp/my app"), None).unwrap_err();
        assert!(e.contains("--app-name"), "saran --app-name wajib ada: {e}");
    }

    #[test]
    fn stack_dipaksa_flag_menang_atas_deteksi() {
        let kosong = PathBuf::from("/tmp/autore-dev-kosong");
        std::fs::create_dir_all(&kosong).unwrap();
        let e = stack_pilihan(&kosong, None).unwrap_err();
        assert!(e.contains("--stack"), "saran --stack wajib ada: {e}");
        assert_eq!(stack_pilihan(&kosong, Some("go")).unwrap(), TechStack::Go);
        std::fs::remove_dir_all(&kosong).ok();
    }

    #[test]
    fn port_host_yang_terpakai_dilewati() {
        let mulai = PORT_AWAL + 1;
        assert_eq!(cari_port_host(|p| p >= mulai), Some(mulai));
        assert_eq!(cari_port_host(|_| false), None);
    }

    #[test]
    fn argv_docker_berbentuk_array_tanpa_shell() {
        assert_eq!(arg_build("web:dev").join(" "), "build -t web:dev .");
        assert_eq!(
            arg_run("web-dev", 8300, 8000, "web:dev").join(" "),
            "run --rm --name web-dev -p 8300:8000 web:dev"
        );
    }

    #[test]
    fn dockerfile_yang_sudah_ada_tidak_ditimpa() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("Dockerfile"), "FROM scratch\n").unwrap();
        let cfg = InitConfig {
            app_name: "web".into(),
            stack: TechStack::Python,
            app_port: 8000,
            deploy_port: 8300,
        };
        let dibuat = tulis_pipeline_kurang(tmp.path(), &cfg).unwrap();
        assert_eq!(dibuat, vec![tmp.path().join(".dockerignore")]);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("Dockerfile")).unwrap(),
            "FROM scratch\n"
        );
    }
}
