# Autore Phase 3 — Enterprise Visual & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Dashboard `:9120` berubah dari tabel + timeline vertikal jadi dashboard analytics padat data: grafik tren 7 hari, donut distribusi, Recent Runs, matriks tahap pipeline, filter aplikasi, dan halaman Keamanan dengan radar chart.

**Architecture:** CLI tetap otak. Subcommand baru `autore runs --json` membaca histori build dari Jenkins API (Basic auth dari `~/.config/autore/jenkins.conf`), mengambil author dari `git log` repo lokal, dan mengirim satu payload siap-render (runs + daily buckets + totals). Hono cuma `execFile` CLI, validasi bentuk, cache 60 detik, tandai `stale`. TypeScript hanya merender + aritmetika presentasi (kurang dua timestamp). Snapshot Rust ditambah `stage_times`, `finished_at`, `gates_passed`, `gates_total` supaya durasi per-tahap punya sumber nyata.

**Tech Stack:** Rust (clap, reqwest/ureq sesuai `cli/src/jenkins.rs`), Hono + Node 18, Next 15.5 App Router + React 19, Tailwind 4, Recharts 3.10.1, Vitest 3, Playwright.

**Spec:** `docs/plans/2026-11-04-autore-actionable-dashboard.md` (Phase 2) + permintaan user Phase 3 (5 fitur, verbatim di bagian Decisions).

## Global Constraints

- Node `v18.19.1`, React `19.1.1`, Next `15.5.28`. Semua dependency dipin **eksak** (tanpa `^`/`~`): `recharts` `3.10.1`, `react-is` `19.1.1`.
- Tidak ada dependency baru selain dua di atas.
- Semua `execFile` di API: `shell: false`, argv hardcoded, tidak pernah menerima string dari frontend.
- Kontrak JSON CLI ↔ Hono berubah **di commit yang sama** (validator Hono menolak key tak dikenal).
- Field baru di `Snapshot`/`Pipeline` wajib `#[serde(default)]` — `dashboard-status.json` lama harus tetap bisa dimuat.
- Visual: Light Mode, border `border-gray-200`, radius kecil, font Inter (`@fontsource/inter` sudah terpasang). Warna seri: passed `#16a34a`, failed `#dc2626`, running `#f59e0b`, grid `#e5e7eb`, teks `#64748b`.
- Copy bahasa Indonesia. Angka/tanggal: `DD/MM`, waktu relatif bahasa Indonesia.
- Bucket harian memakai **UTC** (`YYYY-MM-DD`), karena timestamp Jenkins epoch ms.
- Rust: `cargo fmt` tidak tersedia; `cargo clippy -- -D warnings` wajib exit 0. Tes: `scripts/run_tests.sh`.
- Web: `npx vitest run`, `npx tsc --noEmit`, `npm run build:dashboard` wajib hijau.
- Semua kerja di VPS (`ssh vps`, `~/Autore`). `cargo` butuh `. "$HOME/.cargo/env"`.

## Review Focus

1. **jsdom tanpa layout**: Recharts `ResponsiveContainer` mengukur 0×0 di jsdom → chart merender kosong. Tes wajib meng-assert **props/data**, bukan piksel, dan komponen wajib `"use client"` agar `next build` tidak gagal.
2. **Histori kosong**: Jenkins mati atau belum ada build → grafik tidak boleh `NaN`, sumbu tetap `DD/MM` 7 hari, donut total 0 tidak boleh bagi nol, Recent Runs menampilkan empty state.
3. **Author tak diketahui**: commit tidak ada di repo lokal → `—`, jangan pernah mengarang nama.
4. **Durasi hilang**: tahap pertama selalu tanpa durasi (timestamp pertama = akhir tahap 1), dan snapshot lama (`stage_times: []`) → `—`, bukan `0s`.
5. **Filter aplikasi**: query beda huruf besar/kecil + spasi tepi harus tetap menemukan baris, dan status `unknown` harus tetap menampilkan aplikasi yang cuma ada di registry.

---

### Task 1: Snapshot mencatat waktu tahap + jumlah gerbang

**Files:**
- Modify: `cli/src/status.rs` (`struct Pipeline`, fungsi derivasi)
- Modify: `cli/src/pipeline_record.rs` (merge peristiwa `stage`)
- Test: `cli/tests/pipeline_record_cli.rs`

**Interfaces:**
- Produces: `Pipeline.stage_times: Vec<StageTime>` (`{ id: String, at: String }`), `Pipeline.finished_at: String`, `Pipeline.gates_passed: u32`, `Pipeline.gates_total: u32`; `pipeline_record::parse_gates(&str) -> (u32, u32)`.

- [x] **Step 1: Tulis tes yang gagal** — tambahkan ke `cli/tests/pipeline_record_cli.rs`

