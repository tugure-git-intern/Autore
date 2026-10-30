# Trivy (Source + Image), SonarQube Quality Gate, & Nexus Repository Integration Plan (Revisi v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengintegrasikan pemindaian Trivy 2-tahap (`HIGH,CRITICAL` pada source/config sebelum build dan pada final image sesudah build), analisis `cargo clippy` + SAST & Quality Gate SonarQube (`sonarqube:26.10.0.133078-community@sha256:aa0d41212704d1ed35f7ae3b49886b39f639590baf8020cdb191c2a2eb8f9eae` sebagai *pinned PoC version* dengan mitigasi resmi eMudhra CA), serta penyimpanan (`Disable redeploy`) dan deployment artifact/image berbasis `@sha256:<digest>` melalui Nexus Repository OSS (`sonatype/nexus3:3.96.5-alpine@sha256:d70482a3d5d44c8733fb244742fef5ca8ac967da56ccb97398f807bb8d3e585e`) secara *fail-closed*.

**Architecture:**
- **Rust CLI (`autore`)** tetap deterministik dan tidak bergantung pada server eksternal: `autore scan --no-docker` untuk scan ringan lokal (*non-authoritative*), `autore scan` untuk full scan CI pre-build (Static Byte Guard + Gitleaks + Trivy FS/Config `HIGH,CRITICAL`), dan subcommand baru `autore scan-image` untuk full scan CI post-build (verifikasi UID image `!= 0` + Trivy Image Scan `HIGH,CRITICAL` + ekspor SBOM CycloneDX).
- **Jenkins Shared Library & Admin-Controlled Orchestrator** berada di repositori/direktori yang dikontrol admin (terpisah dari repositori aplikasi yang di-scan) untuk mengorkestrasi `cargo clippy` + SonarQube analysis (`-Dsonar.rust.clippy.enabled=false -Dsonar.rust.clippyReport.reportPaths=clippy-report.json`), polling CE task hingga `SUCCESS`, pengecekan Quality Gate menggunakan `analysisId`, verifikasi `ncloc_language_distribution` `rust > 0`, kompilasi binary statis Rust `x86_64-unknown-linux-musl` + `SHA256SUMS`, push image bertag full 40-hex commit SHA ke Nexus (`writePolicy: "ALLOW_ONCE"` / *Disable redeploy*), verifikasi `@sha256:<digest>` via authenticated `HEAD` manifest (`Docker-Content-Digest`), dan deployment berbasis digest.
- **Status C-1 & SonarQube Advisory (Belum Production-Ready):** Selama Jenkins runner masih menggunakan grup `docker` host (`C-1`) dan SonarQube masih memakai *pinned PoC version* `26.10.0.133078-community` dengan mitigasi `cacerts` eMudhra, lingkungan ini berstatus **Sandbox / PoC Validation** dan **belum production-ready** (lihat [`docs/PRODUCTION-ISOLATION-DESIGN.md`](../../PRODUCTION-ISOLATION-DESIGN.md)).

**Tech Stack:**
- Rust (`autore` CLI + `cargo clippy` JSON report, target `x86_64-unknown-linux-musl`)
- Gitleaks: `zricethezav/gitleaks:v8.21.2@sha256:0e99e8821643ea5b235718642b93bb32486af9c8162c8b8731f7cbdc951a7f46`
- Trivy: `aquasec/trivy:0.58.1@sha256:ab70a02200597efa04748f210f793936eb647cbcdb0ea69cc30b226d6f5a22c7`
- SonarQube Community Build (Pinned PoC Version): `sonarqube:26.10.0.133078-community@sha256:aa0d41212704d1ed35f7ae3b49886b39f639590baf8020cdb191c2a2eb8f9eae`
- SonarScanner CLI: `sonarsource/sonar-scanner-cli:12.3.0.4285_8.1.0@sha256:47956b669bf486bdad919e1cbd0533223515aa0b6d1d31763e5a3754942df6d7`
- Sonatype Nexus Repository OSS: `sonatype/nexus3:3.96.5-alpine@sha256:d70482a3d5d44c8733fb244742fef5ca8ac967da56ccb97398f807bb8d3e585e`

**Spec:** [`docs/superpowers/specs/2026-10-29-trivy-sonarqube-nexus-architecture.md`](../specs/2026-10-29-trivy-sonarqube-nexus-architecture.md)

