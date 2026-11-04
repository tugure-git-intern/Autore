# Autore `pipeline record` (Opsi A) Implementation Plan

> **For agentic workers:** kerjakan task berurutan; tiap task punya siklus RED→GREEN sendiri. Semua langkah pakai checkbox `- [ ]`.

**Goal:** Jenkins menulis kemajuan pipeline ke `dashboard-status.json` lewat satu perintah CLI baru (`autore pipeline record`), sehingga `/pipeline` di dashboard berubah `idle → running → passed/failed` dari data asli.

**Architecture:** Logika tulis tetap di Rust (satu penulis kontrak: `cli/src/status.rs`). CLI dapat subcommand tipis `autore pipeline record` yang meng-*merge* satu peristiwa (tahap/status/log) ke simpanan lewat `status::save` yang sudah atomik (tmp + rename). Trusted Shared Library `vars/autorePipeline.groovy` memanggil perintah itu di tiap tahap dan di `post`. Web, API Hono, dan kontrak JSON tidak berubah sama sekali.

**Tech Stack:** Rust 1.x (clap 4, serde_json, tempfile untuk test), Groovy (Jenkins Trusted Shared Library), bash, systemd user unit.

**Spec:** `docs/plans/2026-11-04-autore-live-status.md` (Task 1–6) — plan ini melanjutkan bagian "Known contract mismatch" dan "Per-application pipeline truth is unavailable".

## Global Constraints

- Satu penulis kontrak: `cli/src/status.rs`. Jangan bikin penulis kedua di TypeScript/Groovy.
- Tidak ada dependency baru. `tempfile` sudah ada di `[dev-dependencies]`.
- Binary yang dipanggil Jenkins: `/usr/local/bin/autore` (root-owned, `-rwxr-xr-x`). Repo **tidak** boleh menyuplai script gate; `autore` yang dipasang admin.
- User Jenkins agent: `jenkins` (uid 996, grup `jenkins,docker`). `/home/tugure` = `0750 tugure:tugure`, `/home/tugure/autore-workspace` = `0775 tugure:tugure` → `jenkins` belum bisa menembus `/home/tugure`. Wajib dibuka dulu (Task 0).
- Nama tahap kanonik yang dibaca dashboard: `checkout`, `scan`, `build`, `pasang`, `periksa` (`web/apps/dashboard/src/components/pipeline/stage-timeline.tsx`).
- Simpanan: `dashboard-status.json` di `AUTORE_WORKSPACE`, maks 500 baris log / 64 KiB — dipangkas `status::save`.
- Commit message Bahasa Indonesia, gaya repo (`fix(cli): …`, `feat(cli): …`).
- Jangan sentuh `cli/src/serve.rs` selain tanda tangan `status::save` (satu call-site).

## Review Focus

Kelas input/kegagalan yang spec tidak sebut, tapi paling mungkin menggigit pemakai:

1. Nilai ber-spasi/tanda kutip (`AUDIT_AUTHOR` = `tugure-git-intern <tugure.gitintern@tugu-re.com>`, pesan commit ber-apostrof) → command harus tetap satu argumen di shell.
2. Log panjang / banyak baris → file tidak boleh melewati 64 KiB dan 500 baris (pemangkasan harus jalan, bukan error).
3. Workspace tidak bisa ditulis (permission belum dibuka) → perintah keluar non-nol dengan pesan jelas; tidak boleh meninggalkan `dashboard-status.json.tmp`.
4. Build berikutnya menulis tahap baru → daftar tahap build lama tidak boleh tercampur (butuh `--reset`).
5. Gangguan tulis dashboard tidak boleh menggagalkan pipeline keamanan → panggilan di Groovy best-effort + peringatan keras; hanya preflight (binary lama) yang mem-fail-kan build.

Masing-masing sudah punya test/step di task di bawah.

---

### Task 0: Buka akses workspace untuk user `jenkins` (dijalankan user, butuh sudo)

**Files:** tidak ada perubahan kode.