```rust
#[test]
fn mencatat_waktu_tiap_tahap_dan_gerbang() {
    // 3 panggilan record berurutan: checkout → scan → passed
    // assert JSON `status --json`:
    //   latest_pipeline.stage_times.len() == 2
    //   stage_times[0].id == "checkout", stage_times[1].id == "scan"
    //   stage_times[0].at <= stage_times[1].at  (ISO8601, urut)
    //   finished_at != ""  saat status "passed"
    //   summary "9/9 gerbang lolos · digest sha256:abc" → gates_passed 9, gates_total 9
}
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `scripts/run_tests.sh -k mencatat_waktu_tiap_tahap` → gagal `missing field stage_times` / key tidak ada di JSON.

- [x] **Step 3: Implementasi**

Tambahkan ke `struct Pipeline` (semua dengan `#[serde(default)]`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct StageTime { pub id: String, pub at: String }
```

`parse_gates`: regex/manual scan pertama yang cocok `<angka>/<angka>` diikuti `gerbang lolos`; tidak cocok → `(0, 0)`. Dipanggil saat `summary` di-set di `pipeline_record::gabung`.

Logika merge di `pipeline_record::gabung`: untuk tiap `tahap` baru, `push` `StageTime { id, at: status::now_iso8601() }` (hanya bila `id` belum ada); saat `status` terminal (`passed`/`failed`) → `finished_at = now_iso8601()` dan `gates_*` dari `parse_gates(summary)`.

- [x] **Step 4: Tes hijau** — `scripts/run_tests.sh -k mencatat_waktu_tiap_tahap` → PASS, dan `scripts/run_tests.sh` penuh tetap hijau.

- [x] **Step 5: Commit**

```bash
git add cli/src/status.rs cli/src/pipeline_record.rs cli/tests/pipeline_record_cli.rs
git commit -m "feat(cli): snapshot catat waktu per tahap dan jumlah gerbang keamanan"
```

---

### Task 2: `runs.rs` — bentuk payload + bucket harian (murni, tanpa IO)

**Files:**
- Create: `cli/src/runs.rs`
- Modify: `cli/src/main.rs` (deklarasi `mod runs;`)
- Test: unit test di dalam `cli/src/runs.rs`

**Interfaces:**
- Produces:

```rust
pub struct BuildRingkas { pub number: u64, pub result: Option<String>, pub duration_ms: u64, pub timestamp_ms: u64, pub commit_sha: String }
pub struct RunRecord { pub app: String, pub number: u64, pub status: String, pub duration_ms: u64, pub started_at: String, pub commit_sha: String, pub author: String, pub url: String }
pub struct DailyPoint { pub date: String, pub passed: u32, pub failed: u32 }
pub struct Totals { pub passed: u32, pub failed: u32, pub running: u32 }
pub struct LaporanRuns { pub generated_at: String, pub window_days: u32, pub runs: Vec<RunRecord>, pub daily: Vec<DailyPoint>, pub totals: Totals }

pub fn status_dari_result(result: Option<&str>) -> &'static str;   // SUCCESS→"passed"; FAILURE|ABORTED→"failed"; None→"running"
pub fn parse_builds(json: &str) -> Result<Vec<BuildRingkas>, String>;
pub fn susun_laporan(sumber: Vec<(String, Vec<BuildRingkas>)>, penulis: &std::collections::HashMap<String, String>, days: u32, limit: usize, sekarang_ms: u64) -> LaporanRuns;
```

- [x] **Step 1: Tulis tes yang gagal** — `#[cfg(test)] mod tes` di `cli/src/runs.rs`

```rust
#[test]
fn pilih_sha_repo_aplikasi_bukan_checkout_library() {
    // fixture nyata dari Jenkins job tes-web: actions memuat DUA BuildData
    //   [ {lastBuiltRevision:{SHA1:"e9ae790..."}} , ..., {lastBuiltRevision:{SHA1:"2dfd6ef..."}} ]
    // assert parse_builds(...)[0].commit_sha == "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2"
}

#[test]
fn result_jenkins_dipetakan_ke_status() {
    // Some("SUCCESS")→passed, Some("FAILURE")→failed, Some("ABORTED")→failed, None→running
}

#[test]
fn bucket_harian_selalu_penuh_dan_urut() {
    // days=7, sekarang_ms = 1793783991779 (2026-11-04T...Z), satu build sukses 1 jam lalu
    // assert daily.len() == 7; daily[6].passed == 1; daily[0..6] semua 0; tanggal naik
}

#[test]
fn filter_jendela_lalu_urut_dan_batas_limit() {
    // 3 build: 10 hari lalu, 2 jam lalu, 1 jam lalu; days=7 limit=1
    // assert runs.len() == 1 dan runs[0].number == build terbaru
    // assert totals hanya menghitung jendela 7 hari (2 build)
}

#[test]
fn author_hilang_jadi_string_kosong() {
    // penulis tanpa sha build → author == ""
}
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `scripts/run_tests.sh -k runs::tes` → gagal kompilasi `cannot find module runs` / `not found`.

- [x] **Step 3: Implementasi**

`parse_builds` memakai `serde_json::Value`: ambil `["builds"]`, untuk tiap build ambil `number`, `result` (`null` → `None`), `duration` (default 0), `timestamp`, lalu **iterasi `actions` dan ambil `lastBuiltRevision.SHA1` TERAKHIR yang `branch[].name` dimulai `refs/remotes/origin/`**; kalau tidak ada yang cocok, pakai SHA1 terakhir apa pun; tidak ada → `""`.

`susun_laporan`: buang build dengan `timestamp_ms < sekarang_ms - days*86_400_000`; `status` dari `status_dari_result`; `started_at = status::iso8601_from_unix(timestamp_ms / 1000)`; urut `timestamp_ms` menurun; potong `limit`; `totals` dihitung dari **seluruh jendela** (bukan hasil potong); `daily` tepat `days` entri UTC naik (hari terakhir = hari `sekarang_ms`), `passed`/`failed` saja.

- [x] **Step 4: Tes hijau** — `scripts/run_tests.sh -k runs::tes` → PASS.

- [x] **Step 5: Commit**

```bash
git add cli/src/runs.rs cli/src/main.rs
git commit -m "feat(cli): modul runs — bentuk payload histori build dan bucket harian"
```

---

### Task 3: `autore runs --json` — IO Jenkins + wiring CLI

**Files:**
- Modify: `cli/src/runs.rs` (fungsi IO + `cari_penulis`)
- Modify: `cli/src/main.rs` (`Commands::Runs`, `enum AksiRuns`)
- Test: `cli/tests/runs_cli.rs`

**Interfaces:**
- Consumes: `runs::susun_laporan`, `runs::parse_builds` (Task 2); `jenkins::load_config_from` / `JenkinsConfig`; `status::iso8601_from_unix`.
- Produces:
  - CLI: `autore runs --json [--days <N>] [--limit <N>]` (default `7` dan `5`), `--json` wajib (tanpa itu cetak tabel teks ringkas), exit `0` sukses, `1` gagal (mis. konfigurasi Jenkins tidak ada), `2` argumen salah.
  - `pub fn cari_penulis(dir_app: &Path, sha: &str) -> String` → `git -C <dir> log -1 --format=%an <%ae> <sha>`; gagal/sha kosong → `""`.
  - `pub fn kumpulkan(workspace: &Path, cfg: &JenkinsConfig, days: u32, limit: usize) -> Result<LaporanRuns, String>`.

- [x] **Step 1: Tulis tes yang gagal** — `cli/tests/runs_cli.rs`

Pola sama seperti `deploy_cli.rs`: `fake_jenkins_server()` (`TcpListener::bind("127.0.0.1:0")`, baca 1 request, balas fixture JSON, `Arc<AtomicUsize>`), `TempDir`, `HOME` sementara, workspace berisi `registry.tsv` (`tes-web\t8000\t8003`) + repo `tes-web` hasil `git init` + satu commit, `~/.config/autore/jenkins.conf` menunjuk server palsu.

```rust
#[test]
fn runs_json_memuat_histori_jenkins() {
    // assert exit 0; assert stdout JSON:
    //   window_days == 7; runs.len() == 2; runs[0].app == "tes-web";
    //   runs[0].status == "passed"; runs[0].commit_sha == "2dfd6ef...";
    //   runs[0].author == author commit fixture (<nama> <email>);
    //   daily.len() == 7; totals.passed == 1; totals.failed == 1;
    //   url == format!("{}/job/tes-web/{}", server_url, number)
}

