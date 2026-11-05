# Phase 6 — Repository Health (Stat Card ke-5)

Rencana TDD (RED → GREEN) untuk Autore. Bahasa kerja: Indonesia.
Target rilis: `autore status --json` membawa `repository_health`, Hono memvalidasi, dashboard menampilkan kartu ke-5 "Repository Health" di barisan statistik, plus satu perbaikan UI kecil (sembunyikan baris author kosong di Active Pipelines).

---

## 1. Kondisi data nyata di VPS (hasil pemeriksaan sebelum menulis rencana)

Fakta yang mengubah bentuk pekerjaan ini — bukan asumsi:

1. `~/autore-workspace/dashboard-status.json` saat ini: `applications: []`, `stats.total_apps: 0` (tersimpan), tapi `autore status --json` **membangun ulang** daftar aplikasi dari `registry.tsv` → `total_apps: 10`.
2. `registry.tsv` = 10 baris: `tes-web, tes-web3, ui-demo, ui-demo2, ui-demo3, tes-tahap, uji-kontoh, uji-kontoh2, uji-batal, uji-kosong`.
3. `/api/status` nyata: **semua 10 aplikasi `unknown`**, `security_issues: 0`.
4. `applications[].status` **hanya** ditulis oleh `cli/src/serve.rs:459` (`catat_kemajuan`) — yaitu alur build yang dijalankan **dari dashboard**. `autore pipeline record` (jalur Jenkins) **tidak pernah** menulis status aplikasi; ia hanya menulis `latest_pipeline`.
5. Konsekuensi: kartu Repository Health akan **selalu 0% / bronze 10** kalau kita cuma menghitung dari data sekarang. Karena itu Phase 6 harus menambah jalur pencatatan per aplikasi (Task 1), bukan cuma berhitung (Task 2).
6. `latest_pipeline` **tidak per-aplikasi** (tidak ada field `app`); `pipeline record` dipanggil `record()` di `vars/autorePipeline.groovy` tanpa nama aplikasi, walau `APP_NAME` sudah ada di `environment{}` pipeline. Stage 9 "Deploy by Verified Digest" mencatat stage id **`periksa`** (`vars/autorePipeline.groovy:221`) → itulah penanda "sudah deploy".
7. Root `Jenkinsfile` = `autorePipeline()` tanpa argumen → `appName` default `autore-dummy` (bukan baris registry), maka build `autore-e2e` **tidak** menggeser angka health. `tes-web/Jenkinsfile` memakai `appName: 'tes-web'` → baris registry, ini yang akan jadi gold pertama.
8. Shared library Jenkins `autore` diambil dari **GitHub `Autore.git`@main** (`GlobalLibraries.xml`, `libraryPath: .`) → mendorong perubahan `vars/autorePipeline.groovy` cukup dengan `git push`; tidak ada salinan lokal yang perlu disinkronkan (`workflow-libs/` kosong).
9. Kontrak validator Hono **ketat** (`hasKeys` menolak kunci di luar daftar) → menambah field di CLI tanpa memperbarui `status.ts` membuat **seluruh** endpoint status gagal. Urutan rilis harus CLI → Hono → dashboard dalam satu langkah.
10. `StatCard` (`components/stat-card.tsx`) menaruh ikon di **kiri** label dan sudah punya prop `hint`. Rancangan Snorlx minta ikon di kanan atas → kartu ini dibuat sebagai komponen sendiri (lihat D5).
11. Baris author di Active Pipelines: `active-pipelines.tsx:72-78` (avatar `inisial(p.author)` + `dash(p.author)` → `?` + `—` saat kosong).

---

## 2. Kontrak target

`autore status --json` (field baru ditandai **baru**):

```json
{
  "system_status": "idle",
  "infra": { "jenkins": "active", "nexus": "active" },
  "stats": { "total_apps": 10, "running_containers": 12 },
  "repository_health": {
    "score_percent": 10,
    "total_repos": 10,
    "gold": 1,
    "silver": 0,
    "bronze": 9
  },
  "applications": [
    { "id": "tes-web", "name": "tes-web", "status": "passed", "last_build": "2026-11-05T06:02:40Z",
      "commit_sha": "56a6123", "security_issues": 0, "deployed": true }
  ],
  "latest_pipeline": { "...": "tidak berubah" }
}
```

Aturan klasifikasi (per baris registry, `total_repos = applications.len()`):

| Kelas | Syarat |
|---|---|
| gold | `status == "passed"` **dan** `deployed == true` |
| silver | `status == "passed"` **dan** `deployed == false` |
| bronze | sisanya: `unknown`, `failed`, `running`, `pending`, `idle`, `skipped` |