**Interfaces:**
- Menghasilkan: user `jenkins` bisa menulis `/home/tugure/autore-workspace`; binary baru terpasang di `/usr/local/bin/autore`.

- [ ] **Step 1: Jalankan tiga perintah ini di VPS (kamu yang mengetik, butuh password sudo)**

```bash
sudo usermod -aG tugure jenkins                       # grup tugure sudah punya rwx di autore-workspace
sudo systemctl restart jenkins-agent                  # agent harus restart supaya grup baru terbaca
sudo install -m 0755 ~/Autore/cli/target/release/autore /usr/local/bin/autore
```

- [ ] **Step 2: Verifikasi**

```bash
sudo -u jenkins test -w /home/tugure/autore-workspace && echo WRITABLE
/usr/local/bin/autore --version
```

Expected: `WRITABLE`, lalu versi binary baru (`autore 0.5.6`, naik jadi `0.5.7` setelah Task 5).

Catatan: `usermod` memberi `jenkins` hak baca grup atas seluruh `/home/tugure` (0750 → grup `r-x`). Alternatif lebih sempit kalau kamu tidak mau itu: pasang `apt install acl`, lalu
`sudo setfacl -m u:jenkins:x /home/tugure && sudo setfacl -m u:jenkins:rwx /home/tugure/autore-workspace`.

- [ ] **Step 3: Commit** — tidak ada perubahan; lanjut.

---

### Task 1: Semantik merge `Rekaman` (inti, murni, tanpa filesystem)

**Files:**
- Create: `cli/src/pipeline_record.rs`
- Modify: `cli/src/main.rs` (hanya `mod pipeline_record;` di daftar modul)
- Test: `cli/src/pipeline_record.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `crate::status::{Snapshot, Pipeline}`.
- Produces:
  - `pub struct Rekaman { stage: Vec<String>, status: Option<String>, commit: Option<String>, author: Option<String>, summary: Option<String>, message: Option<String>, log: Vec<String>, reset: bool, json: bool }` (derive `clap::Args`).
  - `pub fn terapkan(snap: &mut Snapshot, rekaman: &Rekaman)`.

Aturan yang harus dipegang `terapkan` (inilah kontraknya):
- `reset` → `stages`, `raw_log`, `failure_reason`, `security_summary` dikosongkan lebih dulu.
- `status` → ditulis ke `system_status` **dan** `latest_pipeline.status`. Kalau nilainya bukan `failed`, `failure_reason` dikosongkan.
- `message` → `failure_reason`.
- `stage` → append ke `stages`, tapi lewati yang sudah ada (dedupe, urutan sesuai kiriman).
- `commit` / `author` / `summary` → ditulis hanya kalau diisi.
- `log` → append ke `raw_log` (pemangkasan tetap urusan `status::save`).
- Field yang tidak diisi tidak boleh berubah nilainya.

- [ ] **Step 1: Tulis test yang gagal**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::Snapshot;

    fn rekaman() -> Rekaman {
        Rekaman { stage: vec![], status: None, commit: None, author: None, summary: None,
                  message: None, log: vec![], reset: false, json: false }
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
        snap.latest_pipeline.stages = vec!["checkout".into(), "scan".into()];
        snap.latest_pipeline.raw_log = vec!["lama".into()];
        snap.latest_pipeline.failure_reason = "gagal lama".into();
        terapkan(&mut snap, &Rekaman { reset: true, ..rekaman() });
        assert!(snap.latest_pipeline.stages.is_empty());
        assert!(snap.latest_pipeline.raw_log.is_empty());
        assert!(snap.latest_pipeline.failure_reason.is_empty());
    }

    #[test]
    fn tahap_ganda_tidak_ditulis_dua_kali() {
        let mut snap = Snapshot::default();
        terapkan(&mut snap, &Rekaman { stage: vec!["checkout".into()], ..rekaman() });
        terapkan(&mut snap, &Rekaman { stage: vec!["checkout".into(), "scan".into()], ..rekaman() });
        assert_eq!(snap.latest_pipeline.stages, vec!["checkout", "scan"]);
    }

    #[test]
    fn status_running_menghapus_alasan_gagal_dan_menyalin_ke_system_status() {
        let mut snap = Snapshot::default();
        snap.latest_pipeline.failure_reason = "gagal lama".into();
        terapkan(&mut snap, &Rekaman { status: Some("running".into()), ..rekaman() });
        assert_eq!(snap.latest_pipeline.status, "running");
        assert_eq!(snap.system_status, "running");
        assert!(snap.latest_pipeline.failure_reason.is_empty());
    }

    #[test]
    fn pesan_gagal_masuk_failure_reason() {
        let mut snap = Snapshot::default();
        terapkan(&mut snap, &Rekaman {
            status: Some("failed".into()),
            message: Some("Gagal di tahap: 5. Build".into()),
            ..rekaman()
        });
        assert_eq!(snap.latest_pipeline.status, "failed");
        assert_eq!(snap.latest_pipeline.failure_reason, "Gagal di tahap: 5. Build");
    }

    #[test]
    fn log_dan_metadata_ditulis_apa_adanya() {
        let mut snap = Snapshot::default();
        terapkan(&mut snap, &Rekaman {
            commit: Some("0770f21".into()),
            author: Some("tugure-git-intern <tugure.gitintern@tugu-re.com>".into()),
            summary: Some("9/9 gerbang lolos · digest sha256:138de1085b65".into()),
            log: vec!["[checkout] ambil source".into(), "".into()],
            ..rekaman()
        });
        assert_eq!(snap.latest_pipeline.commit_sha, "0770f21");
        assert!(snap.latest_pipeline.author.contains('<'));
        assert!(snap.latest_pipeline.security_summary.contains("digest"));
        assert_eq!(snap.latest_pipeline.raw_log.len(), 2);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path cli/Cargo.toml pipeline_record`