## Global Constraints

- Pekerjaan dilakukan di branch khusus (`feat/trivy-sonar-nexus`); **dilarang** push ke `main`, mengubah Jenkins kantor, memakai kredensial produksi, atau menjalankan `sudo` / memasang `/usr/local/bin/autore` sebelum seluruh integrasi teruji dan disetujui.
- **C-1 & SonarQube Advisory Disclaimer:** Jangan mengklaim arsitektur ini *production-ready* selama runner masih berada di grup `docker` host atau selama menggunakan *pinned PoC version* SonarQube `26.10.0.133078-community`. Terapkan mitigasi resmi penghapusan root CA eMudhra (`emsign*`) dari JVM `cacerts`.
- **Digest Pinning Wajib:** Seluruh image (`sonarqube`, `sonar-scanner-cli`, `nexus3`, `gitleaks`, `trivy`) wajib di-pin dengan `@sha256:<64-hex>`.
- **Admin-Controlled Boundary:** Jenkins Shared Library (`vars/autorePipeline.groovy`) dan scanner/orchestrator authoritative harus berada di repositori/lokasi yang dikontrol admin (`/usr/local/bin/autore`, `/usr/local/lib/autore-ci/`), bukan dieksekusi dari repositori aplikasi yang sedang diperiksa.
- **Strategi Tunggal Clippy + SonarQube & Urutan Verifikasi:**
  - Jalankan `cargo clippy --all-targets -- -D warnings` dan hasilkan `clippy-report.json`.
  - Jalankan `sonar-scanner` dengan `-Dsonar.rust.clippy.enabled=false` dan `-Dsonar.rust.clippyReport.reportPaths=clippy-report.json` (jangan menjalankan Clippy dua kali).
  - `/api/languages/list` hanya merupakan **preflight**.
  - Setelah `sonar-scanner` selesai, **wajib polling `/api/ce/task?id=<ceTaskId>` sampai `.task.status == "SUCCESS"` terlebih dahulu** dan ambil `analysisId = .task.analysisId`.
  - Baru setelah CE task `SUCCESS`: (a) periksa Quality Gate menggunakan `analysisId` (`/api/qualitygates/project_status?analysisId=${analysisId}` wajib `status == "OK"`), dan (b) periksa `/api/measures/component` agar `ncloc_language_distribution` memiliki `rust=<N>` dengan $N > 0$.
- **Aturan Tag Full Commit SHA, Nexus `Disable redeploy`, Siklus Hidup Image, & Verifikasi Digest via Authenticated `HEAD`:**
  - **Dilarang menggunakan tag `latest` atau `SHORT_SHA` untuk tag image.** Gunakan full 40-hex Git commit SHA: `<registry>/<app>:build-<BUILD_NUMBER>-commit-<40-hex-GIT_COMMIT>`.
  - Repository Nexus (`docker-hosted` dan `autore-releases`) wajib dikonfigurasi dengan **Deployment Policy: Disable redeploy** (`storage.writePolicy: "ALLOW_ONCE"`).
  - **Jangan menghapus image lokal** setelah Stage 7 (Trivy Image Scan) jika scan lulus; pertahankan image lokal sampai proses push ke Nexus dan verifikasi digest selesai.
  - Setelah push ke Nexus, ambil `LOCAL_DIGEST` (`sha256:<64-hex>`) dari `RepoDigests`, lalu verifikasi digest remote melalui **authenticated `HEAD /v2/<app>/manifests/<LOCAL_DIGEST>`** dan pastikan header response `Docker-Content-Digest` sama persis dengan `LOCAL_DIGEST`.
  - Deployment wajib menggunakan `<registry>/<app>@sha256:<64-hex>`.
- **Zero-Leak Credentials:** `SONAR_TOKEN` dan `NEXUS_USER`/`NEXUS_PASS` berasal dari Jenkins Credentials Store dan dialirkan via env/stdin (`curl --config -`, `docker login --password-stdin`), tidak pernah di `argv` atau log.

## Review Focus

