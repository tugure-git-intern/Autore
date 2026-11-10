//! `autore pipeline record` — penulis `dashboard-status.json` dari luar proses web.
//!
//! Pipeline (Jenkins) memanggil subcommand ini di tiap tahap, jadi logika
//! kontrak tetap satu tempat: modul ini cuma *merge* peristiwa, `status::save`
//! yang menyimpan (atomik: tulis `*.tmp` lalu rename).

use crate::status::{Application, Snapshot, StageTime};
use clap::Args;

/// Satu peristiwa pipeline. Field `Option`/`Vec` kosong = "jangan sentuh".
#[derive(Debug, Clone, Args, Default)]
pub struct Rekaman {
    /// Id tahap kanonik (checkout, scan, build, pasang, periksa); boleh diulang
    #[arg(long, value_name = "ID")]
    pub stage: Vec<String>,

    /// Status pipeline: idle, running, passed, failed
    #[arg(long, value_parser = ["idle", "running", "passed", "failed"])]
    pub status: Option<String>,

    /// Commit yang dibangun (SHA pendek/panjang)
    #[arg(long)]
    pub commit: Option<String>,

    /// Penulis commit seperti yang dicatat pipeline
    #[arg(long)]
    pub author: Option<String>,

    /// Ringkasan keamanan (mis. "9/9 gerbang lolos · digest sha256:...")
    #[arg(long)]
    pub summary: Option<String>,

    /// Alasan gagal (ditulis ke `failure_reason`)
    #[arg(long)]
    pub message: Option<String>,

    /// Satu baris log; boleh diulang
    #[arg(long = "log", value_name = "BARIS")]
    pub log: Vec<String>,

    /// Kosongkan tahap, log, dan ringkasan build sebelumnya (panggilan pertama tiap build)
    #[arg(long)]
    pub reset: bool,

    /// Nama aplikasi (baris `registry.tsv`) yang build-nya direkam; menandai
    /// status aplikasi supaya kartu Repository Health punya data.
    #[arg(long, value_name = "NAMA")]
    pub app: Option<String>,

    /// Cetak dokumen kontrak hasil rekaman ke stdout
    #[arg(long)]
    pub json: bool,
}

/// Baca jumlah gerbang keamanan dari ringkasan pipeline: `"9/9 gerbang lolos ·
/// digest sha256:..."` → `(9, 9)`. Ringkasan tanpa pola itu (atau total nol) →
/// `(0, 0)`, supaya dashboard menampilkan "tanpa data" alih-alih skor palsu.
pub fn parse_gates(summary: &str) -> (u32, u32) {
    let Some(pos) = summary.find("gerbang lolos") else {
        return (0, 0);
    };
    let angka = summary[..pos]
        .trim_end()
        .rsplit(|c: char| !c.is_ascii_digit() && c != '/')
        .next()
        .unwrap_or("");
    let Some((lulus, total)) = angka.split_once('/') else {
        return (0, 0);
    };
    match (lulus.parse::<u32>(), total.parse::<u32>()) {
        (Ok(l), Ok(t)) if t > 0 => (l, t),
        _ => (0, 0),
    }
}