#[test]
fn runs_tanpa_konfigurasi_jenkins_exit_1() {
    // HOME tanpa ~/.config/autore/jenkins.conf → exit 1, stderr memuat "Jenkins"
}

#[test]
fn runs_jenkins_mati_masih_exit_0_dengan_histori_kosong() {
    // server palsu ditutup setelah bind → assert exit 0, runs == [], totals semua 0
}
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `scripts/run_tests.sh -k runs_cli` → gagal `unrecognized subcommand 'runs'` (exit 2).

- [x] **Step 3: Implementasi**

`kumpulkan`: `Workspace` → daftar app dari `registry.tsv` kolom pertama (unik, urut); tiap app `GET {url}/job/{app}/api/json` dengan query hardcoded `tree=builds[number,result,duration,timestamp,actions[lastBuiltRevision[SHA1,branch[name]]]]{0,<limit>}` (Basic auth dari `cfg`), respons non-200 → lewati app itu (bukan error); `parse_builds`; `cari_penulis` per SHA unik (cache `HashMap`); serahkan ke `susun_laporan`; gagal ambil kredensial → `Err`.

`main.rs`: tambahkan `Commands::Runs { json: bool, days: u32, limit: usize }` (default `7`/`5` via `default_value_t`), `--json` cetak `serde_json::to_string_pretty`, tanpa `--json` cetak tabel teks (`app  build  status  durasi  author`).

- [x] **Step 4: Tes hijau** — `scripts/run_tests.sh -k runs_cli` → PASS; `cargo clippy -- -D warnings` exit 0.

- [x] **Step 5: Pull request kecil (opsional) / Commit**

```bash
git add cli/src/runs.rs cli/src/main.rs cli/tests/runs_cli.rs
git commit -m "feat(cli): subcommand runs --json membaca histori build dari Jenkins"
```

---

### Task 4: Hono — klien `autore runs` + cache stale

**Files:**
- Create: `web/apps/api/src/runs.ts`
- Test: `web/apps/api/src/runs.test.ts`

**Interfaces:**
- Consumes: pola `web/apps/api/src/status.ts` (`execFile`, `promisify`, `AUTORE_BIN`, lastGood).
- Produces:

```ts
export interface RunsPayload {
  generated_at: string; window_days: number;
  runs: Array<{ app: string; number: number; status: "passed" | "failed" | "running";
    duration_ms: number; started_at: string; commit_sha: string; author: string; url: string }>;
  daily: Array<{ date: string; passed: number; failed: number }>;
  totals: { passed: number; failed: number; running: number };
}
export const EMPTY_RUNS: RunsPayload;                       // daily: 7 entri nol, runs: [], totals nol
export function validateRuns(raw: unknown): RunsPayload;    // throw Error bila bentuk salah
export async function getRuns(): Promise<{ data: RunsPayload; stale: boolean }>;
```

- [x] **Step 1: Tulis tes yang gagal** — `web/apps/api/src/runs.test.ts`

```ts
it("memanggil argv tetap tanpa shell", async () => { /* inject runner: expect ["runs","--json","--days","7","--limit","5"] */ });
it("menolak status run yang tidak dikenal", () => { /* validateRuns dengan status "SUCCESS" → throw */ });
it("menolak daily yang bukan array angka", () => {});
it("jatuh ke stale + lastGood saat CLI gagal", async () => { /* panggil sukses lalu runner throw → stale true, data sama */ });
it("tanpa lastGood mengembalikan EMPTY_RUNS stale", async () => { /* runner throw sejak awal → runs [] dan stale true, bukan throw */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `cd web && npx vitest run apps/api/src/runs.test.ts` → gagal `Failed to resolve import "./runs"`.

- [x] **Step 3: Implementasi**

`execFileAsync(process.env.AUTORE_BIN || "autore", ["runs","--json","--days","7","--limit","5"], { encoding: "utf8", env: process.env, shell: false, timeout: 15_000, maxBuffer: 1024 * 1024 })`. `validateRuns` memakai allow-list key persis (`runs`/`daily`/`totals`/`generated_at`/`window_days`), `status` ∈ {passed, failed, running}, angka wajib `Number.isFinite`. Cache: `lastGood` + `stale`, TTL 60_000 ms lewat `Date.now()` yang bisa di-inject (param opsional `now = Date.now`).

- [x] **Step 4: Tes hijau** — `npx vitest run apps/api/src/runs.test.ts` → PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/api/src/runs.ts web/apps/api/src/runs.test.ts
git commit -m "feat(api): klien runs dengan cache dan penanda stale"
```

---

### Task 5: Hono — rute `/api/runs` + kontrak status diperluas

**Files:**
- Modify: `web/apps/api/src/index.ts` (rute baru)
- Modify: `web/apps/api/src/status.ts` (validator: `stage_times`, `finished_at`, `gates_passed`, `gates_total`)
- Test: `web/apps/api/src/index.test.ts`

**Interfaces:**
- Consumes: `getRuns`, `EMPTY_RUNS`, `validateRuns` (Task 4); `DashboardStatus` (Task 1 menambah field).
- Produces: `GET /api/runs` → `200 { data: RunsPayload, stale: boolean }`; `/api/status` tetap 200 dan tidak lagi menolak empat field baru.

- [x] **Step 1: Tulis tes yang gagal** — tambahkan ke `web/apps/api/src/index.test.ts`