`score_percent = (gold * 100 + silver * 50) / total_repos` — pembagian bilangan bulat (floor), `total_repos == 0` → `0` (tanpa pembagian nol).

Angka nyata setelah wiring Task 8 selesai dan `tes-web` build sekali lagi: `gold 1, silver 0, bronze 9` → **10%**. Sebelum build itu: `0/0/10` → **0%**.

---

## 3. Keputusan rancangan

- **D1 — Gold dihitung dari status tersimpan, bukan dengan memanggil Jenkins per aplikasi.** Alternatif (10 job Jenkins tiap refresh) ditolak karena alasan yang sama dengan D2 Phase 5: satu refresh = N panggilan HTTP, padahal data sudah ada di snapshot. `passed` sendiri hanya pernah ditulis jalur Jenkins (`pipeline record`) atau alur serve; tidak ada sumber yang bisa memalsukannya.
- **D2 — `--app <nama>` eksplisit di CLI**, bukan membaca `APP_NAME` diam-diam dari environment. Tersurat, bisa diuji, tidak ada kopling tak terlihat antara groovy dan CLI.
- **D3 — Status aplikasi hanya ditulis pada `passed`/`failed`**, meniru komentar yang sudah ada di `serve.rs`: build yang masih `running` tidak boleh mengklaim apa pun. Jadi kartu tidak berkedip 10% → 0% → 10% di tiap build.
- **D4 — `deployed` bersifat "pernah"**: di-latch `true` saat stage `periksa` tercatat, **tidak** dihapus oleh `--reset` (build baru) maupun build gagal. Satu-satunya cara hilang: aplikasi dihapus dari `registry.tsv`. Ini yang diminta kata "pernah sukses di Jenkins".
- **D5 — `repository_health` wajib di validator Hono; `deployed` pada application opsional.** CLI dan Hono naik bersama di mesin yang sama, jadi kunci wajib aman; `deployed` mengikuti pola `stage_times` supaya snapshot lama (tanpa field itu) tetap dimuat, bukan membikin endpoint gagal.
- **D6 — Kartu ke-5 = komponen sendiri `repository-health-card.tsx`**, bukan menambah prop ke `StatCard`. Tata letak yang diminta (judul kiri atas, ikon medali kanan atas) berbeda dari 4 kartu lain (ikon kiri); menambah opsi `iconSide` ke `StatCard` = abstraksi yang baru punya satu pemakai (YAGNI). Grid statistik jadi `lg:grid-cols-5`.
- **D7 — Hitungan memakai daftar registry** (sumber yang sama dengan `stats.total_apps`), supaya "10 repos" di kartu selalu sama dengan "Total Terdaftar". Build `autore-e2e` (yang mencatat `autore-dummy`) tidak dihitung karena bukan baris registry.

---

## 4. Task (TDD, RED dulu — setiap tugas: tulis tes yang gagal, jalankan, baru hijaukan)

### T1 — Rust: `pipeline record --app` mencatat status per aplikasi

RED (`cli/tests/pipeline_record_cli.rs`, gaya berkas itu: helper `autore(ws)`, `simpanan(ws)`):
- Perluas `bantuan_menampilkan_seluruh_flag_kontrak` dengan `--app`.
- `record_app_menandai_aplikasi_yang_lulus`: `pipeline record --app tes-web --status passed --commit abc123` → `autore status --json` memuat `applications[tes-web].status == "passed"`, `deployed == false`.
- `record_app_stage_periksa_menandai_deploy`: `--app tes-web --status running --stage periksa` → `deployed == true`, `status` tetap `unknown` (belum ada hasil akhir).
- `record_app_status_running_tidak_menimpa_hasil_sebelumnya`: `passed` lalu `running` → tetap `passed`.
- `record_app_gagal_menandai_failed_dan_deploy_tetap_true`: `periksa` → `failed` ⇒ `deployed` tetap `true`, kelas jadi bronze.
- `record_tanpa_app_tidak_menyentuh_applications`: jalur lama tidak berubah.
- Perluas `simpanan_lama_tanpa_field_baru_tetap_dimuat` untuk `deployed`.

GREEN:
- `cli/src/pipeline_record.rs`: `pub app: Option<String>` (`#[arg(long, value_name = "NAMA")]`); merge ke `snap.applications` dengan aturan D3/D4 (cari `a.name == nama`, buat entri bila belum ada, `deployed |= stage berisi "periksa"`).
- `cli/src/status.rs`: `Application.deployed: bool` dengan `#[serde(default)]` + nilai `false` di dua tempat pembuatan `Application` (default snapshot & `build()`).

