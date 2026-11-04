//! `autore pipeline record` — penulis `dashboard-status.json` dari luar `serve`.
//!
//! Pipeline (Jenkins) memanggil subcommand ini di tiap tahap, jadi logika
//! kontrak tetap satu tempat: modul ini cuma *merge* peristiwa, `status::save`
//! yang menyimpan (atomik: tulis `*.tmp` lalu rename).

use crate::status::Snapshot;
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

    /// Cetak dokumen kontrak hasil rekaman ke stdout
    #[arg(long)]
    pub json: bool,
}

/// Merge satu peristiwa ke simpanan. Tidak menyentuh filesystem.
pub fn terapkan(snap: &mut Snapshot, rekaman: &Rekaman) {
    if rekaman.reset {
        snap.latest_pipeline.stages.clear();
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
    }

    if let Some(pesan) = &rekaman.message {
        snap.latest_pipeline.failure_reason = pesan.clone();
    }

    for tahap in &rekaman.stage {
        if !snap.latest_pipeline.stages.contains(tahap) {
            snap.latest_pipeline.stages.push(tahap.clone());
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
    }
    snap.latest_pipeline
        .raw_log
        .extend(rekaman.log.iter().cloned());
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
}