Expected: FAIL kompilasi (`cannot find function terapkan` / `struct Rekaman`).

- [ ] **Step 3: Implementasi `terapkan` + struct `Rekaman` di `cli/src/pipeline_record.rs`**

`Rekaman` pakai `#[derive(clap::Args)]` dengan flag: `--stage` (bisa diulang, `Vec<String>`), `--status` (`Option<String>`, `value_parser = ["idle","running","passed","failed"]`), `--commit`, `--author`, `--summary`, `--message`, `--log` (bisa diulang, `long = "log"`), `--reset` (`bool`), `--json` (`bool`). Body `terapkan` mengikuti aturan di Interfaces.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cargo test --manifest-path cli/Cargo.toml pipeline_record`
Expected: PASS 6 test.

- [ ] **Step 5: Commit**

```bash
git add cli/src/pipeline_record.rs cli/src/main.rs
git commit -m "feat(cli): semantik merge rekaman pipeline"
```

---

### Task 2: Subcommand `autore pipeline record` + tulis simpanan (RED dulu, kontrak perilaku)

**Files:**
- Modify: `cli/src/pipeline_record.rs` (tambah `jalankan`), `cli/src/main.rs` (enum `PipelineAksi`, variabel `Commands::Pipeline`, dispatch), `cli/src/status.rs` (`save` mengembalikan `Result`), `cli/src/serve.rs:465` (menyesuaikan pemanggilan)
- Test: `cli/src/main.rs` (test parse) + `cli/src/pipeline_record.rs` (test integrasi lewat `AUTORE_WORKSPACE`)

**Interfaces:**
- Consumes: `pipeline_record::{Rekaman, terapkan}`, `status::{load, save, build, canonical}`, `serve::workspace_dir()`.
- Produces:
  - `status::save(workspace: &Path, snapshot: &Snapshot) -> Result<(), String>` (sebelumnya `()`; hanya mencetak pesan errornya? tidak — pemanggil yang mencetak).
  - `pub fn jalankan(rekaman: &Rekaman) -> i32` — exit code: `0` sukses, `1` kalau simpanan tidak bisa ditulis/diverifikasi.
  - `Commands::Pipeline { aksi: PipelineAksi }`, `enum PipelineAksi { Record(Rekaman) }`.

Perilaku `jalankan`:
1. `let ws = serve::workspace_dir();`
2. `let mut snap = status::load(&ws); terapkan(&mut snap, rekaman);`
3. `save(&ws, &snap)` → kalau `Err`, cetak ke stderr, balik `1`.
4. Verifikasi tulis: `status::load(&ws)` harus memuat status dan seluruh `stage` yang dikirim. Kalau tidak, stderr + `1`. (Ini yang menangkap kasus permission/disk diam-diam.)
5. Kalau `rekaman.json`, cetak `status::canonical(&status::build(&ws))`; kalau tidak, cetak satu baris ringkas ke stdout: `pipeline direkam: <status>, <n> tahap`.

- [ ] **Step 1: Tulis test yang gagal**

Di `cli/src/main.rs` (pola sama dengan `status_mendukung_flag_json_lewat_cli`):

```rust
#[test]
fn pipeline_record_terdaftar_di_cli() {
    use clap::CommandFactory;
    let mut rec = Cli::command()
        .get_subcommands()
        .find(|c| c.get_name() == "pipeline")
        .expect("subcommand pipeline ada")
        .clone()
        .get_subcommands()
        .find(|c| c.get_name() == "record")
        .expect("subcommand record ada")
        .clone();
    let bantuan = rec.render_long_help().to_string();
    for flag in ["--stage", "--status", "--commit", "--author", "--log", "--reset", "--json"] {
        assert!(bantuan.contains(flag), "{flag} hilang: {bantuan}");
    }
}
```

Di `cli/src/pipeline_record.rs` (integrasi, memakai binary hasil build):

```rust
#[test]
fn cli_record_menulis_simpanan_dan_mengembalikan_nol() {
    let tmp = tempfile::TempDir::new().unwrap();
    let bin = env!("CARGO_BIN_EXE_autore");
    let keluaran = std::process::Command::new(bin)
        .args(["pipeline", "record", "--reset", "--status", "running", "--stage", "checkout",
               "--commit", "0770f21", "--author", "tugure-git-intern <tugure.gitintern@tugu-re.com>",
               "--log", "[checkout] ambil source"])
        .env("AUTORE_WORKSPACE", tmp.path())
        .output()
        .unwrap();
    assert_eq!(keluaran.status.code(), Some(0), "stderr: {}", String::from_utf8_lossy(&keluaran.stderr));
    let snap = status::load(tmp.path());
    assert_eq!(snap.latest_pipeline.status, "running");
    assert_eq!(snap.latest_pipeline.stages, vec!["checkout"]);
    assert_eq!(snap.latest_pipeline.commit_sha, "0770f21");
    assert_eq!(snap.latest_pipeline.author, "tugure-git-intern <tugure.gitintern@tugu-re.com>");
    assert_eq!(snap.latest_pipeline.raw_log, vec!["[checkout] ambil source"]);
}

