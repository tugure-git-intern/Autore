# Hapus App Bersih dari Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu aksi `Hapus` di dashboard membersihkan app di server sepenuhnya — container, job Jenkins, baris registry, entri environments, folder — dengan konfirmasi ketik nama dan peran admin.

**Architecture:** Logika tinggal di Rust (`autore hapus-app`), API hanya cangkang `execFile` seperti aksi lain, dashboard memakai `ActionButton` yang sudah ada plus satu kolom ketik-nama. Urutan efek samping: container → job Jenkins → registry/environments → folder, supaya kegagalan di tengah meninggalkan keadaan yang masih bisa dibersihkan, bukan folder hilang dengan job masih polling.

**Tech Stack:** Rust 2021 (clap, serde_json, curl via `jenkins::curl_with_stdin_config`), Hono + TypeScript (`web/apps/api`), Next.js + React (`web/apps/dashboard`), vitest, Playwright.

**Spec:** tidak ada dokumen terpisah. Keputusan produk ada di § Keputusan Produk di bawah; plan ini argumen dari bagian itu.

## Keputusan Produk

- Yang dihapus: container Docker bernama `<app>`, job Jenkins `<app>`, `<app>-rollback`, `<app>-promote`, baris `<app>` di `registry.tsv`, kunci `<app>` di `environments.json`, folder `<workspace>/<app>`.
- **Repo GitHub TIDAK disentuh.** Tidak ada flag untuk itu di plan ini.
- **Riwayat build Jenkins ikut hilang** bersama job. Mode "arsipkan" (job dimatikan, riwayat disimpan) sengaja tidak dibangun sekarang.
- Konfirmasi: pemanggil wajib mengirim `--konfirmasi <nama>` yang sama persis dengan nama app. Dashboard meminta user mengetik nama itu.
- Peran: `admin`. Dev/qa mendapat 403 tanpa efek samping.
- Backup `registry.tsv` dan `environments.json` ke `.bak-<epoch-detik>` sebelum mutasi pertama.
- Audit: setiap percobaan hapus tercatat lewat `catatAudit` yang sudah ada, termasuk yang gagal.

## Global Constraints

- Tanpa dependensi baru di sisi mana pun.
- Nama app divalidasi sebelum efek samping apa pun; pola yang sudah dipakai API: `/^[A-Za-z0-9._-]{1,64}$/`. Sisi Rust memakai `connect::nama_sah` (jadikan `pub(crate)`) PLUS batas `nama.chars().count() <= 64` di `hapus::periksa` — `nama_sah` sendiri tidak boleh diperketat karena `parse_repo_url` memakainya untuk nama repo GitHub yang bisa lebih panjang.
- Tidak ada perintah yang dirakit lewat shell; `docker` dan `curl` dipanggil dengan argv.
- Repo sumber Autore tidak boleh dihapus: `main::is_autore_source_repo` tetap jadi penolak.
- Gerbang Rust: `cargo test --bin autore` (baseline 335 lulus), `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`.
- Gerbang web: `npx vitest run`, `npm run lint`, `npm run typecheck` dari `web/`.
- Sebelum push `main`: deploy web ke VPS, `npx playwright test` di `web/apps/dashboard`, pasang biner ke `/usr/local/bin/autore` dan `/usr/local/lib/autore-ci/autore` (backup `.bak-<ts>` dulu).
- Laptop tidak punya hak push: commit sebagai `MAliffadlan`, `git format-patch`, `scp` ke VPS, `git am` di `~/Autore`, push dari sana.
- Tes Rust yang mengubah `AUTORE_WORKSPACE` wajib memegang `workspace::KUNCI_ENV_WS`.

## Review Focus

- Nama app jahat (`../lain`, spasi, NUL, `coba-alif-5; rm`) → ditolak sebelum container/job/folder disentuh; tidak ada perintah shell yang Terbentuk.
- Folder app sudah hilang tapi job/registry masih ada (app yatim) → hapus tetap membersihkan sisa dan keluar 0, bukan menolak karena folder tidak ada.
- Jenkins mati atau kredensial salah → folder dan registry tidak terlanjur dihapus; keluaran menyebut langkah mana yang gagal dan keluar 1.
- Deploy sedang berjalan untuk app yang sama → hapus ditolak 409, bukan menghapus folder di tengah deploy.
- Peran dev menekan Hapus, atau konfirmasi tidak sama dengan nama → 403/400 tanpa efek samping, pesan bisa dibaca user.

---

### Task 1: Pembuang baris registry dan entri environments

