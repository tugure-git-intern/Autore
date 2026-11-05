//! `autore sbom` — daftar dependensi dari SBOM CycloneDX hasil build.
//!
//! Dua sumber, dicoba berurutan:
//!   1. `<AUTORE_WORKSPACE>/<app>/dist/sbom.cdx.json` (salinan cepat, kalau ada).
//!   2. Artifact Jenkins `dist/sbom.cdx.json` yang diarsipkan stage 6 di build
//!      sukses terakhir. Ini kanal utamanya untuk dashboard: build berjalan di
//!      runner sendiri, jadi salinan di (1) tidak selalu terlihat oleh proses API.
//!
//! Aturan yang sama dengan `runs.rs`/`status.rs`: yang tidak tersedia jadi string
//! kosong, bukan `null`; berkas hilang bukan panic, tapi pesan yang menyebut
//! jalan keluarnya.

use crate::jenkins;
use crate::serve;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Satu baris tabel SBOM Viewer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Paket {
    pub name: String,
    /// Versi kosong kalau SBOM tidak mencatatnya.
    pub version: String,
    /// `os` untuk OS package, `language` untuk library bahasa/aplikasi.
    #[serde(rename = "type")]
    pub jenis: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaporanSbom {
    pub app: String,
    /// `metadata.timestamp` CycloneDX; kosong kalau SBOM tidak mencatatnya.
    pub generated_at: String,
    pub source: String,
    pub total: usize,
    pub packages: Vec<Paket>,
}

/// Cukup ketat untuk menolak `/`, `..`, spasi, dan NUL — sama seperti `APP_ID` di API.
fn id_sah(app: &str) -> bool {
    !app.is_empty()
        && app.len() <= 64
        && app != "."
        && app != ".."
        && app
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn path_sbom(workspace: &Path, app: &str) -> PathBuf {
    workspace.join(app).join("dist").join("sbom.cdx.json")
}

/// Artifact SBOM satu aplikasi di Jenkins (build sukses terakhir).
fn url_artifact(base: &str, app: &str) -> String {
    format!(
        "{}/job/{app}/lastSuccessfulBuild/artifact/dist/sbom.cdx.json",
        base.trim_end_matches('/')
    )
}

/// Ambil SBOM dari artifact Jenkins. Kredensial ikut lewat stdin curl (tidak
/// pernah muncul di argv), sama seperti `runs`/`deploy`.
fn dari_jenkins(app: &str) -> Result<String, String> {
    let cfg = jenkins::load_config_from(&jenkins::default_config_path()).ok_or_else(|| {
        format!(
            "kredensial Jenkins belum ada di {}",
            jenkins::default_config_path().display()
        )
    })?;
    let url = url_artifact(&cfg.url, app);
    let kredensial = format!("user = \"{}:{}\"\n", cfg.user, cfg.token);
    let (code, body) = jenkins::curl_with_stdin_config(
        &[
            "-g",
            "-sS",
            "--max-time",
            "20",
            "-w",
            "\n__HTTP_CODE__:%{http_code}",
            "--config",
            "-",
            &url,
        ],
        &kredensial,
    )?;
    match code {
        200 if !body.trim().is_empty() => Ok(body),
        200 => Err(format!(
            "artifact SBOM `{app}` kosong di Jenkins ({url})"
        )),
        404 => Err(format!(
            "Jenkins belum mengarsipkan SBOM `{app}` (404: {url}) — jalankan build sukses berikutnya"
        )),
        lain => Err(format!("Jenkins menolak permintaan SBOM `{app}`: HTTP {lain}")),
    }
}

fn jenis_paket(jenis_cyclonedx: &str) -> &'static str {
    if jenis_cyclonedx == "operating-system" {
        "os"
    } else {
        "language"
    }
}

/// CycloneDX mengizinkan komponen bersarang; Trivy menaruh OS package dan library
/// bahasa di level atas, tapi satu level turun ini murah dan mencegah tabel kosong
/// pada SBOM yang disusun alat lain.
fn kumpulkan(komponen: &[Value], keluar: &mut Vec<Paket>) {
    for c in komponen {
        let nama = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if !nama.is_empty() {
            keluar.push(Paket {
                name: nama.to_string(),
                version: c
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                jenis: jenis_paket(c.get("type").and_then(|v| v.as_str()).unwrap_or("")).to_string(),
            });
        }
        if let Some(anak) = c.get("components").and_then(|v| v.as_array()) {
            kumpulkan(anak, keluar);
        }
    }
}

fn susun(app: &str, isi: &str, asal: &str) -> Result<LaporanSbom, String> {
    let dokumen: Value = serde_json::from_str(isi).map_err(|e| {
        format!("bukan SBOM CycloneDX: {asal} bukan JSON sah: {e}")
    })?;
    let komponen = dokumen
        .get("components")
        .and_then(|c| c.as_array())
        .ok_or_else(|| format!("{asal} bukan SBOM CycloneDX: tidak ada daftar \"components\""))?;

    let mut packages = Vec::new();
    kumpulkan(komponen, &mut packages);
    packages.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.name.cmp(&b.name))
            .then(a.version.cmp(&b.version))
            .then(a.jenis.cmp(&b.jenis))
    });
    packages.dedup();

    Ok(LaporanSbom {
        app: app.to_string(),
        generated_at: dokumen
            .pointer("/metadata/timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        source: asal.to_string(),
        total: packages.len(),
        packages,
    })
}