#[test]
fn record_keluar_non_nol_dan_tidak_menyisakan_tmp_kalau_workspace_tidak_ada() {
    let tmp = tempfile::TempDir::new().unwrap();
    let hilang = tmp.path().join("tidak-ada");
    let keluaran = std::process::Command::new(env!("CARGO_BIN_EXE_autore"))
        .args(["pipeline", "record", "--status", "running"])
        .env("AUTORE_WORKSPACE", &hilang)
        .output()
        .unwrap();
    assert_eq!(keluaran.status.code(), Some(1));
    assert!(!String::from_utf8_lossy(&keluaran.stderr).is_empty());
    assert!(!hilang.exists());
}

#[test]
fn log_panjang_dipangkas_bukan_error() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_autore"));
    cmd.args(["pipeline", "record", "--reset", "--status", "running", "--stage", "build"]);
    for i in 0..600 { cmd.args(["--log", &format!("baris {i} {}", "x".repeat(80))]); }
    let keluaran = cmd.env("AUTORE_WORKSPACE", tmp.path()).output().unwrap();
    assert_eq!(keluaran.status.code(), Some(0));
    let snap = status::load(tmp.path());
    assert!(snap.latest_pipeline.raw_log.len() <= crate::status::MAX_LOG_LINES);
    let isi = std::fs::read_to_string(tmp.path().join(crate::status::SNAPSHOT_FILE)).unwrap();
    assert!(isi.len() <= crate::status::MAX_SNAPSHOT_BYTES);
    assert!(!tmp.path().join(format!("{}.tmp", crate::status::SNAPSHOT_FILE)).exists());
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cargo test --manifest-path cli/Cargo.toml record`
Expected: FAIL — subcommand `pipeline` belum ada.

- [ ] **Step 3: Implementasi**

- `status.rs`: ubah `pub fn save(...)` menjadi `pub fn save(...) -> Result<(), String>`; hapus `eprintln!` di dalamnya, kembalikan `Err(format!("simpanan status tidak tersimpan: {e}"))`.
- `serve.rs:465`: `if let Err(e) = crate::status::save(&self.workspace, &snap) { eprintln!("WARNING: {e}"); }`.
- `main.rs`: `mod pipeline_record;`, tambah `/// Catat kemajuan pipeline (dipakai Jenkins)` variant `Pipeline { #[command(subcommand)] aksi: PipelineAksi }`, enum `PipelineAksi { Record(pipeline_record::Rekaman) }`, dan dispatch `Commands::Pipeline { aksi: PipelineAksi::Record(r) } => pipeline_record::jalankan(&r)`.
- `pipeline_record.rs`: `jalankan` sesuai perilaku di atas.

