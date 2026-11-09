//! Pemilih tugas ramah saat `autore` dipanggil tanpa subcommand.
//!
//! Aturan tampilan modul ini (mutlak, ditegakkan tes `semua_pesan_ascii`):
//! teks ASCII murni, tanpa emoji, bahasa Indonesia formal, tanpa ornamen.
//!
//! Tes integrasi bisa melewati prompt interaktif dengan `AUTORE_MENU_PILIHAN=1|2|3|4`
//! (khusus tes; tidak ditampilkan di `--help`).

use std::io::{IsTerminal, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const JUDUL: &str = "Autore - Pemilih Tugas";
const OPSI: [&str; 4] = [
    "[1] Web Dashboard",
    "[2] TUI Legacy",
    "[3] Keluar",
    "[4] Admin",
];

const PENGGUNA_DEFAULT: &str = "tugure";
pub(crate) const UNIT_API: &str = "autore-web-api";
pub(crate) const UNIT_DASHBOARD: &str = "autore-web-dashboard";

/// Dua proses dashboard: (argv npm, berkas log, berkas PID). Satu sumber untuk jalur
/// tanpa systemd di `launcher.rs` dan `admin.rs`.
pub(crate) const PROSES: [([&str; 3], &str, &str); 2] = [
    (["npm", "run", "start:api"], "api.log", "api.pid"),
    (["npm", "run", "start:dashboard"], "dashboard.log", "dashboard.pid"),
];
const PORT_DASHBOARD: u16 = 9120;
const PORT_API: u16 = 9121;
const IP_LOCALHOST: &str = "127.0.0.1";

/// Seam ke mesin: tes memakai `SistemPalsu`, produksi memakai [`SistemNyata`].
pub trait Sistem {
    fn pengguna(&self) -> String;
    fn systemctl_ada(&self) -> bool;
    fn unit_terdaftar(&self, unit: &str) -> bool;
    /// Status kedua unit dalam satu panggilan, sejajar dengan `units`. Kosong = systemctl
    /// tidak bisa dipakai (bus mati / non-systemd).
    fn status(&self, units: &[&str]) -> Vec<String>;
    fn start(&self, unit: &str) -> Result<(), String>;
    /// Keluaran mentah `tailscale ip -4` (None = perintah tidak ada/gagal).
    fn ip_tailscale(&self) -> Option<String>;
    /// Keluaran mentah `hostname -I` (None = perintah tidak ada/gagal).
    fn ip_hostname(&self) -> Option<String>;
    /// Ada proses yang menerima koneksi pada `host:port`?
    fn port_terbuka(&self, host: &str, port: u16) -> bool;
    /// Jalankan perintah di latar (`nohup`), kembalikan PID; tulis PID ke `pid_file`.
    fn jalankan_latar(
        &self,
        dir: &Path,
        perintah: &[&str],
        log: &Path,
        pid_file: &Path,
    ) -> Result<u32, String>;
    /// Direktori state pengguna (`~/.local/state/autore`, hormati `XDG_STATE_HOME`).
    fn dir_state(&self) -> PathBuf;
    /// Jalankan program dengan stdio warisan (kode keluar diteruskan apa adanya).
    /// Dipakai `admin.rs` untuk `systemctl`, `journalctl -f`, dan `tail -f`.
    fn warisi(&self, program: &str, argumen: &[String]) -> Result<i32, String>;
    /// Kirim SIGTERM ke PID (jalur tanpa systemd).
    fn hentikan(&self, pid: u32) -> Result<(), String>;
}

const TIMEOUT_SIAP: Duration = Duration::from_millis(15_000);
const JEDA_POLL: Duration = Duration::from_millis(500);

/// Tunggu sampai semua `target` menerima koneksi; kembalikan target yang masih tertutup
/// saat batas waktu habis (kosong = semua siap).
fn tunggu_siap<'a>(
    sis: &dyn Sistem,
    target: &[(&'a str, u16)],
    batas: Duration,
    jeda: Duration,
) -> Vec<(&'a str, u16)> {
    let mulai = Instant::now();
    loop {
        let tertutup: Vec<(&'a str, u16)> = target
            .iter()
            .copied()
            .filter(|(host, port)| !sis.port_terbuka(host, *port))
            .collect();
        if tertutup.is_empty() || mulai.elapsed() >= batas {
            return tertutup;
        }
        std::thread::sleep(jeda);
    }
}

fn pesan_port_bentrok() -> String {
    format!(
        "[!] Port {PORT_DASHBOARD} sudah dipakai proses lain. Hentikan proses tersebut \
         (contoh: proses node lama) lalu jalankan perintah ini lagi."
    )
}

fn pesan_siap() -> String {
    format!("[OK] Dashboard menerima koneksi pada port {PORT_DASHBOARD}.")
}

fn pesan_belum_siap(detik: u64) -> String {
    format!(
        "[!] Dashboard belum menerima koneksi pada port {PORT_DASHBOARD} setelah {detik} detik. \
         Periksa: journalctl --user -u {UNIT_DASHBOARD} -n 30"
    )
}

fn pesan_penutup() -> String {
    "Catatan: Anda dapat menutup terminal ini. Dashboard akan tetap berjalan di background."
        .to_string()
}

/// Jalur tanpa systemd (macOS/WSL): kedua layanan dijalankan lewat `nohup`.
fn jalankan_tanpa_systemd(
    sis: &dyn Sistem,
    keluar: &mut dyn Write,
    batas: Duration,
    jeda: Duration,
    web_dir: Option<PathBuf>,
) -> i32 {
    let dir = match web_dir {
        Some(dir) => dir,
        None => {
            let _ = writeln!(keluar, "{}", pesan_web_dir_tidak_ketemu());
            return 1;
        }
    };
    let _ = writeln!(keluar, "{}", pesan_sistemd_tidak_ada());

    let state = sis.dir_state();
    let mut pid_dashboard = None;
    for (perintah, berkas_log, berkas_pid) in PROSES {
        let log = state.join(berkas_log);
        let pid_file = state.join(berkas_pid);
        match sis.jalankan_latar(&dir, &perintah, &log, &pid_file) {
            Ok(pid) => {
                let _ = writeln!(
                    keluar,
                    "[OK] {}: dijalankan di latar (PID {pid}).",
                    perintah.join(" ")
                );
                pid_dashboard = Some(pid_file);
            }
            Err(galat) => {
                let _ = writeln!(keluar, "[!] Gagal menjalankan {}: {galat}", perintah.join(" "));
                return 1;
            }
        }
    }

    let kode = selesaikan(sis, keluar, batas, jeda);
    if kode == 0 {
        let _ = writeln!(keluar, "\n{}", pesan_penutup());
        if let Some(pid_file) = pid_dashboard {
            let _ = writeln!(keluar, "{}", pesan_hentikan(&pid_file));
        }
    }
    kode
}

/// `Autore/web` tempat perintah npm dijalankan: `AUTORE_WEB_DIR` lebih dulu, lalu
/// `web/` di sekitar cwd dan direktori biner.
fn pilih_web_dir(env: Option<String>, kandidat: &[PathBuf]) -> Option<PathBuf> {
    if let Some(dir) = env.filter(|dir| !dir.trim().is_empty()) {
        let dir = PathBuf::from(dir.trim());
        return dir.join("package.json").is_file().then_some(dir);
    }
    kandidat
        .iter()
        .find(|dir| dir.join("package.json").is_file())
        .cloned()
}

pub(crate) fn cari_web_dir() -> Option<PathBuf> {
    let mut kandidat = vec![
        PathBuf::from("web"),
        PathBuf::from("../web"),
        PathBuf::from("../../web"),
    ];
    if let Ok(biner) = std::env::current_exe() {
        for naik in 1..=3 {
            if let Some(akar) = biner.ancestors().nth(naik) {
                kandidat.push(akar.join("web"));
            }
        }
    }
    pilih_web_dir(std::env::var("AUTORE_WEB_DIR").ok(), &kandidat)
}

/// `~/.local/state/autore`, hormati `XDG_STATE_HOME`.
fn dir_state_dari(env: Option<String>, home: &str) -> PathBuf {
    match env.filter(|dasar| !dasar.trim().is_empty()) {
        Some(dasar) => Path::new(dasar.trim()).join("autore"),
        None => Path::new(home).join(".local/state/autore"),
    }
}

/// Pilihan menu dari `AUTORE_MENU_PILIHAN` (khusus tes; tidak ada di `--help`).
fn pilihan_dari_env(env: Option<String>) -> Option<usize> {
    env?.trim()
        .parse::<usize>()
        .ok()
        .filter(|n| (1..=4).contains(n))
}

/// Dipakai saat stdout bukan terminal (mis. `autore | tee`): tidak ada gunanya
/// menampilkan menu yang tidak bisa dijawab.
pub(crate) fn panduan_subcommand() -> String {
    [
        "Panduan singkat:",
        "  autore status            - status aplikasi dan pipeline",
        "  autore runs              - riwayat pipeline",
        "  autore deploy --path .   - deploy proyek",
        "  autore start             - nyalakan layanan dashboard",
        "  autore stop              - hentikan layanan dashboard",
        "  autore restart           - nyalakan ulang layanan dashboard",
        "  autore logs              - ikuti log layanan (Ctrl-C untuk berhenti)",
        "  autore --help            - seluruh perintah",
        "Jalankan `autore` langsung di terminal untuk memilih menu.",
    ]
    .join("\n")
}

fn pesan_sistemd_tidak_ada() -> String {
    "[i] systemd tidak tersedia pada mesin ini. Layanan dijalankan tanpa systemd.".to_string()
}

pub(crate) fn pesan_web_dir_tidak_ketemu() -> String {
    "[!] Repo web (Autore/web) tidak ditemukan. Setel AUTORE_WEB_DIR ke direktori tersebut."
        .to_string()
}

fn pesan_hentikan(pid_file: &Path) -> String {
    format!(
        "Proses dijalankan tanpa systemd. Hentikan dengan: kill $(cat {})",
        pid_file.display()
    )
}

/// Titik masuk dari `main.rs`: 1 = Web Dashboard, 2 = TUI legacy, 3 = keluar.
pub fn menu_awal() -> usize {
    if let Some(pilihan) = pilihan_dari_env(std::env::var("AUTORE_MENU_PILIHAN").ok()) {
        return pilihan;
    }
    let mut keluar = std::io::stdout();
    if !std::io::stdout().is_terminal() {
        let _ = writeln!(keluar, "{}", panduan_subcommand());
        return 3;
    }
    let _ = writeln!(keluar, "{JUDUL}");
    let opsi: Vec<String> = OPSI.iter().map(|opsi| (*opsi).to_string()).collect();
    let mut tanya = || crate::ui_ask_choose("Pilih tugas", &opsi).map(|indeks| indeks + 1);
    baca_pilihan(&mut tanya, &mut |pesan: &str| {
        let _ = writeln!(std::io::stdout(), "{pesan}");
    })
}

/// Implementasi nyata: memanggil perintah sistem apa adanya.
pub struct SistemNyata;

fn keluaran(program: &str, argumen: &[&str]) -> Option<String> {
    let hasil = std::process::Command::new(program)
        .args(argumen)
        .output()
        .ok()?;
    hasil
        .status
        .success()
        .then(|| String::from_utf8_lossy(&hasil.stdout).to_string())
}

fn ada_perintah(program: &str) -> bool {
    std::process::Command::new(program)
        .arg("--version")
        .output()
        .is_ok()
}

impl Sistem for SistemNyata {
    fn pengguna(&self) -> String {
        keluaran("id", &["-un"])
            .map(|nama| nama.trim().to_string())
            .filter(|nama| !nama.is_empty())
            .unwrap_or_else(|| std::env::var("USER").unwrap_or_default())
    }

    fn systemctl_ada(&self) -> bool {
        // `AUTORE_TANPA_SYSTEMD=1` memaksa jalur cadangan; dipakai tes integrasi, yang
        // tidak bisa membuang /usr/bin/systemctl dari PATH tanpa ikut kehilangan sh/nohup.
        if std::env::var("AUTORE_TANPA_SYSTEMD").is_ok_and(|nilai| nilai.trim() == "1") {
            return false;
        }
        ada_perintah("systemctl")
    }

    fn unit_terdaftar(&self, unit: &str) -> bool {
        std::process::Command::new("systemctl")
            .args(["--user", "cat", unit])
            .output()
            .is_ok_and(|hasil| hasil.status.success())
    }

    fn status(&self, units: &[&str]) -> Vec<String> {
        let mut argv = vec!["--user", "is-active"];
        argv.extend_from_slice(units);
        let Ok(hasil) = std::process::Command::new("systemctl").args(&argv).output() else {
            return Vec::new();
        };
        let baris: Vec<String> = String::from_utf8_lossy(&hasil.stdout)
            .lines()
            .map(|baris| baris.trim().to_string())
            .filter(|baris| !baris.is_empty())
            .collect();
        // Bus systemd mati (kontainer/WSL) = keluaran kosong, bukan "inactive".
        if baris.len() == units.len() {
            baris
        } else {
            Vec::new()
        }
    }

    fn start(&self, unit: &str) -> Result<(), String> {
        let hasil = std::process::Command::new("systemctl")
            .args(["--user", "start", unit])
            .output()
            .map_err(|galat| galat.to_string())?;
        if hasil.status.success() {
            return Ok(());
        }
        let pesan = String::from_utf8_lossy(&hasil.stderr).trim().to_string();
        Err(if pesan.is_empty() {
            format!("systemctl --user start {unit} gagal")
        } else {
            pesan
        })
    }

    fn ip_tailscale(&self) -> Option<String> {
        keluaran("tailscale", &["ip", "-4"])
    }

    fn ip_hostname(&self) -> Option<String> {
        keluaran("hostname", &["-I"])
    }

    fn port_terbuka(&self, host: &str, port: u16) -> bool {
        let Ok(mut alamat) = std::net::ToSocketAddrs::to_socket_addrs(&(host, port)) else {
            return false;
        };
        match alamat.next() {
            Some(alamat) => {
                std::net::TcpStream::connect_timeout(&alamat, Duration::from_millis(300)).is_ok()
            }
            None => false,
        }
    }

    fn jalankan_latar(
        &self,
        dir: &Path,
        perintah: &[&str],
        log: &Path,
        pid_file: &Path,
    ) -> Result<u32, String> {
        if let Some(induk) = log.parent() {
            std::fs::create_dir_all(induk).map_err(|galat| format!("{}: {galat}", induk.display()))?;
        }
        let berkas = std::fs::File::create(log).map_err(|galat| format!("{}: {galat}", log.display()))?;
        let salinan = berkas.try_clone().map_err(|galat| galat.to_string())?;
        let argv: Vec<&str> = perintah.to_vec();
        // `setsid` memisahkan proses dari terminal; tanpa itu, menutup terminal mengirim SIGHUP.
        let (program, argumen) = if ada_perintah("setsid") {
            ("setsid", argv)
        } else {
            (argv[0], argv[1..].to_vec())
        };
        let anak = std::process::Command::new(program)
            .args(argumen)
            .current_dir(dir)
            .stdin(std::process::Stdio::null())
            .stdout(berkas)
            .stderr(salinan)
            .spawn()
            .map_err(|galat| format!("{}: {galat}", perintah[0]))?;
        let pid = anak.id();
        std::fs::write(pid_file, format!("{pid}\n"))
            .map_err(|galat| format!("{}: {galat}", pid_file.display()))?;
        Ok(pid)
    }

    fn dir_state(&self) -> PathBuf {
        dir_state_dari(
            std::env::var("XDG_STATE_HOME").ok(),
            &std::env::var("HOME").unwrap_or_default(),
        )
    }

    fn warisi(&self, program: &str, argumen: &[String]) -> Result<i32, String> {
        let status = std::process::Command::new(program)
            .args(argumen)
            .status()
            .map_err(|galat| format!("{program}: {galat}"))?;
        Ok(status.code().unwrap_or(1))
    }

    fn hentikan(&self, pid: u32) -> Result<(), String> {
        let status = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|galat| format!("kill: {galat}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("kill -TERM {pid} gagal"))
        }
    }
}

/// Pilih satu alamat IPv4: tailscale lebih dulu, lalu `hostname -I`, lalu localhost.
///
/// `hostname -I` mengembalikan beberapa alamat (termasuk jaringan docker `172.16/12` dan IPv6);
/// mencetak semuanya menghasilkan baris URL sampah, karena itu diambil satu saja.
fn pilih_ip(tailscale: Option<String>, hostname: Option<String>) -> String {
    let ts = ipv4_dari(tailscale);
    if let Some(ip) = ts.first() {
        return ip.clone();
    }
    let hn = ipv4_dari(hostname);
    if let Some(ip) = hn.iter().find(|ip| !jaringan_docker(ip)) {
        return ip.clone();
    }
    if let Some(ip) = hn.first() {
        return ip.clone();
    }
    IP_LOCALHOST.to_string()
}

fn ipv4_dari(teks: Option<String>) -> Vec<String> {
    teks.unwrap_or_default()
        .split_whitespace()
        .filter_map(|token| token.parse::<IpAddr>().ok())
        .filter_map(|alamat| match alamat {
            IpAddr::V4(v4) => Some(v4.to_string()),
            IpAddr::V6(_) => None,
        })
        .collect()
}

/// `172.16.0.0/12` = jaringan jembatan docker; tidak berguna bagi pengguna.
fn jaringan_docker(ip: &str) -> bool {
    let mut bagian = ip.split('.');
    bagian.next() == Some("172")
        && bagian
            .next()
            .and_then(|oktet| oktet.parse::<u8>().ok())
            .is_some_and(|oktet| (16..=31).contains(&oktet))
}

/// URL yang ditampilkan ke pengguna. Dashboard mengikat host ikat, jadi `localhost`
/// hanya dipakai kalau host itu sendiri localhost (tanpa tailscale/hostname).
fn susun_url(ip: &str) -> Vec<String> {
    if ip == IP_LOCALHOST {
        vec![format!("http://localhost:{PORT_DASHBOARD}")]
    } else {
        vec![format!("http://{ip}:{PORT_DASHBOARD}")]
    }
}

/// Pengguna yang diharapkan menjalankan dashboard (env `AUTORE_WEB_USER` menimpa default).
fn diharapkan_dari(env: Option<String>) -> String {
    env.filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| PENGGUNA_DEFAULT.to_string())
}

pub(crate) fn diharapkan() -> String {
    diharapkan_dari(std::env::var("AUTORE_WEB_USER").ok())
}

pub fn pengguna_sah(pengguna: &str, diharapkan: &str) -> bool {
    pengguna == diharapkan
}

pub(crate) fn pesan_akses_ditolak() -> String {
    "[!] Akses ditolak. Silakan jalankan sebagai user yang sesuai.".to_string()
}

fn pesan_unit_belum_terpasang() -> String {
    "[!] Unit systemd pengguna belum terpasang di akun ini.".to_string()
}

/// Handler `[1] Web Dashboard`. Mengembalikan exit code.
pub fn jalankan_web(sis: &dyn Sistem, keluar: &mut dyn Write) -> i32 {
    jalankan_web_batas(sis, keluar, TIMEOUT_SIAP, JEDA_POLL)
}

/// Isi handler. Batas waktu poll disuntik supaya tes memakai nilai kecil.
fn jalankan_web_batas(
    sis: &dyn Sistem,
    keluar: &mut dyn Write,
    batas: Duration,
    jeda: Duration,
) -> i32 {
    let _ = (batas, jeda);
    if !pengguna_sah(&sis.pengguna(), &diharapkan()) {
        let _ = writeln!(keluar, "{}", pesan_akses_ditolak());
        return 1;
    }
    if sis.systemctl_ada() && !sis.unit_terdaftar(UNIT_DASHBOARD) {
        let _ = writeln!(keluar, "{}", pesan_unit_belum_terpasang());
        return 1;
    }
    if !sis.systemctl_ada() {
        return jalankan_tanpa_systemd(sis, keluar, batas, jeda, cari_web_dir());
    }
    let _ = writeln!(keluar, "[OK] Layanan sedang diperiksa.");

    let unit = [UNIT_API, UNIT_DASHBOARD];
    let status = sis.status(&unit);
    if status.len() != unit.len() {
        // systemctl ada tapi bus tak bisa dipakai (kontainer/WSL): jalur tanpa systemd.
        return jalankan_tanpa_systemd(sis, keluar, batas, jeda, cari_web_dir());
    }
    let host_ikat = pilih_ip(sis.ip_tailscale(), sis.ip_hostname());
    if status[1] != "active" && sis.port_terbuka(&host_ikat, PORT_DASHBOARD) {
        let _ = writeln!(keluar, "{}", pesan_port_bentrok());
        return 1;
    }
    for (nama, kini) in unit.iter().zip(status.iter()) {
        match kini.as_str() {
            "active" => {
                let _ = writeln!(keluar, "[OK] {nama}: aktif");
            }
            "activating" => {
                let _ = writeln!(keluar, "[i] {nama}: activating. Menunggu.");
            }
            lain => {
                let _ = writeln!(keluar, "[i] {nama}: {lain}. Menjalankan...");
                if let Err(galat) = sis.start(nama) {
                    let _ = writeln!(keluar, "[!] Gagal menjalankan {nama}: {galat}");
                    return 1;
                }
                let _ = writeln!(keluar, "[OK] {nama}: aktif");
            }
        }
    }

    let kode = selesaikan(sis, keluar, batas, jeda);
    if kode == 0 {
        let _ = writeln!(keluar, "\n{}", pesan_penutup());
    }
    kode
}

/// URL, kesiapan port, dan verdict. Dipakai jalur systemd maupun jalur nohup.
fn selesaikan(sis: &dyn Sistem, keluar: &mut dyn Write, batas: Duration, jeda: Duration) -> i32 {
    let ip = pilih_ip(sis.ip_tailscale(), sis.ip_hostname());
    let _ = writeln!(keluar, "\nURL Dashboard:");
    for url in susun_url(&ip) {
        let _ = writeln!(keluar, "  {url}");
    }

    let target = [(ip.as_str(), PORT_DASHBOARD), (IP_LOCALHOST, PORT_API)];
    let tertutup = tunggu_siap(sis, &target, batas, jeda);
    if !tertutup.is_empty() {
        let _ = writeln!(keluar, "{}", pesan_belum_siap(batas.as_secs()));
        return 1;
    }
    let _ = writeln!(keluar, "{}", pesan_siap());
    0
}

fn pesan_pilihan_tidak_dikenal(pilihan: usize) -> String {
    format!("[!] Pilihan tidak dikenal: {pilihan}. Ketik 1, 2, 3, atau 4.")
}

/// Baca pilihan 1..=4. Sumber yang mengembalikan pilihan di luar rentang ditanya ulang;
/// sumber yang habis (`None`) dianggap keluar supaya Ctrl-C tidak menggantung.
fn baca_pilihan(sumber: &mut dyn FnMut() -> Option<usize>, tulis: &mut dyn FnMut(&str)) -> usize {
    loop {
        match sumber() {
            Some(pilihan) if (1..=4).contains(&pilihan) => return pilihan,
            Some(pilihan) => tulis(&pesan_pilihan_tidak_dikenal(pilihan)),
            None => return 3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// Catatan `jalankan_latar`: (dir, perintah, log, pid_file).
    type CatatanLatar = (String, Vec<String>, PathBuf, PathBuf);

    struct SistemPalsu {
        pengguna: String,
        systemctl_ada: bool,
        unit_terdaftar: bool,
        statuses: Vec<String>,
        start_gagal: Option<String>,
        start_calls: RefCell<Vec<String>>,
        ip_tailscale: Option<String>,
        ip_hostname: Option<String>,
        ports: RefCell<HashMap<(String, u16), bool>>,
        port_buka_setelah: Option<usize>,
        panggilan_port: RefCell<usize>,
        /// Meniru systemd: begitu unit di-start, portnya benar-benar terbuka.
        buka_saat_start: bool,
        /// Catatan `jalankan_latar`: (dir, perintah, log, pid_file).
        latar: RefCell<Vec<CatatanLatar>>,
    }

    impl Sistem for SistemPalsu {
        fn pengguna(&self) -> String {
            self.pengguna.clone()
        }
        fn systemctl_ada(&self) -> bool {
            self.systemctl_ada
        }
        fn unit_terdaftar(&self, _unit: &str) -> bool {
            self.unit_terdaftar
        }
        fn status(&self, units: &[&str]) -> Vec<String> {
            assert_eq!(units.len(), 2, "kedua unit harus ditanya dalam satu panggilan");
            self.statuses.clone()
        }
        fn start(&self, unit: &str) -> Result<(), String> {
            self.start_calls.borrow_mut().push(unit.to_string());
            match &self.start_gagal {
                Some(pesan) => Err(pesan.clone()),
                None => {
                    if self.buka_saat_start {
                        let ikat = pilih_ip(self.ip_tailscale.clone(), self.ip_hostname.clone());
                        let mut ports = self.ports.borrow_mut();
                        ports.insert((ikat, PORT_DASHBOARD), true);
                        ports.insert((IP_LOCALHOST.to_string(), PORT_API), true);
                    }
                    Ok(())
                }
            }
        }
        fn ip_tailscale(&self) -> Option<String> {
            self.ip_tailscale.clone()
        }
        fn ip_hostname(&self) -> Option<String> {
            self.ip_hostname.clone()
        }
        fn port_terbuka(&self, host: &str, port: u16) -> bool {
            *self.panggilan_port.borrow_mut() += 1;
            if let Some(batas) = self.port_buka_setelah {
                return *self.panggilan_port.borrow() >= batas;
            }
            self.ports
                .borrow()
                .get(&(host.to_string(), port))
                .copied()
                .unwrap_or(false)
        }
        fn jalankan_latar(
            &self,
            dir: &Path,
            perintah: &[&str],
            log: &Path,
            pid_file: &Path,
        ) -> Result<u32, String> {
            self.latar.borrow_mut().push((
                dir.display().to_string(),
                perintah.iter().map(|arg| (*arg).to_string()).collect(),
                log.to_path_buf(),
                pid_file.to_path_buf(),
            ));
            if self.buka_saat_start {
                let ikat = pilih_ip(self.ip_tailscale.clone(), self.ip_hostname.clone());
                let mut ports = self.ports.borrow_mut();
                ports.insert((ikat, PORT_DASHBOARD), true);
                ports.insert((IP_LOCALHOST.to_string(), PORT_API), true);
            }
            Ok(4242)
        }
        fn dir_state(&self) -> PathBuf {
            PathBuf::from("/tmp/autore-tes")
        }
        fn warisi(&self, _program: &str, _argumen: &[String]) -> Result<i32, String> {
            Ok(0)
        }
        fn hentikan(&self, _pid: u32) -> Result<(), String> {
            Ok(())
        }
    }

    /// Host yang dipakai `palsu()`: IP tailnet, sama dengan `ip_tailscale` bawaan.
    fn host_ikat_palsu() -> String {
        "100.80.3.14".to_string()
    }

    fn palsu(pengguna: &str) -> SistemPalsu {
        SistemPalsu {
            pengguna: pengguna.to_string(),
            systemctl_ada: true,
            unit_terdaftar: true,
            statuses: vec!["active".to_string(), "active".to_string()],
            start_gagal: None,
            start_calls: RefCell::new(Vec::new()),
            ip_tailscale: Some("100.80.3.14\n".to_string()),
            ip_hostname: Some("192.168.0.89 172.18.0.1 fd7a:115c:a1e0::1\n".to_string()),
            ports: RefCell::new(HashMap::from([
                ((host_ikat_palsu(), PORT_DASHBOARD), true),
                ((IP_LOCALHOST.to_string(), PORT_API), true),
            ])),
            port_buka_setelah: None,
            panggilan_port: RefCell::new(0),
            buka_saat_start: true,
            latar: RefCell::new(Vec::new()),
        }
    }

    const BATAS_TES: Duration = Duration::from_millis(20);
    const JEDA_TES: Duration = Duration::from_millis(1);

    fn jalankan_cepat(sis: &SistemPalsu, keluaran: &mut Vec<u8>) -> (i32, String) {
        let kode = jalankan_web_batas(sis, keluaran, BATAS_TES, JEDA_TES);
        teks(kode, keluaran)
    }

    #[test]
    fn port_dipakai_proses_lain_tidak_start_unit() {
        let mut sis = palsu("tugure");
        sis.statuses = vec!["active".to_string(), "inactive".to_string()];
        sis.ports = RefCell::new(HashMap::from([(
            (host_ikat_palsu(), PORT_DASHBOARD),
            true,
        )]));
        let mut keluaran = Vec::new();
        let (kode, teks) = jalankan_cepat(&sis, &mut keluaran);
        assert_eq!(kode, 1, "{teks}");
        assert!(teks.contains("[!] Port 9120 sudah dipakai proses lain"), "{teks}");
        assert!(sis.start_calls.borrow().is_empty(), "jangan start di atas port yang terpakai");
    }

    #[test]
    fn localhost_terbuka_tidak_dianggap_bentrok() {
        let mut sis = palsu("tugure");
        sis.statuses = vec!["active".to_string(), "inactive".to_string()];
        sis.ports = RefCell::new(HashMap::from([
            ((IP_LOCALHOST.to_string(), PORT_DASHBOARD), true),
            ((IP_LOCALHOST.to_string(), PORT_API), true),
        ]));
        let mut keluaran = Vec::new();
        let (kode, teks) = jalankan_cepat(&sis, &mut keluaran);
        assert_eq!(kode, 0, "localhost bukan host ikat dashboard: {teks}");
        assert!(!teks.contains("sudah dipakai proses lain"), "{teks}");
        assert_eq!(sis.start_calls.borrow().len(), 1, "unit tetap dijalankan: {teks}");
    }

    #[test]
    fn tunggu_siap_berhenti_begitu_port_terbuka() {
        let mut sis = palsu("tugure");
        sis.port_buka_setelah = Some(3);
        let host = host_ikat_palsu();
        let target = [(host.as_str(), PORT_DASHBOARD), (IP_LOCALHOST, PORT_API)];
        let sisa = tunggu_siap(&sis, &target, Duration::from_secs(5), JEDA_TES);
        assert!(sisa.is_empty(), "port terbuka setelah 3 panggilan: {sisa:?}");
        let panggilan = *sis.panggilan_port.borrow();
        assert!((3..10).contains(&panggilan), "poll berhenti tepat saat siap: {panggilan}");
    }

    #[test]
    fn habis_waktu_belum_siap_lapor_journalctl_dan_exit_1() {
        let sis = palsu("tugure");
        for (host, port) in [(host_ikat_palsu(), PORT_DASHBOARD), (IP_LOCALHOST.to_string(), PORT_API)] {
            sis.ports.borrow_mut().insert((host, port), false);
        }
        let mut keluaran = Vec::new();
        let (kode, teks) = jalankan_cepat(&sis, &mut keluaran);
        assert_eq!(kode, 1, "{teks}");
        assert!(teks.contains("journalctl --user -u autore-web-dashboard -n 30"), "{teks}");
        assert!(teks.contains("[!] Dashboard belum menerima koneksi"), "{teks}");
        assert!(
            *sis.panggilan_port.borrow() >= 5,
            "harus polling berkali-kali, bukan sekali: {}",
            sis.panggilan_port.borrow()
        );
    }

    #[test]
    fn siap_dan_catatan_penutup_tercetak() {
        let sis = palsu("tugure");
        let mut keluaran = Vec::new();
        let (kode, teks) = jalankan_cepat(&sis, &mut keluaran);
        assert_eq!(kode, 0, "{teks}");
        assert!(teks.contains("[OK] Dashboard menerima koneksi pada port 9120."), "{teks}");
        assert!(
            teks.contains(
                "Catatan: Anda dapat menutup terminal ini. Dashboard akan tetap berjalan di background."
            ),
            "{teks}"
        );
    }

    fn teks(kode: i32, keluaran: &[u8]) -> (i32, String) {
        (kode, String::from_utf8(keluaran.to_vec()).unwrap())
    }

    #[test]
    fn pengguna_bukan_tugure_ditolak() {
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&palsu("mectov"), &mut keluaran), &keluaran);
        assert_eq!(kode, 1);
        assert!(
            teks.contains("[!] Akses ditolak. Silakan jalankan sebagai user yang sesuai."),
            "{teks}"
        );
    }

    #[test]
    fn default_pengguna_tugure_dan_env_menimpa() {
        assert_eq!(diharapkan_dari(None), "tugure");
        assert_eq!(diharapkan_dari(Some("mectov".to_string())), "mectov");
        assert!(pengguna_sah("tugure", "tugure"));
        assert!(!pengguna_sah("mectov", "tugure"));
    }

    #[test]
    fn unit_belum_terpasang_dilaporkan_jelas() {
        let mut sis = palsu("tugure");
        sis.unit_terdaftar = false;
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&sis, &mut keluaran), &keluaran);
        assert_eq!(kode, 1);
        assert!(teks.contains("[!] Unit systemd pengguna belum terpasang"), "{teks}");
    }

    #[test]
    fn pengguna_sah_lolos_penjaga() {
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&palsu("tugure"), &mut keluaran), &keluaran);
        assert_eq!(kode, 0, "{teks}");
    }

    #[test]
    fn dua_unit_aktif_tidak_memanggil_start() {
        let sis = palsu("tugure");
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&sis, &mut keluaran), &keluaran);
        assert_eq!(kode, 0, "{teks}");
        assert!(teks.contains("[OK] autore-web-api: aktif"), "{teks}");
        assert!(teks.contains("[OK] autore-web-dashboard: aktif"), "{teks}");
        assert!(sis.start_calls.borrow().is_empty(), "{:?}", sis.start_calls.borrow());
    }

    #[test]
    fn unit_nonaktif_dipanggil_start_sekali() {
        let mut sis = palsu("tugure");
        sis.statuses = vec!["active".to_string(), "inactive".to_string()];
        for (host, port, buka) in [
            (host_ikat_palsu(), PORT_DASHBOARD, false),
            (IP_LOCALHOST.to_string(), PORT_API, true),
        ] {
            sis.ports.borrow_mut().insert((host, port), buka);
        }
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&sis, &mut keluaran), &keluaran);
        assert_eq!(kode, 0, "{teks}");
        assert_eq!(
            *sis.start_calls.borrow(),
            vec!["autore-web-dashboard".to_string()],
            "hanya unit nonaktif yang di-start"
        );
        assert!(teks.contains("[OK] autore-web-dashboard: aktif"), "{teks}");
    }

    #[test]
    fn status_activating_ditunggu_bukan_start_ulang() {
        let mut sis = palsu("tugure");
        sis.statuses = vec!["activating".to_string(), "active".to_string()];
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&sis, &mut keluaran), &keluaran);
        assert_eq!(kode, 0, "{teks}");
        assert!(sis.start_calls.borrow().is_empty(), "activating bukan alasan start ulang");
        assert!(teks.contains("[i] autore-web-api: activating. Menunggu."), "{teks}");
    }

    #[test]
    fn start_gagal_dilaporkan_dan_exit_1() {
        let mut sis = palsu("tugure");
        sis.statuses = vec!["inactive".to_string(), "inactive".to_string()];
        sis.start_gagal = Some("Unit autore-web-api.service not found.".to_string());
        sis.ports = RefCell::new(HashMap::from([
            ((host_ikat_palsu(), PORT_DASHBOARD), false),
            ((IP_LOCALHOST.to_string(), PORT_API), false),
        ]));
        sis.buka_saat_start = false;
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&sis, &mut keluaran), &keluaran);
        assert_eq!(kode, 1);
        assert!(teks.contains("[!] Gagal menjalankan autore-web-api"), "{teks}");
        assert!(teks.contains("not found"), "pesan systemctl diteruskan: {teks}");
    }

    #[test]
    fn tailscale_dipakai_lebih_dulu() {
        assert_eq!(
            pilih_ip(Some("100.80.3.14\n".to_string()), Some("192.168.0.89\n".to_string())),
            "100.80.3.14"
        );
    }

    #[test]
    fn tailscale_multi_baris_diambil_yang_pertama() {
        assert_eq!(
            pilih_ip(Some("100.80.3.14\n100.66.38.79\n".to_string()), None),
            "100.80.3.14"
        );
    }

    #[test]
    fn hostname_i_diambil_satu_ipv4_abaikan_docker_dan_ipv6() {
        let keluaran = "192.168.0.89 172.18.0.1 172.19.0.1 172.17.0.1 100.80.3.14 fd7a:115c:a1e0::1\n";
        assert_eq!(pilih_ip(None, Some(keluaran.to_string())), "192.168.0.89");
    }

    #[test]
    fn hostname_hanya_docker_dan_ipv6_dipakai_daripada_localhost() {
        assert_eq!(
            pilih_ip(None, Some("172.18.0.1 fd7a:115c:a1e0::1\n".to_string())),
            "172.18.0.1"
        );
    }

    #[test]
    fn tanpa_tailscale_dan_hostname_jatuh_ke_localhost() {
        assert_eq!(pilih_ip(None, None), "127.0.0.1");
        assert_eq!(pilih_ip(Some(String::new()), Some("   \n".to_string())), "127.0.0.1");
    }

    #[test]
    fn url_pakai_host_ikat_tanpa_localhost() {
        assert_eq!(
            susun_url("100.80.3.14"),
            vec!["http://100.80.3.14:9120".to_string()]
        );
    }

    #[test]
    fn url_localhost_tidak_diulang() {
        assert_eq!(susun_url("127.0.0.1"), vec!["http://localhost:9120".to_string()]);
    }

    #[test]
    fn handler_mencetak_url_dashboard() {
        let sis = palsu("tugure");
        let mut keluaran = Vec::new();
        let (kode, teks) = teks(jalankan_web(&sis, &mut keluaran), &keluaran);
        assert_eq!(kode, 0, "{teks}");
        assert!(teks.contains("http://100.80.3.14:9120"), "{teks}");
        assert!(
            !teks.contains("http://localhost:9120"),
            "dashboard hanya mengikat IP tailnet, tautan localhost mati: {teks}"
        );
    }

    #[test]
    fn dir_state_hormati_xdg_state_home() {
        assert_eq!(
            dir_state_dari(None, "/home/tugure"),
            PathBuf::from("/home/tugure/.local/state/autore")
        );
        assert_eq!(
            dir_state_dari(Some("/tmp/x".to_string()), "/home/tugure"),
            PathBuf::from("/tmp/x/autore")
        );
        assert_eq!(
            dir_state_dari(Some("  ".to_string()), "/home/tugure"),
            PathBuf::from("/home/tugure/.local/state/autore")
        );
    }

    #[test]
    fn pesan_pilihan_rentang_baru() {
        let teks = pesan_pilihan_tidak_dikenal(7);
        assert!(teks.contains("Ketik 1, 2, 3, atau 4."), "{teks}");
    }

    #[test]
    fn panduan_subcommand_menyebut_admin() {
        let teks = panduan_subcommand();
        for baris in ["autore start", "autore stop", "autore restart", "autore logs"] {
            assert!(teks.contains(baris), "{baris} hilang dari panduan");
        }
    }

    #[test]
    fn pilihan_dari_env_hanya_satu_sampai_empat() {
        assert_eq!(pilihan_dari_env(Some("2".to_string())), Some(2));
        assert_eq!(pilihan_dari_env(Some(" 3 ".to_string())), Some(3));
        assert_eq!(pilihan_dari_env(Some("4".to_string())), Some(4));
        assert_eq!(pilihan_dari_env(Some("9".to_string())), None);
        assert_eq!(pilihan_dari_env(Some("menu".to_string())), None);
        assert_eq!(pilihan_dari_env(None), None);
    }

    #[test]
    fn panduan_singkat_ascii_dan_menyebut_subcommand() {
        let teks = panduan_subcommand();
        assert!(teks.is_ascii(), "{teks}");
        assert!(teks.contains("autore status"), "{teks}");
        assert!(teks.contains("autore --help"), "{teks}");
    }

    #[test]
    fn tanpa_systemctl_jalankan_npm_di_latar() {
        let sis = palsu("tugure");
        let mut keluaran = Vec::new();
        let kode = jalankan_tanpa_systemd(
            &sis,
            &mut keluaran,
            BATAS_TES,
            JEDA_TES,
            Some(PathBuf::from("/tmp/web")),
        );
        let teks = String::from_utf8(keluaran).unwrap();
        assert_eq!(kode, 0, "{teks}");
        assert!(teks.contains("[i] systemd tidak tersedia"), "{teks}");
        assert!(teks.contains("[OK] npm run start:dashboard: dijalankan di latar (PID 4242)."), "{teks}");
        assert!(teks.contains("kill $(cat /tmp/autore-tes/dashboard.pid)"), "{teks}");

        let catatan = sis.latar.borrow();
        assert_eq!(catatan.len(), 2, "api dan dashboard dijalankan");
        assert_eq!(catatan[0].0, "/tmp/web", "dijalankan di direktori web");
        assert_eq!(catatan[0].1, vec!["npm", "run", "start:api"]);
        assert_eq!(catatan[1].1, vec!["npm", "run", "start:dashboard"]);
        assert_eq!(catatan[0].2, PathBuf::from("/tmp/autore-tes/api.log"));
        assert_eq!(catatan[1].3, PathBuf::from("/tmp/autore-tes/dashboard.pid"));
    }

    #[test]
    fn web_dir_tidak_ketemu_minta_autore_web_dir() {
        let sis = palsu("tugure");
        let mut keluaran = Vec::new();
        let kode = jalankan_tanpa_systemd(&sis, &mut keluaran, BATAS_TES, JEDA_TES, None);
        let teks = String::from_utf8(keluaran).unwrap();
        assert_eq!(kode, 1);
        assert!(teks.contains("AUTORE_WEB_DIR"), "{teks}");
        assert!(sis.latar.borrow().is_empty(), "jangan menjalankan apa pun tanpa repo web");
    }

    #[test]
    fn pilih_web_dir_pakai_env_lalu_kandidat() {
        let dasar = std::env::temp_dir().join(format!("autore-tes-web-{}", std::process::id()));
        let web = dasar.join("web");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::write(web.join("package.json"), "{}").unwrap();

        assert_eq!(pilih_web_dir(Some(web.display().to_string()), &[]), Some(web.clone()));
        assert_eq!(
            pilih_web_dir(None, &[dasar.join("bukan"), web.clone()]),
            Some(web.clone())
        );
        assert_eq!(pilih_web_dir(None, &[dasar.join("bukan")]), None);
        assert_eq!(
            pilih_web_dir(Some(dasar.join("bukan").display().to_string()), std::slice::from_ref(&web)),
            None,
            "AUTORE_WEB_DIR salah tidak boleh diam-diam jatuh ke kandidat"
        );
        std::fs::remove_dir_all(&dasar).unwrap();
    }

    fn semua_pesan() -> Vec<String> {
        let mut teks: Vec<String> = vec![JUDUL.to_string()];
        teks.extend(OPSI.iter().map(|o| o.to_string()));
        teks.push(pesan_pilihan_tidak_dikenal(9));
        teks.push(pesan_akses_ditolak());
        teks.push(pesan_unit_belum_terpasang());
        teks.push(pesan_port_bentrok());
        teks.push(pesan_siap());
        teks.push(pesan_belum_siap(15));
        teks.push(pesan_penutup());
        teks.push(pesan_sistemd_tidak_ada());
        teks.push(pesan_web_dir_tidak_ketemu());
        teks.push(pesan_hentikan(Path::new("/tmp/autore-tes/dashboard.pid")));
        teks.push(panduan_subcommand());
        teks
    }

    #[test]
    fn semua_pesan_ascii() {
        for teks in semua_pesan() {
            assert!(teks.is_ascii(), "pesan memuat non-ASCII: {teks:?}");
        }
    }

    #[test]
    fn menu_menampilkan_empat_pilihan() {
        assert!(JUDUL.contains("Autore"));
        assert_eq!(OPSI[0], "[1] Web Dashboard");
        assert_eq!(OPSI[1], "[2] TUI Legacy");
        assert_eq!(OPSI[2], "[3] Keluar");
        assert_eq!(OPSI[3], "[4] Admin");
    }

    #[test]
    fn pilihan_tidak_dikenal_ditanya_ulang() {
        let mut jawaban = vec![Some(9usize), Some(2)].into_iter();
        let mut keluhan: Vec<String> = Vec::new();
        let hasil = baca_pilihan(
            &mut || jawaban.next().unwrap_or(None),
            &mut |t: &str| keluhan.push(t.to_string()),
        );
        assert_eq!(hasil, 2, "pilihan sah kedua harus diterima");
        assert_eq!(keluhan.len(), 1, "harus ada tepat satu keluhan");
        assert!(keluhan[0].contains('9'), "keluhan menyebut pilihan: {}", keluhan[0]);
        assert!(keluhan[0].starts_with("[!]"), "keluhan berawalan [!]: {}", keluhan[0]);
    }

    #[test]
    fn sumber_habis_dianggap_keluar() {
        let mut jawaban = Vec::<Option<usize>>::new().into_iter();
        let mut keluhan: Vec<String> = Vec::new();
        let hasil = baca_pilihan(
            &mut || jawaban.next().unwrap_or(None),
            &mut |t: &str| keluhan.push(t.to_string()),
        );
        assert_eq!(hasil, 3, "batal = keluar");
        assert!(keluhan.is_empty(), "batal bukan kesalahan");
    }

    #[test]
    fn pilihan_keluar_tidak_menghasilkan_keluhan() {
        let mut jawaban = vec![Some(3usize)].into_iter();
        let mut keluhan: Vec<String> = Vec::new();
        let hasil = baca_pilihan(
            &mut || jawaban.next().unwrap_or(None),
            &mut |t: &str| keluhan.push(t.to_string()),
        );
        assert_eq!(hasil, 3);
        assert!(keluhan.is_empty());
    }
}
