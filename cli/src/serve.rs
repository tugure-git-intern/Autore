//! Dashboard web minimal (tahap 1): satu user, satu pekerjaan dalam satu waktu.
//! Tanpa dependency baru — HTTP ditulis tangan di atas TcpListener, karena kebutuhan
//! hanya: sajikan satu halaman, terima nama project, dan alirkan log apa adanya.
//!
//! ponytail: satu job global + bukan multi-user. Naikkan ke antrean & akun per orang
//! saat dashboard dipakai lebih dari satu orang (lihat rencana tahap 2).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::jenkins;
use crate::templates::validate_app_name;

const HALAMAN: &str = include_str!("web/index.html");

#[derive(Clone, Copy, PartialEq)]
enum Status {
    Idle,
    Running,
    Sukses,
    Gagal,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Idle => "idle",
            Status::Running => "running",
            Status::Sukses => "sukses",
            Status::Gagal => "gagal",
        }
    }
}

struct Job {
    nama: String,
    status: Status,
    baris: Vec<String>,
    tautan: String,
    pesan: String,
}

impl Default for Job {
    fn default() -> Self {
        Job {
            nama: String::new(),
            status: Status::Idle,
            baris: Vec::new(),
            tautan: String::new(),
            pesan: String::new(),
        }
    }
}

pub struct Server {
    job: Arc<Mutex<Job>>,
    workspace: PathBuf,
    host_tampil: String,
}

/// Jalankan dashboard. Mengembalikan kode keluar.
pub fn run(port: u16, host: String, buka_browser: bool) -> i32 {
    let workspace = workspace_dir();
    if let Err(e) = std::fs::create_dir_all(&workspace) {
        eprintln!("ERROR: gagal menyiapkan workspace {}: {e}", workspace.display());
        return 1;
    }

    let listener = match TcpListener::bind((host.as_str(), port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("ERROR: tidak bisa membuka port {host}:{port} — {e}");
            eprintln!("  i Coba port lain: autore serve --port 9120");
            return 1;
        }
    };

    let link = format!("http://{}:{}", display_host(&host), port);
    println!("\n  Dashboard Autore jalan di {link}");
    println!("  Workspace project: {}", workspace.display());
    println!("  Tekan Ctrl+C untuk berhenti.\n");

    if buka_browser {
        let _ = open_browser(&link);
    }

    let server = Arc::new(Server {
        job: Arc::new(Mutex::new(Job::default())),
        workspace,
        host_tampil: display_host(&host),
    });

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let srv = Arc::clone(&server);
                thread::spawn(move || {
                    let _ = srv.handle(s);
                });
            }
            Err(_) => continue,
        }
    }
    0
}

fn display_host(bind_host: &str) -> String {
    match bind_host {
        "0.0.0.0" | "::" | "" => "127.0.0.1".to_string(),
        other => other.to_string(),
    }
}

fn workspace_dir() -> PathBuf {
    if let Ok(p) = std::env::var("AUTORE_WORKSPACE") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".autore-workspace")
}