- [ ] **Step 4: Jalankan, pastikan lulus + tidak ada regresi**

Run: `cargo test --manifest-path cli/Cargo.toml && cargo clippy --manifest-path cli/Cargo.toml --all-targets -- -D warnings`
Expected: seluruh test hijau (166 + 9 baru), clippy exit 0.

- [ ] **Step 5: Commit**

```bash
git add cli/src/pipeline_record.rs cli/src/main.rs cli/src/status.rs cli/src/serve.rs
git commit -m "feat(cli): perintah 'autore pipeline record'"
```

---

### Task 3: Groovy memanggil `pipeline record` di tiap tahap

**Files:**
- Modify: `vars/autorePipeline.groovy`

**Interfaces:**
- Consumes: `/usr/local/bin/autore pipeline record` (Task 2), `AUTORE_WORKSPACE=/home/tugure/autore-workspace`.
- Produces: simpanan yang berubah `idle → running → passed/failed` selama build.

- [ ] **Step 1: Tambah helper + pemetaan tahap (setelah blok `def nexusRegistry = ...`)**

```groovy
    def workspace = config.workspace ?: '/home/tugure/autore-workspace'
    def autoreBin = config.autoreBin ?: '/usr/local/bin/autore'

    // Kutip satu argumen shell dengan aman (author/pesan commit bisa berisi spasi, <, ', dll).
    def q = { String v -> "'" + (v ?: '').replace("'", "'\\''") + "'" }

    // Best-effort: gagal tulis dashboard TIDAK boleh menggagalkan pipeline keamanan.
    def record = { Map m ->
        def parts = ["AUTORE_WORKSPACE=${q(workspace)}", autoreBin, 'pipeline', 'record', '--status', m.status]
        if (m.reset) { parts << '--reset' }
        (m.stages ?: []).each { parts += ['--stage', it] }
        if (m.commit) { parts += ['--commit', q(m.commit)] }
        if (m.author) { parts += ['--author', q(m.author)] }
        if (m.summary) { parts += ['--summary', q(m.summary)] }
        if (m.message) { parts += ['--message', q(m.message)] }
        (m.logs ?: []).each { parts += ['--log', q(it)] }
        def cmd = parts.join(' ')
        def code = sh(script: cmd, returnStatus: true)
        if (code != 0) { echo "WARNING: dashboard record gagal (exit ${code}): ${cmd}" }
    }
```

