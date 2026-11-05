//! `autore active` — pipeline yang sedang **berjalan** atau **menunggu** di Jenkins.
//!
//! Dibaca dari dua panggilan saja (root listing + queue), bukan per-job, karena
//! dashboard memanggil ini tiap 10 detik.
//!
//! Aturan yang sama dengan `runs.rs`: yang tidak tersedia jadi string kosong,
//! bukan `null`; Jenkins mati bukan panic.

use crate::jenkins::JenkinsConfig;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

/// Satu kartu di section "Active Pipelines".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PipelineAktif {
    pub app: String,
    /// 0 untuk yang masih menunggu — belum ada build.
    pub number: u64,
    /// `running` atau `queued`.
    pub status: String,
    pub branch: String,
    pub commit_sha: String,
    pub author: String,
    pub started_at: String,
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub struct Counts {
    pub running: u32,
    pub queued: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaporanAktif {
    pub generated_at: String,
    pub active: Vec<PipelineAktif>,
    pub counts: Counts,
}

/// Hasil antara sebelum disusun jadi kartu: belum ada URL, waktu ISO, atau author.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Kandidat {
    pub app: String,
    pub number: u64,
    pub status: String,
    pub branch: String,
    pub commit_sha: String,
    pub started_ms: u64,
}

fn balasan_bukan_json(e: serde_json::Error) -> String {
    format!("balasan Jenkins bukan JSON: {e}")
}

/// `refs/heads/main` → `main`. Ref yang sudah pendek dibiarkan.
pub fn nama_branch(nama: &str) -> String {
    for awalan in [
        "refs/heads/",
        "refs/remotes/origin/",
        "refs/remotes/",
        "refs/tags/",
    ] {
        if let Some(sisa) = nama.strip_prefix(awalan) {
            return sisa.to_string();
        }
    }
    nama.to_string()
}