impl Server {
    fn handle(&self, mut stream: TcpStream) -> std::io::Result<()> {
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut baris_awal = String::new();
        if reader.read_line(&mut baris_awal)? == 0 {
            return Ok(());
        }
        let mut bagian = baris_awal.split_whitespace();
        let method = bagian.next().unwrap_or("").to_string();
        let path = bagian.next().unwrap_or("/").to_string();

        // Baca header (dan panjang body untuk POST).
        let mut content_length = 0usize;
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h)? == 0 {
                break;
            }
            if h.trim().is_empty() {
                break;
            }
            let low = h.to_ascii_lowercase();
            if let Some(v) = low.strip_prefix("content-length:") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }

        match (method.as_str(), path.split('?').next().unwrap_or("/")) {
            ("GET", "/") | ("GET", "/index.html") => {
                kirim(&mut stream, 200, "text/html; charset=utf-8", HALAMAN)
            }
            ("GET", "/api/status") => {
                let (status, tautan, pesan, nama) = {
                    let j = self.job.lock().unwrap();
                    (
                        j.status.as_str().to_string(),
                        j.tautan.clone(),
                        j.pesan.clone(),
                        j.nama.clone(),
                    )
                };
                let body = format!(
                    "{{\"status\":\"{status}\",\"tautan\":\"{}\",\"pesan\":\"{}\",\"nama\":\"{}\"}}",
                    json_escape(&tautan),
                    json_escape(&pesan),
                    json_escape(&nama)
                );
                kirim(&mut stream, 200, "application/json", &body)
            }
            ("GET", "/api/log") => self.aliran_log(&mut stream),
            ("POST", "/api/buat") => {
                let mut body = vec![0u8; content_length];
                if content_length > 0 {
                    reader.read_exact(&mut body)?;
                }
                let teks = String::from_utf8_lossy(&body).to_string();
                let nama = ambil_field(&teks, "nama");
                let (kode, pesan) = self.mulai_job(&nama);
                let status = if kode == 200 { "true" } else { "false" };
                let body = format!(
                    "{{\"ok\":{status},\"pesan\":\"{}\"}}",
                    json_escape(&pesan)
                );
                kirim(&mut stream, kode, "application/json", &body)
            }
            _ => kirim(&mut stream, 404, "text/plain", "tidak ada"),
        }
    }

    /// Aliran log (SSE). Selesai ketika pekerjaan usai.
    fn aliran_log(&self, stream: &mut TcpStream) -> std::io::Result<()> {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
        stream.write_all(head.as_bytes())?;
        stream.flush()?;

        let mut pos = 0usize;
        loop {
            let (potongan, status, tautan, pesan) = {
                let j = self.job.lock().unwrap();
                let baru: Vec<String> = j.baris.iter().skip(pos).cloned().collect();
                pos = j.baris.len();
                match j.status {
                    Status::Sukses => (baru, "sukses", j.tautan.clone(), j.pesan.clone()),
                    Status::Gagal => (baru, "gagal", j.tautan.clone(), j.pesan.clone()),
                    _ => (baru, "jalan", String::new(), String::new()),
                }
            };

            for baris in potongan {
                let _ = write!(stream, "data: {}\n\n", baris.replace('\n', " "));
            }
            let _ = stream.flush();

            if status != "jalan" {
                let akhir = format!(
                    "event: hasil\ndata: {{\"status\":\"{status}\",\"tautan\":\"{}\",\"pesan\":\"{}\"}}\n\n",
                    json_escape(&tautan),
                    json_escape(&pesan)
                );
                let _ = stream.write_all(akhir.as_bytes());
                let _ = stream.flush();
                return Ok(());
            }
            thread::sleep(Duration::from_millis(250));
        }
    }

    /// Mulai satu pekerjaan. Menolak kalau masih ada yang berjalan.
    fn mulai_job(&self, nama: &str) -> (u16, String) {
        if let Err(e) = validate_app_name(nama) {
            return (400, e);
        }
        {
            let mut j = self.job.lock().unwrap();
            if j.status == Status::Running {
                let pelaku = j.nama.clone();
                return (409, format!("Masih ada pekerjaan berjalan: {pelaku}"));
            }
            *j = Job {
                nama: nama.to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            };
        }

        let srv = Server {
            job: Arc::clone(&self.job),
            workspace: self.workspace.clone(),
            host_tampil: self.host_tampil.clone(),
        };
        let target_name = nama.to_string();
        thread::spawn(move || srv.jalankan_quickstart(&target_name));
        (200, String::new())
    }

    fn catat(&self, teks: impl Into<String>) {
        let mut j = self.job.lock().unwrap();
        j.baris.push(teks.into());
    }

    fn jalankan_quickstart(&self, nama: &str) {
        let (app_port, deploy_port) = alokasi_port(&self.workspace, nama);
        self.catat("Menyiapkan kerangka aplikasi...");

        let exe = match std::env::current_exe() {
            Ok(e) => e,
            Err(e) => return self.selesai_gagal(&format!("tidak bisa menemukan biner autore: {e}")),
        };

        let mut child = match Command::new(&exe)
            .arg("quick-start")
            .arg("--path")
            .arg(&self.workspace)
            .arg("--app-name")
            .arg(nama)
            .arg("--stack")
            .arg("python")
            .arg("--app-port")
            .arg(app_port.to_string())
            .arg("--deploy-port")
            .arg(deploy_port.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => return self.selesai_gagal(&format!("gagal menjalankan pipeline: {e}")),
        };

        if let Some(out) = child.stdout.take() {
            let srv = self.clone_ringan();
            thread::spawn(move || {
                for baris in BufReader::new(out).lines().map_while(Result::ok) {
                    let bersih = bersihkan(&baris);
                    if bersih.is_empty() {
                        continue;
                    }
                    srv.terjemahkan(&bersih);
                }
            });
        }
        if let Some(err) = child.stderr.take() {
            let srv = self.clone_ringan();
            thread::spawn(move || {
                for baris in BufReader::new(err).lines().map_while(Result::ok) {
                    let bersih = bersihkan(&baris);
                    if !bersih.is_empty() {
                        srv.catat(format!("! {bersih}"));
                    }
                }
            });
        }

        let status = match child.wait() {
            Ok(s) => s,
            Err(e) => return self.selesai_gagal(&format!("pipeline tidak bisa diselesaikan: {e}")),
        };

        if !status.success() {
            let pesan = self.pesan_gagal_terakhir(nama);
            return self.selesai_gagal(&pesan);
        }

        self.catat("Build jalan di Jenkins, menunggu hasilnya...");
        self.tunggu_hasil_jenkins(nama, deploy_port);
    }

    /// Terjemahkan baris keluaran CLI jadi tahapan bahasa manusia (log mentah tetap dikirim).
    fn terjemahkan(&self, baris: &str) {
        if baris.contains("1/4") {
            self.catat("Kerangka aplikasi & pipeline dibuat.");
        } else if baris.contains("2/4") || baris.contains("Repo GitHub") {
            self.catat("Repository GitHub disiapkan.");
        } else if baris.contains("3/4") || baris.contains("Push ke Git") {
            self.catat("Kode dikirim ke GitHub.");
        } else if baris.contains("siap & build-nya sudah jalan") {
            self.catat("Didaftarkan ke Jenkins, build mulai berjalan.");
        }
        self.catat(format!("  {baris}"));
    }

    fn pesan_gagal_terakhir(&self, nama: &str) -> String {
        let j = self.job.lock().unwrap();
        let mut sebab = String::new();
        for b in j.baris.iter().rev() {
            if let Some(sisa) = b.strip_prefix("! ") {
                sebab = sisa.strip_prefix("ERROR:").unwrap_or(sisa).trim().to_string();
                break;
            }
        }
        if sebab.is_empty() {
            for b in j.baris.iter().rev() {
                if b.contains("ERROR") {
                    sebab = b.trim_start_matches("ERROR:").trim().to_string();
                    break;
                }
            }
        }

        // Terjemahan pesan teknis -> bahasa yang bisa ditindaklanjuti orang non-teknis.
        let rendah = sebab.to_lowercase();
        if rendah.contains("token github") || rendah.contains("kredensial jenkins") {
            return "Server belum diatur lengkap (token GitHub/Jenkins belum ada). Hubungi admin."
                .to_string();
        }
        if rendah.contains("belum berisi kode aplikasi") {
            return format!("Aplikasi '{nama}' belum punya kode di dalamnya.");
        }
        if rendah.contains("sudah punya dockerfile") {
            return format!(
                "Nama '{}' sudah dipakai di server ini. Pakai nama lain (fitur Perbarui belum ada).",
                nama
            );
        }
        if rendah.contains("gagal push") {
            return format!("Kode '{nama}' tidak bisa dikirim ke GitHub. Hubungi admin.");
        }
        if sebab.is_empty() {
            return format!(
                "Aplikasi '{nama}' gagal disiapkan. Buka detail teknis untuk melihat sebabnya."
            );
        }
        format!("Aplikasi '{nama}' gagal disiapkan: {sebab}")
    }

    fn tunggu_hasil_jenkins(&self, nama: &str, deploy_port: u16) {
        let cfg = match jenkins::load_config_from(&jenkins::default_config_path()) {
            Some(c) => c,
            None => {
                return self.selesai_gagal("Kredensial Jenkins belum diatur di server ini.");
            }
        };

        let mulai = std::time::Instant::now();
        let batas = mulai + Duration::from_secs(15 * 60);
        let mut kabar_terakhir = mulai;
        loop {
            if std::time::Instant::now() > batas {
                return self.selesai_gagal("Build belum selesai setelah 15 menit.");
            }
            if kabar_terakhir.elapsed() >= Duration::from_secs(30) {
                kabar_terakhir = std::time::Instant::now();
                self.catat("Build masih berjalan di Jenkins, tunggu sebentar...");
            }
            match jenkins::last_build_result(&cfg, nama) {
                Ok(Some(hasil)) if hasil == "SUCCESS" => {
                    self.catat("Memeriksa aplikasi hidup...");
                    let tautan = format!("http://{}:{}", self.host_tampil, deploy_port);
                    self.selesai_sukses(&tautan, &format!("Aplikasi '{nama}' hidup dan bisa dibuka."));
                    return;
                }
                Ok(Some(hasil)) => {
                    return self.selesai_gagal(&format!(
                        "Build di Jenkins gagal ({hasil}). Buka detail teknis untuk melihat sebabnya."
                    ));
                }
                Ok(None) => thread::sleep(Duration::from_secs(5)),
                Err(e) => {
                    return self.selesai_gagal(&format!("Tidak bisa membaca status Jenkins: {e}"));
                }
            }
        }
    }

    fn selesai_sukses(&self, tautan: &str, pesan: &str) {
        let mut j = self.job.lock().unwrap();
        j.status = Status::Sukses;
        j.tautan = tautan.to_string();
        j.pesan = pesan.to_string();
        j.baris.push(pesan.to_string());
    }

    fn selesai_gagal(&self, pesan: &str) {
        let mut j = self.job.lock().unwrap();
        j.status = Status::Gagal;
        j.pesan = pesan.to_string();
        j.baris.push(pesan.to_string());
    }

    fn clone_ringan(&self) -> Server {
        Server {
            job: Arc::clone(&self.job),
            workspace: self.workspace.clone(),
            host_tampil: self.host_tampil.clone(),
        }
    }
}