- [ ] **Step 2: Preflight di stage 1 (di dalem blok `script` yang memeriksa `trusted`)**

Tambahkan sebelum `def commit = ...`:

```groovy
                        def okRecord = sh(script: "${autoreBin} pipeline record --help >/dev/null 2>&1",
                                          returnStatus: true)
                        if (okRecord != 0) {
                            error("${autoreBin} belum punya 'pipeline record'. Pasang binary baru: sudo install -m 0755 ~/Autore/cli/target/release/autore ${autoreBin}")
                        }
```

Hanya preflight ini yang boleh mem-fail-kan build (binary lama = kegagalan konfigurasi, bukan gangguan dashboard).

- [ ] **Step 3: Panggilan per tahap**

- Akhir stage 1 (setelah `echo "Target Image Tag: ..."`):

```groovy
                    record(status: 'running', reset: true, stages: ['checkout'],
                           commit: env.FULL_GIT_COMMIT, author: env.AUDIT_AUTHOR,
                           logs: ["[checkout] ${env.SHORT_SHA} ${env.AUDIT_MESSAGE}".toString()])
```

- Akhir stage 2 (`Autore Static Guard & Gitleaks`): `record(status: 'running', stages: ['scan'], logs: ['[scan] static guard + gitleaks lulus'])`
- Akhir stage 5 (`Build Image & Static musl Binary`): `record(status: 'running', stages: ['build'], logs: ["[build] image ${env.IMMUTABLE_IMAGE_TAG}".toString()])`
- Akhir stage 8 (`Push to Nexus & Verify Remote Digest`): `record(status: 'running', stages: ['pasang'], logs: ["[push] nexus ${env.NEXUS_DOCKER_REGISTRY}".toString()])`
- Akhir stage 9 (`Deploy by Verified Digest`): ambil digest lalu rekam `periksa`:

```groovy
                    script {
                        def digest = sh(script: 'cat .verified-image-digest', returnStdout: true).trim()
                        record(status: 'running', stages: ['periksa'], logs: ["[deploy] digest ${digest}".toString()])
                    }
```

- [ ] **Step 4: `post { always { ... } }` — hasil akhir**

Sebelum blok `withCredentials` Telegram, tambahkan:

```groovy
                def sukses = currentBuild.currentResult == 'SUCCESS'
                def digest = sh(script: 'cat .verified-image-digest 2>/dev/null || true', returnStdout: true).trim()
                if (sukses) {
                    record(status: 'passed',
                           summary: "9/9 gerbang lolos · digest ${digest}",
                           logs: ["[done] build #${env.BUILD_NUMBER} SUCCESS".toString()])
                } else {
                    record(status: 'failed',
                           message: "Gagal di tahap: ${env.FAILED_STAGE ?: 'tidak diketahui'}",
                           logs: ["[done] build #${env.BUILD_NUMBER} ${currentBuild.currentResult}".toString()])
                }
```

Expected setelah ini: `/pipeline` menampilkan 5 tahap terisi + panel log + ringkasan digest.

- [ ] **Step 5: Cek sintaks Groovy tanpa menjalankan pipeline**

Run: `groovy -e 'new GroovyShell().parse(new File("vars/autorePipeline.groovy")); println "syntax ok"' || echo "groovy tidak ada — validasi lewat build #129 di Task 5"`
Expected: `syntax ok` (atau dilewati kalau `groovy` tidak terpasang — verifikasi sebenarnya di Task 5).

- [ ] **Step 6: Commit**

```bash
git add vars/autorePipeline.groovy
git commit -m "feat(ci): laporkan tahap pipeline ke dashboard lewat autore pipeline record"
```

Catatan: Trusted Shared Library diambil Jenkins dari repo ini (`@Library('autore')`), jadi commit di `main` + push sudah cukup; tidak ada salinan terpisah yang perlu di-`sudo install`.

---

### Task 4: Dokumentasi

**Files:**
- Modify: `web/README.md` (bagian `Live status contract check`)

