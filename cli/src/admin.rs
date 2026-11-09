//! Perintah admin (`autore start|stop|restart|logs`) dan sub-menu `[4] Admin`.
//!
//! Aturan tampilan sama dengan `launcher.rs` (ditegakkan tes `semua_pesan_admin_ascii`):
//! teks ASCII murni, tanpa emoji, bahasa Indonesia formal, tanpa ornamen.
//!
//! Tes integrasi bisa melewati sub-menu dengan `AUTORE_ADMIN_PILIHAN=1..5` (khusus tes;
//! tidak ditampilkan di `--help`). Jalur tanpa systemd bisa dipaksa dengan
//! `AUTORE_TANPA_SYSTEMD=1`, juga khusus tes.

use crate::launcher::{self, Sistem};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

/// Dua unit yang dikelola. Urutannya dipakai di argv `systemctl` dan baris status.
const UNIT: [&str; 2] = [launcher::UNIT_API, launcher::UNIT_DASHBOARD];

pub const JUDUL_ADMIN: &str = "Autore - Menu Admin";
pub const OPSI_ADMIN: [&str; 5] = [
    "[1] Start",
    "[2] Stop",
    "[3] Restart",
    "[4] Logs",
    "[5] Kembali",
];

/// Jumlah baris log yang ditampilkan sebelum mengikuti.
const BARIS_LOG: usize = 50;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Aksi {
    Start,
    Stop,
    Restart,
    Logs { follow: bool, lines: usize },
}

impl Aksi {
    /// Pilihan sub-menu `1..=4` -> aksi; `5` (Kembali) dan di luar rentang -> None.
    pub fn dari_pilihan(pilihan: usize) -> Option<Aksi> {
        match pilihan {
            1 => Some(Aksi::Start),
            2 => Some(Aksi::Stop),
            3 => Some(Aksi::Restart),
            4 => Some(Aksi::Logs {
                follow: true,
                lines: BARIS_LOG,
            }),
            _ => None,
        }
    }

    pub fn nama_systemctl(&self) -> &'static str {
        match self {
            Aksi::Start => "start",
            Aksi::Stop => "stop",
            Aksi::Restart => "restart",
            Aksi::Logs { .. } => "logs",
        }
    }
}

fn argv_systemctl(aksi: &str, units: &[&str]) -> Vec<String> {
    let mut argv: Vec<String> = vec!["--user".to_string(), aksi.to_string()];
    argv.extend(units.iter().map(|unit| (*unit).to_string()));
    argv
}

fn argv_journal(units: &[&str], follow: bool, lines: usize) -> Vec<String> {
    let mut argv: Vec<String> = vec!["--user".to_string()];
    for unit in units {
        argv.push("-u".to_string());
        argv.push((*unit).to_string());
    }
    argv.push("-n".to_string());
    argv.push(lines.to_string());
    argv.push("--no-pager".to_string());
    if follow {
        argv.push("-f".to_string());
    }
    argv
}

fn argv_tail(berkas: &[PathBuf], follow: bool, lines: usize) -> Vec<String> {
    let mut argv: Vec<String> = vec!["-n".to_string(), lines.to_string()];
    if follow {
        argv.push("-f".to_string());
    }
    argv.extend(berkas.iter().map(|berkas| berkas.display().to_string()));
    argv
}

/// Isi berkas PID (`api.pid`). Selalu fungsi murni: tak menyentuh proses.
fn pid_dari(berkas: &Path) -> Option<u32> {
    std::fs::read_to_string(berkas).ok()?.trim().parse().ok()
}

fn panduan_admin() -> String {
    "[i] Menu Admin butuh terminal interaktif. Gunakan: autore start|stop|restart|logs.".to_string()
}