**Files:**
- Modify: `cli/src/workspace.rs` (tambah fungsi setelah `catat_port`, sekitar `cli/src/workspace.rs:110-185`)
- Modify: `cli/src/lingkungan.rs` (tambah fungsi setelah `init_semua_dengan`)
- Test: modul `tests` di kedua berkas yang sama

**Interfaces:**
- Consumes: `workspace::baca_registry`, `workspace::entri_registry`, `lingkungan::baca_env` (sudah ada).
- Produces:
  - `pub(crate) fn hapus_port(workspace: &Path, nama: &str) -> bool` — true bila ada baris yang dibuang; berkas ditulis ulang hanya kalau berubah.
  - `pub(crate) fn hapus_app(workspace: &Path, nama: &str) -> Result<bool, String>` — `Ok(false)` bila `environments.json` tidak ada atau kunci tidak ada; `Err` hanya bila berkas ada tapi rusak/tidak bisa ditulis.

- [x] **Step 1: Tulis tes gagal**

```rust
#[test]
fn hapus_port_membuang_satu_baris_dan_menyisakan_lain() {
    let tmp = tempfile::TempDir::new().unwrap();
    std::fs::write(tmp.path().join("registry.tsv"), "a\t8000\t8083\nb\t8000\t8093\n").unwrap();
    assert!(hapus_port(tmp.path(), "a"));
    assert_eq!(entri_registry(tmp.path()).len(), 1);
    assert_eq!(entri_registry(tmp.path())[0].0, "b");
}

#[test]
fn hapus_port_nama_tidak_ada_tidak_menulis_ulang() {
    let tmp = tempfile::TempDir::new().unwrap();
    let reg = tmp.path().join("registry.tsv");
    std::fs::write(&reg, "a\t8000\t8083\n").unwrap();
    let sebelum = std::fs::metadata(&reg).unwrap().modified().unwrap();
    assert!(!hapus_port(tmp.path(), "tidak-ada"));
    assert_eq!(std::fs::metadata(&reg).unwrap().modified().unwrap(), sebelum);
}
```

Tambah juga di `lingkungan.rs`: `hapus_app_membuang_kunci_app_itu_saja` (dua kunci, satu dibuang, kunci lain utuh) dan `hapus_app_tanpa_berkas_mengembalikan_false` (folder kosong → `Ok(false)`).

- [x] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd cli && cargo test --bin autore hapus_port`
Expected: FAIL, `cannot find function hapus_port`.

- [x] **Step 3: Implement kedua fungsi**

Tulis ulang berkas dengan baris/kunci yang tersisa, mengikuti cara tulis yang sudah dipakai `catat_port` dan `init_semua_dengan` (tulis ke berkas sementara lalu rename untuk `environments.json`). Jangan mengubah format baris yang tersisa.

- [x] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd cli && cargo test --bin autore hapus_`
Expected: PASS, empat tes baru hijau.

- [x] **Step 5: Commit**

```bash
git add cli/src/workspace.rs cli/src/lingkungan.rs
git commit -m "feat(cli): pembuang baris registry dan entri environments per app"
```

---

### Task 2: Penghapusan job Jenkins dan container

**Files:**
- Modify: `cli/src/jenkins.rs` (setelah `register_promote_job`, sekitar `cli/src/jenkins.rs:741`)
- Modify: `cli/src/workspace.rs` (dekat `container_jalan`, `cli/src/workspace.rs:37`)
- Modify: `cli/src/connect.rs:49` (`fn nama_sah` → `pub(crate) fn nama_sah`)
- Test: modul `tests` di `jenkins.rs` dan `workspace.rs`

**Interfaces:**
- Consumes: `jenkins::curl_with_stdin_config`, `jenkins::extract_crumb_pair`, `jenkins::normalize_jenkins_url`, `JenkinsConfig`.
- Produces:
  - `pub fn kode_hapus_job(code: u16) -> Result<bool, String>` — 200/302 → `Ok(true)`; 404 → `Ok(false)`; 401/403 → `Err("Autentikasi Jenkins ditolak (HTTP 401/403). Periksa username/password.")`; selain itu → `Err` memuat kode.
  - `pub fn hapus_job(cfg: &JenkinsConfig, job_name: &str) -> Result<bool, String>` — ambil crumb (boleh tidak ada bila CSRF mati), `POST {base}/job/{job_name}/doDelete`, terjemahkan lewat `kode_hapus_job`.
  - `pub(crate) fn hapus_container(nama: &str) -> bool` — `docker rm -f <nama>`; true bila keluar 0; nama divalidasi `connect::nama_sah` dulu, nama tidak sah → false tanpa memanggil docker.