```ts
it("GET /api/runs mengembalikan payload runs", async () => { /* 200, body.data.window_days === 7 */ });
it("GET /api/runs tetap 200 saat CLI gagal", async () => { /* 200, stale true, data.runs [] */ });
it("status menerima field tahap dan gerbang baru", async () => { /* fixture CLI dengan stage_times/finished_at/gates_* → 200 */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `npx vitest run apps/api/src/index.test.ts` → 404 pada `/api/runs`, atau `status tidak sah` untuk fixture baru.

- [x] **Step 3: Implementasi**

Di `index.ts`: `app.get("/api/runs", async (c) => c.json(await getRuns()));` (pakai pola `reply` yang ada bila ada). Di `status.ts` tambahkan validasi: `stage_times` array objek `{id: string, at: string}`, `finished_at: string`, `gates_passed`/`gates_total` integer ≥ 0. **Tidak** boleh menolak field yang hilang (gapura lama belum mengirim) — pakai default `[]`/`""`/`0`.

- [x] **Step 4: Tes hijau** — `npx vitest run` (semua) → 100+ passed; `npx tsc --noEmit` exit 0.

- [x] **Step 5: Commit**

```bash
git add web/apps/api/src/index.ts web/apps/api/src/index.test.ts web/apps/api/src/status.ts
git commit -m "feat(api): rute GET /api/runs dan kontrak status dengan data tahap"
```

---

### Task 6: `lib/format.ts` — waktu relatif, durasi, sha pendek

**Files:**
- Create: `web/apps/dashboard/src/lib/format.ts`
- Test: `web/apps/dashboard/src/lib/format.test.ts`

**Interfaces:**
- Produces:

```ts
export function relativeTime(iso: string, now?: number): string;   // "baru saja" | "5 menit lalu" | "3 jam lalu" | "2 hari lalu" | "—"
export function formatDuration(ms: number): string;                // 850→"850ms" | 45244→"45.2s" | 96000→"1m 36s" | ≤0→"—"
export function shortSha(sha: string): string;                     // 7 karakter pertama, ""→"—"
```

- [x] **Step 1: Tulis tes yang gagal** — `lib/format.test.ts`

```ts
it("waktu relatif bahasa Indonesia", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  expect(relativeTime("2026-11-04T09:59:40Z", now)).toBe("baru saja");
  expect(relativeTime("2026-11-04T09:55:00Z", now)).toBe("5 menit lalu");
  expect(relativeTime("2026-11-04T07:00:00Z", now)).toBe("3 jam lalu");
  expect(relativeTime("2026-11-01T10:00:00Z", now)).toBe("3 hari lalu");
});
it("waktu relatif tidak pernah negatif", () => { /* iso 1 menit di masa depan → "baru saja" */ });
it("iso/tanggal tidak sah jadi strip", () => { expect(relativeTime("", now)).toBe("—"); expect(relativeTime("bukan-tanggal", now)).toBe("—"); });
it("durasi", () => { expect(formatDuration(850)).toBe("850ms"); expect(formatDuration(45244)).toBe("45.2s"); expect(formatDuration(96000)).toBe("1m 36s"); expect(formatDuration(0)).toBe("—"); });
it("sha pendek", () => { expect(shortSha("2dfd6ef3b42a965dd03c392095a116faf1c8a8c2")).toBe("2dfd6ef"); expect(shortSha("")).toBe("—"); });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `npx vitest run apps/dashboard/src/lib/format.test.ts` → import gagal.

- [x] **Step 3: Implementasi** — ambang: `<60s` → "baru saja"; `<3600s` → `${m} menit lalu`; `<86400s` → `${h} jam lalu`; selain itu `${d} hari lalu`; nilai negatif di-clamp ke "baru saja".

- [x] **Step 4: Tes hijau** — `npx vitest run apps/dashboard/src/lib/format.test.ts` → PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/format.ts web/apps/dashboard/src/lib/format.test.ts
git commit -m "feat(dashboard): helper format waktu relatif, durasi, dan sha"
```

---

### Task 7: `lib/stages.ts` — durasi per tahap dari timestamp

**Files:**
- Create: `web/apps/dashboard/src/lib/stages.ts`
- Modify: `web/apps/dashboard/src/lib/contracts.ts` (tipe `stage_times`, `finished_at`, `gates_passed`, `gates_total`)
- Test: `web/apps/dashboard/src/lib/stages.test.ts`

**Interfaces:**
- Produces:

```ts
export type StageRow = { id: string; durationMs: number | null; result: "passed" | "failed" | "running" };
export function stageRows(stageTimes: Array<{ id: string; at: string }>, finishedAt: string, pipelineStatus: string): StageRow[];
```

- [x] **Step 1: Tulis tes yang gagal**

```ts
it("durasi = selisih timestamp tahap berikutnya", () => {
  // stage_times: checkout@10:00:00, scan@10:00:30, build@10:01:30; finished_at 10:02:00; status passed
  // assert [ {checkout, null}, {scan, 30000, passed}, {build, 30000, passed} ]
});
it("tahap pertama tanpa durasi, bukan nol", () => { expect(stageRows(...)[0].durationMs).toBeNull(); });
it("snapshot lama tanpa stage_times jadi daftar kosong", () => { expect(stageRows([], "", "passed")).toEqual([]); });
it("tahap terakhir mewarisi status pipeline", () => {
  // status failed → tahap terakhir result "failed", sisanya "passed"
  // status running → tahap terakhir result "running"
});
it("tanpa finished_at, tahap terakhir durationMs null", () => {});
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — import `./stages` gagal.

- [x] **Step 3: Implementasi** — urutkan mengikuti `stage_times` apa adanya (jangan sort), `durationMs` = `Date.parse(at[i+1]) - Date.parse(at[i])` (tahap terakhir: `Date.parse(finishedAt) - Date.parse(at[i])` bila `finishedAt` sah); semua hasil harus `> 0` selain `null` (nilai 0/negatif → `null`). `result` tahap terakhir mengikuti `pipelineStatus`, sisanya `passed`.