/// SHA + branch dari `actions[].lastBuiltRevision`. Sama dengan `runs.rs`: job
/// Autore melakukan dua checkout, jadi yang dari `origin` yang dipakai; kalau
/// tidak ada, pakai yang terakhir terlihat — jangan mengarang.
fn sha_dan_branch(build: &Value) -> (String, String) {
    let mut sha_origin = String::new();
    let mut branch_origin = String::new();
    let mut sha_akhir = String::new();
    let mut branch_akhir = String::new();

    let aksi_aksi = build
        .get("actions")
        .and_then(|a| a.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    for aksi in aksi_aksi {
        let Some(rev) = aksi.get("lastBuiltRevision") else {
            continue;
        };
        let Some(sha) = rev.get("SHA1").and_then(|s| s.as_str()) else {
            continue;
        };
        let cabang = rev
            .get("branch")
            .and_then(|b| b.as_array())
            .and_then(|b| b.first())
            .and_then(|c| c.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        let dari_origin = cabang.starts_with("refs/remotes/origin/");

        sha_akhir = sha.to_string();
        branch_akhir = nama_branch(cabang);
        if dari_origin {
            sha_origin = sha.to_string();
            branch_origin = nama_branch(cabang);
        }
    }

    if sha_origin.is_empty() {
        (sha_akhir, branch_akhir)
    } else {
        (sha_origin, branch_origin)
    }
}

/// Job yang build terakhirnya masih `building:true`. Job tanpa `lastBuild`
/// (belum pernah build) atau yang tidak sedang jalan dilewati.
pub fn parse_jobs(json: &str) -> Result<Vec<Kandidat>, String> {
    let nilai: Value = serde_json::from_str(json).map_err(balasan_bukan_json)?;
    Ok(nilai
        .get("jobs")
        .and_then(|j| j.as_array())
        .map(|jobs| {
            jobs.iter()
                .filter_map(|job| {
                    let app = job.get("name").and_then(|n| n.as_str())?.to_string();
                    if app.is_empty() {
                        return None;
                    }
                    let build = job.get("lastBuild")?;
                    if !build.get("building").and_then(|b| b.as_bool())? {
                        return None;
                    }
                    let (commit_sha, branch) = sha_dan_branch(build);
                    Some(Kandidat {
                        app,
                        number: build.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
                        status: "running".to_string(),
                        branch,
                        commit_sha,
                        started_ms: build.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Item queue `/queue/api/json` → calon kartu `queued`. Item tanpa nama task
/// (bentuknya berubah antar versi Jenkins) dilewati, bukan panik.
pub fn parse_queue(json: &str) -> Result<Vec<Kandidat>, String> {
    let nilai: Value = serde_json::from_str(json).map_err(balasan_bukan_json)?;
    Ok(nilai
        .get("items")
        .and_then(|i| i.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let task = item.get("task")?;
                    let app = task
                        .get("name")
                        .and_then(|n| n.as_str())
                        .filter(|n| !n.is_empty())
                        .or_else(|| {
                            task.get("fullName")
                                .and_then(|n| n.as_str())
                                .filter(|n| !n.is_empty())
                        })?
                        .to_string();
                    Some(Kandidat {
                        app,
                        number: 0,
                        status: "queued".to_string(),
                        branch: String::new(),
                        commit_sha: String::new(),
                        started_ms: item
                            .get("inQueueSince")
                            .and_then(|t| t.as_u64())
                            .unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

fn rapikan_base(base: &str) -> &str {
    base.trim_end_matches('/')
}

/// Susun laporan: yang berjalan dulu (paling lama di atas), lalu yang menunggu
/// (paling lama menunggu di atas). Murni supaya urutan bisa diuji dengan angka tetap.
pub fn susun_aktif(
    mut running: Vec<Kandidat>,
    mut queued: Vec<Kandidat>,
    base: &str,
    sekarang_ms: u64,
) -> LaporanAktif {
    running.sort_by_key(|k| k.started_ms);
    queued.sort_by_key(|k| k.started_ms);

    let base = rapikan_base(base);
    let mut counts = Counts::default();
    let aktif = running
        .into_iter()
        .chain(queued)
        .map(|k| {
            if k.status == "running" {
                counts.running += 1;
            } else {
                counts.queued += 1;
            }
            let nomor = if k.number > 0 {
                format!("/{}", k.number)
            } else {
                String::new()
            };
            PipelineAktif {
                url: format!("{base}/job/{}{nomor}", k.app),
                started_at: if k.started_ms > 0 {
                    crate::status::iso8601_from_unix(k.started_ms / 1000)
                } else {
                    String::new()
                },
                app: k.app,
                number: k.number,
                status: k.status,
                branch: k.branch,
                commit_sha: k.commit_sha,
                author: String::new(),
            }
        })
        .collect();

    LaporanAktif {
        generated_at: crate::status::iso8601_from_unix(sekarang_ms / 1000),
        active: aktif,
        counts,
    }
}

/// Dua panggilan Jenkins → laporan. Author diisi pemanggil (`cari_penulis`
/// butuh repo lokal, jadi tidak masuk fungsi murni ini).
pub fn parse_active(
    jobs_json: &str,
    queue_json: &str,
    base: &str,
    sekarang_ms: u64,
) -> Result<LaporanAktif, String> {
    let jalan = parse_jobs(jobs_json)?;
    let antre = parse_queue(queue_json)?;
    Ok(susun_aktif(jalan, antre, base, sekarang_ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dipotong dari respons nyata `GET /api/json?tree=jobs[name,lastBuild[...]]`
    /// (2026-11-05): `tes-web` sedang jalan, `diag-ws` selesai, `autore-dummy`
    /// belum pernah build.
    const JOBS: &str = r#"{"jobs":[
      {"name":"tes-web","lastBuild":{"number":42,"building":true,"timestamp":1793848988000,
       "actions":[{},{"_class":"hudson.plugins.git.util.BuildData","lastBuiltRevision":
         {"SHA1":"3878d9307475eb84316edde4e77f63fd0b98ae4e","branch":[{"name":"main"}]}}]}},
      {"name":"diag-ws","lastBuild":{"number":7,"building":false,"timestamp":1793840000000,
       "actions":[{}]}},
      {"name":"autore-dummy","lastBuild":null}
    ]}"#;

    /// Bentuk item queue dari dokumentasi Jenkins — queue kosong saat kode ini
    /// ditulis, jadi field yang hilang wajib jadi "" bukan panic.
    const QUEUE: &str = r#"{"items":[
      {"id":11,"why":"Menunggu node tersedia","inQueueSince":1793849100000,"task":{"name":"ui-demo"}}
    ]}"#;

    const BASE: &str = "http://100.80.3.14:8080";

    #[test]
    fn hanya_build_building_yang_jadi_running() {
        let jalan = parse_jobs(JOBS).expect("jobs sah");

        assert_eq!(jalan.len(), 1);
        assert_eq!(jalan[0].app, "tes-web");
        assert_eq!(jalan[0].number, 42);
        assert_eq!(jalan[0].status, "running");
    }

    #[test]
    fn sha_dan_branch_dibaca_dari_last_built_revision() {
        let jalan = parse_jobs(JOBS).expect("jobs sah");

        assert_eq!(
            jalan[0].commit_sha,
            "3878d9307475eb84316edde4e77f63fd0b98ae4e"
        );
        assert_eq!(jalan[0].branch, "main");
        assert_eq!(jalan[0].started_ms, 1793848988000);
    }

    #[test]
    fn branch_refs_dinormalisasi() {
        for (mentah, harapan) in [
            ("main", "main"),
            ("refs/heads/main", "main"),
            ("refs/remotes/origin/main", "main"),
            ("refs/remotes/origin/feature/auth", "feature/auth"),
            ("refs/tags/v1.2", "v1.2"),
            ("", ""),
        ] {
            assert_eq!(nama_branch(mentah), harapan, "input: {mentah}");
        }
    }

    #[test]
    fn queue_jadi_status_queued_dengan_number_nol() {
        let antre = parse_queue(QUEUE).expect("queue sah");

        assert_eq!(antre.len(), 1);
        assert_eq!(antre[0].app, "ui-demo");
        assert_eq!(antre[0].status, "queued");
        assert_eq!(antre[0].number, 0);
        assert_eq!(antre[0].commit_sha, "");
        assert_eq!(antre[0].branch, "");
        assert_eq!(antre[0].started_ms, 1793849100000);
    }

    #[test]
    fn queue_tanpa_task_tidak_panik() {
        let antre = parse_queue(r#"{"items":[{"id":3},{"id":4,"task":{"name":""}}]}"#)
            .expect("item cacat dilewati");

        assert!(antre.is_empty());
    }

    #[test]
    fn queue_kosong_dan_jobs_tanpa_build_jadi_laporan_kosong() {
        let laporan = parse_active(r#"{"jobs":[]}"#, r#"{"items":[]}"#, BASE, 1_793_850_000_000)
            .expect("payload sah");

        assert!(laporan.active.is_empty());
        assert_eq!(laporan.counts, Counts::default());
    }

    #[test]
    fn urutan_running_dulu_lalu_queued_terlama() {
        let jalan = vec![
            kandidat("tes-web", 9, "running", 1_793_848_000_000),
            kandidat("tes-web", 8, "running", 1_793_840_000_000),
        ];
        let antre = vec![
            kandidat("ui-demo", 0, "queued", 1_793_849_000_000),
            kandidat("ui-demo3", 0, "queued", 1_793_830_000_000),
        ];
        let laporan = susun_aktif(jalan, antre, BASE, 1_793_850_000_000);

        let urutan: Vec<(String, u64)> = laporan
            .active
            .iter()
            .map(|p| (p.app.clone(), p.number))
            .collect();
        assert_eq!(
            urutan,
            vec![
                ("tes-web".to_string(), 8),
                ("tes-web".to_string(), 9),
                ("ui-demo3".to_string(), 0),
                ("ui-demo".to_string(), 0),
            ]
        );
    }

    #[test]
    fn url_dan_waktu_disusun_dari_base_ternormalisasi() {
        let laporan = parse_active(JOBS, QUEUE, "http://100.80.3.14:8080/", 1_793_850_000_000)
            .expect("payload sah");

        assert_eq!(
            laporan.active[0].url,
            "http://100.80.3.14:8080/job/tes-web/42"
        );
        assert_eq!(laporan.active[1].url, "http://100.80.3.14:8080/job/ui-demo");
        assert_eq!(laporan.active[0].started_at, "2026-11-05T03:23:08Z");
        assert_eq!(laporan.active[1].started_at, "2026-11-05T03:25:00Z");
        assert_eq!(laporan.generated_at, "2026-11-05T03:40:00Z");
        assert_eq!(laporan.active[0].author, "");
    }

    #[test]
    fn counts_menghitung_kedua_status() {
        let laporan = parse_active(JOBS, QUEUE, BASE, 1_793_850_000_000).expect("payload sah");

        assert_eq!(laporan.counts.running, 1);
        assert_eq!(laporan.counts.queued, 1);
        assert_eq!(laporan.active.len(), 2);
    }

    #[test]
    fn balasan_bukan_json_jadi_error_jelas() {
        let salah =
            parse_active("<html>502</html>", r#"{"items":[]}"#, BASE, 0).expect_err("harus error");

        assert!(salah.contains("Jenkins"), "pesan: {salah}");

        let salah_antre = parse_jobs("bukan json").expect_err("harus error");
        assert!(salah_antre.contains("Jenkins"), "pesan: {salah_antre}");
    }

    fn kandidat(app: &str, number: u64, status: &str, started_ms: u64) -> Kandidat {
        Kandidat {
            app: app.to_string(),
            number,
            status: status.to_string(),
            branch: "main".to_string(),
            commit_sha: "a".repeat(40),
            started_ms,
        }
    }
}