fn baca(app: &str) -> Result<LaporanSbom, String> {
    let path = path_sbom(&serve::workspace_dir(), app);
    match std::fs::read_to_string(&path) {
        Ok(isi) => susun(app, &isi, &path.display().to_string()),
        Err(lokal) => {
            let isi = dari_jenkins(app).map_err(|jenkins| {
                format!(
                    "SBOM belum ada untuk `{app}`.\n  salinan lokal: {} ({lokal})\n  artifact Jenkins: {jenkins}\n\
                     Jalankan build aplikasinya sampai stage 6 selesai, lalu coba lagi.",
                    path.display()
                )
            })?;
            susun(app, &isi, &format!("jenkins:{app}/lastSuccessfulBuild"))
        }
    }
}

/// `0` sukses, `1` gagal. Satu-satunya penulis stdout adalah jalur sukses, jadi
/// pemanggil (API) tidak pernah mem-parse JSON palsu.
pub fn jalankan(app: &str, json: bool) -> i32 {
    if !id_sah(app) {
        eprintln!(
            "ERROR: id aplikasi tidak sah: `{app}` (huruf, angka, titik, garis bawah, minus; maksimal 64)"
        );
        return 1;
    }

    let laporan = match baca(app) {
        Ok(l) => l,
        Err(pesan) => {
            eprintln!("ERROR: {pesan}");
            return 1;
        }
    };

    if json {
        match serde_json::to_string(&laporan) {
            Ok(teks) => println!("{teks}"),
            Err(e) => {
                eprintln!("ERROR: gagal menyusun JSON: {e}");
                return 1;
            }
        }
        return 0;
    }

    println!(
        "\n{} — {} paket (SBOM: {})\n",
        laporan.app, laporan.total, laporan.generated_at
    );
    for p in &laporan.packages {
        let versi = if p.version.is_empty() { "-" } else { &p.version };
        println!("  {:<44} {:<20} {}", p.name, versi, p.jenis);
    }
    println!();
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_aplikasi_yang_bisa_kabur_ditolak() {
        for jahat in ["", ".", "..", "../rahasia", "a/b", "te s", "x\0"] {
            assert!(!id_sah(jahat), "`{jahat}` harus ditolak");
        }
        for sah in ["tes-web", "app_1", "aplikasi.baru", &"x".repeat(64)] {
            assert!(id_sah(sah), "`{sah}` harus diterima");
        }
        assert!(!id_sah(&"x".repeat(65)));
    }

    #[test]
    fn jenis_cyclonedx_dipetakan_ke_dua_kategori_dashboard() {
        assert_eq!(jenis_paket("operating-system"), "os");
        assert_eq!(jenis_paket("library"), "language");
        assert_eq!(jenis_paket(""), "language");
    }

    #[test]
    fn url_artifact_menunjuk_build_sukses_terakhir() {
        assert_eq!(
            url_artifact("http://100.80.3.14:8080/", "tes-web"),
            "http://100.80.3.14:8080/job/tes-web/lastSuccessfulBuild/artifact/dist/sbom.cdx.json"
        );
    }

    #[test]
    fn sbom_dari_jenkins_memakai_nama_sumber_artifact() {
        let isi = r#"{"components":[{"type":"operating-system","name":"openssl","version":"3.0.11"}]}"#;
        let laporan = susun("tes-web", isi, "jenkins:tes-web/lastSuccessfulBuild").unwrap();

        assert_eq!(laporan.source, "jenkins:tes-web/lastSuccessfulBuild");
        assert_eq!(laporan.total, 1);
        assert_eq!(laporan.packages[0].name, "openssl");
        assert_eq!(laporan.packages[0].jenis, "os");
    }
}