- [x] **Step 4: Tes hijau** → PASS. `npx tsc --noEmit` exit 0.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/stages.ts web/apps/dashboard/src/lib/stages.test.ts web/apps/dashboard/src/lib/contracts.ts
git commit -m "feat(dashboard): hitung durasi per tahap dari timestamp snapshot"
```

---

### Task 8: `lib/filter-apps.ts` — pencarian + filter status

**Files:**
- Create: `web/apps/dashboard/src/lib/filter-apps.ts`
- Test: `web/apps/dashboard/src/lib/filter-apps.test.ts`

**Interfaces:**
- Produces: `export type StatusFilter = "all" | "passed" | "failed" | "unknown"; export function filterApps(apps: ApplicationRecord[], query: string, status: StatusFilter): ApplicationRecord[];`

- [x] **Step 1: Tulis tes yang gagal**

```ts
it("mencari tanpa peduli huruf besar/kecil dan spasi tepi", () => {
  // apps [tes-web, ui-demo, uji-kontoh]; query "  DEMO " → [ui-demo]
});
it("mencocokkan id maupun name", () => {});
it("filter status", () => {
  // status "failed" → hanya yang failed; "unknown" → hanya yang unknown (aplikasi registry-only tetap tampil)
});
it("query kosong + all mengembalikan semua", () => {});
it("tidak ada hasil jadi array kosong", () => {});
```

- [x] **Step 2: Jalankan, pastikan GAGAL** → import gagal.

- [x] **Step 3: Implementasi** — `q = query.trim().toLowerCase()`; cocok bila `id.toLowerCase().includes(q) || name.toLowerCase().includes(q)`; lalu saring `status === "all" || app.status === status`.

- [x] **Step 4: Tes hijau** → PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/filter-apps.ts web/apps/dashboard/src/lib/filter-apps.test.ts
git commit -m "feat(dashboard): fungsi filter aplikasi berdasarkan query dan status"
```

---

### Task 9: `lib/charts.ts` — seri tren, irisan donut, sumbu radar

**Files:**
- Create: `web/apps/dashboard/src/lib/charts.ts`
- Test: `web/apps/dashboard/src/lib/charts.test.ts`

**Interfaces:**
- Produces:

```ts
export const CHART_COLORS = { passed: "#16a34a", failed: "#dc2626", running: "#f59e0b", grid: "#e5e7eb" } as const;
export function toTrend(daily: Array<{ date: string; passed: number; failed: number }>): Array<{ label: string; passed: number; failed: number }>; // label "DD/MM"
export function toSlices(totals: { passed: number; failed: number; running: number }): Array<{ key: "passed" | "failed" | "running"; name: string; value: number; fill: string }>;
export function toRadar(score: { security: number | null; reliability: number | null; speed: number | null; freshness: number | null; coverage: number | null }): Array<{ axis: string; value: number }>;
```

- [x] **Step 1: Tulis tes yang gagal**

```ts
it("label tren dari tanggal UTC", () => { expect(toTrend([{ date: "2026-11-04", passed: 2, failed: 1 }])[0].label).toBe("04/11"); });
it("donut selalu tiga irisan berurutan passed, failed, running", () => { /* totals {passed:5,failed:2,running:0} → length 3, value 0 tetap ada */ });
it("donut nol total tidak membagi nol", () => { /* semua 0 → tiga irisan value 0 */ });
it("radar membuang sumbu tanpa data", () => {
  // {security: 100, reliability: 66, speed: null, freshness: 80, coverage: 50} → length 4, tanpa "Kecepatan"
});
it("radar membatasi 0..100", () => { /* 140 → 100; -5 → 0 */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** → import gagal.

- [x] **Step 3: Implementasi** — nama irisan: `Lulus`, `Gagal`, `Berjalan`; nama sumbu radar: `Keamanan`, `Keandalan`, `Kecepatan`, `Kesegaran`, `Cakupan`; pembulatan `Math.round`, clamp 0..100.

- [x] **Step 4: Tes hijau** → PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/charts.ts web/apps/dashboard/src/lib/charts.test.ts
git commit -m "feat(dashboard): seri data untuk tren, donut, dan radar"
```

---

### Task 10: Pasang Recharts (dipin eksak)

**Files:**
- Modify: `web/apps/dashboard/package.json`, `web/package-lock.json`

- [x] **Step 1: Ukur kondisi awal** — `cd web && npx vitest run` (catat jumlah passed) dan `npx tsc --noEmit` (exit 0).

- [x] **Step 2: Pasang**

```bash
cd web && npm install --save-exact --workspace apps/dashboard recharts@3.10.1 react-is@19.1.1
npm ls recharts react-is
```

- [x] **Step 3: Verifikasi tidak ada regresi** — `npx vitest run` (jumlah passed sama seperti Step 1), `npx tsc --noEmit` exit 0, `npm run build:dashboard` sukses.

- [x] **Step 4: Commit**

```bash
git add web/apps/dashboard/package.json web/package-lock.json
git commit -m "chore(dashboard): pasang recharts 3.10.1 dan react-is untuk grafik"
```

---

### Task 11: Komponen grafik Overview — Area + Donut

**Files:**
- Create: `web/apps/dashboard/src/components/charts/run-trends.tsx`
- Create: `web/apps/dashboard/src/components/charts/run-distribution.tsx`
- Create: `web/apps/dashboard/src/components/ui/chart-card.tsx`
- Test: `web/apps/dashboard/src/components/charts/charts.test.tsx`

**Interfaces:**
- Consumes: `toTrend`, `toSlices`, `CHART_COLORS` (Task 9).
- Produces: `<RunTrends daily={DailyPoint[]} />`, `<RunDistribution totals={Totals} />`, `<ChartCard title subtitle>{children}</ChartCard>`.

- [x] **Step 1: Tulis tes yang gagal** — `charts.test.tsx` dengan `vi.mock("recharts", ...)` yang mengganti tiap primitif jadi elemen yang mencetak props-nya (`data-chart-props`), karena jsdom tidak punya layout.