/// Merge satu peristiwa ke simpanan. Tidak menyentuh filesystem.
pub fn terapkan(snap: &mut Snapshot, rekaman: &Rekaman) {
    // Build aplikasi (rekaman.app terisi) punya jalurnya sendiri: ia tidak boleh
    // menyentuh `latest_pipeline`/`system_status` milik pipeline Autore. Kalau
    // boleh, kartu "Status Pipeline" berganti-ganti milik tiap aplikasi dan
    // tampak nyangkut "Berjalan" saat aplikasi lain sedang dibangun.
    if let Some(nama) = rekaman.app.as_deref().filter(|n| !n.is_empty()) {
        terapkan_aplikasi(snap, rekaman, nama);
        return;
    }

    if rekaman.reset {
        snap.latest_pipeline.stages.clear();
        snap.latest_pipeline.stage_times.clear();
        snap.latest_pipeline.finished_at.clear();
        snap.latest_pipeline.gates_passed = 0;
        snap.latest_pipeline.gates_total = 0;
        snap.latest_pipeline.raw_log.clear();
        snap.latest_pipeline.failure_reason.clear();
        snap.latest_pipeline.security_summary.clear();
    }

    if let Some(status) = &rekaman.status {
        snap.latest_pipeline.status = status.clone();
        snap.system_status = status.clone();
        // `running`/`passed` bukan kegagalan: alasan gagal lama tidak boleh nyangkut.
        if status != "failed" {
            snap.latest_pipeline.failure_reason.clear();
        }
        // Tahap terakhir selesai = pipeline selesai. Waktu ini yang dipakai web
        // menghitung durasi tahap terakhir.
        if status == "passed" || status == "failed" {
            snap.latest_pipeline.finished_at = crate::status::now_iso8601();
        }
    }

    if let Some(pesan) = &rekaman.message {
        snap.latest_pipeline.failure_reason = pesan.clone();
    }

    for tahap in &rekaman.stage {
        if !snap.latest_pipeline.stages.contains(tahap) {
            snap.latest_pipeline.stages.push(tahap.clone());
            snap.latest_pipeline.stage_times.push(StageTime {
                id: tahap.clone(),
                at: crate::status::now_iso8601(),
            });
        }
    }

    if let Some(v) = &rekaman.commit {
        snap.latest_pipeline.commit_sha = v.clone();
    }
    if let Some(v) = &rekaman.author {
        snap.latest_pipeline.author = v.clone();
    }
    if let Some(v) = &rekaman.summary {
        snap.latest_pipeline.security_summary = v.clone();
        let (lulus, total) = parse_gates(v);
        snap.latest_pipeline.gates_passed = lulus;
        snap.latest_pipeline.gates_total = total;
    }
    snap.latest_pipeline
        .raw_log
        .extend(rekaman.log.iter().cloned());
}

/// Update satu baris `applications[]` untuk build aplikasi non-Autore.
/// `deployed` hanya pernah naik; commit diambil dari peristiwa build (jatuh ke
/// commit baris aplikasi kalau pipeline tidak mengirim `--commit`).
fn terapkan_aplikasi(snap: &mut Snapshot, rekaman: &Rekaman, nama: &str) {
    let lewat_deploy = rekaman
        .stage
        .iter()
        .any(|t| t == crate::status::TAHAP_DEPLOY);
    if !snap.applications.iter().any(|a| a.name == nama) {
        snap.applications.push(Application::baru(nama));
    }
    let commit = rekaman.commit.clone().unwrap_or_default();
    if let Some(entri) = snap.applications.iter_mut().find(|a| a.name == nama) {
        if lewat_deploy {
            entri.deployed = true;
        }
        // Commit boleh datang di panggilan mana pun (biasanya yang pertama):
        // simpan begitu ada, hasil akhir tinggal pakai yang tersimpan.
        if !commit.is_empty() {
            entri.commit_sha = commit;
        }
        // Sama seperti perekaman standar: hanya hasil akhir yang menulis status.
        if let Some(status) = &rekaman.status {
            if status == "passed" || status == "failed" {
                let sha = entri.commit_sha.clone();
                entri.tuntaskan(status, &sha, lewat_deploy);
            }
        }
    }
}