Verifikasi: `cargo test --test pipeline_record_cli` lalu `cargo test`.

### T2 — Rust: `repository_health` di `status --json`

RED (unit tes di `cli/src/status.rs`):
- Tabel klasifikasi: `[]` → `0/0/0/0`; 10 unknown → `score 0, bronze 10`; 1 gold + 1 silver + 8 bronze → `15`; 10 gold → `100`; 1 gold dari 3 (2 unknown) → `33` (floor); 1 app `running` → bronze.
- Tes bentuk JSON: `autore status --json` memuat kunci `repository_health` dengan empat field bilangan bulat ≥ 0.

GREEN:
- `pub struct RepositoryHealth { score_percent: u32, total_repos: u32, gold: u32, silver: u32, bronze: u32 }`.
- `fn hitungan_kesehatan(apps: &[Application]) -> RepositoryHealth` (fungsi murni, mudah diuji).
- `Snapshot.repository_health` + `#[serde(default)]` (snapshot lama tetap dimuat) + diisi di `build()` setelah `snap.stats.total_apps`.

Verifikasi: `cargo test`, lalu di VPS `cargo build --release --manifest-path cli/Cargo.toml && ./cli/target/release/autore status --json | jq .repository_health` → harus `0/10/0/0/10` sebelum T8 dijalankan.

### T3 — Hono: validasi `repository_health` + `deployed`

RED (`web/apps/api/src/status.test.ts`):
- Payload `fixture` + `repository_health` → diterima, nilai diteruskan apa adanya.
- `gold: -1`, `gold: 1.5`, `gold: "1"` → ditolak (`invalid Autore status JSON`).
- Kunci asing di dalam `repository_health` → ditolak.
- Application dengan `deployed: true` → diterima; `deployed: "ya"` → ditolak; tanpa `deployed` → diterima (kompatibilitas snapshot lama).
- `repository_health` hilang → ditolak (kunci wajib).

GREEN: tipe + `isRepositoryHealth` + masukkan ke `hasKeys` `isDashboardStatus`; `isApplication` menerima `deployed` lewat daftar opsional.

Verifikasi: `npx vitest run web/apps/api` (VPS: `cd ~/Autore/web`).

### T4 — Kontrak dashboard + fixture

RED: `tsc -p apps/dashboard --noEmit` gagal karena `DashboardStatus` belum punya `repository_health` (fixture di `app/page.test.tsx`, `app/pipeline/page.test.tsx`, `app/applications/page.test.tsx`, `components/dashboard-overview.test.tsx`).

GREEN: `lib/contracts.ts` — `export type RepositoryHealth`, `DashboardStatus.repository_health`, `ApplicationRecord.deployed?: boolean`; tambahkan `repository_health` ke setiap fixture status di berkas tes.

Verifikasi: `npx tsc -p apps/dashboard --noEmit` bersih.

### T5 — Dashboard: kartu ke-5 "Repository Health"

RED:
- `components/repository-health-card.test.tsx` (baru): judul `Repository Health`; ikon `Medal` ada & `aria-hidden="true"`; nilai besar `21%`; teks kecil `10 repos · 0 gold · 0 silver · 10 bronze`; kasus `0%` dan `total_repos 0` tidak mencetak `NaN`.
- `components/dashboard-overview.test.tsx`: kartu tampil di dalam `<section aria-label="Statistik">` bersama 4 kartu lain, dan memakai `data.repository_health`.

GREEN: `components/repository-health-card.tsx` (judul kiri atas, ikon `Medal` dari `lucide-react` di kanan atas, angka `text-xl` kiri bawah, teks kecil `text-xs text-muted`) + pasang di `dashboard-overview.tsx` sebagai anak ke-5 `<section aria-label="Statistik">` + ubah grid ke `lg:grid-cols-5`.

Verifikasi: `npx vitest run apps/dashboard`.

### T6 — UI minor: sembunyikan baris author kosong

RED (`components/active-pipelines.test.tsx`): payload dengan `author: ""` → `queryByText("?")` null dan tidak ada teks author; payload dengan `author: "tugure"` → baris author tampil (tes lama tetap lolos).

GREEN: `active-pipelines.tsx` — bungkus blok avatar+nama dengan `{p.author ? (…) : null}`.

Verifikasi: `npx vitest run apps/dashboard`.

### T7 — e2e

RED (`e2e/dashboard.spec.ts`): stub `/api/status` memuat `repository_health` → assert judul `Repository Health`, nilai `21%`, dan teks kecilnya terlihat; sekaligus assert kartu kelima ada di barisan statistik (baseline 23 tes → 24).