```tsx
it("RunTrends mengirim 7 titik dan dua seri", () => {
  // render dengan daily 7 entri; ambil data prop dari stub AreaChart
  // assert length 7; assert ada dua <Area> dengan dataKey "passed" dan "failed"; stroke #16a34a / #dc2626
});
it("RunTrends menampilkan empty state saat semua nol", () => {
  // semua passed/failed 0 → teks "Belum ada build dalam 7 hari terakhir"
});
it("RunDistribution menampilkan tiga irisan dan total di tengah", () => {
  // totals {passed:5,failed:2,running:1} → 3 <Cell>, teks "8" di tengah, legenda "Lulus 5" dst
});
it("RunDistribution total nol tidak menampilkan NaN", () => { /* totals 0 → teks "0", tidak ada "NaN" di container */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `npx vitest run apps/dashboard/src/components/charts` → import gagal.

- [x] **Step 3: Implementasi**

Kedua file diawali `"use client"`. `RunTrends`: `ResponsiveContainer height={220}` → `AreaChart` dengan `defs` dua `linearGradient` (opacity 0.25 → 0), `<CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />`, `<XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} />`, `<YAxis allowDecimals={false} width={28} />`, `<Tooltip />`, `<Area type="monotone" dataKey="passed" stroke="#16a34a" fill="url(#gradPassed)" strokeWidth={2} />`, sama untuk `failed`. Empty state = div `text-sm text-gray-500` (chart tidak dirender).

`RunDistribution`: `PieChart` + `<Pie innerRadius={54} outerRadius={78} dataKey="value" paddingAngle={2}>` dengan `<Cell fill={slice.fill} />`, label total di tengah lewat elemen absolut (`text-2xl font-semibold`), legenda baris `key value` di bawah. `ChartCard`: `rounded-lg border border-gray-200 bg-white p-5` + judul `text-sm font-medium text-gray-900` + subjudul `text-xs text-gray-500`.

- [x] **Step 4: Tes hijau** — `npx vitest run apps/dashboard/src/components/charts` → PASS; `npx tsc --noEmit` exit 0.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/components/charts web/apps/dashboard/src/components/ui/chart-card.tsx
git commit -m "feat(dashboard): kartu grafik tren build dan distribusi hasil"
```

---

### Task 12: Recent Runs + klien `/api/runs`

**Files:**
- Create: `web/apps/dashboard/src/lib/runs-client.ts`
- Create: `web/apps/dashboard/src/components/recent-runs.tsx`
- Test: `web/apps/dashboard/src/lib/runs-client.test.ts`, `web/apps/dashboard/src/components/recent-runs.test.tsx`

**Interfaces:**
- Consumes: `relativeTime`, `formatDuration`, `shortSha` (Task 6), `RunRecord` (Task 4), pola `status-client.ts`.
- Produces: `fetchRuns(): Promise<{ data: RunsPayload; stale: boolean }>`; `<RecentRuns runs={RunRecord[]} stale={boolean} />`.

- [x] **Step 1: Tulis tes yang gagal**

```ts
// runs-client.test.ts
it("mengambil /api/runs dan mengembalikan payload", async () => { /* mock fetch 200 → data.runs */ });
it("melempar error saat respons bukan 200", async () => { /* 500 → throw */ });

// recent-runs.test.tsx
it("menampilkan maksimal 5 baris", () => { /* kirim 7 run → 5 baris */ });
it("kolom commit 7 karakter dan author kosong jadi strip", () => {
  // expect teks "2dfd6ef"; run dengan author "" → "—"
});
it("badge status dan durasi relatif tampil", () => {
  // data-testid "run-status" berisi "passed"; durasi "45.2s"; waktu "3 jam lalu"
});
it("empty state saat tidak ada run", () => { /* teks "Belum ada run" */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** → import gagal.

- [x] **Step 3: Implementasi** — tabel `w-full text-sm`, header `text-xs uppercase tracking-wide text-gray-500`, baris `border-t border-gray-200`, commit pakai `font-mono` + link ke `run.url` (`target="_blank" rel="noreferrer"`), status pakai `StatusBadge` yang sudah ada, waktu pakai `<time dateTime={run.started_at}>`. Stale: `<span className="text-xs text-amber-600">data terakhir</span>` di header kartu.

- [x] **Step 4: Tes hijau** → PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/runs-client.ts web/apps/dashboard/src/lib/runs-client.test.ts web/apps/dashboard/src/components/recent-runs.tsx web/apps/dashboard/src/components/recent-runs.test.tsx
git commit -m "feat(dashboard): section Recent Runs dengan waktu relatif dan durasi"
```

---

### Task 13: Overview merangkai grafik + Recent Runs

**Files:**
- Modify: `web/apps/dashboard/src/app/page.tsx`
- Test: `web/apps/dashboard/src/app/page.test.tsx`

**Interfaces:**
- Consumes: `<RunTrends>`, `<RunDistribution>` (Task 11), `<RecentRuns>` (Task 12), `fetchRuns` (Task 12), `fetchStatus` yang sudah ada.

- [x] **Step 1: Tulis tes yang gagal** — tambahkan ke `app/page.test.tsx`

```ts
it("Overview menampilkan tren, distribusi, dan recent runs", async () => {
  // mock fetch status + runs; assert teks "Tren 7 Hari", "Distribusi", "Recent Runs"
});
it("Overview tetap tampil saat /api/runs gagal", async () => {
  // fetch runs reject → kartu grafik empty state, bukan crash; status tetap tampil
});
it("banner stale status tetap muncul", () => {});
```

- [x] **Step 2: Jalankan, pastikan GAGAL** — `npx vitest run apps/dashboard/src/app/page.test.tsx`.

- [x] **Step 3: Implementasi** — grid `grid gap-4 md:grid-cols-3`: tren `md:col-span-2`, distribusi `md:col-span-1`, lalu `<RecentRuns>` selebar penuh. Fetch paralel (`Promise.allSettled`) supaya kegagalan runs tidak menjatuhkan status.

