//! Dashboard web minimal (tahap 1): satu user, satu pekerjaan dalam satu waktu.
//! Tanpa dependency baru — HTTP ditulis tangan di atas TcpListener, karena kebutuhan
//! hanya: sajikan satu halaman, terima nama project, dan alirkan log apa adanya.
//!
//! ponytail: satu job global + bukan multi-user. Naikkan ke antrean & akun per orang
//! saat dashboard dipakai lebih dari satu orang (lihat rencana tahap 2).

use crate::progress;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// PID proses pipeline yang sedang jalan (0 = tidak ada). Dipakai tombol "Batalkan".
static ANAK: AtomicU32 = AtomicU32::new(0);
static ANAK_RUN_ID: AtomicU64 = AtomicU64::new(0);
/// ID pekerjaan yang sedang dibatalkan (0 = tidak ada yang dibatalkan).
static DIBATALKAN_RUN_ID: AtomicU64 = AtomicU64::new(0);
static RUN_COUNTER: AtomicU64 = AtomicU64::new(1);

use crate::jenkins;
use crate::templates::validate_app_name;

const HALAMAN: &str = include_str!("web/index.html");
const HALAMAN_V2: &str = include_str!("web2/index.html");

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
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
    id: u64,
    nama: String,
    status: Status,
    baris: Vec<String>,
    /// Urutan tahap yang sudah selesai, dikabarkan CLI lewat baris data
    /// (lihat `crate::progress`) atau oleh server sendiri. Halaman web memakai
    /// daftar ini untuk memajukan langkah-langkahnya — tidak lagi menebak dari kalimat.
    tahap_urut: Vec<String>,
    tautan: String,
    pesan: String,
}