1. **Measures atau Quality Gate dibaca sebelum Compute Engine task `SUCCESS`, atau Quality Gate tidak memakai `analysisId`:** `scripts/ci-sonarqube-gate.sh` wajib menolak melanjutkan ke endpoint `/api/qualitygates/project_status` maupun `/api/measures/component` sebelum `/api/ce/task?id=${ceTaskId}` mengembalikan `status == "SUCCESS"` dan `analysisId` non-kosong.
2. **SonarQube menjalankan Clippy internal sekaligus mengimpor `clippy-report.json`:** `scripts/ci-sonarqube-gate.sh` wajib menyertakan `-Dsonar.rust.clippy.enabled=false` setiap kali mengimpor `clippy-report.json`.
3. **Tag image hanya memakai 7-karakter `SHORT_SHA` atau `:latest`:** `scripts/ci-nexus-publish.sh` wajib memvalidasi tag terhadap regex `^.+:build-[0-9]+-commit-[0-9a-f]{40}$`.
4. **Verifikasi digest remote tidak memakai authenticated `HEAD` atau header `Docker-Content-Digest` berbeda:** `scripts/ci-nexus-publish.sh` wajib mengirim request `HEAD` terautentikasi (via `curl --config -`) ke `/v2/<app>/manifests/<LOCAL_DIGEST>` dan membandingkan header `Docker-Content-Digest` dengan `LOCAL_DIGEST`.
5. **Nexus mengizinkan redeploy (`ALLOW` вместо `ALLOW_ONCE`) atau truststore SonarQube masih memuat CA eMudhra (`emsign`):** `bootstrap-local-services.sh` wajib mengatur `writePolicy: "ALLOW_ONCE"` pada Nexus dan menghapus alias `emsign*` dari `cacerts` sebelum SonarQube dijalankan.

---

## 1. Urutan Stage Pipeline, Input/Output, Credential, & Kondisi Gagal

```text
Checkout (Full 40-Hex GIT_COMMIT)
  ↓
Stage 1: Autore Static Scan + Gitleaks (Secret Scan)
  ↓
Stage 2: Trivy Filesystem & Config Scan (HIGH,CRITICAL)
  ↓
Stage 3: Cargo Clippy + SonarQube SAST Analysis (Preflight + clippy.enabled=false + Import JSON)
  ↓
Stage 4: SonarQube CE Task Wait (SUCCESS) -> Quality Gate (by analysisId) -> Verify rust ncloc > 0
  ↓
Stage 5: Build Docker Image (Full 40-Hex Commit Tag) & Static Rust musl Binary
  ↓
Stage 6: Trivy Final Image Scan (HIGH,CRITICAL) + Runtime UID != 0 (Keep Image on Pass)
  ↓
Stage 7: Generate CycloneDX SBOM & SHA256SUMS
  ↓
Stage 8: Push Full-SHA Tag to Nexus (Disable redeploy) & Verify Digest via Authenticated HEAD
  ↓
Stage 9: Deploy by @sha256:<digest> & Smoke Test
```

