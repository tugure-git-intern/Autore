//! `autore runs` — histori build dari Jenkins untuk grafik dashboard.
//!
//! Dashboard tidak boleh menebak, jadi yang dikirim hanya yang Jenkins benar-benar
//! laporkan: jumlah, hasil, durasi, waktu mulai. Author diambil dari repo lokal
//! karena job Autore melakukan `git clone` di dalam stage, sehingga Jenkins tidak
//! punya `changeSet`.
//!
//! Jenkins mati/URL salah bukan error fatal: aplikasi yang job-nya tidak bisa
//! dibaca dilewati, laporan tetap keluar (dashboard menandainya `stale` sendiri).
//! Konfigurasi Jenkins yang belum ada tetap error (exit 1) — itu salah pasang,
//! bukan gangguan sementara.

use crate::jenkins::JenkinsConfig;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

const HARI_MS: u64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BuildRingkas {
    pub number: u64,
    pub result: Option<String>,
    pub duration_ms: u64,
    pub timestamp_ms: u64,
    pub commit_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RunRecord {
    pub app: String,
    pub number: u64,
    pub status: String,
    pub duration_ms: u64,
    pub started_at: String,
    pub commit_sha: String,
    pub author: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DailyPoint {
    pub date: String,
    pub passed: u32,
    pub failed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct Totals {
    pub passed: u32,
    pub failed: u32,
    pub running: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaporanRuns {
    pub generated_at: String,
    pub window_days: u32,
    pub runs: Vec<RunRecord>,
    pub daily: Vec<DailyPoint>,
    pub totals: Totals,
}

/// Hasil Jenkins → status dashboard. `null` berarti build masih jalan.
pub fn status_dari_result(result: Option<&str>) -> &'static str {
    match result {
        Some("SUCCESS") => "passed",
        Some(_) => "failed",
        None => "running",
    }
}

/// SHA commit aplikasi dari satu build. Job Autore melakukan dua checkout
/// (library Autore, lalu repo aplikasi) sehingga `actions` memuat lebih dari satu
/// `lastBuiltRevision`. Yang benar adalah yang berasal dari remote origin; kalau
/// tidak ada, pakai SHA terakhir yang ada — jangan mengarang.
fn sha_dari_actions(build: &serde_json::Value) -> String {
    let mut terakhir = String::new();
    let mut terakhir_origin = String::new();
    for aksi in build
        .get("actions")
        .and_then(|a| a.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[])
    {
        let Some(rev) = aksi
            .get("lastBuiltRevision")
            .and_then(|r| r.get("SHA1"))
            .and_then(|s| s.as_str())
        else {
            continue;
        };
        terakhir = rev.to_string();
        let dari_origin = aksi
            .get("lastBuiltRevision")
            .and_then(|r| r.get("branch"))
            .and_then(|b| b.as_array())
            .map(|cabang| {
                cabang.iter().any(|c| {
                    c.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.starts_with("refs/remotes/origin/"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        if dari_origin {
            terakhir_origin = rev.to_string();
        }
    }
    if terakhir_origin.is_empty() {
        terakhir
    } else {
        terakhir_origin
    }
}

pub fn parse_builds(json: &str) -> Result<Vec<BuildRingkas>, String> {
    let nilai: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("balasan Jenkins bukan JSON: {e}"))?;
    Ok(nilai
        .get("builds")
        .and_then(|b| b.as_array())
        .map(|builds| {
            builds
                .iter()
                .map(|b| BuildRingkas {
                    number: b.get("number").and_then(|v| v.as_u64()).unwrap_or(0),
                    result: b
                        .get("result")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    duration_ms: b.get("duration").and_then(|v| v.as_u64()).unwrap_or(0),
                    timestamp_ms: b.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0),
                    commit_sha: sha_dari_actions(b),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// `YYYY-MM-DD` untuk nomor hari sejak epoch (UTC, sama dengan timestamp Jenkins).
fn tanggal_utc(hari: u64) -> String {
    crate::status::iso8601_from_unix(hari * 86_400)[..10].to_string()
}

/// Susun laporan dari build yang sudah diambil. Murni: tanpa jam sistem, tanpa IO,
/// supaya perilaku jendela/limit/bucket bisa diuji dengan angka tetap.
pub fn susun_laporan(
    sumber: Vec<(String, Vec<BuildRingkas>)>,
    penulis: &HashMap<String, String>,
    days: u32,
    limit: usize,
    sekarang_ms: u64,
) -> LaporanRuns {
    let mulai = sekarang_ms.saturating_sub(days as u64 * HARI_MS);

    let mut kandidat: Vec<(u64, RunRecord)> = Vec::new();
    for (app, builds) in sumber {
        for b in builds {
            if b.timestamp_ms < mulai {
                continue;
            }
            kandidat.push((
                b.timestamp_ms,
                RunRecord {
                    app: app.clone(),
                    number: b.number,
                    status: status_dari_result(b.result.as_deref()).to_string(),
                    duration_ms: b.duration_ms,
                    started_at: crate::status::iso8601_from_unix(b.timestamp_ms / 1000),
                    author: penulis.get(&b.commit_sha).cloned().unwrap_or_default(),
                    commit_sha: b.commit_sha,
                    url: String::new(),
                },
            ));
        }
    }
    kandidat.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.number.cmp(&a.1.number)));

    // Totals dari seluruh jendela: donut mewakili 7 hari, bukan 5 baris teratas.
    let mut totals = Totals::default();
    for (_, r) in &kandidat {
        match r.status.as_str() {
            "passed" => totals.passed += 1,
            "failed" => totals.failed += 1,
            _ => totals.running += 1,
        }
    }

    let hari_ini = sekarang_ms / HARI_MS;
    let mut daily: Vec<DailyPoint> = (0..days as u64)
        .map(|i| DailyPoint {
            date: tanggal_utc(hari_ini - (days as u64 - 1 - i)),
            passed: 0,
            failed: 0,
        })
        .collect();
    for (ts, r) in &kandidat {
        let tanggal = tanggal_utc(ts / HARI_MS);
        if let Some(titik) = daily.iter_mut().find(|d| d.date == tanggal) {
            match r.status.as_str() {
                "passed" => titik.passed += 1,
                "failed" => titik.failed += 1,
                _ => {}
            }
        }
    }

    let runs: Vec<RunRecord> = kandidat
        .into_iter()
        .take(limit)
        .map(|(_, r)| r)
        .collect();

    LaporanRuns {
        generated_at: crate::status::iso8601_from_unix(sekarang_ms / 1000),
        window_days: days,
        runs,
        daily,
        totals,
    }
}

/// Author commit dari repo lokal. Commit tidak ada di sini (build dari mesin lain)
/// → string kosong; `kumpulkan` menutupnya dari peta rekaman pipeline.
pub fn cari_penulis(dir_app: &Path, sha: &str) -> String {
    if sha.is_empty() {
        return String::new();
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir_app)
        .args(["log", "-1", "--format=%an <%ae>", sha])
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    }
}

/// Isi penulis yang tidak bisa dijawab klon host dari peta rekaman build.
/// Klon host tetap sumber utama: jawaban yang sudah ada tidak pernah ditimpa.
fn isi_penulis_tersimpan(lokal: &mut HashMap<String, String>, tersimpan: &[(String, String)]) {
    for (sha, nama) in tersimpan {
        if sha.is_empty() || nama.trim().is_empty() {
            continue;
        }
        if lokal.get(sha).map(String::is_empty).unwrap_or(true) {
            lokal.insert(sha.clone(), nama.clone());
        }
    }
}

fn ambil_build(
    cfg: &JenkinsConfig,
    base: &str,
    app: &str,
    limit: usize,
) -> Result<Vec<BuildRingkas>, String> {
    // Brackets di-encode: Jenkins menolak query mentah, dan `-g` mematikan globbing
    // curl supaya `[`, `]`, `{`, `}` tidak dianggap pola.
    let tree = format!(
        "builds%5Bnumber,result,duration,timestamp,actions%5BlastBuiltRevision%5BSHA1,branch%5Bname%5D%5D%5D%5D%7B0,{limit}%7D"
    );
    let url = format!("{base}/job/{app}/api/json?tree={tree}");
    let kredensial = format!("user = \"{}:{}\"\n", cfg.user, cfg.token);
    let (code, body) = crate::jenkins::curl_with_stdin_config(
        &[
            "-g",
            "-sS",
            "--max-time",
            "15",
            "-w",
            "\n__HTTP_CODE__:%{http_code}",
            "--config",
            "-",
            &url,
        ],
        &kredensial,
    )?;
    if code != 200 {
        return Err(format!("Jenkins membalas HTTP {code} untuk job {app}"));
    }
    parse_builds(&body)
}

pub fn kumpulkan(
    workspace: &Path,
    cfg: &JenkinsConfig,
    days: u32,
    limit: usize,
) -> Result<LaporanRuns, String> {
    let base = crate::jenkins::normalize_jenkins_url(&cfg.url)?;

    let mut sumber = Vec::new();
    for proyek in crate::workspace::baca_registry(workspace) {
        if let Ok(builds) = ambil_build(cfg, &base, &proyek.nama, limit) {
            sumber.push((proyek.nama.clone(), builds));
        }
    }

    let mut penulis: HashMap<String, String> = HashMap::new();
    for (app, builds) in &sumber {
        for b in builds {
            if b.commit_sha.is_empty() || penulis.contains_key(&b.commit_sha) {
                continue;
            }
            let nama = cari_penulis(&workspace.join(app), &b.commit_sha);
            penulis.insert(b.commit_sha.clone(), nama);
        }
    }
    isi_penulis_tersimpan(&mut penulis, &crate::status::load(workspace).penulis);

    let sekarang_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut laporan = susun_laporan(sumber, &penulis, days, limit, sekarang_ms);
    for r in &mut laporan.runs {
        r.url = format!("{base}/job/{}/{}", r.app, r.number);
    }
    Ok(laporan)
}

pub fn jalankan(days: u32, limit: usize, json: bool) -> i32 {
    let path = crate::jenkins::default_config_path();
    let Some(cfg) = crate::jenkins::load_config_from(&path) else {
        eprintln!(
            "ERROR: konfigurasi Jenkins belum ada di {}. Jalankan `autore deploy` dulu.",
            path.display()
        );
        return 1;
    };

    let laporan = match kumpulkan(&crate::workspace::workspace_dir(), &cfg, days, limit) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("ERROR: {e}");
            return 1;
        }
    };

    if json {
        println!("{}", serde_json::to_string(&laporan).unwrap_or_default());
        return 0;
    }

    if laporan.runs.is_empty() {
        println!("Belum ada run dalam {} hari terakhir.", laporan.window_days);
        return 0;
    }
    println!(
        "{:<16} {:<6} {:<8} {:>8}  PENULIS",
        "APLIKASI", "BUILD", "STATUS", "DURASI"
    );
    for r in &laporan.runs {
        let penulis = if r.author.is_empty() { "—" } else { &r.author };
        println!(
            "{:<16} {:<6} {:<8} {:>7.1}s  {}",
            r.app,
            format!("#{}", r.number),
            r.status,
            r.duration_ms as f64 / 1000.0,
            penulis
        );
    }
    0
}

#[cfg(test)]
mod tes {
    use super::*;

    fn build(number: u64, result: Option<&str>, timestamp_ms: u64) -> BuildRingkas {
        BuildRingkas {
            number,
            result: result.map(|r| r.to_string()),
            duration_ms: 1000 * number,
            timestamp_ms,
            commit_sha: format!("sha{number}"),
        }
    }

    #[test]
    fn pilih_sha_repo_aplikasi_bukan_checkout_library() {
        let json = r#"{"builds":[{"number":6,"result":"SUCCESS","duration":45244,"timestamp":1793783991779,
            "actions":[
              {"lastBuiltRevision":{"SHA1":"e9ae790be2aeebae5a3b82d434062a1489ce6baa","branch":[{"name":"main"}]}},
              {},{},
              {"lastBuiltRevision":{"SHA1":"2dfd6ef3b42a965dd03c392095a116faf1c8a8c2","branch":[{"name":"refs/remotes/origin/main"}]}}
            ]}]}"#;
        let builds = parse_builds(json).unwrap();
        assert_eq!(
            builds[0].commit_sha,
            "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2"
        );
    }

    #[test]
    fn sha_tanpa_branch_origin_pakai_yang_terakhir() {
        let json = r#"{"builds":[{"number":1,"result":"SUCCESS","duration":1,"timestamp":1,
            "actions":[{"lastBuiltRevision":{"SHA1":"aaa","branch":[{"name":"main"}]}}]}]}"#;
        assert_eq!(parse_builds(json).unwrap()[0].commit_sha, "aaa");
    }

    #[test]
    fn build_tanpa_aksi_tidak_panik() {
        let json = r#"{"builds":[{"number":2,"result":null,"timestamp":5},{"number":3}]}"#;
        let builds = parse_builds(json).unwrap();
        assert_eq!(builds.len(), 2);
        assert_eq!(builds[0].commit_sha, "");
        assert_eq!(builds[0].result, None);
        assert_eq!(builds[1].result, None);
    }

    #[test]
    fn balasan_bukan_json_jadi_error_jelas() {
        assert!(parse_builds("<html>oops</html>").is_err());
    }

    #[test]
    fn result_jenkins_dipetakan_ke_status() {
        assert_eq!(status_dari_result(Some("SUCCESS")), "passed");
        assert_eq!(status_dari_result(Some("FAILURE")), "failed");
        assert_eq!(status_dari_result(Some("ABORTED")), "failed");
        assert_eq!(status_dari_result(None), "running");
    }

    #[test]
    fn bucket_harian_selalu_penuh_dan_urut() {
        // 2026-11-04T09:19:51Z
        let sekarang = 1_793_783_991_779u64;
        let laporan = susun_laporan(
            vec![("tes-web".to_string(), vec![build(6, Some("SUCCESS"), sekarang - 3_600_000)])],
            &HashMap::new(),
            7,
            5,
            sekarang,
        );
        assert_eq!(laporan.daily.len(), 7);
        assert_eq!(laporan.daily[6].date, "2026-11-04");
        assert_eq!(laporan.daily[6].passed, 1);
        assert_eq!(laporan.daily[0].date, "2026-10-29");
        let tanggal: Vec<&str> = laporan.daily.iter().map(|d| d.date.as_str()).collect();
        let mut urut = tanggal.clone();
        urut.sort_unstable();
        assert_eq!(tanggal, urut, "tanggal harus naik");
    }

    #[test]
    fn build_di_luar_jendela_dibuang_tapi_totals_jendela() {
        let sekarang = 1_793_783_991_779u64;
        let sepuluh_hari = 10 * HARI_MS;
        let laporan = susun_laporan(
            vec![(
                "tes-web".to_string(),
                vec![
                    build(1, Some("SUCCESS"), sekarang - sepuluh_hari),
                    build(2, Some("FAILURE"), sekarang - 7_200_000),
                    build(3, Some("SUCCESS"), sekarang - 3_600_000),
                ],
            )],
            &HashMap::new(),
            7,
            1,
            sekarang,
        );
        assert_eq!(laporan.runs.len(), 1, "limit dipotong setelah filter jendela");
        assert_eq!(laporan.runs[0].number, 3);
        assert_eq!(laporan.totals.passed, 1);
        assert_eq!(laporan.totals.failed, 1);
    }

    #[test]
    fn author_hilang_jadi_string_kosong_dan_url_diisi_pemanggil() {
        let sekarang = 1_793_783_991_779u64;
        let laporan = susun_laporan(
            vec![("tes-web".to_string(), vec![build(6, Some("SUCCESS"), sekarang)])],
            &HashMap::new(),
            7,
            5,
            sekarang,
        );
        assert_eq!(laporan.runs[0].author, "");
        assert_eq!(laporan.runs[0].url, "");
        assert!(laporan.runs[0].started_at.ends_with('Z'));
    }

    #[test]
    fn running_masuk_totals_tapi_tidak_ke_grafik_harian() {
        let sekarang = 1_793_783_991_779u64;
        let laporan = susun_laporan(
            vec![("tes-web".to_string(), vec![build(7, None, sekarang)])],
            &HashMap::new(),
            7,
            5,
            sekarang,
        );
        assert_eq!(laporan.runs[0].status, "running");
        assert_eq!(laporan.totals.running, 1);
        assert_eq!(laporan.daily[6].passed, 0);
        assert_eq!(laporan.daily[6].failed, 0);
    }

    #[test]
    fn penulis_dibaca_dari_repo_lokal() {
        let tmp = tempfile::TempDir::new().unwrap();
        for args in [
            ["init", "-q", "-b", "main"].as_slice(),
            ["add", "."].as_slice(),
        ] {
            std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(tmp.path())
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success());
        }
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .args([
                "-c",
                "user.name=Uji",
                "-c",
                "user.email=uji@example.test",
                "commit",
                "-q",
                "-m",
                "c",
            ])
            .output()
            .unwrap();
        assert!(out.status.success());
        let sha = String::from_utf8_lossy(
            &std::process::Command::new("git")
                .arg("-C")
                .arg(tmp.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .trim()
        .to_string();

        assert_eq!(cari_penulis(tmp.path(), &sha), "Uji <uji@example.test>");
        assert_eq!(
            cari_penulis(tmp.path(), "0000000000000000000000000000000000000000"),
            ""
        );
        assert_eq!(cari_penulis(tmp.path(), ""), "");
    }

    #[test]
    fn penulis_tersimpan_menutup_commit_yang_tidak_ada_di_klon_host() {
        let mut penulis: HashMap<String, String> = HashMap::new();
        penulis.insert("lokal".to_string(), "Lokal <lokal@contoh.test>".to_string());

        isi_penulis_tersimpan(
            &mut penulis,
            &[
                (
                    "hilang".to_string(),
                    "maliffadlan <maliffadlan@gmail.com>".to_string(),
                ),
                ("lokal".to_string(), "Palsu <palsu@contoh.test>".to_string()),
            ],
        );

        assert_eq!(
            penulis.get("hilang").map(String::as_str),
            Some("maliffadlan <maliffadlan@gmail.com>")
        );
        assert_eq!(
            penulis.get("lokal").map(String::as_str),
            Some("Lokal <lokal@contoh.test>"),
            "jawaban klon host tidak boleh ditimpa peta rekaman"
        );
    }

    #[test]
    fn penulis_tersimpan_mengisi_yang_kosong_dan_abaikan_yang_tak_lengkap() {
        let mut penulis: HashMap<String, String> = HashMap::new();
        penulis.insert("kosong".to_string(), String::new());

        isi_penulis_tersimpan(
            &mut penulis,
            &[
                (
                    "kosong".to_string(),
                    "maliffadlan <maliffadlan@gmail.com>".to_string(),
                ),
                (String::new(), "tanpa-sha <x@contoh.test>".to_string()),
                ("tanpa-nama".to_string(), "   ".to_string()),
            ],
        );

        assert_eq!(
            penulis.get("kosong").map(String::as_str),
            Some("maliffadlan <maliffadlan@gmail.com>")
        );
        assert!(!penulis.contains_key(""));
        assert!(!penulis.contains_key("tanpa-nama"));
    }
}