impl Default for Job {
    fn default() -> Self {
        Job {
            id: 0,
            nama: String::new(),
            status: Status::Idle,
            baris: Vec::new(),
            tahap_urut: Vec::new(),
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
                let _ = s.set_read_timeout(Some(Duration::from_secs(10)));
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

pub(crate) fn workspace_dir() -> PathBuf {
    if let Ok(p) = std::env::var("AUTORE_WORKSPACE") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join("autore-workspace")
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
            ("GET", "/v2") | ("GET", "/v2/") | ("GET", "/v2/index.html") => {
                kirim(&mut stream, 200, "text/html; charset=utf-8", HALAMAN_V2)
            }
            ("GET", "/api/status") => {
                let (status, tautan, pesan, nama, tahap) = {
                    let j = self.job.lock().unwrap();
                    (
                        j.status.as_str().to_string(),
                        j.tautan.clone(),
                        j.pesan.clone(),
                        j.nama.clone(),
                        j.tahap_urut.clone(),
                    )
                };
                let daftar_tahap = tahap
                    .iter()
                    .map(|t| format!("\"{}\"", json_escape(t)))
                    .collect::<Vec<_>>()
                    .join(",");
                let body = format!(
                    "{{\"status\":\"{status}\",\"tautan\":\"{}\",\"pesan\":\"{}\",\"nama\":\"{}\",\"tahap\":[{daftar_tahap}]}}",
                    json_escape(&tautan),
                    json_escape(&pesan),
                    json_escape(&nama)
                );
                kirim(&mut stream, 200, "application/json", &body)
            }
            ("GET", "/api/log") => self.aliran_log(&mut stream),
            ("POST", "/api/batal") => {
                let ya = self.batalkan();
                let body = format!(
                    "{{\"ok\":{ya},\"pesan\":\"{}\"}}",
                    if ya {
                        "Dibatalkan. Build yang sudah dikirim ke Jenkins tetap jalan sampai selesai."
                    } else {
                        "Tidak ada pekerjaan yang sedang jalan."
                    }
                );
                kirim(&mut stream, 200, "application/json", &body)
            }
            ("GET", "/api/daftar") => {
                // Sumbernya `registry.tsv` di workspace — bukan riwayat browser,
                // jadi daftar ini tetap benar walau dibuka dari komputer lain.
                let proyek = baca_registry(&self.workspace);
                let jalan = container_jalan();
                let isi = proyek
                    .iter()
                    .map(|p| {
                        let hidup = match &jalan {
                            Some(j) => {
                                if j.iter().any(|n| n == &p.nama) {
                                    "true"
                                } else {
                                    "false"
                                }
                            }
                            None => "null",
                        };
                        format!(
                            "{{\"nama\":\"{}\",\"tautan\":\"http://{}:{}\",\"hidup\":{hidup}}}",
                            json_escape(&p.nama),
                            self.host_tampil,
                            p.deploy_port
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                kirim(&mut stream, 200, "application/json", &format!("{{\"proyek\":[{isi}]}}"))
            }
            ("GET", "/api/kemampuan") => {
                // Sumber kebenaran tetap CLI: fungsi kemampuan_json dipanggil langsung.
                kirim(&mut stream, 200, "application/json", &crate::kemampuan_json())
            }
            ("POST", "/api/buat") => {
                if content_length > 64 * 1024 {
                    return kirim(&mut stream, 413, "text/plain", "Payload too large");
                }
                let mut body = vec![0u8; content_length];
                if content_length > 0 {
                    reader.read_exact(&mut body)?;
                }
                let teks = String::from_utf8_lossy(&body).to_string();
                let nama = ambil_field(&teks, "nama");
                let kode = ambil_field(&teks, "kode");
                let alamat = ambil_field(&teks, "alamat");
                let (kode_http, pesan) = self.mulai_job(&nama, &kode, &alamat);
                let status = if kode_http == 200 { "true" } else { "false" };
                let body = format!(
                    "{{\"ok\":{status},\"pesan\":\"{}\"}}",
                    json_escape(&pesan)
                );
                kirim(&mut stream, kode_http, "application/json", &body)
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
        let mut pos_tahap = 0usize;
        loop {
            let tahap_baru: Vec<String> = {
                let j = self.job.lock().unwrap();
                let baru = j.tahap_urut.iter().skip(pos_tahap).cloned().collect();
                pos_tahap = j.tahap_urut.len();
                baru
            };
            for t in tahap_baru {
                if write!(stream, "event: tahap\ndata: {{\"tahap\":\"{}\"}}\n\n", json_escape(&t)).is_err() {
                    return Ok(());
                }
            }
            let (potongan, status, tautan, pesan, nama) = {
                let j = self.job.lock().unwrap();
                let baru: Vec<String> = j.baris.iter().skip(pos).cloned().collect();
                pos = j.baris.len();
                let nama = j.nama.clone();
                match j.status {
                    Status::Sukses => (baru, "sukses", j.tautan.clone(), j.pesan.clone(), nama),
                    Status::Gagal => (baru, "gagal", j.tautan.clone(), j.pesan.clone(), nama),
                    _ => (baru, "jalan", String::new(), String::new(), nama),
                }
            };

            for baris in potongan {
                if write!(stream, "data: {}\n\n", baris.replace('\n', " ")).is_err() {
                    return Ok(());
                }
            }
            if stream.flush().is_err() {
                return Ok(());
            }

            if status != "jalan" {
                let akhir = format!(
                    "event: hasil\ndata: {{\"status\":\"{status}\",\"nama\":\"{}\",\"tautan\":\"{}\",\"pesan\":\"{}\"}}\n\n",
                    json_escape(&nama),
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
    /// Mulai satu pekerjaan dari jawaban form web. `kode` dan `alamat` adalah
    /// jawaban pertanyaan yang diumumkan lewat `autore kemampuan`; nama id-nya
    /// harus sama dengan `id` di `kemampuan_json` (main.rs).
    fn mulai_job(&self, nama: &str, kode: &str, alamat: &str) -> (u16, String) {
        if let Err(e) = validate_app_name(nama) {
            return (400, e);
        }
        let kode = match kode.trim() {
            "" => "contoh",
            k @ ("contoh" | "kosong") => k,
            lain => return (400, format!("Pilihan kode '{lain}' tidak dikenal.")),
        }
        .to_string();
        let deploy_port = match alamat.trim() {
            "" | "otomatis" => None,
            angka => match angka.parse::<u16>() {
                Ok(p) => {
                    if let Err(e) = crate::templates::validate_deploy_port(p) {
                        return (400, e);
                    }
                    Some(p)
                }
                _ => return (400, "Nomor port harus angka 1024 atau lebih.".to_string()),
            },
        };
        let run_id = RUN_COUNTER.fetch_add(1, Ordering::SeqCst);
        {
            let mut j = self.job.lock().unwrap();
            if j.status == Status::Running {
                let pelaku = j.nama.clone();
                return (409, format!("Masih ada pekerjaan berjalan: {pelaku}"));
            }
            *j = Job {
                id: run_id,
                nama: nama.to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            };
        }
        // Pekerjaan mulai = simpan dulu, supaya dashboard langsung lihat `running`.
        self.simpan_status();

        let srv = Server {
            job: Arc::clone(&self.job),
            workspace: self.workspace.clone(),
            host_tampil: self.host_tampil.clone(),
        };
        let target_name = nama.to_string();
        thread::spawn(move || srv.jalankan_quickstart(run_id, &target_name, &kode, deploy_port));
        (200, String::new())
    }

    fn catat_id(&self, run_id: u64, teks: impl Into<String>) {
        let mut j = self.job.lock().unwrap();
        if j.id == run_id {
            j.baris.push(teks.into());
        }
    }

    fn catat_tahap_id(&self, run_id: u64, id: &str) {
        let baru = {
            let mut j = self.job.lock().unwrap();
            if j.id == run_id && j.tahap_urut.last().map(|t| t.as_str()) != Some(id) {
                j.tahap_urut.push(id.to_string());
                true
            } else {
                false
            }
        };
        // Tahap baru = titik simpan. Baris log tidak disimpan satu-satu (biaya tulis).
        if baru {
            self.simpan_status();
        }
    }

    /// Tulis `dashboard-status.json` di workspace supaya `autore status --json`
    /// (dan dashboard web) membaca keadaan terakhir. Dipanggil di awal pekerjaan,
    /// tiap tahap, dan saat sukses/gagal/batal.
    ///
    /// ponytail: `commit_sha`, `author`, dan `security_summary` masih kosong —
    /// isi saat pipeline melaporkan ketiganya lewat `progress::tahap`.
    fn simpan_status(&self) {
        let (status, nama, tahap, baris, pesan, tautan) = {
            let j = self.job.lock().unwrap();
            (
                match j.status {
                    Status::Idle => "idle",
                    Status::Running => "running",
                    Status::Sukses => "passed",
                    Status::Gagal => "failed",
                },
                j.nama.clone(),
                j.tahap_urut.clone(),
                j.baris.clone(),
                j.pesan.clone(),
                j.tautan.clone(),
            )
        };

        let mut snap = crate::status::load(&self.workspace);
        snap.system_status = status.to_string();
        snap.latest_pipeline.status = status.to_string();
        snap.latest_pipeline.stages = tahap;
        snap.latest_pipeline.raw_log = baris;
        snap.latest_pipeline.failure_reason = if status == "failed" {
            pesan
        } else {
            String::new()
        };
        if status == "passed" {
            snap.latest_pipeline.security_summary = tautan;
        }

        // Hanya hasil akhir yang menulis status aplikasi: `passed`/`failed`.
        // Saat masih berjalan aplikasi tetap `unknown` supaya web tidak mengklaim sukses.
        if !nama.is_empty() && (status == "passed" || status == "failed") {
            let lewat_deploy = snap
                .latest_pipeline
                .stages
                .iter()
                .any(|t| t == crate::status::TAHAP_DEPLOY);
            if !snap.applications.iter().any(|a| a.name == nama) {
                snap.applications.push(crate::status::Application::baru(&nama));
            }
            if let Some(catatan) = snap.applications.iter_mut().find(|a| a.name == nama) {
                catatan.tuntaskan(status, &snap.latest_pipeline.commit_sha, lewat_deploy);
            }
        }

        if let Err(e) = crate::status::save(&self.workspace, &snap) {
            eprintln!("WARNING: {e}");
        }
    }

    /// Hentikan pekerjaan yang sedang jalan di mesin ini.
    ///
    /// Build yang sudah dikirim ke Jenkins TIDAK ikut berhenti — itu di luar
    /// kendali dashboard, dan pengguna diberi tahu apa adanya.
    fn batalkan(&self) -> bool {
        let run_id = {
            let j = self.job.lock().unwrap();
            if j.status != Status::Running {
                return false;
            }
            j.id
        };
        DIBATALKAN_RUN_ID.store(run_id, Ordering::SeqCst);
        if ANAK_RUN_ID.load(Ordering::SeqCst) == run_id {
            let pid = ANAK.swap(0, Ordering::SeqCst);
            if pid != 0 && cfg!(unix) {
                let _ = Command::new("kill").arg(pid.to_string()).status();
            }
        }
        self.selesai_gagal_id(
            run_id,
            "Dibatalkan. Build yang sudah dikirim ke Jenkins tetap jalan sampai selesai.",
        );
        true
    }

    fn jalankan_quickstart(
        &self,
        run_id: u64,
        nama: &str,
        kode: &str,
        deploy_port_pilihan: Option<u16>,
    ) {
        let (app_port, deploy_port) =
            match alokasi_port(&self.workspace, nama, deploy_port_pilihan) {
                Ok(pasangan) => pasangan,
                // Port tidak bisa dipakai (mis. sudah dikunci aplikasi lain):
                // hentikan sebelum Jenkins dipanggil, jangan biarkan gagal di tengah.
                Err(e) => return self.selesai_gagal_id(run_id, &e),
            };
        self.catat_id(run_id, "Menyiapkan kerangka aplikasi...");

        let exe = match std::env::current_exe() {
            Ok(e) => e,
            Err(e) => return self.selesai_gagal_id(run_id, &format!("tidak bisa menemukan biner autore: {e}")),
        };

        let mut child = match Command::new(&exe)
            .env("AUTORE_PROGRESS", "json")
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
            .arg("--kode")
            .arg(kode)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => return self.selesai_gagal_id(run_id, &format!("gagal menjalankan pipeline: {e}")),
        };

        ANAK.store(child.id(), Ordering::SeqCst);
        ANAK_RUN_ID.store(run_id, Ordering::SeqCst);
        if let Some(out) = child.stdout.take() {
            let srv = self.clone_ringan();
            thread::spawn(move || {
                for baris in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Some(tahap) = progress::ambil(&baris, "tahap") {
                        srv.catat_tahap_id(run_id, &tahap);
                        continue;
                    }
                    let bersih = bersihkan(&baris);
                    if bersih.is_empty() {
                        continue;
                    }
                    srv.terjemahkan_id(run_id, &bersih);
                }
            });
        }
        if let Some(err) = child.stderr.take() {
            let srv = self.clone_ringan();
            thread::spawn(move || {
                for baris in BufReader::new(err).lines().map_while(Result::ok) {
                    let bersih = bersihkan(&baris);
                    if !bersih.is_empty() {
                        srv.catat_id(run_id, format!("! {bersih}"));
                    }
                }
            });
        }

        let status = match child.wait() {
            Ok(s) => s,
            Err(e) => return self.selesai_gagal_id(run_id, &format!("pipeline tidak bisa diselesaikan: {e}")),
        };

        if ANAK_RUN_ID.load(Ordering::SeqCst) == run_id {
            let _ = ANAK.compare_exchange(child.id(), 0, Ordering::SeqCst, Ordering::SeqCst);
        }
        if DIBATALKAN_RUN_ID.load(Ordering::SeqCst) == run_id {
            return;
        }
        if !status.success() {
            let pesan = self.pesan_gagal_terakhir_id(run_id, nama);
            return self.selesai_gagal_id(run_id, &pesan);
        }

        self.catat_id(run_id, "Build jalan di Jenkins, menunggu hasilnya...");
        self.catat_tahap_id(run_id, "build");
        self.tunggu_hasil_jenkins(run_id, nama, deploy_port);
    }

    /// Terjemahkan baris keluaran CLI jadi tahapan bahasa manusia (log mentah tetap dikirim).
    fn terjemahkan_id(&self, run_id: u64, baris: &str) {
        if baris.contains("1/4") {
            self.catat_id(run_id, "Kerangka aplikasi & pipeline dibuat.");
        } else if baris.contains("2/4") || baris.contains("Repo GitHub") {
            self.catat_id(run_id, "Repository GitHub disiapkan.");
        } else if baris.contains("3/4") || baris.contains("Push ke Git") {
            self.catat_id(run_id, "Kode dikirim ke GitHub.");
        } else if baris.contains("siap & build-nya sudah jalan") {
            self.catat_id(run_id, "Didaftarkan ke Jenkins, build mulai berjalan.");
        }
        self.catat_id(run_id, format!("  {baris}"));
    }

    fn pesan_gagal_terakhir_id(&self, run_id: u64, nama: &str) -> String {
        let j = self.job.lock().unwrap();
        if j.id != run_id {
            return format!("Aplikasi '{nama}' gagal disiapkan.");
        }
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

    #[cfg(test)]
    fn pesan_gagal_terakhir(&self, nama: &str) -> String {
        let id = self.job.lock().unwrap().id;
        self.pesan_gagal_terakhir_id(id, nama)
    }

    fn tunggu_hasil_jenkins(&self, run_id: u64, nama: &str, deploy_port: u16) {
        let cfg = match jenkins::load_config_from(&jenkins::default_config_path()) {
            Some(c) => c,
            None => {
                return self.selesai_gagal_id(run_id, "Kredensial Jenkins belum diatur di server ini.");
            }
        };

        let mulai = std::time::Instant::now();
        let batas = mulai + Duration::from_secs(15 * 60);
        let mut kabar_terakhir = mulai;
        let mut err_count = 0u32;
        loop {
            if DIBATALKAN_RUN_ID.load(Ordering::SeqCst) == run_id {
                // Pengguna sudah menekan Batalkan; hasil build tidak lagi ditunggu.
                return;
            }
            if std::time::Instant::now() > batas {
                return self.selesai_gagal_id(run_id, "Build belum selesai setelah 15 menit.");
            }
            if kabar_terakhir.elapsed() >= Duration::from_secs(30) {
                kabar_terakhir = std::time::Instant::now();
                self.catat_id(run_id, "Build masih berjalan di Jenkins, tunggu sebentar...");
            }
            match jenkins::last_build_result(&cfg, nama) {
                Ok(Some(hasil)) if hasil == "SUCCESS" => {
                    // Build selesai = Jenkins juga sudah memasang container (deploy by digest).
                    self.catat_tahap_id(run_id, "pasang");
                    self.catat_id(run_id, "Memeriksa aplikasi hidup...");
                    self.catat_tahap_id(run_id, "periksa");
                    let tautan = format!("http://{}:{}", self.host_tampil, deploy_port);
                    self.selesai_sukses_id(run_id, &tautan, &format!("Aplikasi '{nama}' hidup dan bisa dibuka."));
                    return;
                }
                Ok(Some(hasil)) => {
                    return self.selesai_gagal_id(run_id, &format!(
                        "Build di Jenkins gagal ({hasil}). Buka detail teknis untuk melihat sebabnya."
                    ));
                }
                Ok(None) => {
                    err_count = 0;
                    thread::sleep(Duration::from_secs(5));
                }
                Err(e) => {
                    err_count += 1;
                    if err_count >= 3 {
                        return self.selesai_gagal_id(run_id, &format!("Tidak bisa membaca status Jenkins: {e}"));
                    }
                    self.catat_id(run_id, format!("! Peringatan koneksi Jenkins ({err_count}/3): {e}"));
                    thread::sleep(Duration::from_secs(5));
                }
            }
        }
    }

    fn selesai_sukses_id(&self, run_id: u64, tautan: &str, pesan: &str) {
        if DIBATALKAN_RUN_ID.load(Ordering::SeqCst) == run_id {
            return;
        }
        {
            let mut j = self.job.lock().unwrap();
            if j.id == run_id {
                j.status = Status::Sukses;
                j.tautan = tautan.to_string();
                j.pesan = pesan.to_string();
                j.baris.push(pesan.to_string());
            }
        }
        self.simpan_status();
    }

    fn selesai_gagal_id(&self, run_id: u64, pesan: &str) {
        {
            let mut j = self.job.lock().unwrap();
            if j.id == run_id {
                j.status = Status::Gagal;
                j.pesan = pesan.to_string();
                j.baris.push(pesan.to_string());
            }
        }
        self.simpan_status();
    }

    fn clone_ringan(&self) -> Server {
        Server {
            job: Arc::clone(&self.job),
            workspace: self.workspace.clone(),
            host_tampil: self.host_tampil.clone(),
        }
    }
}

/// Satu project yang tercatat di `registry.tsv`.
pub(crate) struct Proyek {
    pub(crate) nama: String,
    pub(crate) deploy_port: u16,
}

/// Baca catatan project di workspace (dibuat saat pertama kali deploy).
/// Baris rusak dilewati, bukan bikin seluruh daftar hilang.
pub(crate) fn baca_registry(workspace: &std::path::Path) -> Vec<Proyek> {
    entri_registry(workspace)
        .into_iter()
        .map(|(nama, _app, deploy_port)| Proyek { nama, deploy_port })
        .collect()
}

/// Nama container yang sedang jalan. `None` = docker tidak bisa ditanya, supaya
/// halaman bisa bilang "tidak diketahui" alih-alih menuduh aplikasi mati.
pub(crate) fn container_jalan() -> Option<Vec<String>> {
    let out = Command::new("docker")
        .args(["ps", "--format", "{{.Names}}"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|b| b.trim().to_string())
            .filter(|b| !b.is_empty())
            .collect(),
    )
}

/// Rentang port deploy di host: kebiasaan lama kelipatan 10 dari 8003, lalu celah lain.
const PORT_AWAL: u16 = 8003;
const PORT_TENGAH: u16 = 8200;
const PORT_AKHIR: u16 = 9000;

/// Port deploy untuk `nama`. Port lama dipakai ulang kalau sudah terdaftar; port
/// pilihan pengguna ditolak kalau sudah dikunci aplikasi lain atau sedang hidup —
/// tidak pernah diganti diam-diam. Tidak menulis registry: pakai `catat_port`
/// setelah aplikasi benar-benar dibuat.
pub(crate) fn pilih_port(
    workspace: &std::path::Path,
    nama: &str,
    pilihan: Option<u16>,
) -> Result<(u16, u16), String> {
    // Port DI DALAM container selalu 8000: tiap container punya jaringan sendiri,
    // jadi tidak pernah bentrok. Yang harus unik adalah port di host (deploy).
    const APP_PORT: u16 = 8000;

    if let Some(p) = pilihan {
        if let Some(pemilik) = pemilik_port(workspace, nama, p) {
            return Err(pesan_port_bentrok(
                workspace,
                nama,
                p,
                &format!("sudah dipakai aplikasi '{pemilik}'"),
            ));
        }
        if !port_bebas(p) {
            return Err(pesan_port_bentrok(
                workspace,
                nama,
                p,
                "sedang dipakai proses lain di server ini",
            ));
        }
        return Ok((APP_PORT, p));
    }

    if let Some(lama) = baca_registry(workspace)
        .iter()
        .find(|proyek| proyek.nama == nama)
        .map(|proyek| proyek.deploy_port)
    {
        return Ok((APP_PORT, lama));
    }

    match saran_port_bebas(workspace, nama) {
        Some(p) => Ok((APP_PORT, p)),
        None => Err(format!(
            "Tidak ada port bebas di rentang {PORT_AWAL}-{PORT_AKHIR}. Bersihkan registry.tsv atau hentikan container lama."
        )),
    }
}

/// Kunci port aplikasi di `registry.tsv` (tambah kalau baru, segarkan kalau sudah
/// ada) supaya aplikasi berikutnya tidak diberi port yang sama.
pub(crate) fn catat_port(
    workspace: &std::path::Path,
    nama: &str,
    app_port: u16,
    deploy_port: u16,
) {
    let mut baris = entri_registry(workspace);
    match baris.iter_mut().find(|(n, _, _)| n == nama) {
        Some(entri) => {
            entri.1 = app_port;
            entri.2 = deploy_port;
        }
        None => baris.push((nama.to_string(), app_port, deploy_port)),
    }
    let isi: String = baris
        .iter()
        .map(|(n, a, d)| format!("{n}\t{a}\t{d}\n"))
        .collect();
    let reg = workspace.join("registry.tsv");
    if let Err(e) = std::fs::write(&reg, isi) {
        eprintln!("WARNING: gagal menulis {}: {e}", reg.display());
    }
}

fn alokasi_port(
    workspace: &std::path::Path,
    nama: &str,
    pilihan: Option<u16>,
) -> Result<(u16, u16), String> {
    let (app_port, deploy_port) = pilih_port(workspace, nama, pilihan)?;
    catat_port(workspace, nama, app_port, deploy_port);
    Ok((app_port, deploy_port))
}

/// Nama aplikasi lain yang sudah mengunci `port` di registry.
fn pemilik_port(workspace: &std::path::Path, nama: &str, port: u16) -> Option<String> {
    baca_registry(workspace)
        .into_iter()
        .find(|proyek| proyek.deploy_port == port && proyek.nama != nama)
        .map(|proyek| proyek.nama)
}

/// Port yang belum dikunci aplikasi lain **dan** belum di-listen proses mana pun.
fn saran_port_bebas(workspace: &std::path::Path, nama: &str) -> Option<u16> {
    let terkunci: Vec<u16> = baca_registry(workspace)
        .into_iter()
        .filter(|proyek| proyek.nama != nama)
        .map(|proyek| proyek.deploy_port)
        .collect();
    let kelipatan_sepuluh = (PORT_AWAL..PORT_TENGAH).step_by(10);
    let celah = (PORT_AWAL..=PORT_AKHIR).filter(|p| !(p - PORT_AWAL).is_multiple_of(10));
    kelipatan_sepuluh
        .chain(celah)
        .find(|p| !terkunci.contains(p) && port_bebas(*p))
}

fn pesan_port_bentrok(
    workspace: &std::path::Path,
    nama: &str,
    port: u16,
    sebab: &str,
) -> String {
    let saran = saran_port_bebas(workspace, nama)
        .map(|p| p.to_string())
        .unwrap_or_else(|| "(tidak ada)".to_string());
    format!("Port {port} {sebab}. Saran port bebas: {saran}.")
}

/// Semua baris `registry.tsv` utuh (nama, port app, port deploy) untuk ditulis ulang.
fn entri_registry(workspace: &std::path::Path) -> Vec<(String, u16, u16)> {
    const APP_PORT: u16 = 8000;
    let mut out = Vec::new();
    let Ok(isi) = std::fs::read_to_string(workspace.join("registry.tsv")) else {
        return out;
    };
    for baris in isi.lines() {
        let mut it = baris.split('\t');
        let nama = it.next().unwrap_or("").trim();
        if nama.is_empty() {
            continue;
        }
        let app = it
            .next()
            .and_then(|a| a.trim().parse::<u16>().ok())
            .unwrap_or(APP_PORT);
        let Some(deploy) = it.next().and_then(|d| d.trim().parse::<u16>().ok()) else {
            continue;
        };
        out.push((nama.to_string(), app, deploy));
    }
    out
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
    let mut hasil_bytes: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    hasil_bytes.push(v);
                    i += 3;
                    continue;
                }
                hasil_bytes.push(b'%');
                i += 1;
            }
            b'+' => {
                hasil_bytes.push(b' ');
                i += 1;
            }
            b => {
                hasil_bytes.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&hasil_bytes).trim().to_string()
}

fn json_escape(teks: &str) -> String {
    teks.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(['\n', '\r'], " ")
}

fn status_reason(kode: u16) -> &'static str {
    match kode {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

fn kirim(stream: &mut TcpStream, kode: u16, tipe: &str, body: &str) -> std::io::Result<()> {
    let reason = status_reason(kode);
    let head = format!(
        "HTTP/1.1 {kode} {reason}\r\nContent-Type: {tipe}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
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

    /// Port yang baru saja dibebaskan kernel: dipakai tes port pilihan pengguna
    /// supaya tidak bergantung pada port mana yang kebetulan hidup di server ini.
    fn port_bebas_baru() -> u16 {
        let tahan = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = tahan.local_addr().unwrap().port();
        drop(tahan);
        port
    }

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
        let (a1, d1) = alokasi_port(tmp.path(), "proj-a", None).unwrap();
        let (a2, d2) = alokasi_port(tmp.path(), "proj-a", None).unwrap();
        assert_eq!((a1, d1), (a2, d2));
        assert_eq!(a1, 8000, "port dalam container selalu 8000");
        assert!(d1 >= 8003);
        let (a3, d3) = alokasi_port(tmp.path(), "proj-b", None).unwrap();
        assert_eq!(a3, 8000);
        assert_ne!(d1, d3, "port host harus beda tiap project");
    }

    #[test]
    fn alokasi_port_menyimpan_port_pilihan_pengguna() {
        let tmp = TempDir::new().unwrap();
        // Port tetap (mis. 8085) bisa kebetulan sedang dipakai container di server
        // ini, jadi pakai port yang baru saja dibebaskan kernel.
        let port = port_bebas_baru();
        let (a1, d1) = alokasi_port(tmp.path(), "proj-custom", Some(port)).unwrap();
        assert_eq!(d1, port);
        assert_eq!(a1, 8000);
        let daftar = baca_registry(tmp.path());
        assert_eq!(daftar.len(), 1);
        assert_eq!(daftar[0].nama, "proj-custom");
        assert_eq!(daftar[0].deploy_port, port);
    }

    #[test]
    fn pilih_port_menolak_port_pilihan_yang_sudah_terdaftar() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("registry.tsv"), "lain\t8000\t8088\n").unwrap();
        let err = pilih_port(tmp.path(), "baru", Some(8088)).unwrap_err();
        assert!(err.contains("8088"), "pesan harus menyebut portnya: {err}");
        assert!(
            err.contains("Saran port bebas"),
            "pesan harus menawarkan port lain: {err}"
        );
    }

    #[test]
    fn pilih_port_menolak_port_pilihan_yang_sedang_hidup() {
        let tmp = TempDir::new().unwrap();
        let tahan = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = tahan.local_addr().unwrap().port();
        let err = pilih_port(tmp.path(), "baru", Some(port)).unwrap_err();
        assert!(
            err.contains(&port.to_string()),
            "pesan harus menyebut portnya: {err}"
        );
    }

    #[test]
    fn pilih_port_melewati_port_yang_sudah_dikunci_registry() {
        // Port belum di-listen (deploy belum jalan), tapi sudah tercatat milik
        // aplikasi lain: alokator wajib melewatinya.
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("registry.tsv"), "lain\t8000\t8003\n").unwrap();
        let (app, deploy) = pilih_port(tmp.path(), "baru", None).unwrap();
        assert_eq!(app, 8000);
        assert_ne!(deploy, 8003, "port yang sudah dikunci aplikasi lain dipakai ulang");
    }

    #[test]
    fn pilih_port_memakai_ulang_port_aplikasi_yang_sama() {
        let tmp = TempDir::new().unwrap();
        catat_port(tmp.path(), "aku", 8000, 8090);
        catat_port(tmp.path(), "lain", 8000, 8003);
        assert_eq!(pilih_port(tmp.path(), "aku", None).unwrap().1, 8090);
    }

    #[test]
    fn catat_port_menambah_dan_menyegarkan_tanpa_menggusur_lain() {
        let tmp = TempDir::new().unwrap();
        catat_port(tmp.path(), "satu", 8000, 8003);
        catat_port(tmp.path(), "dua", 8000, 8013);
        catat_port(tmp.path(), "satu", 8000, 8023);
        let daftar = baca_registry(tmp.path());
        assert_eq!(daftar.len(), 2, "baris nama yang sama disegarkan, bukan digandakan");
        assert_eq!(daftar[0].nama, "satu");
        assert_eq!(daftar[0].deploy_port, 8023);
        assert_eq!(daftar[1].nama, "dua");
    }

    #[test]
    fn pilih_port_memberi_port_berbeda_untuk_tiga_nama() {
        let tmp = TempDir::new().unwrap();
        let mut dipakai = Vec::new();
        for nama in ["port-a", "port-b", "port-c"] {
            dipakai.push(alokasi_port(tmp.path(), nama, None).unwrap().1);
        }
        let jumlah_unik = {
            let mut u = dipakai.clone();
            u.sort_unstable();
            u.dedup();
            u.len()
        };
        assert_eq!(jumlah_unik, 3, "tiap aplikasi baru harus dapat port sendiri: {dipakai:?}");
        assert_eq!(baca_registry(tmp.path()).len(), 3);
    }

    #[test]
    fn pilih_port_melebar_kalau_tangga_sepuluhan_habis() {
        let tmp = TempDir::new().unwrap();
        let isi: String = (1..=20)
            .map(|i| format!("app-{i}\t8000\t{}\n", 8003 + i * 10))
            .collect();
        std::fs::write(tmp.path().join("registry.tsv"), isi).unwrap();
        let (_, deploy) = pilih_port(tmp.path(), "baru", None).unwrap();
        let dipakai: Vec<u16> = baca_registry(tmp.path())
            .iter()
            .map(|p| p.deploy_port)
            .collect();
        assert!(
            !dipakai.contains(&deploy),
            "port {deploy} sudah dipakai aplikasi lain"
        );
        assert!((8000..=9000).contains(&deploy), "port di luar rentang wajar: {deploy}");
    }

    #[test]
    fn pesan_gagal_diterjemahkan_ke_bahasa_manusia() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job {
                id: 0,
                nama: "demo".to_string(),
                status: Status::Running,
                baris: vec![
                    "  • Folder bla".to_string(),
                    "! ERROR: Token GitHub tidak ditemukan. Set AUTORE_GITHUB_TOKEN atau jalankan lewat menu."
                        .to_string(),
                ],
                tahap_urut: Vec::new(),
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
    fn baca_registry_melewati_baris_rusak() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("registry.tsv"),
            "web-a\t8000\t8003\n\nrusak-tanpa-port\nweb-b\t8000\t8013\n",
        )
        .unwrap();
        let daftar = baca_registry(tmp.path());
        assert_eq!(daftar.len(), 2, "baris rusak tidak masuk");
        assert_eq!(daftar[0].nama, "web-a");
        assert_eq!(daftar[0].deploy_port, 8003);
        assert_eq!(daftar[1].nama, "web-b");
    }

    #[test]
    fn baca_registry_kosong_kalau_belum_ada_catatan() {
        let tmp = TempDir::new().unwrap();
        assert!(baca_registry(tmp.path()).is_empty());
    }

    #[test]
    fn batalkan_menolak_saat_tidak_ada_pekerjaan() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job::default())),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };
        assert!(!srv.batalkan(), "tidak ada yang jalan = tidak ada yang dibatalkan");
        assert!(matches!(srv.job.lock().unwrap().status, Status::Idle));
    }