| Stage | Input | Output | Credential ID (Jenkins) | Exit Code & Kondisi Gagal (*Fail-Closed*) |
| :--- | :--- | :--- | :--- | :--- |
| **Checkout** | Git commit `HEAD` | `GIT_COMMIT` (40-hex), `IMAGE_TAG` (`build-<N>-commit-<40-hex-GIT_COMMIT>`) | SCM read-only | Exit `!= 0` jika `GIT_COMMIT` bukan 40-hex atau `IMAGE_TAG` mengandung `latest`. |
| **1. Static + Gitleaks** | Workspace (`ro`) | `gitleaks.json` (`[]`) | Tidak ada (`--network none`) | Exit `1` jika `/usr/local/bin/autore` bukan milik `root`, ada pelanggaran statis/secret/symlink, atau `gitleaks.json` tidak valid. |
| **2. Trivy FS/Config** | Workspace (`ro`) | `trivy-fs.json` (`SchemaVersion`) | Tidak ada | Exit `1` jika ditemukan CVE/misconfig `HIGH` atau `CRITICAL` pada source/lockfile/Dockerfile. |
| **3. Clippy + SonarQube Analysis** | Source code, `clippy-report.json`, preflight `/api/languages/list` | `.scannerwork/report-task.txt` (`ceTaskId`) | `sonarqube-token` (`SONAR_TOKEN` env) | Exit `!= 0` jika preflight `/api/languages/list` tidak memuat `"key":"rust"`, `cargo clippy -D warnings` gagal, atau scanner gagal. |
| **4. CE Task $\rightarrow$ Quality Gate (`analysisId`) $\rightarrow$ Rust Measures** | `ceTaskId` | CE `status == "SUCCESS"` (`analysisId`) $\rightarrow$ Quality Gate `status == "OK"` $\rightarrow$ `ncloc_language_distribution` `rust > 0` | `sonarqube-token` (`curl --config -` stdin) | Exit `1` jika CE task gagal/timeout (>300s), Quality Gate `status != "OK"` untuk `analysisId`, atau `ncloc_language_distribution` tidak memuat `rust > 0`. |
| **5. Build Image & `musl` Binary** | `Dockerfile`, `cli/` | Image lokal `<registry>/<app>:build-<N>-commit-<40-hex>` (**dipertahankan**), `dist/autore-linux-x86_64-musl` | Tidak ada | Exit `!= 0` jika unit test di Dockerfile gagal, build gagal, tag bukan 40-hex SHA, atau binary `musl` masih *dynamically linked*. |
| **6. Trivy Final Image Scan** | Image lokal `<registry>/<app>:build-<N>-commit-<40-hex>` | `trivy-image.json`, verifikasi UID `!= 0` | Tidak ada | Exit `1` (+ hapus image lokal) jika UID `== 0` atau ada CVE `HIGH`/`CRITICAL`. **Jika lulus, image lokal TIDAK dihapus.** |
| **7. SBOM & Checksum** | Image lokal + binary `musl` | `dist/sbom.cdx.json`, `dist/SHA256SUMS` | Tidak ada | Exit `1` jika SBOM bukan JSON CycloneDX valid atau `sha256sum -c` gagal. |
| **8. Push ke Nexus & Verify Digest (`HEAD`)** | Image lokal `<registry>/<app>:build-<N>-commit-<40-hex>` + `dist/*` | `.verified-image-digest` (`<registry>/<app>@sha256:<64-hex>`), URL Raw artifact (`ALLOW_ONCE`) | `nexus-credentials` (`NEXUS_USER`/`NEXUS_PASS` via stdin) | Exit `1` jika tag bukan 40-hex SHA, repo bukan `ALLOW_ONCE`, push gagal, authenticated `HEAD /v2/<app>/manifests/<digest>` gagal, atau header `Docker-Content-Digest != LOCAL_DIGEST`. |
| **9. Deploy by `@sha256:<digest>`** | `<registry>/<app>@sha256:<64-hex>` | Container sehat di `127.0.0.1:$DEPLOY_PORT` | `nexus-credentials` | Exit `1` jika ref bukan `@sha256:<64-hex>` atau `/health` gagal dalam 10 detik (container lama dipertahankan). |

---

## 2. Daftar File yang Akan Dibuat / Diubah

- **Modify:**
  - `cli/src/external.rs` — Ubah default severity Trivy ke `HIGH,CRITICAL`, tambahkan dukungan `--severity`, serta implementasikan `run_trivy_image()` (tolak tag `:latest`, verifikasi UID image `!= 0`, Trivy `image` scan `HIGH,CRITICAL`, dan pembuatan SBOM CycloneDX tanpa menghapus image yang lulus).
  - `cli/src/main.rs` — Perjelas deskripsi mode CLI (`autore scan --no-docker` = scan ringan lokal, `autore scan` = full scan CI), tambahkan `--severity`, dan tambahkan subcommand `autore scan-image`.
  - `cli/tests/scan_cli.rs` — Tambahkan E2E test untuk `autore scan-image` dan severity `HIGH,CRITICAL`.
  - `scripts/security-check.sh` — Selaraskan severity Trivy menjadi `HIGH,CRITICAL`.
  - `sandbox/dummy-app/test_security_check.py` — Tambahkan regression & integration tests untuk semua komponen baru.
