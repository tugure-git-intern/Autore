//! Kontrak status dashboard (`autore status --json`) + simpanan yang ditulis
//! pipeline `autore serve`.
//!
//! Satu sumber kebenaran untuk data yang dibaca web: pipeline menulis
//! `dashboard-status.json` di workspace, CLI mencetaknya sebagai satu objek JSON.
//! Yang belum pernah dibangun pipeline-nya tetap `unknown` — jangan pernah
//! melaporkannya `passed`.
//!
//! ponytail: satu pekerjaan global (lihat `serve.rs`). Naikkan ke riwayat per
//! aplikasi saat dashboard melayani banyak orang sekaligus.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Nama berkas simpanan di workspace. Web membacanya lewat `autore status --json`.
pub const SNAPSHOT_FILE: &str = "dashboard-status.json";

/// Batas yang diminta kontrak: log mentah tidak boleh tumbuh tanpa batas.
pub const MAX_LOG_LINES: usize = 500;
pub const MAX_SNAPSHOT_BYTES: usize = 64 * 1024;

/// Status infrastruktur yang tidak bisa ditanya (docker mati) — jangan menuduh.
pub const UNKNOWN: &str = "unknown";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Infra {
    pub jenkins: String,
    pub nexus: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stats {
    pub total_apps: usize,
    pub running_containers: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Application {
    pub id: String,
    pub name: String,
    /// `passed` / `failed` / `unknown`. Aplikasi yang cuma ada di registry = `unknown`.
    pub status: String,
    pub last_build: String,
    pub commit_sha: String,
    pub security_issues: u32,
}

/// Waktu satu tahap selesai (pipeline memanggil `record` di akhir tiap tahap).
/// Dipakai web untuk menghitung durasi per tahap; bukan fakta baru, cuma jam.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct StageTime {
    pub id: String,
    /// ISO-8601 UTC, sama format dengan `now_iso8601`.
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Pipeline {
    /// `idle` / `running` / `passed` / `failed`.
    pub status: String,
    pub failure_reason: String,
    pub stages: Vec<String>,
    pub security_summary: String,
    pub commit_sha: String,
    pub author: String,
    pub raw_log: Vec<String>,
    /// Satu entri per tahap di `stages`, urut. Simpanan lama tidak punya field
    /// ini: `default` wajib supaya `dashboard-status.json` versi lama tetap dimuat.
    #[serde(default)]
    pub stage_times: Vec<StageTime>,
    /// Waktu pipeline selesai (`passed`/`failed`); kosong selama masih jalan.
    #[serde(default)]
    pub finished_at: String,
    /// Gerbang keamanan yang lolos dan totalnya, dibaca dari `security_summary`.
    #[serde(default)]
    pub gates_passed: u32,
    #[serde(default)]
    pub gates_total: u32,
}

/// Dokumen kontrak: persis yang dicetak `autore status --json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub system_status: String,
    pub infra: Infra,
    pub stats: Stats,
    pub applications: Vec<Application>,
    pub latest_pipeline: Pipeline,
}

impl Default for Snapshot {
    fn default() -> Self {
        Snapshot {
            system_status: "idle".to_string(),
            infra: Infra {
                jenkins: UNKNOWN.to_string(),
                nexus: UNKNOWN.to_string(),
            },
            stats: Stats {
                total_apps: 0,
                running_containers: 0,
            },
            applications: Vec::new(),
            latest_pipeline: Pipeline {
                status: "idle".to_string(),
                failure_reason: String::new(),
                stages: Vec::new(),
                security_summary: String::new(),
                commit_sha: String::new(),
                author: String::new(),
                raw_log: Vec::new(),
                stage_times: Vec::new(),
                finished_at: String::new(),
                gates_passed: 0,
                gates_total: 0,
            },
        }
    }
}

/// Berkas simpanan di workspace.
pub fn file(workspace: &Path) -> PathBuf {
    workspace.join(SNAPSHOT_FILE)
}

/// Satu objek JSON kanonik (satu baris, urutan field tetap).
pub fn canonical(snapshot: &Snapshot) -> String {
    serde_json::to_string(snapshot).unwrap_or_default()
}

/// Baca simpanan. Berkas hilang/rusak = default (jangan bikin CLI gagal).
pub fn load(workspace: &Path) -> Snapshot {
    std::fs::read_to_string(file(workspace))
        .ok()
        .and_then(|isi| serde_json::from_str::<Snapshot>(&isi).ok())
        .map(capped)
        .unwrap_or_default()
}

/// Pangkas log mentah: maksimal 500 baris terakhir, dan total berkas ≤ 64KiB.
fn capped(mut snap: Snapshot) -> Snapshot {
    if snap.latest_pipeline.raw_log.len() > MAX_LOG_LINES {
        let lebih = snap.latest_pipeline.raw_log.len() - MAX_LOG_LINES;
        snap.latest_pipeline.raw_log.drain(..lebih);
    }
    while serde_json::to_string(&snap).map(|s| s.len()).unwrap_or(0) > MAX_SNAPSHOT_BYTES
        && !snap.latest_pipeline.raw_log.is_empty()
    {
        snap.latest_pipeline.raw_log.remove(0);
    }
    snap
}

/// Tulis simpanan secara atomik (tmp + rename) sambil memangkas log mentah.
/// Pemanggil yang memutuskan arti kegagalan: `serve` memperingatkan, `pipeline
/// record` keluar non-nol supaya pipeline tahu dashboard tidak terbarui.
pub fn save(workspace: &Path, snapshot: &Snapshot) -> Result<(), String> {
    let isi = serde_json::to_string(&capped(snapshot.clone()))
        .map_err(|e| format!("status dashboard tidak bisa disusun: {e}"))?;
    let target = file(workspace);
    let sementara = workspace.join(format!("{SNAPSHOT_FILE}.tmp"));
    std::fs::write(&sementara, &isi).map_err(|e| {
        format!(
            "status dashboard tidak tersimpan ({}): {e}",
            sementara.display()
        )
    })?;
    std::fs::rename(&sementara, &target).map_err(|e| {
        let _ = std::fs::remove_file(&sementara);
        format!(
            "status dashboard tidak tersimpan ({}): {e}",
            target.display()
        )
    })
}

/// Susun dokumen kontrak dari simpanan + `registry.tsv` + docker.
///
/// Daftar aplikasi tetap dari registry; aplikasi yang belum punya hasil build di
/// simpanan dilaporkan `unknown` — bukan `passed`.
pub fn build(workspace: &Path) -> Snapshot {
    let mut snap = load(workspace);

    // Baris ganda di registry (nama sama muncul dua kali) bukan dua aplikasi:
    // web memakai `id` sebagai key baris tabel dan tujuan link, jadi daftarnya
    // harus unik walau berkasnya berisi baris kembar. Ambil yang pertama.
    let mut terlihat: Vec<String> = Vec::new();
    snap.applications = crate::serve::baca_registry(workspace)
        .into_iter()
        .filter(|p| {
            if terlihat.contains(&p.nama) {
                false
            } else {
                terlihat.push(p.nama.clone());
                true
            }
        })
        .map(|p| {
            snap.applications
                .iter()
                .find(|a| a.name == p.nama)
                .cloned()
                .unwrap_or(Application {
                    id: p.nama.clone(),
                    name: p.nama.clone(),
                    status: UNKNOWN.to_string(),
                    last_build: String::new(),
                    commit_sha: String::new(),
                    security_issues: 0,
                })
        })
        .collect();
    snap.stats.total_apps = snap.applications.len();

    let hidup = crate::serve::container_jalan();
    snap.infra = Infra {
        jenkins: infra_status(&hidup, "autore-jenkins"),
        nexus: infra_status(&hidup, "autore-nexus"),
    };
    if let Some(nama) = hidup {
        snap.stats.running_containers = nama.len();
    }
    snap
}

/// Waktu sekarang dalam ISO-8601 UTC (`2026-11-03T10:00:00Z`).
pub fn now_iso8601() -> String {
    let detik = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso8601_from_unix(detik)
}

/// Detik epoch -> `YYYY-MM-DDTHH:MM:SSZ`. Tanpa crate tanggal: algoritma
/// civil-from-days (Howard Hinnant) cukup untuk kalender Gregorian UTC.
pub fn iso8601_from_unix(detik: u64) -> String {
    let hari = (detik / 86_400) as i64;
    let sisa = detik % 86_400;
    let (jam, menit, detik_ke) = (sisa / 3600, (sisa % 3600) / 60, sisa % 60);

    let z = hari + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{jam:02}:{menit:02}:{detik_ke:02}Z")
}

/// Status satu container infra. `None` = docker tidak bisa ditanya -> `unknown`.
fn infra_status(hidup: &Option<Vec<String>>, container: &str) -> String {
    match hidup {
        Some(nama) if nama.iter().any(|n| n == container) => "active".to_string(),
        Some(_) => "inactive".to_string(),
        None => UNKNOWN.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn reg(mut apps: Vec<(&str, &str)>) -> TempDir {
        let tmp = TempDir::new().unwrap();
        let mut isi = String::new();
        for (nama, _) in apps.drain(..) {
            isi.push_str(&format!("{nama}\t8000\t8003\n"));
        }
        std::fs::write(tmp.path().join("registry.tsv"), isi).unwrap();
        tmp
    }

    #[test]
    fn canonical_mencetak_satu_objek_json_dengan_field_kontrak() {
        // Satu aplikasi di registry supaya field per-aplikasi ikut muncul.
        let tmp = reg(vec![("portal-klaim", "8000")]);
        let json = canonical(&build(tmp.path()));
        assert!(json.starts_with('{') && json.ends_with('}'), "{json}");
        assert_eq!(
            json.lines().count(),
            1,
            "harus satu objek, bukan banyak baris"
        );
        for key in [
            "\"system_status\"",
            "\"infra\"",
            "\"jenkins\"",
            "\"nexus\"",
            "\"stats\"",
            "\"total_apps\"",
            "\"running_containers\"",
            "\"applications\"",
            "\"id\"",
            "\"name\"",
            "\"status\"",
            "\"last_build\"",
            "\"commit_sha\"",
            "\"security_issues\"",
            "\"latest_pipeline\"",
            "\"failure_reason\"",
            "\"stages\"",
            "\"security_summary\"",
            "\"author\"",
            "\"raw_log\"",
        ] {
            assert!(json.contains(key), "{key} hilang dari kontrak: {json}");
        }
        // urutan tetap: system_status sebelum infra sebelum stats sebelum applications
        let urut = |a: &str, b: &str| json.find(a).unwrap() < json.find(b).unwrap();
        assert!(urut("\"system_status\"", "\"infra\""));
        assert!(urut("\"infra\"", "\"stats\""));
        assert!(urut("\"stats\"", "\"applications\""));
        assert!(urut("\"applications\"", "\"latest_pipeline\""));
    }

    #[test]
    fn aplikasi_registry_saja_selalu_unknown() {
        let tmp = reg(vec![("portal-klaim", "8000")]);
        let snap = build(tmp.path());
        assert_eq!(snap.stats.total_apps, 1);
        assert_eq!(snap.applications.len(), 1);
        assert_eq!(snap.applications[0].name, "portal-klaim");
        assert_eq!(
            snap.applications[0].status, "unknown",
            "belum pernah dibangun = unknown, jangan diklaim passed"
        );
        assert_eq!(snap.system_status, "idle");
    }

    #[test]
    fn simpanan_pipeline_menang_atas_unknown() {
        let tmp = reg(vec![("portal-klaim", "8000"), ("app-baru", "8000")]);
        let mut snap = Snapshot::default();
        snap.applications.push(Application {
            id: "portal-klaim".to_string(),
            name: "portal-klaim".to_string(),
            status: "passed".to_string(),
            last_build: "2026-11-03T10:00:00Z".to_string(),
            commit_sha: "a1b2c3d4e5f6".to_string(),
            security_issues: 0,
        });
        snap.latest_pipeline.status = "passed".to_string();
        snap.system_status = "passed".to_string();
        save(tmp.path(), &snap).unwrap();

        let gabung = build(tmp.path());
        assert_eq!(
            gabung.stats.total_apps, 2,
            "registry tetap sumber daftar aplikasi"
        );
        let klaim = gabung
            .applications
            .iter()
            .find(|a| a.name == "portal-klaim")
            .unwrap();
        assert_eq!(klaim.status, "passed");
        assert_eq!(klaim.commit_sha, "a1b2c3d4e5f6");
        let baru = gabung
            .applications
            .iter()
            .find(|a| a.name == "app-baru")
            .unwrap();
        assert_eq!(baru.status, "unknown");
        assert_eq!(gabung.latest_pipeline.status, "passed");
        assert_eq!(gabung.system_status, "passed");
    }

    #[test]
    fn save_lalu_load_bolak_balik_dan_tak_tinggalkan_file_sementara() {
        let tmp = TempDir::new().unwrap();
        let snap = Snapshot {
            system_status: "running".to_string(),
            latest_pipeline: Pipeline {
                status: "running".to_string(),
                stages: vec!["kerangka".to_string(), "repo".to_string()],
                ..Default::default()
            },
            ..Default::default()
        };
        save(tmp.path(), &snap).unwrap();

        assert!(file(tmp.path()).exists());
        let sisa: Vec<String> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n != SNAPSHOT_FILE)
            .collect();
        assert!(sisa.is_empty(), "sisa file sementara: {sisa:?}");
        assert_eq!(
            load(tmp.path()).latest_pipeline.stages,
            snap.latest_pipeline.stages
        );
    }

    #[test]
    fn load_default_kalau_berkas_hilang_atau_rusak() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(load(tmp.path()), Snapshot::default());
        std::fs::write(file(tmp.path()), "{ bukan json").unwrap();
        assert_eq!(load(tmp.path()), Snapshot::default());
    }

    #[test]
    fn raw_log_dipangkas_jadi_500_baris_terakhir() {
        let tmp = TempDir::new().unwrap();
        let mut snap = Snapshot::default();
        snap.latest_pipeline.raw_log = (0..900).map(|i| format!("baris-{i}")).collect();
        save(tmp.path(), &snap).unwrap();

        let isi = load(tmp.path());
        assert_eq!(isi.latest_pipeline.raw_log.len(), MAX_LOG_LINES);
        assert_eq!(isi.latest_pipeline.raw_log.last().unwrap(), "baris-899");
    }

    #[test]
    fn berkas_simpanan_tidak_lebih_dari_64_kib() {
        let tmp = TempDir::new().unwrap();
        let mut snap = Snapshot::default();
        snap.latest_pipeline.raw_log = (0..900)
            .map(|i| format!("{i}-{}", "x".repeat(200)))
            .collect();
        save(tmp.path(), &snap).unwrap();

        let ukuran = std::fs::metadata(file(tmp.path())).unwrap().len();
        assert!(ukuran <= MAX_SNAPSHOT_BYTES as u64, "berkas {ukuran} byte");
        let json = canonical(&load(tmp.path()));
        assert!(
            serde_json::from_str::<Snapshot>(&json).is_ok(),
            "JSON tetap sah"
        );
    }

    #[test]
    fn gagal_menulis_mengembalikan_error_dan_tidak_merusak_workspace() {
        let tmp = TempDir::new().unwrap();
        // Workspace berupa berkas biasa: tulis simpanan pasti gagal.
        let bukan_dir = tmp.path().join("bukan-folder");
        std::fs::write(&bukan_dir, "x").unwrap();
        assert!(
            save(&bukan_dir, &Snapshot::default()).is_err(),
            "kegagalan tulis harus terlihat oleh pemanggil"
        );
        assert!(bukan_dir.is_file(), "workspace tidak boleh dirusak");
    }

    #[test]
    fn waktu_iso_8601_utc_benar_untuk_epoch_diketahui() {
        assert_eq!(iso8601_from_unix(0), "1970-01-01T00:00:00Z");
        // 2026-11-03T10:00:00Z
        assert_eq!(iso8601_from_unix(1793700000), "2026-11-03T10:00:00Z");
        assert!(now_iso8601().ends_with('Z'));
        assert_eq!(now_iso8601().len(), 20, "format tetap YYYY-MM-DDTHH:MM:SSZ");
    }

    #[test]
    fn infra_unknown_kalau_docker_tidak_bisa_ditanya() {
        // `container_jalan()` -> None dipetakan ke UNKNOWN. Diuji langsung pada
        // pemetaannya: mengubah PATH global akan berlomba dengan test lain yang
        // menjalankan proses (mis. `git`) secara paralel.
        assert_eq!(infra_status(&None, "autore-jenkins"), UNKNOWN);
        assert_eq!(infra_status(&None, "autore-nexus"), UNKNOWN);
        assert_eq!(
            infra_status(&Some(vec!["autore-jenkins".to_string()]), "autore-jenkins"),
            "active"
        );
        assert_eq!(infra_status(&Some(vec![]), "autore-nexus"), "inactive");
    }

    #[test]
    fn baris_registry_ganda_hanya_jadi_satu_aplikasi() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("registry.tsv"),
            "app-dua\t8000\t8033\napp-dua\t8000\t8043\napp-satu\t8000\t8053\n",
        )
        .unwrap();

        let snap = build(tmp.path());

        let nama: Vec<&str> = snap.applications.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(nama, vec!["app-dua", "app-satu"], "{nama:?}");
        assert_eq!(snap.stats.total_apps, 2);
        let mut id: Vec<&str> = snap.applications.iter().map(|a| a.id.as_str()).collect();
        id.sort_unstable();
        id.dedup();
        assert_eq!(
            id.len(),
            snap.applications.len(),
            "id aplikasi harus unik: dipakai sebagai key baris dan tujuan link"
        );
    }

    // Dua test berikut mengunci kontrak yang sudah benar (bukan hasil perbaikan):
    // konsumen web menolak `null`, jadi teks yang tidak tersedia wajib `""`.
    #[test]
    fn load_default_menghasilkan_kontrak_json_dengan_teks_kosong() {
        let tmp = TempDir::new().unwrap();
        let value: serde_json::Value = serde_json::from_str(&canonical(&build(tmp.path()))).unwrap();
        assert_eq!(value["latest_pipeline"]["failure_reason"], "");
        assert_eq!(value["latest_pipeline"]["security_summary"], "");
        assert_eq!(value["latest_pipeline"]["commit_sha"], "");
        assert_eq!(value["latest_pipeline"]["author"], "");
        assert_eq!(value["latest_pipeline"]["stages"], serde_json::json!([]));
    }

    #[test]
    fn canonical_tidak_mengubah_teks_kosong_menjadi_null() {
        let json = canonical(&Snapshot::default());
        assert!(!json.contains(":null"), "{json}");
    }
}