/// Port bebas untuk project: 8000-8099 (app) dengan deploy = app + 3.
/// Disimpan supaya project lama memakai port yang sama lagi.
fn alokasi_port(workspace: &std::path::Path, nama: &str) -> (u16, u16) {
    // Port DI DALAM container selalu 8000: tiap container punya jaringan sendiri,
    // jadi tidak pernah bentrok. Yang harus unik adalah port di host (deploy).
    const APP_PORT: u16 = 8000;
    let reg = workspace.join("registry.tsv");
    let mut terpakai: Vec<u16> = Vec::new();
    if let Ok(isi) = std::fs::read_to_string(&reg) {
        for baris in isi.lines() {
            let mut it = baris.split('\t');
            let pemilik = it.next().unwrap_or("");
            let _app = it.next();
            let deploy = it.next();
            if pemilik == nama {
                if let Some(d) = deploy.and_then(|d| d.parse::<u16>().ok()) {
                    return (APP_PORT, d);
                }
            }
            if let Some(p) = deploy.and_then(|d| d.parse::<u16>().ok()) {
                terpakai.push(p);
            }
        }
    }

    let mut deploy = 8003u16;
    while deploy < 8200 {
        if !terpakai.contains(&deploy) && port_bebas(deploy) {
            let mut isi = std::fs::read_to_string(&reg).unwrap_or_default();
            isi.push_str(&format!("{nama}\t{APP_PORT}\t{deploy}\n"));
            let _ = std::fs::write(&reg, isi);
            return (APP_PORT, deploy);
        }
        deploy += 10;
    }
    (APP_PORT, 8003)
}