- **Create (Referensi Admin-Controlled Orchestrator & Shared Library):**
  - `scripts/ci-sonarqube-gate.sh` — Preflight `/api/languages/list`, jalankan `sonar-scanner-cli@sha256:47956b669bf486bdad919e1cbd0533223515aa0b6d1d31763e5a3754942df6d7` dengan `-Dsonar.rust.clippy.enabled=false -Dsonar.rust.clippyReport.reportPaths=clippy-report.json` dan mount `cacerts` yang telah dimitigasi dari eMudhra, polling `/api/ce/task?id=<ceTaskId>` hingga `SUCCESS`, cek `/api/qualitygates/project_status?analysisId=<analysisId>` == `OK`, lalu verifikasi `ncloc_language_distribution` `rust > 0`.
  - `scripts/build-musl-release.sh` — Build binary statis `autore-linux-x86_64-musl`, verifikasi bukan dynamic executable, dan buat `SHA256SUMS`.
  - `scripts/ci-nexus-publish.sh` — Validasi tag full 40-hex SHA (`^.+:build-[0-9]+-commit-[0-9a-f]{40}$`, tolak `:latest` dan `SHORT_SHA`), verifikasi repo Nexus memakai `writePolicy: "ALLOW_ONCE"`, push image ke Nexus, ambil `LOCAL_DIGEST` dari `RepoDigests`, verifikasi kecocokan dengan header `Docker-Content-Digest` via authenticated `HEAD /v2/<app>/manifests/<LOCAL_DIGEST>`, lalu unggah `autore-linux-x86_64-musl`, `sbom.cdx.json`, dan `SHA256SUMS` ke Nexus Raw repo.
  - `scripts/ci-deploy-by-digest.sh` — Tolak referensi tanpa `@sha256:<64-hex>`, jalankan container kandidat dari digest immutable, uji `/health`, dan lakukan pergantian *rollback-safe*.
  - `sandbox/services/docker-compose.yml` — Layanan lokal dengan image digest ter-pin:
    - `sonarqube:26.10.0.133078-community@sha256:aa0d41212704d1ed35f7ae3b49886b39f639590baf8020cdb191c2a2eb8f9eae` (`127.0.0.1:9000:9000`, mount sanitized `cacerts:ro`)
    - `sonatype/nexus3:3.96.5-alpine@sha256:d70482a3d5d44c8733fb244742fef5ca8ac967da56ccb97398f807bb8d3e585e` (`127.0.0.1:8082:8081` + `127.0.0.1:5000:5000`)
  - `sandbox/services/bootstrap-local-services.sh` — Mitigasi resmi `keytool -delete` untuk menghapus root CA eMudhra (`emsign*`) dari `cacerts` sebelum menyalakan SonarQube, serta inisialisasi repo Nexus `docker-hosted` dan `autore-releases` dengan `writePolicy: "ALLOW_ONCE"` (*Disable redeploy*).
  - `vars/autorePipeline.groovy` — Paket Jenkins Trusted Shared Library yang dikontrol admin.

---

## 3. Rincian Tugas Implementasi (TDD)

### Task 1: Mode CLI (`autore scan` vs `autore scan-image`) & Trivy Severity `HIGH,CRITICAL`

**Files:**
- Modify: `cli/src/external.rs`
- Modify: `cli/src/main.rs`
- Modify: `scripts/security-check.sh`
- Test: `cli/src/external.rs` (`mod tests`), `cli/tests/scan_cli.rs`

- [ ] **Step 1: Tulis unit test & E2E test yang gagal (RED)**
  - `trivy_fs_uses_high_and_critical_severity_by_default`
  - `trivy_image_rejects_mutable_latest_tag`
  - `trivy_image_rejects_root_uid_before_scanning`
  - `trivy_image_blocks_on_high_or_critical_cve_and_requires_valid_report`
  - `trivy_image_preserves_image_on_pass_and_writes_cyclonedx_sbom`
- [ ] **Step 2: Jalankan `cargo test` dan pastikan gagal (RED)**
- [ ] **Step 3: Implementasikan perubahan di `cli/src/external.rs`, `cli/src/main.rs`, dan `scripts/security-check.sh`**
- [ ] **Step 4: Jalankan test sampai lulus (GREEN) dan commit**

---

### Task 2: Static Binary Builder (`x86_64-unknown-linux-musl`) & `SHA256SUMS`

**Files:**
- Create: `scripts/build-musl-release.sh`
- Test: `sandbox/dummy-app/test_security_check.py`

- [ ] **Step 1: Tulis regression test di `sandbox/dummy-app/test_security_check.py` (RED)**
  - `test_build_musl_release_produces_static_binary_and_verified_sha256sums`
- [ ] **Step 2: Jalankan test dan pastikan gagal (RED)**
- [ ] **Step 3: Implementasikan `scripts/build-musl-release.sh`**
- [ ] **Step 4: Jalankan test sampai lulus (GREEN) dan commit**

---

### Task 3: SonarQube Gate (`clippy.enabled=false` + CE Task `SUCCESS` $\rightarrow$ Quality Gate by `analysisId` $\rightarrow$ `ncloc_language_distribution` `rust > 0`)