- [x] **Step 4: Tes hijau** — `npx vitest run` semua PASS; `npx tsc --noEmit`; `npm run build:dashboard`.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/app/page.tsx web/apps/dashboard/src/app/page.test.tsx
git commit -m "feat(dashboard): overview dengan grafik tren, distribusi, dan recent runs"
```

---

### Task 14: Pipeline Detail — matriks tahap (kartu) menggantikan timeline vertikal

**Files:**
- Create: `web/apps/dashboard/src/components/pipeline/stage-matrix.tsx`
- Delete: `web/apps/dashboard/src/components/pipeline/stage-timeline.tsx` (+ tesnya bila ada)
- Modify: `web/apps/dashboard/src/app/pipeline/page.tsx`
- Test: `web/apps/dashboard/src/components/pipeline/stage-matrix.test.tsx`, `app/pipeline/page.test.tsx`

**Interfaces:**
- Consumes: `stageRows` (Task 7), `formatDuration` (Task 6), `Profile` belum ada — cukup props.
- Produces: `<StageMatrix rows={StageRow[]} stages={string[]} pipelineStatus={string} />` — `stages` dipakai bila `rows` kosong (snapshot lama).

- [x] **Step 1: Tulis tes yang gagal**

```tsx
it("merender satu kartu per tahap", () => { /* 5 tahap → 5 kartu, ada data-testid "stage-card" */ });
it("durasi tampil per kartu, tahap pertama strip", () => {
  // rows[0].durationMs null → kartu pertama berisi "—"; kartu kedua berisi "30.0s"
});
it("kartu gagal berwarna merah dan punya tanda", () => {
  // pipelineStatus failed → kartu terakhir punya class mengandung "border-red-300" dan label "Gagal"
});
it("snapshot lama tanpa stage_times tetap merender kartu dari stages", () => { /* rows [] + stages ["checkout","scan"] → 2 kartu, semua durasi "—" */ });
it("menampilkan nomor urut dan panah antar kartu", () => { /* ada "1","2" dan elemen pemisah data-testid "stage-arrow" */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** → import gagal.

- [x] **Step 3: Implementasi**

Kartu: `min-w-[168px] rounded-lg border border-gray-200 bg-white p-4`, status lulus `border-emerald-200 bg-emerald-50/40`, gagal `border-red-300 bg-red-50/40`, berjalan `border-amber-200 bg-amber-50/40`. Grid horizontal `flex items-stretch gap-2 overflow-x-auto` dengan pemisah `<span data-testid="stage-arrow" aria-hidden>→</span>`. Tiap kartu: nomor urut `text-[11px] text-gray-400`, nama tahap `text-sm font-medium capitalize`, durasi `font-mono text-xs`, chip status. Log mentah tetap panel terpisah yang sudah ada di halaman (jangan diubah).

- [x] **Step 4: Tes hijau** — `npx vitest run apps/dashboard/src/components/pipeline` + `npx vitest run apps/dashboard/src/app/pipeline` → PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/components/pipeline web/apps/dashboard/src/app/pipeline
git commit -m "feat(dashboard): pipeline detail jadi matriks kartu dengan durasi per tahap"
```

---

### Task 15: Filter bar halaman Aplikasi

**Files:**
- Create: `web/apps/dashboard/src/components/applications-filter.tsx`
- Modify: `web/apps/dashboard/src/app/applications/page.tsx`
- Test: `web/apps/dashboard/src/components/applications-filter.test.tsx`, `app/applications/page.test.tsx`

**Interfaces:**
- Consumes: `filterApps`, `StatusFilter` (Task 8).
- Produces: `<ApplicationsFilter query onQueryChange status onStatusChange total shown />` (controlled, tanpa state internal).

- [x] **Step 1: Tulis tes yang gagal**

```tsx
it("mengetik di pencarian menyaring tabel", async () => {
  // userEvent.type "demo" → hanya baris ui-demo*
});
it("dropdown status menyaring sesuai pilihan", async () => {
  // pilih "Gagal" → hanya baris failed; pilih "Unknown" → aplikasi registry-only tetap tampil
});
it("menampilkan jumlah hasil", () => { /* "3 dari 10 aplikasi" */ });
it("empty state saat tidak ada yang cocok", () => { /* teks "Tidak ada aplikasi yang cocok" */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** → import gagal.

- [x] **Step 3: Implementasi** — input `type="search"` dengan ikon `lucide-react` `Search`, placeholder "Cari aplikasi…", `className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"`; select status opsi `Semua status`, `Lulus`, `Gagal`, `Unknown`. State di `applications/page.tsx` (`useState`), tabel memakai `filterApps`.

- [x] **Step 4: Tes hijau** → PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/components/applications-filter.tsx web/apps/dashboard/src/app/applications
git commit -m "feat(dashboard): filter pencarian dan status di halaman aplikasi"
```

---

### Task 16: Halaman Keamanan + radar skor

**Files:**
- Create: `web/apps/dashboard/src/lib/score.ts`
- Create: `web/apps/dashboard/src/components/security/quality-radar.tsx`
- Create: `web/apps/dashboard/src/app/security/page.tsx`
- Modify: `web/apps/dashboard/src/components/nav-items.tsx` (tambah entri `Keamanan` → `/security`)
- Test: `lib/score.test.ts`, `components/security/quality-radar.test.tsx`, `app/security/page.test.tsx`

**Interfaces:**
- Consumes: `toRadar` (Task 9), `DashboardStatus` + `RunsPayload`.
- Produces:

```ts
export type Score = { security: number | null; reliability: number | null; speed: number | null; freshness: number | null; coverage: number | null };
export function hitungSkor(status: DashboardStatus, runs: RunsPayload, now?: number): Score;
```

Aturan (semua terukur, tanpa angka karangan):
- `security` = `gates_total > 0 ? gates_passed/gates_total*100 : null`
- `reliability` = `total > 0 ? passed/total*100 : null` (total = passed+failed+running)
- `speed` = `median duration_ms` run sukses vs target **120_000 ms**: `100 - (median/target*100)` di-clamp 0..100; tanpa run sukses → `null`
- `freshness` = umur run terbaru: `100 - (jam/24)*100` clamp 0..100; tanpa run → `null`
- `coverage` = `total_apps > 0 ? (apps punya minimal satu run)/total_apps*100 : null`

- [x] **Step 1: Tulis tes yang gagal**

```ts
// score.test.ts
it("security 9/9 jadi 100 dan 0/0 jadi null", () => {});
it("reliability dari totals runs", () => { /* passed 5, failed 5 → 50 */ });
it("speed memakai median dan clamp", () => { /* durasi 60s → 50; 300s → 0 */ });
it("freshness menurun seiring umur build", () => { /* 12 jam lalu → 50 */ });
it("coverage menghitung aplikasi yang pernah dibangun", () => { /* 1 dari 10 → 10 */ });
it("tanpa data sama sekali semua null", () => {});
```

```tsx
// quality-radar.test.tsx
it("mengirim sumbu terukur ke RadarChart", () => { /* speed null → 4 sumbu; label "Keamanan","Keandalan","Kesegaran","Cakupan" */ });
it("empty state saat semua null", () => { /* teks "Belum ada data untuk dinilai" */ });
```

- [x] **Step 2: Jalankan, pastikan GAGAL** → import gagal.

- [x] **Step 3: Implementasi** — `quality-radar.tsx` (`"use client"`): `RadarChart` + `<PolarGrid stroke="#e5e7eb" />` + `<PolarAngleAxis dataKey="axis" tick={{ fontSize: 12, fill: "#64748b" }} />` + `<PolarRadiusAxis domain={[0,100]} tick={false} axisLine={false} />` + `<Radar dataKey="value" stroke="#0f766e" fill="#14b8a6" fillOpacity={0.25} strokeWidth={2} />`. Halaman `/security`: kartu radar + daftar gerbang (`gates_passed`/`gates_total` dari status) + tabel aplikasi dengan `security_issues > 0`. Catatan kaki jujur: "Skor dihitung dari data pipeline yang ada; sumbu tanpa data tidak ditampilkan."

- [x] **Step 4: Tes hijau** — `npx vitest run` semua PASS; `npx tsc --noEmit`; `npm run build:dashboard`.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/score.ts web/apps/dashboard/src/lib/score.test.ts web/apps/dashboard/src/components/security web/apps/dashboard/src/app/security web/apps/dashboard/src/components/nav-items.tsx
git commit -m "feat(dashboard): halaman keamanan dengan radar skor pipeline"
```

---

### Task 17: Dokumentasi, deploy, verifikasi hidup

**Files:**
- Modify: `web/README.md` (endpoint `/api/runs`, sumber data, batasan jujur)
- Modify: `docs/plans/2026-11-04-autore-visual-analytics.md` (centang progres)

- [x] **Step 1: Dokumentasi** — README bagian baru: `GET /api/runs`, contoh keluaran, sumber data (Jenkins API + `git log`), tiga batasan: (a) durasi tahap pertama tidak terekam, (b) author hanya bila commit ada di repo lokal, (c) histori hanya untuk aplikasi yang punya job Jenkins.

- [x] **Step 2: Pasang binary baru** — di VPS: `. "$HOME/.cargo/env" && cd ~/Autore && cargo build --release && sudo install -m 0755 cli/target/release/autore /usr/local/bin/autore && autore runs --json --days 7 --limit 5 | head -40`.

- [x] **Step 3: Build + restart web** — `cd ~/Autore/web && npm run build:dashboard && npm run build:api` (sesuai skrip yang ada), lalu `systemctl --user restart autore-web-api autore-web-dashboard`, `systemctl --user is-active` keduanya.

- [x] **Step 4: Verifikasi hidup (bukan klaim)**

```bash
curl -s http://127.0.0.1:9121/api/runs | python3 -m json.tool | head -40
curl -s http://127.0.0.1:9120/api/status | python3 -c 'import json,sys;d=json.load(sys.stdin)["data"];print(d["latest_pipeline"]["gates_passed"],d["latest_pipeline"]["gates_total"],len(d["latest_pipeline"]["stage_times"]))'
curl -s http://127.0.0.1:9120/ | grep -c "Recent Runs"
curl -s http://127.0.0.1:9120/security -o /dev/null -w "security %{http_code}\n"
```

Semua harus 200 dan berisi data nyata (bukan `[]`) kecuali aplikasi tanpa job Jenkins.

- [x] **Step 5: Trigger build baru** — `POST /api/actions/deploy` (nomor build baru = path artefak baru, hindari 409 ALLOW_ONCE), tunggu SUCCESS, lalu ulangi Step 4 dan pastikan `stage_times` bertambah serta Recent Runs bertambah satu baris.

- [x] **Step 6: Commit**

```bash
git add web/README.md docs/plans/2026-11-04-autore-visual-analytics.md
git commit -m "docs(web): dokumentasi runs API dan batasan sumber data grafik"
```

---

## Decisions (perlu persetujuan)

1. **React Flow vs kartu HTML.** Plan memilih **matriks kartu**, bukan `@xyflow/react`. Alasan: grafnya statis 5 simpul (tidak ada pan/zoom/drag yang berguna), React Flow butuh `ResizeObserver` dipalsukan di jsdom sehingga tes berhenti menguji apa pun yang nyata, dan menambah ±120 KB. Kartu bisa diuji sungguhan dan tetap "matrix-like". Kalau bos alif tetap mau React Flow, ganti Task 14 dan tambahkan mock `ResizeObserver` di `src/test/setup.ts`.
2. **Data asli, bukan mock.** Plan memilih histori Jenkins lewat `autore runs`, bukan data karangan. Konsekuensi: hari ini hanya job `tes-web` yang punya histori (6 build, semuanya di 1 hari) sehingga grafik 7 hari terlihat sepi — itu jujur. Data memadat setelah SCM poll berjalan beberapa hari. Mock ditolak karena dashboard yang menampilkan angka palsu lebih berbahaya daripada grafik sepi.
3. **Sumbu "Documentation" dibuang.** Tidak ada sumber data dokumentasi di pipeline, jadi radar hanya memakai 5 sumbu yang benar-benar terukur (Keamanan, Keandalan, Kecepatan, Kesegaran, Cakupan). Sumbu tanpa data tidak ditampilkan, bukan diisi angka karangan.

## Catatan eksekusi

- Urutan wajib: Task 1–3 (Rust) → 4–5 (API) → 6–13 (UI Overview) → 14–16 → 17. UI Task 7 bergantung pada field Task 1.
- `autore runs` dipanggil API tiap ≤60 detik; tiap panggilan = 1 request Jenkins per aplikasi di registry (10 hari ini). Jangan naikkan frekuensi tanpa cache.
- Jangan mengubah `web2/` (dashboard lama di `/v2`).
- Snapshot lama tanpa `stage_times` harus tetap tampil; kalau tidak, semua uji regresi Phase 2 akan merah.