**Interfaces:** tidak ada runtime baru; menjelaskan siapa yang menulis simpanan.

- [ ] **Step 1: Tambah paragraf + perintah**

Isi yang harus ada:
- Dua penulis: `autore serve` (alur Deploy di UI lama) dan `autore pipeline record` (dipanggil Jenkins).
- Satu berkas: `$AUTORE_WORKSPACE/dashboard-status.json`, ditulis atomik (tmp+rename).
- Prasyarat permission: user `jenkins` harus bisa menulis workspace (`sudo usermod -aG tugure jenkins` + restart agent), kalau tidak, build tetap sukses tapi dashboard tetap `idle` dan Jenkins cuma mencetak `WARNING: dashboard record gagal (exit 1)`.
- Contoh perintah manual:

```bash
AUTORE_WORKSPACE="$HOME/autore-workspace" /usr/local/bin/autore pipeline record \
  --reset --status running --stage checkout --commit 0770f21 --author "uji manual" \
  --log "[checkout] uji manual"
AUTORE_WORKSPACE="$HOME/autore-workspace" /usr/local/bin/autore status --json | python3 -m json.tool
```

- [ ] **Step 2: Jalankan perintah di atas apa adanya, pastikan output sesuai**

Expected: perintah pertama mencetak `pipeline direkam: running, 1 tahap`; `status --json` memuat `"status":"running"` dan `"stages":["checkout"]`.

- [ ] **Step 3: Commit**

```bash
git add web/README.md
git commit -m "docs(web): jelaskan siapa yang menulis dashboard-status.json"
```

---

### Task 5: Deploy + verifikasi live lewat build baru

**Files:** tidak ada perubahan kode bila verifikasi hijau.

- [ ] **Step 1: Build + pasang binary (user, sudo)**

```bash
cd ~/Autore
PATH="$HOME/.cargo/bin:$PATH" cargo build --release --manifest-path cli/Cargo.toml
sudo install -m 0755 cli/target/release/autore /usr/local/bin/autore
git push origin main
/usr/local/bin/autore pipeline record --help | head -3
```

Expected: header bantuan subcommand `record` muncul (bukti binary baru terpasang), push sukses.

- [ ] **Step 2: Trigger build manual (bukti jalur POST)**

```bash
set -a; . ~/.config/autore/jenkins.conf; set +a
crumb=$(curl -fsS -u "$user:$token" "$url/crumbIssuer/api/json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["crumb"])')
curl -fsS -X POST -u "$user:$token" -H "Jenkins-Crumb: $crumb" \
  "$url/job/autore-e2e/build" -o /dev/null -w "trigger=%{http_code}\n"
```

Expected: `trigger=201`.

- [ ] **Step 3: Tangkap transisi `idle → running`**

```bash
for i in $(seq 1 30); do
  sleep 10
  curl -fsS http://127.0.0.1:9121/api/status | python3 -c '
import json,sys
p=json.load(sys.stdin)["data"]["latest_pipeline"]
print(p["status"], p["stages"])
'
done
```

Expected (kapan pun selama build): minimal satu baris dengan `running` dan `stages` tumbuh `["checkout"] → ["checkout","scan"] → … → ["checkout","scan","build","pasang","periksa"]`.

- [ ] **Step 4: Verifikasi hasil akhir**

```bash
curl -fsS http://127.0.0.1:9121/api/status | python3 -c '
import json,sys
p=json.load(sys.stdin)
lp=p["data"]["latest_pipeline"]
assert p["stale"] is False
assert lp["status"] == "passed", lp["status"]
assert lp["stages"] == ["checkout","scan","build","pasang","periksa"], lp["stages"]
assert lp["commit_sha"] and lp["author"], lp
assert lp["security_summary"], lp
assert len(lp["raw_log"]) >= 5, lp["raw_log"]
print("snapshot OK:", lp["status"], lp["stages"], len(lp["raw_log"]), "baris log")
'
curl -fsS http://127.0.0.1:9120/api/status | python3 -c 'import json,sys;print("via dashboard:", json.load(sys.stdin)["data"]["latest_pipeline"]["status"])'
curl -sS -o /dev/null -w "pipeline_page=%{http_code}\n" "http://127.0.0.1:9120/pipeline?app=tes-web"
```