GREEN: tidak ada kode produksi baru; perbaiki stub/fixture e2e bila perlu.

Verifikasi: `LD_LIBRARY_PATH=/tmp/pwdeps/root/usr/lib/x86_64-linux-gnu npx dotenv -e .env -- npm run test:e2e --workspace @autore/dashboard`.

### T8 — Wiring Jenkins + verifikasi angka nyata

1. `vars/autorePipeline.groovy` — di dalam closure `record` (satu tempat, 7 pemanggil ikut terbawa):
   `parts += ['--app', q(appName)]` (lewati bila `appName` kosong).
2. Naikkan binary yang dipakai Jenkins: `sudo install -m 0755 ~/Autore/cli/target/release/autore /usr/local/bin/autore` — **butuh password sudo, jadi dijalankan atas persetujuan bos alif** (perintah disiapkan; T8 tidak jalan sebelum itu). Web API tidak terpengaruh karena unit `autore-web-api` memakai `AUTORE_BIN` absolut ke `cli/target/release/autore`.
3. `git push origin main` (repo Autore) → shared library Jenkins ikut terambil dari GitHub saat build berikutnya.
4. Nyalakan ulang API + dashboard dengan build terbaru, lalu picu build `tes-web` **dari tombol Deploy di dashboard** (sekalian menguji jalur itu, sesuai catatan bos alif).
5. Bukti wajib setelah build SUCCESS: `curl :9121/api/status | jq .data.repository_health` → `{score_percent: 10, total_repos: 10, gold: 1, silver: 0, bronze: 9}` dan `applications[]` memuat `tes-web` `passed` + `deployed: true`; screenshot kartu di `:9120`.

---

## 5. Gate akhir (angka target, dari baseline yang terukur)

| Gate | Baseline | Target |
|---|---|---|
| `cargo test` | 220 passed / 0 failed | ~228 passed / 0 failed |
| `cargo clippy --all-targets -- -D warnings` | exit 0 | exit 0 |
| `npx vitest run` (web) | 36 berkas / 281 passed | ~38 berkas / ~292 passed |
| `npx tsc -p apps/dashboard --noEmit` | bersih | bersih |
| e2e Playwright | 23 passed | 24 passed |
| Verifikasi live VPS | — | health `10/10/1/0/9` + screenshot kartu |

`cargo fmt --check` **bukan** gate (toolchain stabil tanpa komponen `rustfmt`), sama seperti Phase 5.

---

## 6. Pertanyaan untuk bos alif (dijawab sebelum eksekusi T1)

1. **Contoh angka.** `score_percent: 21` dengan `gold 0, silver 0, bronze 10` tidak bisa dihasilkan formula `(gold*100 + silver*50)/total` untuk `total 10` (21% butuh total 100, atau pembulatan lain). Pakai formula lo apa adanya (bilangan bulat, pembulatan ke bawah) → kartu sekarang tampil **0%**, dan naik **10%** tiap satu repo gold dari 10? Atau lo mau skala/pembulatan lain?
2. **Silver hampir pasti 0.** Pipeline standar selalu deploy di stage 9 sebelum status `passed`, jadi "passed tapi belum deploy" cuma mungkin untuk pipeline yang tak punya stage deploy. Terima bahwa silver praktis kosong di setup ini?
3. **Copy teks kecil.** Lo tulis `10 repos dan 0 gold 0 silver 10 bronze`. Pilih mana: `10 repos · 0 gold · 0 silver · 10 bronze` (paling ringkas) atau `10 repo · 0 gold · 0 silver · 10 bronze`?
4. **Posisi kartu.** "Card ke-5" → kolom paling kanan (setelah Status Pipeline)? Atau ditaruh paling depan karena ini ringkasan kesehatan seluruh repo?
5. **Sudo install binary.** Biner `/usr/local/bin/autore` harus ikut naik supaya `--app` dikenali Jenkins. Lo yang menjalankan perintah `sudo install` (aku siapkan persis perintahnya), atau ada cara lain yang lo mau?

---

## 7. Batas yang disadari

- 9 repo lain (`ui-demo*`, `uji-*`, `tes-tahap`, `tes-web3`) tetap bronze sampai masing-masing dibangun; kartu akan menampilkan angka rendah untuk waktu yang lama. Ini jujur, bukan bug.
- Tidak ada backfill: aplikasi yang pernah sukses sebelum perubahan ini tetap `unknown` sampai build berikutnya (alternatifnya memanggil Jenkins per aplikasi — ditolak di D1).
- `author` pada kartu Active Pipelines untuk job yang tidak punya clone aplikasi tetap kosong → sekarang disembunyikan (T6), bukan ditebak.