fn port_bebas(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn bersihkan(baris: &str) -> String {
    // Buang kode warna ANSI supaya halaman tidak menampilkan sampah escape.
    let mut hasil = String::new();
    let mut di_escape = false;
    for c in baris.chars() {
        if di_escape {
            if c.is_ascii_alphabetic() {
                di_escape = false;
            }
            continue;
        }
        if c == '\u{1b}' {
            di_escape = true;
            continue;
        }
        hasil.push(c);
    }
    hasil.trim().to_string()
}

fn ambil_field(body: &str, key: &str) -> String {
    // Terima application/x-www-form-urlencoded: nama=abc&... (juga JSON sederhana).
    for pasangan in body.split('&') {
        if let Some((k, v)) = pasangan.split_once('=') {
            if k.trim().trim_matches('"') == key {
                return url_decode(v);
            }
        }
    }
    String::new()
}

fn url_decode(teks: &str) -> String {
    let bytes = teks.as_bytes();
    let mut hasil = String::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    hasil.push(v as char);
                    i += 3;
                    continue;
                }
                hasil.push('%');
                i += 1;
            }
            b'+' => {
                hasil.push(' ');
                i += 1;
            }
            b => {
                hasil.push(b as char);
                i += 1;
            }
        }
    }
    hasil.trim().to_string()
}