pub fn jalankan(sis: &dyn Sistem, aksi: Aksi, keluar: &mut dyn Write) -> i32 {
    if !launcher::pengguna_sah(&sis.pengguna(), &launcher::diharapkan()) {
        let _ = writeln!(keluar, "{}", launcher::pesan_akses_ditolak());
        return 1;
    }
    if !sis.systemctl_ada() {
        return jalankan_tanpa_systemd(sis, aksi, keluar, launcher::cari_web_dir());
    }
    match aksi {
        Aksi::Logs { follow, lines } => {
            let argv = argv_journal(&UNIT, follow, lines);
            jalankan_program(sis, "journalctl", &argv, keluar)
        }
        lain => {
            let nama = lain.nama_systemctl();
            let argv = argv_systemctl(nama, &UNIT);
            match sis.warisi("systemctl", &argv) {
                Ok(0) => {
                    let _ = writeln!(
                        keluar,
                        "[OK] systemctl --user {nama} {} {}",
                        launcher::UNIT_API, launcher::UNIT_DASHBOARD
                    );
                    cetak_status(sis, keluar);
                    0
                }
                Ok(kode) => {
                    let _ = writeln!(
                        keluar,
                        "[!] Gagal menjalankan systemctl --user {nama} {} {} (kode {kode}).",
                        launcher::UNIT_API, launcher::UNIT_DASHBOARD
                    );
                    1
                }
                Err(galat) => {
                    let _ = writeln!(keluar, "[!] Gagal menjalankan systemctl: {galat}");
                    1
                }
            }
        }
    }
}

/// Jalankan program pendamping (journalctl / tail) dan teruskan kode keluarnya.
fn jalankan_program(sis: &dyn Sistem, program: &str, argv: &[String], keluar: &mut dyn Write) -> i32 {
    match sis.warisi(program, argv) {
        Ok(kode) => kode,
        Err(galat) => {
            let _ = writeln!(keluar, "[!] Gagal menjalankan {program}: {galat}");
            1
        }
    }
}

/// Status ringkas sesudah aksi berhasil. Bus systemd yang mati dilaporkan apa adanya.
fn cetak_status(sis: &dyn Sistem, keluar: &mut dyn Write) {
    let status = sis.status(&UNIT);
    if status.len() != UNIT.len() {
        let _ = writeln!(keluar, "[i] Status layanan tidak terbaca.");
        return;
    }
    for (nama, kini) in UNIT.iter().zip(status.iter()) {
        if kini == "active" {
            let _ = writeln!(keluar, "[OK] {nama}: aktif");
        } else {
            let _ = writeln!(keluar, "[i] {nama}: {kini}");
        }
    }
}

/// Isi jalur tanpa systemd. `web_dir` disuntik supaya tes tidak perlu mengubah env global.
fn jalankan_tanpa_systemd(
    sis: &dyn Sistem,
    aksi: Aksi,
    keluar: &mut dyn Write,
    web_dir: Option<PathBuf>,
) -> i32 {
    let _ = writeln!(
        keluar,
        "[i] systemctl tidak tersedia. Memakai jalur tanpa systemd."
    );
    match aksi {
        Aksi::Start => mulai(sis, keluar, web_dir),
        Aksi::Stop => hentikan_proses(sis, keluar),
        Aksi::Restart => {
            let kode = hentikan_proses(sis, keluar);
            if kode != 0 {
                return kode;
            }
            mulai(sis, keluar, web_dir)
        }
        Aksi::Logs { follow, lines } => {
            let state = sis.dir_state();
            let berkas: Vec<PathBuf> = launcher::PROSES
                .iter()
                .map(|(_, berkas_log, _)| state.join(berkas_log))
                .collect();
            let argv = argv_tail(&berkas, follow, lines);
            jalankan_program(sis, "tail", &argv, keluar)
        }
    }
}

fn mulai(sis: &dyn Sistem, keluar: &mut dyn Write, web_dir: Option<PathBuf>) -> i32 {
    let Some(dir) = web_dir else {
        let _ = writeln!(keluar, "{}", launcher::pesan_web_dir_tidak_ketemu());
        return 1;
    };
    let state = sis.dir_state();
    for (perintah, berkas_log, berkas_pid) in launcher::PROSES {
        let log = state.join(berkas_log);
        let pid_file = state.join(berkas_pid);
        match sis.jalankan_latar(&dir, &perintah, &log, &pid_file) {
            Ok(pid) => {
                let _ = writeln!(
                    keluar,
                    "[OK] {}: dijalankan di latar (PID {pid}).",
                    perintah.join(" ")
                );
            }
            Err(galat) => {
                let _ = writeln!(keluar, "[!] Gagal menjalankan {}: {galat}", perintah.join(" "));
                return 1;
            }
        }
    }
    0
}