    #[test]
    fn jawaban_form_ditolak_sebelum_kerja() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job::default())),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };
        let (kode, pesan) = srv.mulai_job("demo-app", "ngawur", "otomatis");
        assert_eq!(kode, 400);
        assert!(pesan.contains("ngawur"), "pesan menyebut pilihan yang salah");

        let (kode, pesan) = srv.mulai_job("demo-app", "contoh", "80");
        assert_eq!(kode, 400, "port di bawah 1024 ditolak");
        assert!(pesan.contains("1024"));

        let (kode, pesan) = srv.mulai_job("demo-app", "contoh", "8080");
        assert_eq!(kode, 400, "port infra 8080 ditolak");
        assert!(pesan.contains("8080"));

        let (kode, _) = srv.mulai_job("Demo App", "contoh", "otomatis");
        assert_eq!(kode, 400, "nama tidak valid ditolak");
    }

    #[test]
    fn url_decode_mendukung_utf8() {
        assert_eq!(url_decode("halo+dunia"), "halo dunia");
        assert_eq!(url_decode("%E2%9C%94+ok"), "✔ ok");
    }

    #[test]
    fn status_reason_sesuai_rfc() {
        assert_eq!(status_reason(200), "OK");
        assert_eq!(status_reason(400), "Bad Request");
        assert_eq!(status_reason(404), "Not Found");
        assert_eq!(status_reason(409), "Conflict");
        assert_eq!(status_reason(413), "Payload Too Large");
        assert_eq!(status_reason(500), "Internal Server Error");
    }

    #[test]
    fn mulai_job_menolak_saat_masih_ada_yang_jalan() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job {
                id: 0,
                nama: "sedang-jalan".to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            })),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };
        let (kode, pesan) = srv.mulai_job("yang-lain", "contoh", "otomatis");
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
        let (kode, pesan) = srv.mulai_job("Nama Salah", "contoh", "otomatis");
        assert_eq!(kode, 400);
        assert!(pesan.contains("huruf kecil"));
    }

    #[test]
    fn json_escape_mengubah_karakter_khusus() {
        assert_eq!(json_escape("baris 1\nbaris 2\r\n\"kutip\"\\garis"), "baris 1 baris 2  \\\"kutip\\\"\\\\garis");
    }

    #[test]
    fn display_host_memilih_alamat_yang_tepat() {
        assert_eq!(display_host("127.0.0.1"), "127.0.0.1");
        assert_eq!(display_host("192.168.1.5"), "192.168.1.5");
        let all = display_host("0.0.0.0");
        assert!(!all.is_empty());
    }

    #[test]
    fn catat_id_dan_tahap_id_hanya_merekam_run_id_yang_cocok() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job {
                id: 42,
                nama: "test".to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            })),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };

        // salah run_id -> diabaikan
        srv.catat_id(999, "log liar");
        srv.catat_tahap_id(999, "tahap-liar");
        {
            let j = srv.job.lock().unwrap();
            assert!(j.baris.is_empty());
            assert!(j.tahap_urut.is_empty());
        }

        // benar run_id -> masuk
        srv.catat_id(42, "log valid");
        srv.catat_tahap_id(42, "tahap-valid");
        srv.catat_tahap_id(42, "tahap-valid"); // dedup consecutive
        {
            let j = srv.job.lock().unwrap();
            assert_eq!(j.baris.len(), 1);
            assert_eq!(j.tahap_urut.len(), 1);
        }

        srv.selesai_sukses_id(42, "http://app", "sukses");
        {
            let j = srv.job.lock().unwrap();
            assert_eq!(j.status, Status::Sukses);
            assert_eq!(j.tautan, "http://app");
        }

        srv.selesai_gagal_id(42, "gagal");
        {
            let j = srv.job.lock().unwrap();
            assert_eq!(j.status, Status::Gagal);
            assert_eq!(j.pesan, "gagal");
        }
    }

    #[test]
    fn server_handle_rute_http() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let tmp = TempDir::new().unwrap();
        let srv = Arc::new(Server {
            job: Arc::new(Mutex::new(Job::default())),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        });

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let srv_clone = Arc::clone(&srv);
        let t = thread::spawn(move || {
            for _ in 0..11 {
                if let Ok((stream, _)) = listener.accept() {
                    let _ = srv_clone.handle(stream);
                }
            }
        });

        let kirim_req = |req: &str| -> String {
            let mut c = TcpStream::connect(addr).unwrap();
            c.write_all(req.as_bytes()).unwrap();
            let mut buf = Vec::new();
            c.read_to_end(&mut buf).unwrap();
            String::from_utf8_lossy(&buf).to_string()
        };

        // 1. GET /
        let resp = kirim_req("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.to_ascii_lowercase().contains("<!doctype html>"));

        // 1b. GET /v2
        let resp_v2 = kirim_req("GET /v2 HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp_v2.starts_with("HTTP/1.1 200 OK"));
        assert!(resp_v2.contains("dag-container"));

        // 2. GET /api/status
        let resp = kirim_req("GET /api/status HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.contains("\"status\":\"idle\""));

        // 3. GET /api/daftar dengan proyek di registry
        std::fs::write(
            tmp.path().join("registry.tsv"),
            "proyek-satu\t8000\t8010\n",
        )
        .unwrap();
        let resp = kirim_req("GET /api/daftar HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.contains("proyek-satu"));

        // 4. GET /api/kemampuan
        let resp = kirim_req("GET /api/kemampuan HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.contains("\"versi\":"));
        assert!(resp.contains("\"buat-baru\""));

        // 5. POST /api/batal (saat sedang running)
        {
            let mut j = srv.job.lock().unwrap();
            j.status = Status::Running;
            j.id = 123;
        }
        let resp = kirim_req("POST /api/batal HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.contains("\"ok\":true"));

        // 6. POST /api/buat dengan payload > 64KB -> 413
        let resp = kirim_req("POST /api/buat HTTP/1.1\r\nHost: localhost\r\nContent-Length: 70000\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 413 Payload Too Large"));

        // 7. POST /api/buat dengan nama salah -> 400
        let b = "nama=Salah!&kode=contoh&alamat=otomatis";
        let req = format!("POST /api/buat HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n{}", b.len(), b);
        let resp = kirim_req(&req);
        assert!(resp.starts_with("HTTP/1.1 400 Bad Request"));

        // 8. GET /tidak-ada -> 404
        let resp = kirim_req("GET /tidak-ada HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 404 Not Found"));

        // 9. GET /api/log (saat status selesai sukses)
        {
            let mut j = srv.job.lock().unwrap();
            j.status = Status::Sukses;
            j.nama = "selesai-app".to_string();
            j.tautan = "http://selesai".to_string();
            j.tahap_urut.push("tahap-uji".to_string());
            j.baris.push("log akhir".to_string());
        }
        let resp = kirim_req("GET /api/log HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.contains("text/event-stream"));
        assert!(resp.contains("event: hasil"));

        // 10. GET /api/log (saat status gagal)
        {
            let mut j = srv.job.lock().unwrap();
            j.status = Status::Gagal;
            j.pesan = "gagal total".to_string();
        }
        let resp = kirim_req("GET /api/log HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.contains("\"status\":\"gagal\""));

        t.join().unwrap();

        let srv2 = srv.clone_ringan();
        assert_eq!(srv2.workspace, srv.workspace);
        assert!(srv2.pesan_gagal_terakhir("selesai-app").contains("Buka detail teknis"));
    }

    #[test]
    fn status_as_str_mencakup_semua_keadaan() {
        assert_eq!(Status::Idle.as_str(), "idle");
        assert_eq!(Status::Running.as_str(), "running");
        assert_eq!(Status::Sukses.as_str(), "sukses");
        assert_eq!(Status::Gagal.as_str(), "gagal");
    }

    #[test]
    fn workspace_dir_menghasilkan_path() {
        let w = workspace_dir();
        assert!(!w.as_os_str().is_empty());

        std::env::set_var("AUTORE_WORKSPACE", "/tmp/autore-custom-ws");
        let w2 = workspace_dir();
        assert_eq!(w2, PathBuf::from("/tmp/autore-custom-ws"));
        std::env::remove_var("AUTORE_WORKSPACE");
    }

    #[test]
    fn port_bebas_memeriksa_port() {
        let _ = port_bebas(1024);
    }

    #[test]
    fn terjemahkan_id_mencakup_berbagai_tahap() {
        let tmp = TempDir::new().unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job {
                id: 1,
                nama: "test".to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            })),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };

        srv.terjemahkan_id(1, "1/4 Inisialisasi");
        srv.terjemahkan_id(1, "2/4 Repo GitHub");
        srv.terjemahkan_id(1, "3/4 Push ke Git");
        srv.terjemahkan_id(1, "siap & build-nya sudah jalan di Jenkins");
        srv.terjemahkan_id(1, "baris biasa");

        let j = srv.job.lock().unwrap();
        assert!(j.baris.iter().any(|b| b.contains("Kerangka aplikasi")));
        assert!(j.baris.iter().any(|b| b.contains("Repository GitHub")));
        assert!(j.baris.iter().any(|b| b.contains("Kode dikirim")));
        assert!(j.baris.iter().any(|b| b.contains("Didaftarkan ke Jenkins")));
    }

    #[test]
    fn pesan_gagal_terjemahan_lengkap() {
        let tmp = TempDir::new().unwrap();
        let buat_srv = |baris: Vec<String>| Server {
            job: Arc::new(Mutex::new(Job {
                id: 10,
                nama: "demo".to_string(),
                status: Status::Gagal,
                baris,
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            })),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        };

        let srv = buat_srv(vec!["! ERROR: folder belum berisi kode aplikasi".into()]);
        assert!(srv.pesan_gagal_terakhir_id(10, "demo").contains("belum punya kode"));

        let srv = buat_srv(vec!["! ERROR: repo sudah punya Dockerfile".into()]);
        assert!(srv.pesan_gagal_terakhir_id(10, "demo").contains("sudah dipakai"));

        let srv = buat_srv(vec!["! ERROR: gagal push ke git".into()]);
        assert!(srv.pesan_gagal_terakhir_id(10, "demo").contains("tidak bisa dikirim"));

        let srv = buat_srv(vec!["! ERROR: masalah jaringan tak terduga".into()]);
        assert!(srv.pesan_gagal_terakhir_id(10, "demo").contains("masalah jaringan"));

        let srv = buat_srv(vec!["tidak ada error".into()]);
        assert!(srv.pesan_gagal_terakhir_id(10, "demo").contains("Buka detail teknis"));

        let srv = buat_srv(vec![]);
        assert_eq!(srv.pesan_gagal_terakhir_id(999, "demo"), "Aplikasi 'demo' gagal disiapkan.");
    }

    #[test]
    fn halaman_v2_berisi_komponen_dashboard_baru() {
        assert!(HALAMAN_V2.contains("Autore"));
        assert!(HALAMAN_V2.contains("v2"));
        assert!(HALAMAN_V2.contains("dag-container"));
        assert!(HALAMAN_V2.contains("/api/daftar"));
    }

    fn srv_dengan_job(tmp: &TempDir, job: Job) -> Server {
        Server {
            job: Arc::new(Mutex::new(job)),
            workspace: tmp.path().to_path_buf(),
            host_tampil: "127.0.0.1".to_string(),
        }
    }

    fn catatan(tmp: &TempDir) -> crate::status::Snapshot {
        crate::status::load(tmp.path())
    }

    #[test]
    fn tahap_dan_selesai_menyimpan_status_dashboard() {
        let tmp = TempDir::new().unwrap();
        let srv = srv_dengan_job(
            &tmp,
            Job {
                id: 7,
                nama: "portal-klaim".to_string(),
                status: Status::Running,
                baris: vec!["menyiapkan".to_string()],
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            },
        );

        srv.simpan_status();
        let awal = catatan(&tmp);
        assert_eq!(awal.system_status, "running");
        assert_eq!(awal.latest_pipeline.status, "running");
        assert_eq!(awal.latest_pipeline.raw_log, vec!["menyiapkan".to_string()]);

        // tahap baru -> tersimpan tanpa menunggu pekerjaan selesai
        srv.catat_tahap_id(7, "kerangka");
        assert_eq!(
            catatan(&tmp).latest_pipeline.stages,
            vec!["kerangka".to_string()]
        );

        srv.selesai_sukses_id(7, "http://127.0.0.1:8003", "Aplikasi 'portal-klaim' hidup.");
        let akhir = catatan(&tmp);
        assert_eq!(akhir.system_status, "passed");
        assert_eq!(akhir.latest_pipeline.status, "passed");
        let app = akhir
            .applications
            .iter()
            .find(|a| a.name == "portal-klaim")
            .expect("aplikasi tercatat setelah build sukses");
        assert_eq!(app.status, "passed");
        assert!(app.last_build.ends_with('Z'), "{}", app.last_build);
    }

    #[test]
    fn gagal_dan_batal_menyimpan_alasan_gagal() {
        let tmp = TempDir::new().unwrap();
        let srv = srv_dengan_job(
            &tmp,
            Job {
                id: 9,
                nama: "app-gagal".to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            },
        );

        srv.selesai_gagal_id(9, "Build di Jenkins gagal (FAILURE).");
        let gagal = catatan(&tmp);
        assert_eq!(gagal.system_status, "failed");
        assert_eq!(
            gagal.latest_pipeline.failure_reason,
            "Build di Jenkins gagal (FAILURE)."
        );

        // Batalkan pekerjaan berikutnya juga tersimpan.
        {
            let mut j = srv.job.lock().unwrap();
            j.id = 10;
            j.status = Status::Running;
            j.pesan = String::new();
        }
        assert!(srv.batalkan());
        let batal = catatan(&tmp);
        assert_eq!(batal.latest_pipeline.status, "failed");
        assert!(batal.latest_pipeline.failure_reason.contains("Dibatalkan"));
    }

    #[test]
    fn gagal_menulis_status_tidak_mengubah_hasil_pipeline() {
        let tmp = TempDir::new().unwrap();
        // Workspace berupa berkas biasa: penulisan simpanan pasti gagal.
        let bukan_folder = tmp.path().join("bukan-folder");
        std::fs::write(&bukan_folder, "x").unwrap();
        let srv = Server {
            job: Arc::new(Mutex::new(Job {
                id: 11,
                nama: "app-x".to_string(),
                status: Status::Running,
                baris: Vec::new(),
                tahap_urut: Vec::new(),
                tautan: String::new(),
                pesan: String::new(),
            })),
            workspace: bukan_folder,
            host_tampil: "127.0.0.1".to_string(),
        };

        srv.selesai_gagal_id(11, "gagal apa saja");
        {
            let j = srv.job.lock().unwrap();
            assert_eq!(
                j.status,
                Status::Gagal,
                "hasil pipeline tetap seperti semula"
            );
            assert_eq!(j.pesan, "gagal apa saja");
        }
        srv.selesai_sukses_id(11, "http://app", "sukses");
        assert_eq!(srv.job.lock().unwrap().status, Status::Sukses);
    }
}