fn json_escape(teks: &str) -> String {
    teks.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .replace('\r', " ")
}

fn kirim(stream: &mut TcpStream, kode: u16, tipe: &str, body: &str) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {kode} OK\r\nContent-Type: {tipe}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

fn open_browser(url: &str) -> std::io::Result<()> {
    let (cmd, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![url])
    } else if cfg!(target_os = "windows") {
        ("cmd", vec!["/C", "start", "", url])
    } else {
        ("xdg-open", vec![url])
    };
    Command::new(cmd).args(args).status()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn bersihkan_membuang_kode_warna() {
        assert_eq!(bersihkan("\u{1b}[32m✔\u{1b}[0m Selesai  "), "✔ Selesai");
    }

    #[test]
    fn ambil_field_membaca_form_urlencoded() {
        assert_eq!(ambil_field("nama=absensi-karyawan&x=1", "nama"), "absensi-karyawan");
        assert_eq!(ambil_field("nama=a%20b", "nama"), "a b");
        assert_eq!(ambil_field("lain=1", "nama"), "");
    }

    #[test]
    fn alokasi_port_memakai_ulang_port_project_lama() {
        let tmp = TempDir::new().unwrap();
        let (a1, d1) = alokasi_port(tmp.path(), "proj-a");
        let (a2, d2) = alokasi_port(tmp.path(), "proj-a");
        assert_eq!((a1, d1), (a2, d2));
        assert_eq!(a1, 8000, "port dalam container selalu 8000");
        assert!(d1 >= 8003);
        let (a3, d3) = alokasi_port(tmp.path(), "proj-b");
        assert_eq!(a3, 8000);
        assert_ne!(d1, d3, "port host harus beda tiap project");
    }

    #[test]
    fn pesan_gagal_diterjemahkan_ke_bahasa_manusia() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job {
                nama: "demo".to_string(),
                status: Status::Running,
                baris: vec![
                    "  • Folder bla".to_string(),
                    "! ERROR: Token GitHub tidak ditemukan. Set AUTORE_GITHUB_TOKEN atau jalankan lewat menu."
                        .to_string(),
                ],
                tautan: String::new(),
                pesan: String::new(),
            })),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };
        assert_eq!(
            srv.pesan_gagal_terakhir("demo"),
            "Server belum diatur lengkap (token GitHub/Jenkins belum ada). Hubungi admin."
        );
    }

    #[test]
    fn mulai_job_menolak_saat_masih_ada_yang_jalan() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job {
                nama: "sedang-jalan".to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            })),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };
        let (kode, pesan) = srv.mulai_job("yang-lain");
        assert_eq!(kode, 409);
        assert!(pesan.contains("sedang-jalan"));
    }

    #[test]
    fn mulai_job_menolak_nama_tidak_valid() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job::default())),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };
        let (kode, pesan) = srv.mulai_job("Nama Salah");
        assert_eq!(kode, 400);
        assert!(pesan.contains("huruf kecil"));
    }
}