fn hentikan_proses(sis: &dyn Sistem, keluar: &mut dyn Write) -> i32 {
    let state = sis.dir_state();
    for (unit, (_, _, berkas_pid)) in UNIT.iter().zip(launcher::PROSES.iter()) {
        let berkas = state.join(berkas_pid);
        let Some(pid) = pid_dari(&berkas) else {
            let _ = writeln!(keluar, "[i] Tidak ada PID tersimpan untuk {unit}.");
            continue;
        };
        match sis.hentikan(pid) {
            Ok(()) => {
                let _ = std::fs::remove_file(&berkas);
                let _ = writeln!(keluar, "[OK] {unit}: dihentikan.");
            }
            Err(galat) => {
                let _ = writeln!(keluar, "[!] Gagal menghentikan {unit} (PID {pid}): {galat}");
                return 1;
            }
        }
    }
    0
}

/// Pilihan sub-menu dari `AUTORE_ADMIN_PILIHAN` (khusus tes; tidak ada di `--help`).
fn pilihan_dari_env(env: Option<String>) -> Option<usize> {
    env?.trim()
        .parse::<usize>()
        .ok()
        .filter(|n| (1..=5).contains(n))
}

pub fn menu(sis: &dyn Sistem, keluar: &mut dyn Write) -> i32 {
    if let Some(pilihan) = pilihan_dari_env(std::env::var("AUTORE_ADMIN_PILIHAN").ok()) {
        return match Aksi::dari_pilihan(pilihan) {
            Some(aksi) => jalankan(sis, aksi, keluar),
            None => 0,
        };
    }
    if !std::io::stdout().is_terminal() {
        let _ = writeln!(keluar, "{}", panduan_admin());
        return 0;
    }
    let _ = writeln!(keluar, "\n{JUDUL_ADMIN}");
    let opsi: Vec<String> = OPSI_ADMIN.iter().map(|opsi| (*opsi).to_string()).collect();
    let mut kode = 0;
    loop {
        let Some(indeks) = crate::ui_ask_choose("Pilih aksi", &opsi) else {
            return kode;
        };
        match Aksi::dari_pilihan(indeks + 1) {
            Some(aksi) => kode = jalankan(sis, aksi, keluar),
            None => return kode,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Catatan `jalankan_latar`: (dir, perintah, log, pid_file).
    type CatatanLatar = (String, Vec<String>, PathBuf, PathBuf);

    struct Palsu {
        pengguna: String,
        systemctl_ada: bool,
        statuses: Vec<String>,
        warisi_kode: i32,
        warisi_gagal: Option<String>,
        warisi: RefCell<Vec<(String, Vec<String>)>>,
        hentikan_gagal: Option<String>,
        hentikan: RefCell<Vec<u32>>,
        latar: RefCell<Vec<CatatanLatar>>,
        dir: PathBuf,
    }

    impl Sistem for Palsu {
        fn pengguna(&self) -> String {
            self.pengguna.clone()
        }
        fn systemctl_ada(&self) -> bool {
            self.systemctl_ada
        }
        fn unit_terdaftar(&self, _unit: &str) -> bool {
            true
        }
        fn status(&self, units: &[&str]) -> Vec<String> {
            assert_eq!(units.len(), 2, "kedua unit ditanya dalam satu panggilan");
            self.statuses.clone()
        }
        fn start(&self, _unit: &str) -> Result<(), String> {
            Ok(())
        }
        fn ip_tailscale(&self) -> Option<String> {
            None
        }
        fn ip_hostname(&self) -> Option<String> {
            None
        }
        fn port_terbuka(&self, _host: &str, _port: u16) -> bool {
            false
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
            Ok(4242)
        }
        fn dir_state(&self) -> PathBuf {
            self.dir.clone()
        }
        fn warisi(&self, program: &str, argumen: &[String]) -> Result<i32, String> {
            self.warisi.borrow_mut().push((
                program.to_string(),
                argumen.iter().map(|arg| arg.to_string()).collect(),
            ));
            match &self.warisi_gagal {
                Some(galat) => Err(galat.clone()),
                None => Ok(self.warisi_kode),
            }
        }
        fn hentikan(&self, pid: u32) -> Result<(), String> {
            self.hentikan.borrow_mut().push(pid);
            match &self.hentikan_gagal {
                Some(galat) => Err(galat.clone()),
                None => Ok(()),
            }
        }
    }

    fn palsu(pengguna: &str) -> Palsu {
        Palsu {
            pengguna: pengguna.to_string(),
            systemctl_ada: true,
            statuses: vec!["active".to_string(), "active".to_string()],
            warisi_kode: 0,
            warisi_gagal: None,
            warisi: RefCell::new(Vec::new()),
            hentikan_gagal: None,
            hentikan: RefCell::new(Vec::new()),
            latar: RefCell::new(Vec::new()),
            dir: dir_tes("palsu"),
        }
    }

    /// Direktori state tiruan yang bersih: satu nama per tes, isinya dihapus dulu.
    fn dir_tes(nama: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("autore-admin-{}-{nama}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("direktori tes");
        dir
    }

    /// Web dir tiruan berisi `package.json` supaya `jalankan_latar` punya tujuan.
    fn web_tes(nama: &str) -> PathBuf {
        let dir = dir_tes(nama).join("web");
        std::fs::create_dir_all(&dir).expect("direktori web");
        std::fs::write(dir.join("package.json"), "{}").expect("package.json");
        dir
    }

    fn teks(kode: i32, keluaran: &[u8]) -> (i32, String) {
        (kode, String::from_utf8_lossy(keluaran).to_string())
    }

    fn j(sis: &Palsu, aksi: Aksi) -> (i32, String) {
        let mut keluaran = Vec::new();
        let kode = jalankan(sis, aksi, &mut keluaran);
        teks(kode, &keluaran)
    }

    fn log(sis: &Palsu, aksi: Aksi, web: Option<PathBuf>) -> (i32, String) {
        let mut keluaran = Vec::new();
        let kode = jalankan_tanpa_systemd(sis, aksi, &mut keluaran, web);
        teks(kode, &keluaran)
    }

    fn panggilan(sis: &Palsu) -> Vec<(String, Vec<String>)> {
        sis.warisi.borrow().clone()
    }

    // ---------- T1: label, aksi, argv ----------

    #[test]
    fn judul_admin_dan_lima_opsi() {
        assert_eq!(JUDUL_ADMIN, "Autore - Menu Admin");
        assert_eq!(
            OPSI_ADMIN,
            [
                "[1] Start",
                "[2] Stop",
                "[3] Restart",
                "[4] Logs",
                "[5] Kembali"
            ]
        );
    }

    #[test]
    fn pilihan_aksi_1_sampai_4() {
        assert_eq!(Aksi::dari_pilihan(1), Some(Aksi::Start));
        assert_eq!(Aksi::dari_pilihan(2), Some(Aksi::Stop));
        assert_eq!(Aksi::dari_pilihan(3), Some(Aksi::Restart));
        assert!(matches!(Aksi::dari_pilihan(4), Some(Aksi::Logs { .. })));
        assert_eq!(Aksi::dari_pilihan(5), None, "Kembali bukan aksi");
        assert_eq!(Aksi::dari_pilihan(9), None);
    }

    #[test]
    fn argv_systemctl_dua_unit_satu_panggilan() {
        let argv = argv_systemctl("start", &[launcher::UNIT_API, launcher::UNIT_DASHBOARD]);
        assert_eq!(
            argv,
            vec![
                "--user",
                "start",
                "autore-web-api",
                "autore-web-dashboard"
            ]
        );
    }

    #[test]
    fn semua_pesan_admin_ascii() {
        let mut teks: Vec<String> = OPSI_ADMIN.iter().map(|opsi| (*opsi).to_string()).collect();
        teks.push(JUDUL_ADMIN.to_string());
        teks.push(panduan_admin());
        for t in teks {
            assert!(t.is_ascii(), "bukan ASCII: {t}");
        }
    }

    // ---------- T2: penjaga pengguna + jalur systemd ----------

    #[test]
    fn pengguna_lain_ditolak_tanpa_menyentuh_sistem() {
        let sis = palsu("mectov");
        let (kode, keluaran) = j(&sis, Aksi::Start);
        assert_eq!(kode, 1, "{keluaran}");
        assert!(
            keluaran.contains("[!] Akses ditolak. Silakan jalankan sebagai user yang sesuai."),
            "{keluaran}"
        );
        assert!(panggilan(&sis).is_empty(), "jangan panggil systemctl");
    }

    #[test]
    fn start_memanggil_systemctl_sekali_dua_unit() {
        let sis = palsu("tugure");
        let (kode, keluaran) = j(&sis, Aksi::Start);
        assert_eq!(kode, 0, "{keluaran}");
        assert_eq!(
            panggilan(&sis),
            vec![(
                "systemctl".to_string(),
                vec![
                    "--user".to_string(),
                    "start".to_string(),
                    "autore-web-api".to_string(),
                    "autore-web-dashboard".to_string()
                ]
            )],
            "satu panggilan, dua unit"
        );
    }

    #[test]
    fn stop_dan_restart_memakai_aksi_benar() {
        for (aksi, nama) in [(Aksi::Stop, "stop"), (Aksi::Restart, "restart")] {
            let sis = palsu("tugure");
            let (kode, keluaran) = j(&sis, aksi);
            assert_eq!(kode, 0, "{keluaran}");
            assert_eq!(panggilan(&sis)[0].1[1], nama, "{keluaran}");
        }
    }

    #[test]
    fn sesudah_start_cetak_status_kedua_unit() {
        let sis = palsu("tugure");
        let (_, keluaran) = j(&sis, Aksi::Start);
        assert!(keluaran.contains("[OK] autore-web-api: aktif"), "{keluaran}");
        assert!(
            keluaran.contains("[OK] autore-web-dashboard: aktif"),
            "{keluaran}"
        );
    }

    #[test]
    fn systemctl_gagal_exit_1() {
        let mut sis = palsu("tugure");
        sis.warisi_kode = 1;
        let (kode, keluaran) = j(&sis, Aksi::Start);
        assert_eq!(kode, 1, "{keluaran}");
        assert!(
            keluaran.contains(
                "[!] Gagal menjalankan systemctl --user start autore-web-api autore-web-dashboard (kode 1)."
            ),
            "{keluaran}"
        );
    }

    // ---------- T3: logs ----------

    #[test]
    fn logs_default_follow() {
        let argv = argv_journal(&[launcher::UNIT_API, launcher::UNIT_DASHBOARD], true, BARIS_LOG);
        assert_eq!(
            argv,
            vec![
                "--user",
                "-u",
                "autore-web-api",
                "-u",
                "autore-web-dashboard",
                "-n",
                "50",
                "--no-pager",
                "-f"
            ]
        );
    }

    #[test]
    fn logs_no_follow_tanpa_ef() {
        let argv = argv_journal(&[launcher::UNIT_API, launcher::UNIT_DASHBOARD], false, 120);
        assert!(!argv.iter().any(|arg| arg == "-f"), "{argv:?}");
        assert_eq!(argv[argv.len() - 2], "120");
        assert_eq!(argv[argv.len() - 1], "--no-pager");
    }

    #[test]
    fn logs_diteruskan_ke_journalctl() {
        let sis = palsu("tugure");
        let (kode, keluaran) = j(
            &sis,
            Aksi::Logs {
                follow: false,
                lines: BARIS_LOG,
            },
        );
        assert_eq!(kode, 0, "{keluaran}");
        let (program, argv) = &panggilan(&sis)[0];
        assert_eq!(program, "journalctl");
        assert_eq!(argv.iter().filter(|arg| *arg == "-u").count(), 2);

        let mut gagal = palsu("tugure");
        gagal.warisi_kode = 130;
        let (kode, _) = j(
            &gagal,
            Aksi::Logs {
                follow: true,
                lines: BARIS_LOG,
            },
        );
        assert_eq!(kode, 130, "kode journalctl diteruskan apa adanya");
    }

    // ---------- T4: jalur tanpa systemd ----------

    #[test]
    fn tanpa_systemd_start_menjalankan_dua_proses() {
        let mut sis = palsu("tugure");
        sis.systemctl_ada = false;
        let web = web_tes("start");
        let (kode, keluaran) = log(&sis, Aksi::Start, Some(web.clone()));
        assert_eq!(kode, 0, "{keluaran}");
        assert!(
            keluaran.contains("[i] systemctl tidak tersedia. Memakai jalur tanpa systemd."),
            "{keluaran}"
        );
        assert!(
            keluaran.contains("[OK] npm run start:api: dijalankan di latar (PID 4242)."),
            "{keluaran}"
        );
        assert!(
            keluaran.contains("[OK] npm run start:dashboard: dijalankan di latar (PID 4242)."),
            "{keluaran}"
        );
        let latar = sis.latar.borrow();
        assert_eq!(latar.len(), 2, "api dan dashboard dijalankan");
        assert_eq!(latar[0].0, web.display().to_string());
        assert_eq!(latar[0].1, vec!["npm", "run", "start:api"]);
        assert_eq!(latar[1].1, vec!["npm", "run", "start:dashboard"]);
        assert!(latar[0].3.ends_with("api.pid"), "{:?}", latar[0].3);
        assert!(latar[1].3.ends_with("dashboard.pid"), "{:?}", latar[1].3);
    }

    #[test]
    fn tanpa_systemd_stop_menghabisi_pid_dan_menghapus_berkas() {
        let mut sis = palsu("tugure");
        sis.systemctl_ada = false;
        sis.dir = dir_tes("stop");
        std::fs::write(sis.dir.join("api.pid"), "4242\n").expect("api.pid");
        let (kode, keluaran) = log(&sis, Aksi::Stop, None);
        assert_eq!(kode, 0, "{keluaran}");
        assert_eq!(*sis.hentikan.borrow(), vec![4242]);
        assert!(
            keluaran.contains("[OK] autore-web-api: dihentikan."),
            "{keluaran}"
        );
        assert!(!sis.dir.join("api.pid").exists(), "berkas PID dihapus");
    }

    #[test]
    fn tanpa_systemd_stop_tanpa_pid_lapor_dan_lolos() {
        let mut sis = palsu("tugure");
        sis.systemctl_ada = false;
        sis.dir = dir_tes("stop-kosong");
        let (kode, keluaran) = log(&sis, Aksi::Stop, None);
        assert_eq!(kode, 0, "{keluaran}");
        assert!(
            keluaran.contains("[i] Tidak ada PID tersimpan untuk autore-web-api."),
            "{keluaran}"
        );
        assert!(sis.hentikan.borrow().is_empty(), "tidak menghabisi apa pun");
    }

    #[test]
    fn tanpa_systemd_restart_stop_lalu_start() {
        let mut sis = palsu("tugure");
        sis.systemctl_ada = false;
        sis.dir = dir_tes("restart");
        std::fs::write(sis.dir.join("dashboard.pid"), "777\n").expect("dashboard.pid");
        let (kode, keluaran) = log(&sis, Aksi::Restart, Some(web_tes("restart-web")));
        assert_eq!(kode, 0, "{keluaran}");
        assert_eq!(*sis.hentikan.borrow(), vec![777], "stop dulu");
        assert_eq!(sis.latar.borrow().len(), 2, "lalu start dua proses");
    }

    #[test]
    fn tanpa_systemd_logs_memakai_tail() {
        let mut sis = palsu("tugure");
        sis.systemctl_ada = false;
        sis.dir = dir_tes("logs");
        let (kode, keluaran) = log(
            &sis,
            Aksi::Logs {
                follow: false,
                lines: BARIS_LOG,
            },
            None,
        );
        assert_eq!(kode, 0, "{keluaran}");
        let (program, argv) = &panggilan(&sis)[0];
        assert_eq!(program, "tail");
        assert!(!argv.iter().any(|arg| arg == "-f"), "{argv:?}");
        assert!(argv.iter().any(|arg| arg.ends_with("api.log")), "{argv:?}");
        assert!(
            argv.iter().any(|arg| arg.ends_with("dashboard.log")),
            "{argv:?}"
        );
    }
}