**Files:**
- Create: `scripts/ci-sonarqube-gate.sh`
- Test: `sandbox/dummy-app/test_security_check.py`

- [ ] **Step 1: Tulis regression test di `sandbox/dummy-app/test_security_check.py` (RED)**
  - `test_sonarqube_gate_disables_internal_clippy_and_imports_report`
  - `test_sonarqube_gate_never_passes_token_in_argv_and_uses_pinned_scanner_digest`
  - `test_sonarqube_gate_waits_for_ce_task_success_before_checking_quality_gate_by_analysis_id_and_measures`
  - `test_sonarqube_gate_fails_when_quality_gate_status_is_error_or_warn`
  - `test_sonarqube_gate_fails_when_rust_ncloc_is_zero_even_if_languages_list_had_rust`
  - `test_sonarqube_gate_fails_on_timeout`
- [ ] **Step 2: Jalankan test dan pastikan gagal (RED)**
- [ ] **Step 3: Implementasikan `scripts/ci-sonarqube-gate.sh`**
- [ ] **Step 4: Jalankan test sampai lulus (GREEN) dan commit**

---

### Task 4: Nexus Publisher (Full 40-Hex SHA Tag, `ALLOW_ONCE`, Authenticated `HEAD` `Docker-Content-Digest`) & Digest Deployer

**Files:**
- Create: `scripts/ci-nexus-publish.sh`
- Create: `scripts/ci-deploy-by-digest.sh`
- Test: `sandbox/dummy-app/test_security_check.py`

- [ ] **Step 1: Tulis regression test di `sandbox/dummy-app/test_security_check.py` (RED)**
  - `test_nexus_publish_rejects_latest_or_short_sha_tag`
  - `test_nexus_publish_verifies_allow_once_disable_redeploy_policy`
  - `test_nexus_publish_verifies_digest_via_authenticated_head_and_docker_content_digest_header`
  - `test_nexus_publish_fails_when_remote_docker_content_digest_differs`
  - `test_nexus_publish_keeps_local_image_until_digest_verified`
  - `test_deploy_by_digest_rejects_tags_without_sha256_digest`
  - `test_deploy_by_digest_keeps_old_container_when_new_candidate_fails_healthcheck`
- [ ] **Step 2: Jalankan test dan pastikan gagal (RED)**
- [ ] **Step 3: Implementasikan `scripts/ci-nexus-publish.sh` dan `scripts/ci-deploy-by-digest.sh`**
- [ ] **Step 4: Jalankan test sampai lulus (GREEN) dan commit**

---

### Task 5: Docker Compose Lokal (Pinned Digests + Mitigasi eMudhra `cacerts` + Nexus `ALLOW_ONCE`) & Admin-Controlled Shared Library

**Files:**
- Create: `sandbox/services/docker-compose.yml`
- Create: `sandbox/services/bootstrap-local-services.sh`
- Create: `vars/autorePipeline.groovy`
- Create: README.md (bagian library)

- [ ] **Step 1: Tulis regression test di `sandbox/dummy-app/test_security_check.py` (RED)**
  - Memastikan `sandbox/services/docker-compose.yml` mem-pin `sonarqube:26.10.0.133078-community@sha256:aa0d41212704d1ed35f7ae3b49886b39f639590baf8020cdb191c2a2eb8f9eae` dan `sonatype/nexus3:3.96.5-alpine@sha256:d70482a3d5d44c8733fb244742fef5ca8ac967da56ccb97398f807bb8d3e585e`, me-mount `cacerts` yang telah dimitigasi dari eMudhra (`:ro`), mengikat seluruh port ke `127.0.0.1`, mengatur `writePolicy: "ALLOW_ONCE"` di `bootstrap-local-services.sh`, dan memastikan `vars/autorePipeline.groovy` hanya memanggil binary/skrip dari lokasi admin-controlled (`/usr/local/bin/autore` & `/usr/local/lib/autore-ci/`) dengan full 40-hex `GIT_COMMIT`.
- [ ] **Step 2: Jalankan test dan pastikan gagal (RED)**
- [ ] **Step 3: Implementasikan file compose, skrip bootstrap, dan shared library**
- [ ] **Step 4: Jalankan seluruh test suite sampai lulus (GREEN) dan commit**