- [ ] **Step 1: Tulis tes gagal**

```rust
#[test]
fn kode_hapus_job_menerjemahkan_kode_http() {
    assert_eq!(kode_hapus_job(302), Ok(true));
    assert_eq!(kode_hapus_job(200), Ok(true));
    assert_eq!(kode_hapus_job(404), Ok(false));
    assert!(kode_hapus_job(401).is_err());
    assert!(kode_hapus_job(500).unwrap_err().contains("500"));
}

#[test]
fn hapus_container_menolak_nama_tidak_sah() {
    assert!(!hapus_container("../lain"));
    assert!(!hapus_container("a b"));
    assert!(!hapus_container(""));
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd cli && cargo test --bin autore kode_hapus_job`
Expected: FAIL, fungsi belum ada.

- [ ] **Step 3: Implement ketiga perubahan**

`hapus_job` meniru bentuk `register_and_trigger_jenkins` (cookie jar + `--config -` untuk kredensial, `-w "\n__HTTP_CODE__:%{http_code}"`), hanya saja metodenya POST ke `doDelete` dan tanpa berkas XML. `hapus_container` memakai `Command::new("docker").args(["rm", "-f", nama])`.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd cli && cargo test --bin autore && cargo clippy --all-targets -- -D warnings`
Expected: PASS semua, clippy bersih.

- [ ] **Step 5: Commit**

```bash
git add cli/src/jenkins.rs cli/src/workspace.rs cli/src/connect.rs
git commit -m "feat(cli): hapus job Jenkins dan container per app"
```

---

### Task 3: Subcommand `autore hapus-app`

**Files:**
- Create: `cli/src/hapus.rs`
- Modify: `cli/src/main.rs` (deklarasi `mod hapus;`, varian `Commands` dekat `DeleteProject` di `cli/src/main.rs:911-913`, dispatch dekat `cli/src/main.rs:2064`)
- Test: `cli/src/hapus.rs` modul `tests`

**Interfaces:**
- Consumes: Task 1 (`hapus_port`, `lingkungan::hapus_app`), Task 2 (`hapus_job`, `hapus_container`, `connect::nama_sah`), `workspace::workspace_dir`, `workspace::entri_registry`, `jenkins::load_config_from` + `jenkins::default_config_path`, `main::is_autore_source_repo`.
- Produces:
  - Varian clap: `HapusApp { nama: String, #[arg(long)] konfirmasi: String }` dengan `#[command(visible_alias = "hapus-app")]`.
  - `pub(crate) struct HasilLangkah { pub(crate) nama: &'static str, pub(crate) berhasil: bool, pub(crate) pesan: String }`
  - `pub(crate) fn periksa(nama: &str, konfirmasi: &str, terdaftar: &[String], folder: &Path) -> Result<(), String>`
  - `pub(crate) fn ringkasan(langkah: &[HasilLangkah]) -> (i32, String)` — 0 bila semua berhasil, 1 bila ada yang gagal; teks memuat nama langkah yang gagal.
  - `pub(crate) fn jalankan_dengan(nama: &str, konfirmasi: &str, workspace: &Path, cfg: Option<&JenkinsConfig>) -> (i32, Vec<HasilLangkah>)` — orkestrasi dengan workspace dan konfigurasi Jenkins disuntik supaya bisa diuji tanpa jaringan.
  - `pub(crate) fn jalankan(nama: &str, konfirmasi: &str) -> i32` — cangkang tipis: baca `workspace::workspace_dir()` dan `jenkins::load_config_from(&jenkins::default_config_path())`, panggil `jalankan_dengan`, cetak ringkasan.

- [ ] **Step 1: Tulis tes gagal**

```rust
#[test]
fn periksa_menolak_konfirmasi_beda() {
    let tmp = tempfile::TempDir::new().unwrap();
    assert!(periksa("app-a", "app-b", &["app-a".into()], tmp.path()).is_err());
}

#[test]
fn periksa_menolak_nama_tidak_sah_dan_tidak_terdaftar() {
    let tmp = tempfile::TempDir::new().unwrap();
    assert!(periksa("../lain", "../lain", &["../lain".into()], tmp.path()).is_err());
    assert!(periksa("app-x", "app-x", &["app-a".into()], tmp.path()).is_err());
}

#[test]
fn periksa_mengizinkan_folder_sudah_hilang() {
    let tmp = tempfile::TempDir::new().unwrap();
    assert!(periksa("app-a", "app-a", &["app-a".into()], &tmp.path().join("app-a")).is_ok());
}

#[test]
fn ringkasan_keluar_satu_bila_ada_langkah_gagal() {
    let langkah = vec![
        HasilLangkah { nama: "container", berhasil: true, pesan: String::new() },
        HasilLangkah { nama: "job Jenkins", berhasil: false, pesan: "HTTP 500".into() },
    ];
    let (kode, teks) = ringkasan(&langkah);
    assert_eq!(kode, 1);
    assert!(teks.contains("job Jenkins"));
    assert!(teks.contains("HTTP 500"));
}
```

Tambah `periksa_menolak_repo_sumber_autore`: folder berisi `cli/Cargo.toml` + `vars/autorePipeline.groovy` → `Err`.

Tambah tes perilaku orkestrasi tanpa jaringan (pakai `KUNCI_ENV_WS` bila menyentuh env):

```rust
#[test]
fn jenkins_tidak_terkonfigurasi_tetap_membersihkan_registry_dan_folder() {
    let tmp = tempfile::TempDir::new().unwrap();
    let ws = tmp.path();
    std::fs::write(ws.join("registry.tsv"), "app-a\t8000\t8083\n").unwrap();
    std::fs::create_dir_all(ws.join("app-a")).unwrap();
    let (kode, langkah) = jalankan_dengan("app-a", "app-a", ws, None);
    assert_eq!(kode, 1);
    assert!(langkah.iter().any(|l| l.nama == "job Jenkins" && !l.berhasil));
    assert!(entri_registry(ws).is_empty());
    assert!(!ws.join("app-a").exists());
    assert!(std::fs::read_dir(ws).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().starts_with("registry.tsv.bak-")));
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd cli && cargo test --bin autore periksa_`
Expected: FAIL, modul belum ada.

- [ ] **Step 3: Implement `cli/src/hapus.rs` dan sambungkan ke clap**

Urutan `jalankan`: `periksa` → backup `registry.tsv` + `environments.json` ke `.bak-<epoch-detik>` → `hapus_container(nama)` → `hapus_job` untuk `<nama>`, `<nama>-rollback`, `<nama>-promote` (404 dianggap berhasil, job memang tidak ada) → `hapus_port` (bila mengembalikan `false`, baca ulang `entri_registry`: baris masih ada berarti langkah registry GAGAL, bukan "tidak ada baris" — `false` juga berarti gagal tulis) → `lingkungan::hapus_app` → hapus folder bila ada dan bukan repo sumber. Lepas kedua `#[allow(dead_code)]` dari Task 1 di sini. Setiap langkah menghasilkan `HasilLangkah`; kegagalan satu langkah tidak menghentikan langkah lain, tetapi `ringkasan` menentukan exit code. Cetak satu baris per langkah dengan prefix yang sama seperti gaya `connect.rs`, lalu ringkasan.

Bila konfigurasi Jenkins tidak ada, langkah job dicatat gagal dengan pesan yang menyebut `jenkins.conf` — registry dan folder tetap dibersihkan, dan exit code 1 memberi tahu user bahwa job mungkin masih ada.

- [ ] **Step 4: Jalankan tes dan gerbang penuh**

Run: `cd cli && cargo test --bin autore && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS, clippy bersih, fmt bersih.

- [ ] **Step 5: Commit**

```bash
git add cli/src/hapus.rs cli/src/main.rs
git commit -m "feat(cli): autore hapus-app membersihkan container, job, registry, env, folder"
```

---

### Task 4: Rute API `POST /api/actions/remove`

**Files:**
- Create: `web/apps/api/src/hapus-app.ts`
- Create: `web/apps/api/src/hapus-app.test.ts`
- Modify: `web/apps/api/src/actions.ts` (`ActionKind`, `TIMEOUT`, fungsi aksi baru, ekspor)
- Modify: `web/apps/api/src/index.ts` (rute + `requireSession(auth, "admin")` + `rateLimiter`, dekat `web/apps/api/src/index.ts:331-345`)
- Modify: `web/apps/api/src/index.test.ts`
- Test: `web/apps/api/src/actions.test.ts`, `web/apps/api/src/index.test.ts`

**Interfaces:**
- Consumes: `actions.ts` yang sudah ada (`spawnAutore`, `resolveTarget` tidak dipakai untuk remove, `ambilKunci`/`aksiBerjalan`, `catatAudit`, `resetStatusCache`, `bacaRegistry`).
- Produces:
  - `hapus-app.ts`: `export function argvHapusApp(nama: string, konfirmasi: string): string[]` → `["hapus-app", nama, "--konfirmasi", konfirmasi]`.
  - `ActionKind` bertambah `"remove"`; `TIMEOUT.remove = 120_000`.
  - `ActionResult` tidak berubah bentuk; `action: "remove"`, `target: <nama>`.
  - Metode baru pada objek yang dikembalikan `buatActions`: `remove(app: string, konfirmasi: string, author?: Identitas): Promise<ActionResult>`.

Aturan rute: `app` wajib lolos `APP_ID`; `konfirmasi` wajib sama persis dengan `app` (kalau tidak 400); app wajib ada di `registry.tsv` **atau** daftar `autore status` (folder boleh sudah tidak ada); path tetap harus satu tingkat di bawah workspace; aksi ditolak 409 bila `aksiBerjalan()` bukan null atau `pemegangKunci(app)` ada — remove menyentuh registry dan Jenkins seperti quick-start.

- [ ] **Step 1: Tulis tes gagal**

`hapus-app.test.ts`: `argvHapusApp("app-a", "app-a")` menghasilkan argv persis di atas.

`actions.test.ts` (pola tes yang sudah ada di berkas itu):
- `remove menolak konfirmasi yang berbeda` → `{ ok: false, status: 400 }`, `deps.spawn` tidak terpanggil.
- `remove menolak id tidak sah` (`"../lain"`) → 400, spawn tidak terpanggil.
- `remove app yatim tetap jalan` (registry punya `app-a`, `stat` folder gagal) → spawn terpanggil dengan argv hapus-app, hasil `ok: true`.
- `remove mencatat audit walau CLI keluar 1` → `audit` terpanggil dengan `action: "remove"`, hasil 422.
- `remove ditolak saat deploy berjalan` → 409.

`index.test.ts` (pola `createApp` + `app.request` yang sudah ada di berkas itu): sesi ber-peran `dev` menembak `/api/actions/remove` → 403 dan `spawn` tidak terpanggil; sesi `admin` dengan konfirmasi cocok → 200.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/hapus-app.test.ts apps/api/src/actions.test.ts`
Expected: FAIL, modul/aksi belum ada.

- [ ] **Step 3: Implement modul, aksi, dan rute**

Rute memakai `requireSession(auth, "admin")` lalu `rateLimiter`, meniru susunan rute actions lain. Body: `{ app, konfirmasi }`. Jangan memakai `resolveTarget` (ia menuntut folder ada); tulis resolusi khusus remove sesuai aturan di atas.

- [ ] **Step 4: Jalankan gerbang web**

Run: `cd web && npx vitest run && npm run lint && npm run typecheck`
Expected: semua lulus, lint dan typecheck bersih.

- [ ] **Step 5: Commit**

```bash
git add web/apps/api/src/hapus-app.ts web/apps/api/src/hapus-app.test.ts web/apps/api/src/actions.ts web/apps/api/src/actions.test.ts web/apps/api/src/index.ts web/apps/api/src/index.test.ts
git commit -m "feat(api): aksi remove khusus admin dengan konfirmasi nama"
```

---

### Task 5: Tombol Hapus di dashboard

**Files:**
- Modify: `web/apps/dashboard/src/lib/actions-client.ts` (`ActionKind`, `SUCCESS`)
- Modify: `web/apps/dashboard/src/components/actions/action-button.tsx` (`ActionConfirmation` + input ketik nama)
- Modify: `web/apps/dashboard/src/app/applications/page.tsx:58` (tambah tombol di samping Scan)
- Test: `web/apps/dashboard/src/lib/actions-client.test.ts`, `web/apps/dashboard/src/components/actions/action-button.test.tsx`

**Interfaces:**
- Consumes: `runAction(action, app)` yang sudah ada — ubah jadi `runAction(action, app, konfirmasi?: string)` dan sertakan `konfirmasi` di body hanya bila ada.
- Produces: `ActionConfirmation` bertambah `requireTypedName?: string`; bila diisi, dialog menampilkan input berlabel "Ketik nama aplikasi untuk konfirmasi" dan tombol konfirmasi disabled sampai nilainya sama persis. `ActionKind` frontend bertambah `"remove"`; pesan sukses: `"Aplikasi dihapus dari server. Repo GitHub tidak disentuh."`

Tombol di `applications/page.tsx`: label `"Hapus"`, `action="remove"`, `confirm={{ title: "Hapus aplikasi ini dari server?", warning: "Container, job Jenkins, registry, environments, dan folder app dihapus. Repo GitHub tidak disentuh. Riwayat build ikut hilang.", confirmLabel: "Hapus permanen", requireTypedName: app }}`, `onDone` menyegarkan daftar seperti tombol lain.

Peran tidak dibaca di klien: tombol terlihat untuk semua, server menolak 403 dan pesan itu tampil lewat jalur toast yang sudah ada.

- [ ] **Step 1: Tulis tes gagal**

`actions-client.test.ts`: `runAction("remove", "app-a", "app-a")` mengirim body `{ app: "app-a", konfirmasi: "app-a" }`; `runAction("scan", "app-a")` tetap mengirim `{ app: "app-a" }` saja.

`action-button.test.tsx`: dengan `requireTypedName: "app-a"`, tombol konfirmasi disabled saat input kosong dan saat berisi `"app-b"`, aktif setelah `"app-a"`; menekan tombol itu memanggil `runAction` dengan konfirmasi `"app-a"`.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/dashboard/src/lib/actions-client.test.ts apps/dashboard/src/components/actions/action-button.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement perubahan klien**

Input memakai `useId` dan `aria-label` seperti input di `connect-dialog.tsx`; dialog tetap memakai `showModal` dengan jalur cadang atribut `open` yang sudah ada.

- [ ] **Step 4: Jalankan gerbang web**

Run: `cd web && npx vitest run && npm run lint && npm run typecheck`
Expected: semua lulus.

- [ ] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/actions-client.ts web/apps/dashboard/src/lib/actions-client.test.ts web/apps/dashboard/src/components/actions/action-button.tsx web/apps/dashboard/src/components/actions/action-button.test.tsx web/apps/dashboard/src/app/applications/page.tsx
git commit -m "feat(dashboard): tombol Hapus dengan konfirmasi ketik nama"
```

---

### Task 6: Docs, deploy VPS, dan bukti hidup

**Files:**
- Modify: `README.md` (tabel CLI Command Reference, sekitar `README.md:203-236`)
- Modify: `web/README.md` (catatan aksi dashboard)
- Create: `web/apps/dashboard/e2e/hapus-app.spec.ts`

**Interfaces:**
- Consumes: semua task sebelumnya; biner terpasang di VPS; skrip `scripts/mint-session-cookie.mts` untuk sesi Playwright.

- [ ] **Step 1: Tulis docs**

README: satu baris tabel untuk `autore hapus-app <nama> --konfirmasi <nama>` plus kalimat bahwa repo GitHub tidak disentuh dan riwayat build ikut hilang. `web/README.md`: satu paragraf bahwa aksi remove butuh peran admin dan konfirmasi nama.

- [ ] **Step 2: Tulis e2e**

`hapus-app.spec.ts`: buat app uji lewat CLI (`connect` pada repo uji tanpa `/health`), buka `/applications` dengan cookie sesi admin, klik Hapus, ketik nama, konfirmasi, harapkan toast sukses dan app hilang dari daftar. Sesi qa/dev diuji menolak: tombol tetap ada, jawaban 403, app masih ada.

- [ ] **Step 3: Deploy ke VPS dan jalankan Playwright**

Run (di VPS setelah `git am`): `cargo build --release --bin autore`, pasang ke dua path dengan backup, build dashboard, restart unit, lalu `npx playwright test` di `web/apps/dashboard`.
Expected: semua spec lulus, termasuk spec baru.

- [ ] **Step 4: Bukti manual lima tempat**

Jalankan satu hapus lewat dashboard pada app uji, lalu cek: `docker ps -a | grep <app>` kosong, job Jenkins 404, `registry.tsv` tidak memuat `<app>`, `environments.json` tidak memuat kunci `<app>`, folder tidak ada. Simpan keluaran ini di catatan eksekusi plan.

- [ ] **Step 5: Commit dan push dari VPS**

```bash
git add README.md web/README.md web/apps/dashboard/e2e/hapus-app.spec.ts
git commit -m "docs+e2e: hapus app dari dashboard"
```

Lalu `git format-patch`, `scp`, `git am` di VPS, `git push origin main`, dan tunggu `autore-e2e` SUCCESS untuk commit itu.

---

## Catatan Eksekusi

(Diisi saat eksekusi: nomor build Jenkins, sha256 biner, keluaran bukti lima tempat, penyimpangan dari plan.)