/// Jalankan `autore pipeline record`; balik exit code proses.
///
/// Baca-tulis lewat berkas (bukan objek di memori) supaya kegagalan permission
/// atau disk terlihat, bukan jadi sukses palsu.
pub fn jalankan(rekaman: &Rekaman) -> i32 {
    let workspace = crate::workspace::workspace_dir();
    let mut snap = crate::status::load(&workspace);
    terapkan(&mut snap, rekaman);

    if let Err(e) = crate::status::save(&workspace, &snap) {
        eprintln!("WARNING: {e}");
        return 1;
    }

    let balik = crate::status::load(&workspace);
    // Rekaman aplikasi diverifikasi lewat barisnya sendiri, bukan lewat slot
    // pipeline Autore (yang memang tidak disentuh).
    if let Some(nama) = rekaman.app.as_deref().filter(|n| !n.is_empty()) {
        let Some(baris) = balik.applications.iter().find(|a| a.name == nama) else {
            eprintln!("WARNING: aplikasi '{nama}' tidak terbaca kembali dari simpanan");
            return 1;
        };
        // Hanya hasil akhir yang ditulis ke baris aplikasi; `running` tidak
        // pernah mengklaim status, jadi tidak ada yang diverifikasi.
        if let Some(status) = rekaman
            .status
            .as_deref()
            .filter(|s| *s == "passed" || *s == "failed")
        {
            if baris.status != status {
                eprintln!(
                    "WARNING: status '{status}' aplikasi '{nama}' tidak terbaca kembali dari simpanan"
                );
                return 1;
            }
        }
    } else {
        if let Some(status) = &rekaman.status {
            if &balik.latest_pipeline.status != status {
                eprintln!("WARNING: status '{status}' tidak terbaca kembali dari simpanan");
                return 1;
            }
        }
        for tahap in &rekaman.stage {
            if !balik.latest_pipeline.stages.contains(tahap) {
                eprintln!("WARNING: tahap '{tahap}' tidak terbaca kembali dari simpanan");
                return 1;
            }
        }
    }

    if rekaman.json {
        println!(
            "{}",
            crate::status::canonical(&crate::status::build(&workspace))
        );
    } else if let Some(nama) = rekaman.app.as_deref().filter(|n| !n.is_empty()) {
        println!(
            "aplikasi direkam: {}, status {}",
            nama,
            balik
                .applications
                .iter()
                .find(|a| a.name == nama)
                .map(|a| a.status.as_str())
                .unwrap_or(crate::status::UNKNOWN)
        );
    } else {
        println!(
            "pipeline direkam: {}, {} tahap",
            balik.latest_pipeline.status,
            balik.latest_pipeline.stages.len()
        );
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::Snapshot;

    fn rekaman() -> Rekaman {
        Rekaman::default()
    }

    #[test]
    fn field_yang_tidak_diisi_tidak_mengubah_simpanan() {
        let mut snap = Snapshot::default();
        snap.latest_pipeline.commit_sha = "405156b".to_string();
        snap.latest_pipeline.raw_log = vec!["baris lama".to_string()];
        terapkan(&mut snap, &rekaman());
        assert_eq!(snap.latest_pipeline.commit_sha, "405156b");
        assert_eq!(snap.latest_pipeline.raw_log, vec!["baris lama".to_string()]);
    }

    #[test]
    fn reset_mengosongkan_tahap_log_dan_alasan() {
        let mut snap = Snapshot::default();
        snap.latest_pipeline.stages = vec!["checkout".to_string(), "scan".to_string()];
        snap.latest_pipeline.raw_log = vec!["lama".to_string()];
        snap.latest_pipeline.failure_reason = "gagal lama".to_string();
        terapkan(
            &mut snap,
            &Rekaman {
                reset: true,
                ..rekaman()
            },
        );
        assert!(snap.latest_pipeline.stages.is_empty());
        assert!(snap.latest_pipeline.raw_log.is_empty());
        assert!(snap.latest_pipeline.failure_reason.is_empty());
    }

    #[test]
    fn tahap_ganda_tidak_ditulis_dua_kali() {
        let mut snap = Snapshot::default();
        terapkan(
            &mut snap,
            &Rekaman {
                stage: vec!["checkout".to_string()],
                ..rekaman()
            },
        );
        terapkan(
            &mut snap,
            &Rekaman {
                stage: vec!["checkout".to_string(), "scan".to_string()],
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.stages, vec!["checkout", "scan"]);
    }

    #[test]
    fn status_running_menghapus_alasan_gagal_dan_menyalin_ke_system_status() {
        let mut snap = Snapshot::default();
        snap.latest_pipeline.failure_reason = "gagal lama".to_string();
        terapkan(
            &mut snap,
            &Rekaman {
                status: Some("running".to_string()),
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.status, "running");
        assert_eq!(snap.system_status, "running");
        assert!(snap.latest_pipeline.failure_reason.is_empty());
    }

    #[test]
    fn pesan_gagal_masuk_failure_reason_tanpa_dibersihkan() {
        let mut snap = Snapshot::default();
        terapkan(
            &mut snap,
            &Rekaman {
                status: Some("failed".to_string()),
                message: Some("Gagal di tahap: 5. Build".to_string()),
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.status, "failed");
        assert_eq!(snap.system_status, "failed");
        assert_eq!(
            snap.latest_pipeline.failure_reason,
            "Gagal di tahap: 5. Build"
        );
    }

    #[test]
    fn log_dan_metadata_ditulis_apa_adanya() {
        let mut snap = Snapshot::default();
        terapkan(
            &mut snap,
            &Rekaman {
                commit: Some("0770f21".to_string()),
                author: Some("tugure-git-intern <tugure.gitintern@tugu-re.com>".to_string()),
                summary: Some("9/9 gerbang lolos · digest sha256:138de1085b65".to_string()),
                log: vec!["[checkout] ambil source".to_string(), String::new()],
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.commit_sha, "0770f21");
        assert!(snap.latest_pipeline.author.contains('<'));
        assert!(snap.latest_pipeline.security_summary.contains("digest"));
        assert_eq!(snap.latest_pipeline.raw_log.len(), 2);
    }

    #[test]
    fn urutan_tahap_sesuai_kiriman_dan_terpisah_per_build() {
        let mut snap = Snapshot::default();
        for tahap in ["checkout", "scan", "build", "pasang", "periksa"] {
            terapkan(
                &mut snap,
                &Rekaman {
                    status: Some("running".to_string()),
                    stage: vec![tahap.to_string()],
                    ..rekaman()
                },
            );
        }
        assert_eq!(
            snap.latest_pipeline.stages,
            vec!["checkout", "scan", "build", "pasang", "periksa"]
        );

        // Build berikutnya: reset dulu, jadi tahap build lama tidak menempel.
        terapkan(
            &mut snap,
            &Rekaman {
                reset: true,
                status: Some("running".to_string()),
                stage: vec!["checkout".to_string()],
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.stages, vec!["checkout"]);
    }

    #[test]
    fn jumlah_gerbang_dibaca_dari_ringkasan() {
        assert_eq!(parse_gates("9/9 gerbang lolos · digest sha256:abc"), (9, 9));
        assert_eq!(parse_gates("12/12 gerbang lolos"), (12, 12));
        assert_eq!(parse_gates("1/9 gerbang lolos"), (1, 9));
        // Tidak ada pola, atau total nol: "tanpa data", bukan skor 0%.
        assert_eq!(parse_gates(""), (0, 0));
        assert_eq!(parse_gates("gerbang lolos"), (0, 0));
        assert_eq!(parse_gates("0/0 gerbang lolos"), (0, 0));
        assert_eq!(parse_gates("gagal di tahap 2"), (0, 0));
    }

    #[test]
    fn tahap_mencatat_waktu_urut_dan_reset_membersihkannya() {
        let mut snap = Snapshot::default();
        for tahap in ["checkout", "scan", "build"] {
            terapkan(
                &mut snap,
                &Rekaman {
                    status: Some("running".to_string()),
                    stage: vec![tahap.to_string()],
                    ..rekaman()
                },
            );
        }
        let waktu: Vec<String> = snap
            .latest_pipeline
            .stage_times
            .iter()
            .map(|t| t.at.clone())
            .collect();
        assert_eq!(snap.latest_pipeline.stage_times.len(), 3);
        assert_eq!(snap.latest_pipeline.stage_times[0].id, "checkout");
        assert!(waktu.iter().all(|w| w.len() == 20 && w.ends_with('Z')));
        assert!(waktu.windows(2).all(|w| w[0] <= w[1]));

        // Tahap ganda tidak menambah entri waktu kedua.
        terapkan(
            &mut snap,
            &Rekaman {
                stage: vec!["build".to_string()],
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.stage_times.len(), 3);

        terapkan(
            &mut snap,
            &Rekaman {
                reset: true,
                ..rekaman()
            },
        );
        assert!(snap.latest_pipeline.stage_times.is_empty());
    }

    #[test]
    fn finished_at_hanya_terisi_saat_pipeline_selesai() {
        let mut snap = Snapshot::default();
        terapkan(
            &mut snap,
            &Rekaman {
                status: Some("running".to_string()),
                ..rekaman()
            },
        );
        assert!(snap.latest_pipeline.finished_at.is_empty());

        terapkan(
            &mut snap,
            &Rekaman {
                status: Some("failed".to_string()),
                message: Some("Gagal di tahap: 3. Trivy".to_string()),
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.finished_at.len(), 20);
    }

    #[test]
    fn ringkasan_ringkas_menyetel_gerbang_dan_build_baru_mereset() {
        let mut snap = Snapshot::default();
        terapkan(
            &mut snap,
            &Rekaman {
                status: Some("passed".to_string()),
                summary: Some("9/9 gerbang lolos · digest sha256:abc".to_string()),
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.gates_passed, 9);
        assert_eq!(snap.latest_pipeline.gates_total, 9);

        terapkan(
            &mut snap,
            &Rekaman {
                reset: true,
                status: Some("running".to_string()),
                ..rekaman()
            },
        );
        assert_eq!(snap.latest_pipeline.gates_total, 0);
        assert!(snap.latest_pipeline.finished_at.is_empty());
    }
    #[test]
    fn rekaman_aplikasi_tidak_mengubah_kartu_status_pipeline() {
        let mut snap = Snapshot::default();
        terapkan(
            &mut snap,
            &Rekaman {
                status: Some("passed".to_string()),
                commit: Some("b83318f".to_string()),
                log: vec!["[done] build #227 SUCCESS".to_string()],
                stage: vec!["checkout".to_string()],
                ..rekaman()
            },
        );
        let sebelum = snap.latest_pipeline.clone();
        let system_sebelum = snap.system_status.clone();

        // Build aplikasi lain (tes-web) menulis peristiwanya sendiri.
        terapkan(
            &mut snap,
            &Rekaman {
                reset: true,
                app: Some("tes-web".to_string()),
                status: Some("running".to_string()),
                commit: Some("6d0bca6".to_string()),
                stage: vec!["checkout".to_string()],
                ..rekaman()
            },
        );

        assert_eq!(
            snap.latest_pipeline.status, sebelum.status,
            "kartu Status Pipeline tidak boleh ikut berubah karena build aplikasi"
        );
        assert_eq!(snap.latest_pipeline.commit_sha, sebelum.commit_sha);
        assert_eq!(snap.latest_pipeline.raw_log, sebelum.raw_log);
        assert_eq!(snap.latest_pipeline.stages, sebelum.stages);
        assert_eq!(snap.system_status, system_sebelum);
    }

    #[test]
    fn rekaman_aplikasi_menuntaskan_baris_aplikasinya_sendiri() {
        let mut snap = Snapshot::default();
        terapkan(
            &mut snap,
            &Rekaman {
                status: Some("passed".to_string()),
                commit: Some("b83318f".to_string()),
                ..rekaman()
            },
        );

        terapkan(
            &mut snap,
            &Rekaman {
                app: Some("tes-web".to_string()),
                status: Some("passed".to_string()),
                commit: Some("6d0bca6".to_string()),
                stage: vec![crate::status::TAHAP_DEPLOY.to_string()],
                ..rekaman()
            },
        );

        let app = snap
            .applications
            .iter()
            .find(|a| a.name == "tes-web")
            .expect("baris aplikasi dibuat");
        assert_eq!(app.status, "passed");
        assert_eq!(app.commit_sha, "6d0bca6");
        assert!(app.deployed);
        assert_eq!(snap.latest_pipeline.commit_sha, "b83318f");
    }
}