Expected: `snapshot OK: passed [...] 6 baris log`, `via dashboard: passed`, `pipeline_page=200`.

Catatan penting: URL `/pipeline` **wajib** memakai `?app=` yang ada di `registry.tsv` (`tes-web`, `ui-demo`, …). `autore-dummy` tidak ada di registry, jadi membuka `?app=autore-dummy` menampilkan kartu "tidak ditemukan" — data pipeline global tetap tidak muncul. Lihat Open Question 1.

- [ ] **Step 5: Cek jalur gagal (sekali, murah)**

```bash
AUTORE_WORKSPACE=/tmp/ws-uji-$(date +%s) /usr/local/bin/autore pipeline record --status running; echo "exit=$?"
```

Expected: `exit=1` + pesan jelas di stderr (bukan panic, bukan sukses palsu).

- [ ] **Step 6: Commit (kalau Step 1–5 memaksa perubahan kode)**

```bash
git add -A && git commit -m "fix(ci): <apa yang diperbaiki>"
```

## Tests / validation matrix

| Layer | RED proof | GREEN command |
| --- | --- | --- |
| Semantik merge | 6 test `pipeline_record` gagal kompilasi | `cargo test --manifest-path cli/Cargo.toml pipeline_record` |
| Kontrak CLI | test parse `pipeline record` gagal | `cargo test --manifest-path cli/Cargo.toml pipeline_record_terdaftar_di_cli` |
| Tulis + pangkas | test `cli_record_*` gagal (binary belum ada subcommand) | `cargo test --manifest-path cli/Cargo.toml record` |
| Regresi Rust | N/A | `cargo test --manifest-path cli/Cargo.toml && cargo clippy --manifest-path cli/Cargo.toml --all-targets -- -D warnings` |
| Groovy → simpanan | build #129 tanpa record = `idle` (kondisi sekarang) | Task 5 Step 3–4 |
| Jalur gagal (permission) | Task 5 Step 5 | `exit=1` |

## Risks, tradeoffs, open questions

1. **`/pipeline` tanpa `?app=` tidak menampilkan apa pun.** Halaman sekarang menolak render kalau `app` kosong/tidak ada di registry, padahal `latest_pipeline` global. Selama Jenkins membangun app yang tidak terdaftar (`autore-dummy`), satu-satunya cara melihat data adalah membuka `?app=tes-web` — membingungkan. Kandidat Phase 2: render timeline global saat `app` kosong, dan/atau daftarkan app yang dibangun Jenkins ke `registry.tsv`.
2. **`security_issues` tetap 0 dan status aplikasi tetap `unknown`.** `build()` hanya memuat aplikasi dari `registry.tsv`; `--app` sengaja tidak ada di plan ini supaya tidak ada argumen yang tidak kelihatan efeknya.
3. **Grup `tugure` memberi `jenkins` akses baca grup ke seluruh `/home/tugure`.** Alternatif ACL lebih sempit ada di Task 0 Step 2.
4. **Dua penulis** (`autore serve` sebagai `tugure`, Jenkins sebagai `jenkins`) bisa saling menimpa; `tmp + rename` menjaga berkas tidak pernah setengah jadi, tapi yang terakhir menang. Kalau Phase 2 menambah riwayat build, pindahkan ke penyimpanan ber-lock.
5. **Post-stage gagal (`FAILED_STAGE` kosong)** → `failure_reason` = "Gagal di tahap: tidak diketahui"; cukup jujur, tidak menebak.
6. **Kloning `raw_log` bukan console penuh.** Panel log dashboard hanya ringkasan 5–6 baris; console penuh tetap di Jenkins. Kalau nanti perlu log utuh, tambahkan `--log-file` yang membaca tail berkas, jangan kirim console via argumen.
