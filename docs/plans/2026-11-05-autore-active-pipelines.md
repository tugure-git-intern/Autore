# Plan: Section "Active Pipelines" di Overview (TDD RED-GREEN)

**Tanggal:** 2026-11-05 · **Repo:** `~/Autore` (VPS `100.80.3.14`, user `tugure`) · **Status:** menunggu persetujuan, belum dieksekusi

## Tujuan

Section baru di halaman Overview, **di atas** grafik "Tren 7 Hari": daftar pipeline yang **sedang berjalan** (`building: true`) atau **menunggu di queue** Jenkins, dalam bentuk grid kartu horizontal — nama job, branch, commit SHA (monospace), author (avatar inisial), badge status (Running biru pastel / Pending kuning pastel), dan garis tipis indeterminate di dasar kartu. UI polling tiap 10 detik. Kalau tidak ada yang aktif → empty state.

## Baseline yang diukur (2026-11-05, sebelum ada perubahan)

| Yang diukur | Hasil nyata | Cara |
|---|---|---|
| Job di Jenkins | 4: `autore-dummy` (disabled), `autore-e2e` (red, #139), `diag-ws` (blue), `tes-web` (red) | `curl -g -s -u "$U:$T" -G --data-urlencode "tree=jobs[name,color,lastBuild[...]]" http://127.0.0.1:8080/api/json` |
| Queue Jenkins sekarang | `{"_class":"hudson.model.Queue","items":[]}` — kosong | `curl .../queue/api/json` |
| Field yang Jenkins benar-benar kirim untuk satu build | `number`, `result`, `building`, `duration`, `estimatedDuration`, `timestamp`, `actions[].lastBuiltRevision.SHA1`, `actions[].lastBuiltRevision.branch[0].name` | build nyata `autore-e2e` #139: SHA `3878d9307475eb84316edde4e77f63fd0b98ae4e`, branch `main`, `building:false`, `duration:117405` |
| `changeSet` | **tidak ada** (job Autore `git clone` di dalam stage) → author tidak ada di Jenkins | dibaca dari `autore-e2e`: tidak ada `changeSet` pada `actions` |
| Endpoint Hono yang ada | `GET /healthz`, `/api/status`, `/api/runs`, `POST /api/actions/{deploy,scan}` | `web/apps/api/src/index.ts` |
| Cache backend | `/api/runs` = 60 s (`CACHE_MS = 60_000` di `runs.ts`) | `web/apps/api/src/runs.ts:11` |
| Pola polling di UI | **belum ada satupun** — `grep -rn "setInterval" web/apps/dashboard/src` → hanya `setTimeout` toast 6 s di `action-button.tsx:65` | grep |
| Rewrite `/api` di Next | daftar eksplisit 3 endpoint: `/api/status`, `/api/runs`, `/api/actions/:path*` | `web/apps/dashboard/next.config.ts` |
| Registry app (untuk author dari clone lokal) | 10 app: `tes-web, tes-web3, ui-demo, ui-demo2, ui-demo3, tes-tahap, uji-kontoh, uji-kontoh2, uji-batal, uji-kosong` | `~/autore-workspace/registry.tsv` |
| Suite yang harus tetap hijau | vitest **244 tes / 31 file**; e2e **17 tes**; `tsc -p apps/dashboard` bersih; rust `cargo test` (angka diisi di Task 1 GATE) | dijalankan hari ini |
| Build Jenkins terakhir | #139 **FAILURE** di tahap 6 (Trivy final image scan `autore-dummy`, debian 13.7, 87 paket) — **bukan** akibat commit web; gerbang 1–3 + SonarQube LULUS | `consoleText` #139 |

## Global Constraints (non-negosiasi)

1. **CLI adalah otaknya.** Hono tidak boleh bicara ke Jenkins/Docker langsung; satu-satunya jalan adalah spawn `autore <subcommand> --json` dengan argv hardcoded (`shell: false`). Fitur ini karenanya butuh subcommand Rust baru, bukan `fetch()` dari Node.
2. **Data yang tidak tersedia = string kosong `""`, bukan `null`** — konvensi `status.rs` / `runs.rs`; UI merendernya jadi `—` lewat `dash()`.
3. **Validator Hono fail-closed:** exact key set; payload CLI yang berubah bentuk → endpoint 503/`stale`, bukan angka karangan.
4. **Gaya UI:** light mode saja, border 1px, tanpa gradient, shadow maksimal `shadow-sm`, font Inter, copy Indonesia, ikon `lucide-react`.
5. **Invarian e2e yang sudah ada tetap berlaku** (heading + `scrollWidth ≤ 1280` + tidak ada gradient/shadow berat). Section baru wajib lolos gerbang itu.
6. **Tidak ada `sudo`, tidak ada push, tidak ada trigger Jenkins, tidak ada restart service** tanpa persetujuan eksplisit. Task berhenti setelah hijau.
7. Semua kerja Autore di **VPS**, bukan laptop.
8. Satu task = satu commit; lapor RED + GREEN nyata, bukan ringkasan.

## Keputusan desain

### D1 — Endpoint baru `GET /api/active`, bukan menambah field ke `/api/runs`

Alasan: `/api/runs` punya `CACHE_MS = 60_000` dan payload-nya divalidasi exact-key-set. Data "sedang berjalan" yang dipolling tiap 10 detik butuh TTL ≤ 10 detik; menurunkannya ke semua konsumen berarti grafik 7 hari + Recent Runs ikut kehilangan cache 60 detik dan Jenkins dipanggil 6× lebih sering untuk data yang tidak berubah cepat. Dua endpoint = dua TTL, tanpa mengubah satu byte kontrak lama.

`ponytail:` Satu endpoint dengan parameter `?ttl=` akan lebih ringkas, tapi menaruh kebijakan cache di URL = permukaan baru untuk disalahgunakan; tambah kalau kelak ada konsumen ketiga yang butuh TTL lain.

### D2 — Sumber data: **2 panggilan HTTP ke Jenkins**, bukan 11

`autore runs` memanggil `/job/<app>/api/json` per app dari registry (10–11 panggilan). Untuk polling 10 detik itu terlalu mahal. Pipeline aktif dibaca dari **root**: `GET {base}/api/json?tree=jobs[name,lastBuild[number,building,timestamp,actions[lastBuiltRevision[SHA1,branch[name]]]]]` (semua job sekali) + `GET {base}/queue/api/json?tree=items[id,task[name],why,inQueueSince]` (queue sekali). Dua panggilan per refresh, apa pun jumlah job.

`ponytail:` Kalau jumlah job melewati ~200, root listing jadi berat → ganti ke `/api/json?tree=jobs[name,color]` lalu query per job yang `color` menyala. Tambah saat itu terjadi.

### D3 — Tidak difilter registry — nama job Jenkins = nama pipeline

Registry (`~/autore-workspace/registry.tsv`) memuat 10 app, Jenkins hanya punya 4 job dengan nama yang tidak semuanya ada di registry (`diag-ws`, `autore-dummy` tidak ada di registry). Filter by registry justru **menyembunyikan** build yang benar-benar sedang jalan (mis. `autore-e2e`, job pipeline repo ini). Karena itu daftar aktif = apa pun yang Jenkins laporkan sedang jalan/menunggu.

`ponytail:` Konsekuensi: job yang tidak pernah dipakai dashboard ikut muncul. Kalau user mau hanya app-nya sendiri, tambah filter registry di sisi CLI (bukan di UI) — satu loop di `active.rs`.

### D4 — Author dari clone lokal, avatar = inisial

Jenkins tidak mengirim `changeSet` untuk job ini (dibuktikan di baseline), jadi author diambil dari `git log -1 --format=%an <sha>` di `~/autore-workspace/<app>` (fungsi `cari_penulis` yang sudah dipakai `runs.rs`). Untuk item *queued* belum ada SHA sama sekali → `author: ""`, `commit_sha: ""`.

Avatar: tidak ada URL avatar GitHub di Jenkins (butuh plugin). Dipakai **lingkaran inisial** seperti `UserMenu` (`user.login.slice(0,2).toUpperCase()`), diekstrak jadi helper `inisial()`.

`ponytail:` Avatar asli butuh plugin/API GitHub; inisial selalu benar dan tidak menambah panggilan jaringan. Naikkan ke avatar GitHub kalau user memasang plugin-nya.

### D5 — Data progress tidak diambil

Garis indeterminate (tanpa persentase) seperti Snorlx — jadi tidak perlu `estimatedDuration`, stage, atau `wfapi`. Konsekuensinya: kartu tetap benar walau Jenkins tidak punya plugin workflow.

`ponytail:` `estimatedDuration` + `timestamp` sudah ada di respons yang kita ambil; bar persentase bisa ditambahkan tanpa panggilan baru kalau diminta.

### D6 — Bentuk payload CLI (kontrak baru, `autore active --json`)

```json
{
  "generated_at": "2026-11-05T03:41:07Z",
  "active": [
    {
      "app": "tes-web",
      "number": 42,
      "status": "running",
      "branch": "main",
      "commit_sha": "3878d9307475eb8",
      "author": "Alif",
      "started_at": "2026-11-05T03:39:12Z",
      "url": "http://100.80.3.14:8080/job/tes-web/42"
    },
    {
      "app": "ui-demo",
      "number": 0,
      "status": "queued",
      "branch": "",
      "commit_sha": "",
      "author": "",
      "started_at": "",
      "url": "http://100.80.3.14:8080/job/ui-demo"
    }
  ],
  "counts": { "running": 1, "queued": 1 }
}
```

- `status`: `"running" | "queued"`.
- `number: 0` = belum ada nomor build (item masih di queue) — Hono memvalidasi `>= 0`.
- `branch` dinormalisasi: `refs/remotes/origin/main` dan `refs/heads/main` → `main`.
- Urutan: `running` dulu (mulai paling lama dulu), lalu `queued` (yang paling lama menunggu dulu) — supaya kartu tidak melompat tiap poll.

### D7 — Cache Hono 5 detik + `stale` seperti `/api/runs`

Polling 10 detik dari beberapa tab tidak boleh berarti Jenkins dipanggil 10× per 10 detik. `CACHE_MS = 5_000` di `active.ts`, dan saat CLI gagal: kirim data terakhir yang baik dengan `stale: true`; kalau belum pernah sukses → `{"active": [], "counts": {running:0,queued:0}}` + `stale: true`. Endpoint **tidak pernah 5xx** karena Jenkins diam.

`ponytail:` Tidak ada backoff saat Jenkins mati — cache 5 detik sudah membatasi beban. Tambah backoff kalau kelak ada laporan Jenkins keberatan.

### D8 — Polling di komponen, 10 detik, berhenti saat unmount

Tidak ada pustaka (`swr`/`react-query`) yang terpasang dan tidak akan ditambah untuk satu endpoint. Hook kecil: `setInterval` 10 s + `AbortController` per request + tidak menumpuk request (skip kalau yang sebelumnya belum selesai) + reset saat tab kembali terlihat.

`ponytail:` Tab yang disembunyikan tetap dipolling (browser biasanya men-throttle jadi ≥ 1 menit). Kalau mau hemat, tambah guard `document.visibilityState`. Satu baris.

## Task 1 — Rust: parsing `active` dari Jenkins (fungsi murni) → **commit 1**

**Berkas baru:** `cli/src/active.rs` (modul + `#[cfg(test)]`).

### RED

Tes di dalam `cli/src/active.rs` yang gagal karena modulnya belum ada:

```bash
cd ~/Autore && PATH=$HOME/.cargo/bin:$PATH cargo test --manifest-path cli/Cargo.toml active:: 2>&1 | tail -20
```

Harus mencetak `error[E0583]: file not found for module 'active'` (atau `unresolved import` setelah `mod active;` ditambahkan) — bukan hijau.

Fixture diambil **verbatim** dari Jenkins nyata (baseline di atas), bukan karangan:

```rust
const JOBS: &str = r#"{"jobs":[
  {"name":"tes-web","lastBuild":{"number":42,"building":true,"timestamp":1793848988000,
   "actions":[{},{"_class":"hudson.plugins.git.util.BuildData","lastBuiltRevision":
     {"SHA1":"3878d9307475eb84316edde4e77f63fd0b98ae4e","branch":[{"name":"main"}]}}]}},
  {"name":"diag-ws","lastBuild":{"number":7,"building":false,"timestamp":1793840000000,
   "actions":[{}]}},
  {"name":"autore-dummy","lastBuild":null}
]}"#;

// Bentuk item queue BELUM pernah terlihat hidup (queue kosong saat baseline).
// Diambil dari dokumentasi Jenkins API; field yang hilang harus jadi "" bukan panic.
const QUEUE: &str = r#"{"items":[
  {"id":11,"why":"Menunggu node tersedia","inQueueSince":1793849100000,"task":{"name":"ui-demo"}}
]}"#;
```

Tes yang wajib ada:

| Nama tes | Yang dijamin |
|---|---|
| `hanya_build_building_yang_jadi_running` | `diag-ws` (building:false) **tidak** ikut; `autore-dummy` (lastBuild null) tidak panik |
| `sha_dan_branch_dibaca_dari_last_built_revision` | `commit_sha` = SHA nyata, `branch` = `main` |
| `branch_refs_dinormalisasi` | `refs/remotes/origin/main` dan `refs/heads/main` → `main`; `refs/tags/v1` → `v1` |
| `queue_jadi_status_queued_dengan_number_nol` | item queue → `status:"queued"`, `number:0`, `commit_sha:""`, `started_at:""`, `url` tanpa nomor build |
| `queue_tanpa_task_tidak_panik` | item cacat dilewati, bukan `unwrap()` |
| `urutan_running_dulu_lalu_queued_terlama` | determinisme urutan kartu |
| `balasan_bukan_json_jadi_error_jelas` | pesan error menyebut Jenkins, bukan `unwrap` |
| `counts_menghitung_kedua_status` | `counts.running`/`counts.queued` cocok dengan isi `active` |

### GREEN

`cli/src/active.rs`:

- `pub struct PipelineAktif { app, number, status, branch, commit_sha, author, started_at, url }` + `pub struct LaporanAktif { generated_at, active, counts }`, semua `Serialize`.
- `pub fn status_branch(nama: &str) -> String` — normalisasi ref (murni, diuji).
- `pub fn parse_active(jobs_json: &str, queue_json: &str, base: &str) -> Result<LaporanAktif, String>` — murni, tanpa I/O; author **belum** diisi di sini (diisi pemanggil, seperti `susun_laporan` di `runs.rs`).
- `mod active;` di `main.rs`.

### GATE

```bash
cd ~/Autore && PATH=$HOME/.cargo/bin:$PATH cargo test --manifest-path cli/Cargo.toml 2>&1 | grep -E "^test result"
cd ~/Autore && PATH=$HOME/.cargo/bin:$PATH cargo clippy --manifest-path cli/Cargo.toml --all-targets -- -D warnings 2>&1 | tail -2
```
Harus `205 → 205 + 8` tes, `0 failed`, dan clippy bersih. (Baseline hari ini: **205 passed / 0 failed**; `cargo clippy --all-targets -- -D warnings` → exit 0. `cargo fmt --check` **tidak bisa dipakai**: komponen `rustfmt` belum terpasang di toolchain VPS, jadi bukan gate.)

### COMMIT

`feat(cli): baca pipeline aktif dan queue jenkins jadi payload json`

## Task 2 — Rust: subcommand `autore active --json` → **commit 2**

### RED

Tes yang gagal lebih dulu:

| Nama tes | Yang dijamin |
|---|---|
| `url_jobs_dan_queue_disusun_dari_base_ternormalisasi` | URL root + queue dibangun dari `normalize_jenkins_url` (test dengan helper URL builder murni, tanpa jaringan) |
| `laporan_kosong_saat_tidak_ada_yang_aktif` | queue kosong + tidak ada `building:true` → `{"active":[],"counts":{"running":0,"queued":0}}` (bukan `null`, bukan error) |
| `author_diisi_dari_clone_lokal_atau_kosong` | SHA tanpa clone lokal → `author:""` (memakai `cari_penulis` yang sudah ada) |

### GREEN

- `Commands::Active { #[arg(long)] json: bool }` di `main.rs` (dekat `Runs`), arm → `active::jalankan(json)`.
- `pub fn jalankan(json: bool) -> i32`: baca config Jenkins (`load_config_from`; tanpa config → pesan + `exit 1`, sama seperti `runs`), lalu **2** panggilan `curl_with_stdin_config` (`-g -sS --max-time 15 -w '\n__HTTP_CODE__:%{http_code}' --config -`): root jobs + queue. HTTP ≥ 400 → error jelas. Isi `author` lewat `cari_penulis(&workspace_dir().join(app), sha)` (hanya untuk yang `running`).
- Tanpa `--json`: tabel ringkas (`APP`, `#`, `STATUS`, `BRANCH`, `SHA`, `PENULIS`) atau `Belum ada pipeline yang berjalan.`

### GATE

```bash
cd ~/Autore && PATH=$HOME/.cargo/bin:$PATH cargo build --release --manifest-path cli/Cargo.toml 2>&1 | tail -3
~/Autore/cli/target/release/autore active --json | head -c 300
~/Autore/cli/target/release/autore active
```
Bukti nyata yang diharapkan sekarang (queue kosong, tidak ada build jalan): `{"generated_at":"…","active":[],"counts":{"running":0,"queued":0}}` dan `Belum ada pipeline yang berjalan.` — **kalau ada build yang kebetulan jalan, itu justru bukti lebih baik**: tempel output aslinya.

### COMMIT

`feat(cli): subcommand active untuk pipeline yang sedang jalan`

## Task 3 — Hono: `GET /api/active` + cache 5 detik → **commit 3**

**Berkas:** `web/apps/api/src/active.ts` (+ `active.test.ts`), `index.ts`, `index.test.ts`.

### RED

```bash
cd ~/Autore/web && npx vitest run apps/api/src/active.test.ts 2>&1 | tail -20
```
Gagal: `Failed to resolve import "./active"`.

| Nama tes | Yang dijamin |
|---|---|
| `payload_sah_lolos_validasi` | bentuk D6 diterima apa adanya |
| `kunci_tambahan_ditolak` | strict exact key set (konvensi `runs.ts`) |
| `status_di_luar_running_queued_ditolak` | `"passed"` di `active[]` → invalid |
| `number_negatif_ditolak` / `number_nol_diterima` | queue (`0`) sah, `-1` tidak |
| `cli_gagal_sebelum_ada_data_baik_jadi_payload_kosong_stale` | `{active:[],counts:{…0},stale:true}`, bukan lempar |
| `cli_gagal_setelah_ada_data_baik_pakai_data_terakhir_stale` | `stale:true` + data lama |
| `panggilan_kedua_dalam_lima_detik_tidak_spawn_cli` | cache 5 s benar-benar bekerja (runner dihitung) |

Tes endpoint di `index.test.ts`: `GET /api/active` → 200 `{data,stale}`; tanpa sesi tetap 200 (read-only, sama seperti `/api/runs`); `Cache-Control: no-store`.

### GREEN

- `active.ts` meniru `runs.ts` sepersis mungkin: `ACTIVE_ARGS = ["active", "--json"]`, `RUN_ACTIVE_CLI` via `execFile(process.env.AUTORE_BIN || "autore", …, {shell:false, timeout:15_000})`, `validateActive()`, `emptyActive()`, `getActive()` dengan `CACHE_MS = 5_000` + `lastGood`.
- `index.ts`: `app.get("/api/active", …)` + parameter `active: ActiveLoader = () => getActive()` (pola `RunsLoader` supaya mudah di-inject di tes).

### GATE

```bash
cd ~/Autore/web && npx vitest run apps/api 2>&1 | tail -5    # 69 → 69 + 8
```
Smoke nyata setelah rebuild binary (Task 2 sudah membangunnya):
```bash
curl -s localhost:9121/api/active | head -c 200    # setelah service API di-restart oleh user di tahap deploy
```

### COMMIT

`feat(api): endpoint active untuk pipeline yang sedang jalan`

## Task 4 — Next: rewrite `/api/active` + kontrak + client → **commit 4**

**Berkas:** `web/apps/dashboard/next.config.ts`, `web/apps/dashboard/playwright.config.ts` (komentar), `src/lib/contracts.ts`, `src/lib/active-client.ts` (+ test).

### RED

```bash
cd ~/Autore/web && npx vitest run apps/dashboard/src/lib/active-client.test.ts 2>&1 | tail -15
```
Gagal: `Failed to resolve import "./active-client"`.

| Nama tes | Yang dijamin |
|---|---|
| `mengambil /api/active dan mengembalikan payload` | `fetch("/api/active", {cache:"no-store", signal})` persis seperti `runs-client` |
| `http_503_jadi_error` | `runs request failed`-style error, tidak diam-diam kosong |
| `meneruskan penanda stale dari server` | `stale:true` diteruskan |

### GREEN

- `next.config.ts`: **tambah satu baris** `{ source: "/api/active", destination: "http://127.0.0.1:9121/api/active" }` ke daftar eksplisit yang sudah ada.
  **Ini bukan detail kosmetik** — rewrite lama `/api/:path*` pernah menelan seluruh `/api/auth/*` dan membuat login 404 selama satu sesi penuh. Endpoint baru yang lupa didaftarkan akan dijawab Hono `404 Not Found` (`text/plain`, 13 byte).
- `playwright.config.ts`: komentar daftar endpoint ikut diperbarui (komentar itu satu-satunya dokumentasi urutan rewrite).
- `lib/contracts.ts`: `ActiveStatus = "running" | "queued"`, `ActivePipeline` (bentuk D6 + komentar "CLI mengirim \"\" — bukan null"), `ActivePayload`, `ApiActiveResponse = {data, stale}`.
- `lib/active-client.ts`: `fetchActive(signal?)` meniru `runs-client.ts` sepersis mungkin (pesan error `active request failed: <status>`).

### GATE

```bash
cd ~/Autore/web && npx vitest run apps/dashboard/src/lib/active-client.test.ts 2>&1 | tail -5   # 3 hijau
npx tsc -p apps/dashboard/tsconfig.json --noEmit                                                # bersih
```

### COMMIT

`feat(web): kontrak dan klien untuk endpoint active`

## Task 5 — UI: `ActivePipelines` (section + kartu + badge + bar indeterminate) → **commit 5**

**Berkas:** `src/components/active-pipelines.tsx` (+ test), `src/components/ui/badge.tsx`, `src/lib/format.ts` (+ test).

### RED

```bash
cd ~/Autore/web && npx vitest run apps/dashboard/src/components/active-pipelines.test.tsx 2>&1 | tail -20
```
Gagal: modul belum ada.

| Nama tes | Yang dijamin |
|---|---|
| `judul_dan_hitungan_tampil` | heading `Active Pipelines` + teks `2 berjalan atau menunggu` (copy final menunggu jawaban Pertanyaan 1) |
| `ikon_petir_hijau_ada` | `Zap` dari `lucide-react` dengan kelas hijau (petir hijau seperti Snorlx) |
| `kartu_running_badge_biru_dan_bar_berkedip` | badge `Berjalan` tone biru pastel + elemen bar ber-`data-testid="progress-indeterminate"` |
| `kartu_queued_badge_kuning_tanpa_bar` | badge `Menunggu` tone kuning pastel, **tanpa** bar (belum jalan) |
| `sha_monospace_dipotong_tujuh` | `shortSha` dipakai; kelas `font-mono` |
| `branch_dan_penulis_tampil` | `main` + inisial author (`AL`) |
| `penulis_kosong_jadi_dash` | `dash()` dipakai, bukan string kosong |
| `empty_state_saat_tidak_ada_aktif` | copy empty state (menunggu jawaban Pertanyaan 2) |
| `stale_menampilkan_penanda_data_terakhir` | pola `RecentRuns` (`data terakhir`) |
| `tanpa_gradient_dan_shadow_berat` | kelas yang dipakai tidak menambah gradient/shadow > sm (menjaga gerbang e2e) |

Tes tambahan: `format.test.ts` → `inisial("Alif Fadlan") === "AL"`, nama satu kata, nama kosong → `"?"`.

### GREEN

- `ui/badge.tsx`: tambah tone `yellow: "bg-yellow-100 text-yellow-700"` (biru sudah ada: `bg-blue-100 text-blue-700`). Dua-duanya pastel, tanpa border tebal.
- `lib/format.ts`: `inisial(nama: string): string`.
- `components/active-pipelines.tsx` — komponen **presentational** (`{ active, counts, stale }`, tanpa fetch sendiri supaya bisa diuji tanpa timer):
  - Pembungkus `ChartCard title="Active Pipelines" subtitle="Pipeline yang sedang berjalan atau menunggu"`; `action` = `<span className="inline-flex items-center gap-1 text-xs text-green-700"><Zap className="h-3.5 w-3.5" />{n} berjalan atau menunggu</span>`.
  - Grid: `grid gap-3 md:grid-cols-2 xl:grid-cols-3`.
  - Kartu: `Card className="flex flex-col justify-between overflow-hidden"` → baris 1 nama `app` + `#{number}` (nomor disembunyikan kalau `0`), baris 2 ikon `GitBranch` + branch, baris 3 SHA `font-mono text-xs` (link ke `url`, `target="_blank"`), baris 4 avatar inisial (`h-6 w-6 rounded-full bg-gray-100 text-[10px]`) + `dash(author)`.
  - Badge: `Berjalan` → tone `blue`; `Menunggu` → tone `yellow`.
  - Bar indeterminate di dasar kartu **hanya** untuk `running`: `<div className="h-0.5 w-full overflow-hidden bg-gray-100"><div data-testid="progress-indeterminate" className="h-full w-1/3 bg-blue-500/70 motion-safe:animate-[geser_1.4s_ease-in-out_infinite]" /></div>`; `-mx-5 -mb-5` supaya menempel di tepi kartu.
  - Empty state: satu kartu tipis berisi copy "Semua pipeline selesai" (Atau section disembunyikan — Pertanyaan 2).

### GATE

```bash
cd ~/Autore/web && npx vitest run apps/dashboard/src/components/active-pipelines.test.tsx apps/dashboard/src/lib/format.test.ts 2>&1 | tail -5
```

### COMMIT

`feat(web): section active pipelines dengan kartu status dan bar indeterminate`

## Task 6 — Polling 10 detik → **commit 6**

**Berkas:** `src/components/use-active-pipelines.ts` (+ test).

### RED

```bash
cd ~/Autore/web && npx vitest run apps/dashboard/src/components/use-active-pipelines.test.tsx 2>&1 | tail -20
```

| Nama tes (pakai `vi.useFakeTimers()`) | Yang dijamin |
|---|---|
| `memuat_sekali_saat_mount` | fetch pertama terjadi tanpa menunggu 10 s |
| `memuat_lagi_setelah_sepuluh_detik` | `advanceTimersByTime(10_000)` → fetch kedua |
| `tidak_menumpuk_saat_permintaan_sebelumnya_belum_selesai` | request menggantung → tidak ada fetch ketiga |
| `berhenti_setelah_unmount` | `clearInterval`; tidak ada fetch setelah unmount |
| `gagal_pertama_kali_tetap_menampilkan_hasil_lama` | error tidak mengosongkan kartu yang sudah ada |
| `stale_dari_server_diteruskan_ke_ui` | flag `stale` naik ke komponen |

### GREEN

`useActivePipelines(intervalMs = 10_000)` → `{ data, stale, memuat, gagal }`: `useEffect` + `setInterval`, `AbortController` per tick, guard `inFlight`, `clearInterval` + `abort()` di cleanup, state hanya ditimpa kalau request yang menyelesaikan masih yang terbaru.

`ponytail:` Tanpa exponential backoff saat gagal — 6 percobaan/menit ke loopback `127.0.0.1:9121` yang punya cache 5 s. Tambah backoff kalau Jenkins/API mulai keberatan.

### GATE

```bash
cd ~/Autore/web && npx vitest run apps/dashboard/src/components/use-active-pipelines.test.tsx 2>&1 | tail -5
```

### COMMIT

`feat(web): polling sepuluh detik untuk kartu pipeline aktif`

## Task 7 — Pasang di Overview **di atas** grafik → **commit 7**

**Berkas:** `src/components/overview-analytics.tsx` (+ `overview-analytics`/`page.test.tsx`).

### RED

Tes yang gagal: section harus muncul **sebelum** `Tren 7 Hari` di DOM:

```tsx
const judul = screen.getAllByRole("heading").map((h) => h.textContent);
expect(judul.indexOf("Active Pipelines")).toBeLessThan(judul.indexOf("Tren 7 Hari"));
```
Gagal karena `Active Pipelines` belum ada.

### GREEN

Di `OverviewAnalytics`, panggil `useActivePipelines()` dan render `<ActivePipelines … />` **di atas** `div.mt-6.grid` yang memuat `Tren 7 Hari` + `Distribusi`. `useEffect` lama untuk `/api/runs` tidak diubah; kalau `/api/active` gagal, hanya section ini yang kosong — kartu status di atasnya tetap tampil (pola yang sudah dipakai halaman ini).

### GATE

```bash
cd ~/Autore/web && npx vitest run apps/dashboard/src/components apps/dashboard/src/app 2>&1 | tail -5
npx tsc -p apps/dashboard/tsconfig.json --noEmit
```

### COMMIT

`feat(web): tampilkan pipeline aktif di atas grafik tren`

## Task 8 — CSS: keyframes bar indeterminate → **commit 8**

### RED

`globals.css` belum punya `@keyframes geser` → animasi tidak berjalan (bisa dipastikan lewat tes unit kecil yang membaca file? **tidak** — proyek menolak test pembaca sumber). Karena itu RED di sini diambil dari **e2e**: tes Task 9 akan gagal `Animation name "geser" tidak terdefinisi`/visual, dan itu dicatat sebagai RED bersama Task 9.

### GREEN

`app/globals.css`:

```css
@keyframes geser {
  from { transform: translateX(-100%); }
  to   { transform: translateX(300%); }
}
```

`ponytail:` Satu keyframes global dipakai satu komponen. Kalau kelak ada bar kedua dengan arah berbeda, pindahkan ke `@theme`/token animasi Tailwind — belum perlu sekarang.

### GATE

`npx vitest run apps/dashboard/src/components/active-pipelines.test.tsx` tetap hijau (kelas `motion-safe:animate-[geser_…]` sudah ada di Task 5).

### COMMIT

`style(web): keyframes bar kemajuan indeterminate`

## Task 9 — E2E: section, polling, dan endpoint publik → **commit 9**

**Berkas:** `apps/dashboard/e2e/dashboard.spec.ts`.

### RED

Tambahan tes yang gagal lebih dulu (dijalankan dengan cara yang sama seperti hari ini):

```bash
cd ~/Autore/web && npm run build:dashboard && LD_LIBRARY_PATH=/tmp/pwdeps/root/usr/lib/x86_64-linux-gnu npm run test:e2e
```
Gagal: `Active Pipelines` belum ada di build.

| Tes baru | Yang dijamin |
|---|---|
| `section Active Pipelines ada dan sebelum Tren 7 Hari` | posisi vertikal: `boundingBox().y` section < `boundingBox().y` kartu grafik |
| `hitungan pada badge sesuai jumlah kartu` | teks `… berjalan atau menunggu` konsisten dengan `[data-testid="pipeline-card"]` |
| `setiap kartu punya bar indeterminate hanya saat running` | `[data-testid="progress-indeterminate"]` ada ⇔ badge `Berjalan` |
| `GET /api/active tanpa sesi dijawab 200` | read-only tetap terbuka (tanpa sesi) dan bentuknya `{data:{active:[],counts:{…}},stale:…}` |
| `tanpa gradient/shadow berat` (sudah ada) | section baru tidak melanggar gerbang desain lama |

Screenshot baru: section ini ikut terekam di `dashboard.png` (sudah ada) + tambahan `active-pipelines.png` bila ada kartu.

### GREEN

Tidak ada kode produksi baru — kalau ada tes yang masih merah di sini, artinya bug Task 5/6/7, bukan tesnya. Perbaiki di commit perbaikan terpisah dan sebutkan di laporan.

### GATE

```bash
cd ~/Autore/web && npx vitest run 2>&1 | tail -3          # 244 → 244 + ~30, 31 → 35 file
npx tsc -p apps/dashboard/tsconfig.json --noEmit
npm run test:e2e 2>&1 | tail -5                            # 17 → 22 hijau
```

### COMMIT

`test(web): e2e section pipeline aktif dan endpoint publiknya`

## Task 10 — Verifikasi menyeluruh + serah terima (tanpa deploy) → **commit 10**

### GATE

```bash
cd ~/Autore && PATH=$HOME/.cargo/bin:$PATH cargo test --manifest-path cli/Cargo.toml 2>&1 | grep -E "^test result"
cd ~/Autore/web && npx vitest run 2>&1 | tail -3
npx tsc -p apps/dashboard/tsconfig.json --noEmit && echo "tsc bersih"
npm run build:dashboard 2>&1 | tail -5
npm run test:e2e 2>&1 | tail -3
git -C ~/Autore status --short && git -C ~/Autore log --oneline -10
```

### Deploy (butuh persetujuan terpisah — **jangan** dijalankan di dalam plan ini)

1. `cargo build --release --manifest-path cli/Cargo.toml` (unit API memakai `AUTORE_BIN=$HOME/Autore/cli/target/release/autore` = path absolut, jadi biner baru terbaca setelah restart unit). `~/.local/bin/autore` (0.5.6) **tidak berpengaruh** di jalur ini: unit systemd tidak menelusuri PATH untuk biner Autore. Tetap jangan pakai `autore` polos dari shell saat menguji manual — `~/.local/bin` lebih dulu di PATH sebagian orang, dan 0.5.6 belum punya subcommand `active` sehingga CLI akan menolak dengan pesan "perintah tidak dikenal" (bukan 503; 503 hanya muncul kalau unit yang menunjuk biner basi).
2. `systemctl --user restart autore-web-api`
3. `cd ~/Autore/web && npm run build:dashboard && systemctl --user restart autore-web-dashboard`
4. Bukti: `curl -s localhost:9121/api/active | head -c 200` dan `curl -s -o /dev/null -w '%{http_code}' -H 'Host: 100.80.3.14:9120' http://127.0.0.1:9120/api/active` → `200` (bukan 404 — cek rewrite).
5. Push: **sudah dilakukan** atas persetujuan user (9 commit di `main`). Catatan: `main` merah di Jenkins #139 karena Trivy menemukan HIGH/CRITICAL pada image `autore-dummy` (debian 13.7) — di luar fitur ini, tapi build berikutnya akan tetap merah sampai itu dibereskan.

## Status akhir (2026-11-05)

Task 1–9 dikerjakan TDD, Task 10 = gate penuh. Deploy lokal (bukan push, bukan trigger Jenkins) dijalankan atas persetujuan user supaya bisa dicek visual: `cargo build --release` + restart `autore-web-api`, `npm run build:dashboard` + restart `autore-web-dashboard`. Bukti: `GET /api/active` dari `:9121` dan dari `:9120` (lewat rewrite) balas `200` dengan bentuk kontrak.

| Gate | Baseline | Akhir |
|---|---|---|
| rust `cargo test` | 205 passed | **219 passed / 0 failed** |
| `cargo clippy --all-targets -- -D warnings` | exit 0 | exit 0 |
| vitest `web` | 244 passed | **281 passed / 36 file** |
| e2e Playwright | 17 passed | **23 passed** |

`cargo fmt --check` tetap **bukan** gate (rustfmt tak terpasang di toolchain VPS).

## Tabel RED → GREEN

| Task | RED (harus gagal) | GREEN | Bukti akhir |
|---|---|---|---|
| 1 | `cargo test active::` → `file not found for module 'active'` | parser murni + 10 tes | 205 → 219 tes, 0 failed |
| 2 | tes builder URL/empty/author merah | subcommand + 2 panggilan curl | `autore active --json` cetak JSON nyata; `active_cli.rs` menegaskan tepat 2 permintaan |
| 3 | `vitest active.test.ts` → `Failed to resolve import "./active"` | `active.ts` + endpoint | `apps/api` hijau |
| 4 | `vitest active-client.test.ts` → resolve gagal | rewrite + kontrak + client | 3 hijau, tsc bersih |
| 5 | `vitest active-pipelines.test.tsx` → modul tak ada | section + kartu + badge + bar | hijau |
| 6 | `vitest use-active-pipelines.test.tsx` → modul tak ada | hook polling 10 s | 7 hijau |
| 7 | urutan section merah | pasang di `OverviewAnalytics` | dashboard 201 hijau |
| 8 | bukan tes berkas (dilarang proyek); RED-nya animasi tak terbentuk | `@keyframes geser` | dibuktikan Task 9 lewat `getAnimations()` |
| 9 | 5 tes section gagal ("section tidak ada") di build lama | — | 17 → **23** e2e hijau |
| 10 | — | — | semua gate hijau, deploy lokal atas persetujuan |


## Review Focus (risiko terukur, bukan opini)

1. **Bentuk item queue belum pernah terlihat hidup.** Queue kosong saat baseline; fixture queue disusun dari dokumentasi Jenkins. Karena itu parser wajib tahan field hilang (`""`) dan melewati item cacat. Risiko: kalau Jenkins versi ini menaruh nama job di `task.name` **dan** `task.fullName` beda, kartu bisa kosong → mitigasi: pakai `task.name`, fallback `task.fullName` bila ada, dan `ponytail:` menyebutkan itu.
2. **Beban Jenkins.** Dengan D2 hanya 2 panggilan per refresh; cache 5 s + polling 10 s ⇒ ≤ 12 refresh/menit walau ada beberapa tab. Bandingkan: pola registry per-app akan 11 panggilan/refresh (≈ 130/menit).
3. **`building:true` bisa hilang di antara dua poll.** Build yang selesai di detik ke-3 menghilang dari kartu pada poll berikutnya — itu **memang** perilaku "live", tapi bikin tes e2e rapuh kalau mengandalkan ada build nyata. Karena itu e2e hanya menegaskan **struktur** (section ada, urutan benar, bar hanya saat running, endpoint 200), bukan "harus ada 1 kartu".
4. **Endpoint baru + rewrite eksplisit = 404 kalau lupa.** Sudah pernah kejadian untuk `/api/auth/*`; Task 4 memasangnya, Task 10 memverifikasi `200` dari `:9120`.
5. **Copy Indonesia vs permintaan verbatim.** Permintaan menulis "X running or pending" (bahasa Inggris); seluruh UI sekarang Indonesia (`Berjalan`, `Menunggu`, `Tren 7 Hari`). Plan memakai Indonesia; Pertanyaan 1 memutuskan.
6. **Tidak ada retry saat Jenkins mati.** Kartu terakhir tetap tampil dengan penanda `data terakhir` — sama seperti `RecentRuns`. Sengaja: dashboard tidak boleh berpura-pura tahu.

## Di luar cakupan

- Tidak menyentuh stage/progress persentase, log live, tombol cancel/abort dari UI.
- Tidak mengubah `/api/runs`, `/api/status`, grafik, Recent Runs, atau autentikasi.
- Tidak menambah tes unit untuk `next.config.ts` (rewrite diuji lewat e2e 200 di Task 9/10).
- Tidak memperbaiki build merah Trivy (`autore-dummy`) — pekerjaan terpisah.

## Pertanyaan (jawab singkat, cukup nomornya)

Sudah dijawab user: (1) copy Indonesia `X berjalan atau menunggu`, (2) section **tetap tampil** dengan teks `Semua pipeline selesai`, (3) judul verbatim `Active Pipelines`, (4) tampilkan semua kartu tanpa pemotongan, (5) kerjakan sampai hijau lalu stop tanpa push, cek visual manual dulu.

1. **Copy hitungan:** `2 berjalan atau menunggu` (Indonesia, konsisten UI) atau `2 running or pending` (verbatim seperti permintaan/referensi Snorlx)?
2. **Empty state:** tampilkan section dengan copy "Semua pipeline selesai", atau **sembunyikan** section saat tidak ada yang aktif?
3. **Judul section:** "Active Pipelines" (verbatim, seperti referensi) atau "Pipeline Aktif" (Indonesia)?
4. **Batas jumlah kartu:** tampilkan semua (biasanya 0–3) atau potong di 6 kartu + "+N lainnya"?
5. **Push:** kerjakan sampai hijau lalu **stop** (tanpa push), atau setelah hijau langsung push + pantau Jenkins?
