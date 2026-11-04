# Plan — Phase 2: Actionable Dashboard (tombol → CLI)

Tanggal: 2026-11-04
Repo: `~/Autore` di VPS (commit `b70eb0e`, tag `v0.5.7`)
Prasyarat: Phase 1 (live status) + Phase 2 snapshot (`autore pipeline record`) sudah live dan terverifikasi di build #129.

Tujuan: dashboard berhenti jadi read-only. Non-teknis bisa klik tombol di `:9120` →
Hono API menjalankan perintah CLI yang **argv-nya hardcoded** → hasil muncul sebagai
spinner + toast, lalu data status di-refresh dari sumber yang sama seperti Phase 1.

Prinsip yang tidak boleh dilanggar (dari keputusan Phase 2 sebelumnya): **CLI tetap otak**.
TypeScript hanya memanggil CLI, tidak pernah meniru logika pipeline.

---

## Task 0 — Recon + baseline (sudah dijalankan, bukti di bawah)

Semua angka di bawah ini hasil pengukuran nyata, bukan asumsi. Dipakai sebagai acuan RED/GREEN.

### 0.1 Bentuk perintah yang akan di-spawn

| Perintah | Argv final yang akan dipakai API | Keluar 0 | Keluar ≠ 0 |
|---|---|---|---|
| Deploy | `autore deploy --path /home/tugure/autore-workspace/<app>` | job Jenkins terdaftar + build dipicu | pesan error di stderr |
| Scan | `autore scan --no-docker --path /home/tugure/autore-workspace/<app>` | semua pemeriksaan lulus | ada temuan / error |

Kode: `cli/src/main.rs:687` (`Commands::Deploy`), `cli/src/main.rs:633` (`Commands::Scan`),
dispatch di `cli/src/main.rs:1284` dan `cli/src/main.rs:1026`.

**Mode non-interaktif sudah ada.** `cli/src/main.rs:815` memanggil
`execute_command(command, false, &mut None)` untuk jalur satu-perintah; `interactive=false`
mematikan semua prompt (`main.rs:1033`, `1299`, `1313`). Jadi proses tanpa TTY tidak akan
menggantung nunggu jawaban. Exit code diteruskan ke proses (`main.rs:816-818`).

### 0.2 Bug yang ditemukan recon (harus dibereskan sebelum tombol Deploy dipakai)

`cli/src/main.rs:1302-1306`:

```rust
let jk_cfg = match ensure_jenkins_config(&conf_path, interactive, reconfigure) {
    Some(c) => c,
    None => return 0,          // ← masalah
};
```

dan `main.rs:573-580`: di mode non-interaktif, `ensure_jenkins_config` mencetak
`ERROR: Konfigurasi Jenkins belum ada di …` lalu `return None`.

Akibatnya: **deploy yang gagal karena konfigurasi hilang menghasilkan exit code 0**.
Kalau dibiarkan, endpoint `POST /api/actions/deploy` akan melaporkan sukses padahal
tidak ada apa pun yang di-deploy — dashboard berbohong. Ini kelas bug yang sama dengan
`save() -> Result` di Phase 2: pemanggil harus bisa membedakan gagal dan sukses.

### 0.3 Aset nyata di VPS (target aksi)

```
registry.tsv        : 10 baris, format  nama \t app_port \t deploy_port   (TAB, dibaca serve.rs:752)
app dir             : ~/autore-workspace/<nama>  → git repo, punya remote origin
                      tes-web → https://github.com/tugure-git-intern/tes-web.git
workspace           : /home/tugure/autore-workspace (0775 tugure:tugure)
job Jenkins sekarang: autore-dummy (disabled), autore-e2e (blue), diag-ws (blue)
```

Catatan penting: registry **tidak** menyimpan path project; yang ada hanya nama + port.
Path harus dibentuk dari `AUTORE_WORKSPACE` + nama aplikasi, dan nama itu wajib divalidasi
(bukan dipercaya).

### 0.4 Efek samping perintah (wajib ditulis di README + dilaporkan ke user)

`autore deploy` bukan cuma memicu build. `jenkins.rs:269` (`ensure_git_committed_and_remote`):
kalau working tree kotor atau belum ada HEAD → `git add .` + `git commit --no-verify`
(user.name `Autore CLI`), lalu `git push`. Artinya tombol Deploy di UI =
**commit + push otomatis repo aplikasi**. Tombol Scan menulis
`<app>/.security-gate-reason` (lihat `cli/tests/scan_cli.rs:58`) di dalam direktori aplikasi.

### 0.5 Permukaan serangan (diukur, bukan diasumsikan)

```
dari internet (157.10.222.62): 9120 → 000, 9121 → 000, 9119 → 000, 22 → tertutup
dari tailnet (100.80.3.14)   : 9120 → 200, 9121 → 000 (bind 127.0.0.1)
```

Jadi: API (9121) loopback-only, dashboard (9120) **hanya bisa dijangkau lewat tailnet**,
dan **tanpa autentikasi**. Endpoint baru ini menambah kemampuan mengubah sistem (spawn
proses) ke halaman yang tidak punya login. Lihat Review Focus #1.

### 0.6 Baseline test (sebelum perubahan apa pun)

```
cargo test                     → 173 passed
cargo clippy --all-targets -D warnings → exit 0
npm test (web/)                → 7 file, 51 passed
```

---

## Global Constraints

1. **`shell: false` wajib.** Pakai `execFile` (sudah jadi kebiasaan di `web/apps/api/src/status.ts:54`).
2. **Tidak ada input mentah dari frontend yang masuk argv.** Yang boleh masuk argv hanya
   path hasil *pembentukan server*: `workspace.join(<id tervalidasi>)`. String dari body
   hanya dipakai sebagai **kunci pencarian** di daftar aplikasi yang sudah ada.
3. **Dua endpoint saja**: `POST /api/actions/deploy` dan `POST /api/actions/scan`.
   Tidak ada endpoint baru lain untuk Phase 2 ini.
4. **Satu aksi berjalan pada satu waktu** (single-flight). Dua klik cepat tidak boleh
   menghasilkan dua `git push` bersamaan ke repo yang sama.
5. **Timeout wajib.** Tiap spawn punya batas waktu; proses yang menggantung tidak boleh
   menggantung request selamanya.
6. Tidak ada dependency baru (baik npm maupun crate). Modal pakai `<dialog>` native,
   spinner & ikon dari `lucide-react` yang sudah terpasang.
7. UI tetap Light Mode, border tipis `border-gray-200`, dan tombol memakai varian di
   `components/ui/button.tsx` (bukan tempelan `className` ad-hoc).
8. Kontrak `GET /api/status` **tidak berubah** — `web/apps/api/src/status.ts` tetap fail-closed.
9. Semua teks yang keluar ke user berbahasa Indonesia, konsisten dengan UI yang ada.
10. `docs/plans/` ikut di-commit (kebiasaan baru setelah `2ba90a0`).

---

## Keputusan desain (baca dulu sebelum menolak salah satu)

**(a) Endpoint mengembalikan hasil setelah proses selesai, bukan 202 fire-and-forget.**
Deploy ≈ 10-60 s (git push + Jenkins API + trigger), scan `--no-docker` ≈ 1-3 s. Menahan
request lebih sederhana dan lebih jujur: toast bisa menyebut hasil sebenarnya ("Deploy
terkirim", "Scan menemukan 2 temuan") alih-alih mengarang status.
*ponytail: ceiling = request panjang nempel di satu koneksi. Kalau deploy nanti butuh
menit-an atau harus tahan refresh halaman, naikkan ke job store + `GET /api/actions/:id`.*

**(b) Target deploy ditentukan server lewat env `AUTORE_DEPLOY_APP`.**
Spesifikasi minta tombol Deploy di Overview; Overview tidak punya baris aplikasi yang
dipilih, jadi tidak ada nilai yang bisa dikirim UI — dan mengirim "deploy app apa" dari
tombol global berarti UI mengarang input. Maka: unit `autore-web-api.service` diberi
`AUTORE_DEPLOY_APP=tes-web`; kalau env kosong → `503` dengan pesan jelas, bukan menebak.
Tombol "Jalankan Ulang" di halaman Pipeline memakai aksi yang sama (deploy = daftar ulang +
push + trigger build), jadi tetap dua endpoint sesuai spesifikasi.

**(c) Body `POST /api/actions/scan` wajib `{"app":"<id>"}` dengan validasi tiga lapis.**
`id` harus (1) cocok `^[A-Za-z0-9._-]{1,64}$`, (2) ada di daftar `applications[].id` dari
`autore status --json`, (3) `path.dirname(resolve(workspace, id)) === workspace` dan direktori
itu benar-benar ada. Lapis 1 menolak `../`, lapis 2 menolak nama yang tidak terdaftar,
lapis 3 menolak symlink/escape. Body dengan kunci ekstra atau tipe salah → `400`
(gaya fail-closed yang sama dengan validator status).

**(d) Semua aksi lewat satu lock global.** Map per-target lebih halus tapi belum ada
kebutuhan nyata: scan menulis `.security-gate-reason` ke direktori aplikasi, dan deploy
menjalankan `git add .` di direktori yang sama — dua aksi bersamaan di app yang sama sudah
tidak aman, apalagi kalau nanti target didefinisikan per app.
*ponytail: ceiling = satu aksi sejalan untuk seluruh sistem. Naikkan ke lock per-target
begitu ada >1 target deploy yang dikonfigurasi.*

**(e) Modal konfirmasi dipakai di Deploy (sesuai spesifikasi) dan di "Jalankan Ulang".**
"Jalankan Ulang" menjalankan aksi mutasi yang sama (commit + push + trigger). Memberinya
modal adalah penyimpangan kecil dari spesifikasi — kalau user mau tanpa modal, cukup hapus
prop `confirm` di halaman Pipeline (satu baris).

---

## Task 1 — Rust: deploy non-interaktif gagal dengan exit 1

**File:** `cli/tests/deploy_cli.rs` (BARU), `cli/src/main.rs`

### RED

Test baru, gaya sama dengan `cli/tests/scan_cli.rs` (binari sungguhan + `TempDir`):

```rust
// cli/tests/deploy_cli.rs
use std::fs;
use std::process::{Command, Stdio};
use tempfile::TempDir;

fn autore() -> Command { Command::new(env!("CARGO_BIN_EXE_autore")) }

fn project_git(dir: &std::path::Path) {
    fs::create_dir_all(dir).unwrap();
    Command::new("git").args(["init","-q","-b","main"]).current_dir(dir).status().unwrap();
}

#[test]
fn deploy_tanpa_konfigurasi_jenkins_gagal_di_mode_non_interaktif() {
    let tmp = TempDir::new().unwrap();
    let home = tmp.path().join("home");
    let project = tmp.path().join("app");
    fs::create_dir_all(&home).unwrap();
    project_git(&project);

    let out = autore()
        .env("HOME", &home)                       // ~/.config/autore/jenkins.conf tidak ada
        .args(["deploy", "--path"]).arg(&project)
        .stdin(Stdio::null())                     // tidak ada TTY: jalur non-interaktif
        .output()
        .unwrap();

    let err = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "stderr: {err}");
    assert!(err.contains("Konfigurasi Jenkins belum ada"), "stderr: {err}");
}
```

Perintah: `cargo test --test deploy_cli`

**Diharapkan GAGAL dengan:** `assertion left == right failed  left: Some(0)  right: Some(1)`
(sekarang `main.rs:1305` mengembalikan 0). Kalau test ini lulus tanpa perubahan kode,
berarti bug-nya bukan yang dibaca di recon — stop dan lapor.

### GREEN

`cli/src/main.rs`, satu baris di arm `Commands::Deploy`:

```rust
let jk_cfg = match ensure_jenkins_config(&conf_path, interactive, reconfigure) {
    Some(c) => c,
    // Di menu interaktif, batal = keluar tenang. Di jalur satu-perintah (dipakai API),
    // konfigurasi hilang = kegagalan yang harus terlihat pemanggil.
    None => return if interactive { 0 } else { 1 },
};
```

Periksa juga `main.rs:1656` (`ensure_jenkins_config(..., interactive, false)` di jalur lain —
QuickStart). Samakan perlakuannya kalau jalur itu juga dipakai non-interaktif; kalau tidak,
jangan diubah (satu perubahan, satu sebab).

### GATE

```
cargo test --test deploy_cli          # 1 passed
cargo test                            # 173 → 174 passed
cargo clippy --all-targets -- -D warnings   # exit 0
```

### COMMIT

`fix(cli): exit 1 saat deploy non-interaktif tanpa konfigurasi Jenkins`

---

## Task 2 — Hono API: modul aksi (`src/actions.ts`)

**File:** `web/apps/api/src/actions.test.ts` (BARU), `web/apps/api/src/actions.ts` (BARU)

### RED

Test dulu, dengan spawn palsu (tidak pernah menjalankan proses sungguhan):

```ts
// web/apps/api/src/actions.test.ts
import { describe, expect, it, vi } from "vitest";
import { hatchActions, type SpawnAction } from "./actions";

const WORKSPACE = "/tmp/autore-workspace-test";
const RUN = async () => JSON.stringify({ /* status minimal: applications [tes-web, ui-demo] */ });

const ok = (): SpawnAction => vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));
```

Test yang harus ada (masing-masing jadi RED lebih dulu):

1. `deploy_memanggil_argv_tetap_tanpa_shell`
   spawn dipanggil dengan `("autore", ["deploy","--path","/tmp/…/autore-workspace-test/tes-web"], {shell:false, …})`.
   Assert: `args.length === 3`, `args[0] === "deploy"`, dan **tidak ada** argumen yang berasal
   dari input user selain id tervalidasi.
2. `scan_memakai_no_docker` → argv `["scan","--no-docker","--path", …]`.
3. `menolak_id_yang_bukan_aplikasi_terdaftar` → `{ ok:false, status:404 }` dan spawn **tidak** dipanggil.
4. `menolak_id_dengan_slash_atau_titik_dua` (`../../etc`, `tes-web/../..`, `a b`, `"tes-web\0"`) → `status:400`, spawn tidak dipanggil.
5. `menolak_id_yang_ada_di_registry_tapi_pathnya_bukan_direktori` (mock `stat.isDirectory()` false) → `404`.
6. `exit_code_non_nol_jadi_kegagalan_yang_membawa_output` → `{ ok:false, status:422, output:"…" }`.
7. `aksi_kedua_ditolak_saat_satu_masih_jalan` → panggil dua `run()` bersamaan dengan spawn
   yang menggantung (deferred promise) → satu `{ok:true}` dan satu `{ ok:false, status:409 }`;
   spawn hanya dipanggil sekali.
8. `lock_dilepas_setelah_aksi_selesai` → setelah aksi pertama selesai, aksi berikutnya `ok:true`.
9. `timeout_jadi_kegagalan` → spawn yang tidak pernah selesai (fake timer) → `{ ok:false, status:504 }`
   dan lock terlepas.
10. `output_dipotong_agar_toast_tidak_meledak` → stdout 200 KB → `output.length <= 4000`.

Perintah: `npm test --workspace @autore/api` (atau `npm test` dari `web/`)

**Diharapkan GAGAL dengan:** `Failed to resolve import "./actions"` / `TypeError: hatchActions is not a function`.

### GREEN

`web/apps/api/src/actions.ts` — bentuk inti:

```ts
import { execFile } from "node:child_process";
import { isAbsolute, join, resolve, dirname } from "node:path";
import { stat } from "node:fs/promises";
import { loadDashboardStatus, runAutore, type RunAutore } from "./status";

export type SpawnResult = { exitCode: number; stdout: string; stderr: string };
export type SpawnAction = (file: string, args: string[], opts: { shell: false; timeout: number; cwd: string; env: NodeJS.ProcessEnv }) => Promise<SpawnResult>;

export type ActionKind = "deploy" | "scan";
export type ActionResult =
  | { ok: true; status: 200; action: ActionKind; target: string; output: string }
  | { ok: false; status: 400 | 404 | 409 | 422 | 503 | 504; error: string; output?: string };

const APP_ID = /^[A-Za-z0-9._-]{1,64}$/;         // tolak "/", "..", spasi, NUL
const MAX_OUTPUT = 4_000;
const TIMEOUT = { deploy: 180_000, scan: 60_000 } as const;

export function spawnAutore(...): SpawnAction { /* execFile, promisify, shell:false */ }

export function hatchActions(opts: { workspace: string; run: RunAutore; spawn: SpawnAction; deployApp: string }) {
  let busy: ActionKind | null = null;              // satu lock global (Keputusan d)
  const bin = process.env.AUTORE_BIN || "autore";  // sama dengan status.ts:55
  …
  return { run: (kind: ActionKind, appId?: string) => Promise<ActionResult> };
}
```

Aturan isi:
- `cwd` = workspace; `env` = `{ ...process.env, GIT_TERMINAL_PROMPT: "0" }` supaya `git push`
  tidak pernah menggantung menunggu password di proses tanpa TTY.
- Path aplikasi: `const dir = join(workspace, id)` → cek `dirname(resolve(dir)) === resolve(workspace)`
  → cek `(await stat(dir)).isDirectory()`.
- Daftar id sah diambil dari `loadDashboardStatus(run)` (sumber yang sama dengan `GET /api/status`,
  jadi tidak ada daftar kedua yang bisa basi).
- `deployApp` kosong → `503 { error: "target deploy belum dikonfigurasi (AUTORE_DEPLOY_APP)" }`.
- Exit code ≠ 0 → `422`, `output` = gabungan stdout+stderr dipotong `MAX_OUTPUT`.
- Timeout/`ETIMEDOUT` → `504`. Error spawn lain (binari tidak ada, `ENOENT`) → `503`.
- `finally { busy = null }`.

### GATE

```
npm test --workspace @autore/api      # 10 passed (semua test baru)
npx tsc --noEmit -p web/apps/api      # atau sesuai cara typecheck yang sudah ada
```

### COMMIT

`feat(api): modul aksi deploy/scan dengan argv tetap dan single-flight`

---

## Task 3 — Hono API: dua endpoint

**File:** `web/apps/api/src/index.test.ts` (BARU), `web/apps/api/src/index.ts`

### RED

```ts
const app = createApp(run, { spawn, workspace: "/tmp/ws", deployApp: "tes-web" });
const res = await app.request("http://localhost/api/actions/scan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ app: "tes-web" }),
});
```

Test:
1. `POST /api/actions/scan` sukses → `200`, body `{ ok:true, action:"scan", target:"tes-web" }`,
   header `Cache-Control: no-store` (konsisten dengan `GET /api/status`).
2. body bukan JSON / kunci ekstra / `app` bukan string → `400`, spawn tidak dipanggil.
3. `POST /api/actions/deploy` tanpa body → `200` (target dari `deployApp`); saat `deployApp` kosong → `503`.
4. app id tidak dikenal → `404`.
5. aksi kedua sementara pertama jalan → `409` + `{ running: "<aksi>" }`.
6. `GET /api/status` masih berperilaku sama (test lama tetap lulus, tidak diubah).
7. `POST /api/actions/scan` dengan `app` valid tapi `spawn` gagal (`ENOENT`) → `503`, pesan tidak
   pernah mengandung path internal mentah yang bisa dipakai menebak struktur server? → cukup
   pastikan body hanya memuat `error` + `output`, bukan objek exception.

**Diharapkan GAGAL dengan:** `404 Not Found` untuk kedua endpoint (route belum ada).

### GREEN

`web/apps/api/src/index.ts`:

```ts
export function createApp(run: RunAutore = runAutore, actions = hatchActions({
  workspace: process.env.AUTORE_WORKSPACE || defaultWorkspace(),
  run,
  spawn: spawnAutore,
  deployApp: process.env.AUTORE_DEPLOY_APP || "",
})) { … }
```

- `POST /api/actions/deploy`: panggil `actions.run("deploy")` (tanpa body; body diabaikan —
  lebih baik diabaikan daripada diam-diam dipakai).
- `POST /api/actions/scan`: baca body JSON, validasi **kunci persis** `["app"]` dan tipe string,
  lalu `actions.run("scan", app)`.
- Keduanya: `c.header("Cache-Control", "no-store")` + kembalikan `status` dari hasil aksi.
- Bentuk error body konsisten: `{ ok:false, error:"…" }` (+ `output` kalau ada).

**Catatan `defaultWorkspace()`:** `status.ts` tidak butuh workspace (CLI membaca env sendiri),
tapi aksi butuh path. Ambil dari `AUTORE_WORKSPACE`, dan kalau kosong → **jangan menebak**
`~/.autore-workspace`: `503` dengan pesan "AUTORE_WORKSPACE belum diset di unit API".
Unit yang ada sekarang sudah menyetelnya (`deploy/autore-web-api.service`), jadi ini murni
pengaman.

### GATE

```
npm test                     # api + dashboard
npm run build:dashboard      # Next build tetap hijau
```

### COMMIT

`feat(api): endpoint POST /api/actions/deploy dan /api/actions/scan`

---

## Task 4 — Dashboard: klien aksi + tombol dengan modal, spinner, toast

**File:** `web/apps/dashboard/src/lib/actions-client.ts` (BARU),
`web/apps/dashboard/src/components/actions/action-button.tsx` (BARU),
`web/apps/dashboard/src/components/actions/action-button.test.tsx` (BARU),
`web/apps/dashboard/src/components/ui/button.tsx` (tambah varian `green`)

### RED

Test komponen (`vi.stubGlobal("fetch", …)` — pola yang sama dengan
`src/app/applications/page.test.tsx:64`):

1. `menampilkan_modal_dulu_lalu_tidak_memanggil_api_saat_dibatalkan`
   → klik tombol → `dialog[open]` ada, `fetch` **belum** dipanggil; klik "Batal"
   (atau tekan `Escape`) → modal tertutup, `fetch` masih 0 kali.
2. `memanggil_api_setelah_konfirmasi` → klik lanjut → `fetch("/api/actions/deploy", { method:"POST" })`.
3. `tombol_jadi_spinner_dan_teks_berubah_saat_berjalan`
   → fetch menggantung → tombol `disabled`, ada `role="status"` teks "Deploy sedang berjalan…",
   ikon spinner punya kelas `animate-spin`.
4. `toast_sukses_lalu_hilang_sendiri` → fetch `200 {ok:true}` → muncul teks hasil, dan setelah
   waktu tunggu (fake timer) toast hilang.
5. `toast_gagal_memakai_role_alert` → fetch `422 {ok:false,error:"…",output:"…"}` → `role="alert"`
   dan pesan error terlihat.
6. `memanggil_onDone_agar_data_di_refresh` → `onDone` terpanggil setelah aksi selesai.
7. `scan_mengirim_app_id_di_body` → tombol scan → body `{"app":"tes-web"}` (JSON, kunci tunggal).

**Diharapkan GAGAL dengan:** `Failed to resolve import "@/components/actions/action-button"`
(atau `Unable to find role="dialog"` kalau komponen ditulis minimalis dulu).

### GREEN

- `lib/actions-client.ts`:

```ts
export type ActionOutcome = { ok: boolean; message: string; output: string };
export async function runAction(action: "deploy" | "scan", app?: string): Promise<ActionOutcome>
```

`fetch(`/api/actions/${action}`, { method: "POST", headers: …, body: app ? JSON.stringify({ app }) : undefined })`;
respons non-OK → `message` dari `error` bila ada, kalau tidak `"Aksi gagal (HTTP <status>)"`.

- `action-button.tsx` (`"use client"`):

```tsx
type Props = {
  label: string; runningLabel: string; action: "deploy" | "scan"; app?: string;
  variant?: "green" | "primary" | "secondary";
  confirm?: { title: string; body: string; confirmLabel: string };  // opsional (Keputusan e)
  onDone?: () => void;
};
```

- Modal: `<dialog>` native + `showModal()`/`close()`. Aksesibilitas (ESC, focus trap) gratis
  dari browser — tidak perlu dependency baru.
- Loading: `<Loader2 className="h-4 w-4 animate-spin" />` (lucide sudah ada) + `disabled` + `aria-busy="true"`.
- Toast: `useState<{ tone: "info" | "ok" | "error"; text: string } | null>`; hilang otomatis;
  `role="status"` untuk info/sukses, `role="alert"` untuk error.
- `Button` varian baru: `green: "bg-green-600 text-white hover:bg-green-700"`
  (Light Mode, sejalan varian yang ada).

### GATE

```
npm test --workspace @autore/dashboard    # 51 → 58 passed
npx tsc --noEmit -p web/apps/dashboard
```

### COMMIT

`feat(web): komponen aksi dengan modal konfirmasi, spinner, dan toast`

---

## Task 5 — Dashboard: pasang tombol di tiga halaman

**File:** `src/app/page.tsx`, `src/app/applications/page.tsx`, `src/app/pipeline/page.tsx`
(+ test masing-masing: `page.test.tsx`, `applications/page.test.tsx`, `pipeline/page.test.tsx`)

### RED

1. Overview: `menampilkan_tombol_deploy_di_kanan_atas`
   → ada `button` bernama "Deploy Sekarang" varian hijau; posisinya di header yang sama dengan
   `h1` "Dashboard"; klik → modal "Yakin mau deploy?" muncul.
2. Aplikasi: `tiap_baris_punya_tombol_scan_keamanan`
   → 2 baris data → 2 tombol "Scan Keamanan"; klik tombol baris kedua → body `{"app":"api-pegawai"}`.
3. Aplikasi: test lama yang mengunci 4 kolom tetap lulus (jangan tambah kolom baru; tombol
   masuk ke kolom "Aksi" yang sudah ada).
4. Pipeline: `menampilkan_tombol_jalankan_ulang` → ada tombol "Jalankan Ulang" di header halaman
   detail; klik → modal konfirmasi → `POST /api/actions/deploy`.
5. Semua tombol memanggil `refresh()` dari `useStatus()` setelah selesai
   (assert lewat fetch kedua ke `/api/status`).

**Diharapkan GAGAL dengan:** `Unable to find role="button" name:"Scan Keamanan"`.

### GREEN

- `app/page.tsx`: header jadi `flex items-start justify-between` → `h1`/`p` di kiri,
  `<ActionButton variant="green" label="Deploy Sekarang" …>` di kanan.
  Tapi `page.tsx` adalah server component: bungkus header dalam komponen klien kecil
  (`components/actions/deploy-now.tsx`) yang juga memanggil `useStatus().refresh` sebagai `onDone`.
- `app/applications/page.tsx`: di sel "Aksi", tombol "Scan Keamanan" (`variant="secondary"`) di
  samping link "Detail"; beri `aria-label` yang memuat nama aplikasi
  (`Scan Keamanan <nama>`) supaya bisa ditarget test tanpa ambigu.
  Halaman ini butuh `refresh()` → `useStatus()` sudah dipakai di sana.
- `app/pipeline/page.tsx`: header `flex items-start justify-between` + "Jalankan Ulang"
  (`variant="secondary"`, `confirm`).

### GATE

```
npm test                     # dashboard: 58 → 65+ passed, api tetap hijau
npm run build:dashboard      # build produksi hijau
```

### COMMIT

`feat(web): tombol Deploy, Scan Keamanan, dan Jalankan Ulang di dashboard`

---

## Task 6 — Dokumen + deploy + verifikasi live

**File:** `web/README.md`, `deploy/autore-web-api.service`

### 6.1 README

Tambah section `## Tombol aksi (deploy & scan)` yang memuat:
- Peta tombol → endpoint → argv CLI yang dijalankan (tabel).
- **Efek samping**: deploy = `git add .` + `git commit --no-verify` + `git push` di direktori
  aplikasi; scan menulis `<app>/.security-gate-reason`.
- Env yang dibutuhkan: `AUTORE_WORKSPACE` (sudah ada), `AUTORE_DEPLOY_APP` (baru), `AUTORE_BIN` (opsional).
- Kenapa tidak ada input bebas: id aplikasi divalidasi tiga lapis; argv sepenuhnya server-side.
- Satu aksi sejalan (409) + timeout (deploy 180 s, scan 60 s).
- Kalimat yang sama seperti Phase 2: "Installing units, restarting production … are deliberate
  manual steps — never part of a check."

### 6.2 Unit systemd

`deploy/autore-web-api.service`: tambah `Environment=AUTORE_DEPLOY_APP=tes-web`
(di bawah `AUTORE_WORKSPACE` yang sudah ada). Kalau user mau target lain, ganti nilainya.

### 6.3 Urutan deploy (WAJIB urut, pelajaran dari Phase 2)

`sudo` dijalankan **oleh user**, bukan oleh agent.

```
1. cd ~/Autore && cargo test && cargo clippy --all-targets -- -D warnings   # 174 passed, exit 0
2. (web) npm test && npm run build:dashboard                                # hijau
3. cargo build --release
4. sudo install -m 0755 cli/target/release/autore /usr/local/bin/autore      # binary DULU
5. cp deploy/autore-web-api.service ~/.config/systemd/user/ && systemctl --user daemon-reload
   systemctl --user restart autore-web-api.service autore-web-dashboard.service
6. verifikasi loopback (6.4)
7. git push origin main                                                     # push TERAKHIR
```

Alasan urutan ini sama dengan Phase 2: build Jenkins akan memakai binary yang terpasang.
Kalau push dilakukan lebih dulu, pipeline berjalan dengan binary lama.

**Bukan bagian dari check:** install unit, restart service produksi, dan push — langkah manual.

### 6.4 Verifikasi (bukti yang harus dikumpulkan)

Semua di VPS, loopback:

```bash
# 1. scan aplikasi nyata
curl -s -X POST http://127.0.0.1:9121/api/actions/scan \
  -H 'content-type: application/json' -d '{"app":"tes-web"}' | head -c 400

# 2. tolak input jahat
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:9121/api/actions/scan \
  -H 'content-type: application/json' -d '{"app":"../../etc"}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:9121/api/actions/scan \
  -H 'content-type: application/json' -d '{"app":"tes-web","extra":1}'

# 3. single-flight (dua request bersamaan)
( curl -s -o /tmp/a.json -w '%{http_code}\n' -X POST http://127.0.0.1:9121/api/actions/scan \
    -H 'content-type: application/json' -d '{"app":"tes-web"}' & \
  curl -s -o /tmp/b.json -w '%{http_code}\n' -X POST http://127.0.0.1:9121/api/actions/scan \
    -H 'content-type: application/json' -d '{"app":"tes-web"}' & wait )

# 4. deploy sungguhan (efek samping nyata: job Jenkins tes-web dibuat/dibuild)
curl -s -X POST http://127.0.0.1:9121/api/actions/deploy | head -c 400

# 5. target tidak diset -> 503 (uji dengan env kosong pada proses uji, bukan unit produksi)
```

Yang harus terlihat:
- `200` + `target: "tes-web"` untuk scan bersih, `422` + `output` kalau ada temuan.
- `400` untuk `../../etc` **dan** `{"app":"tes-web","extra":1}`.
- dari dua request bersamaan: satu `200`, satu `409`.
- deploy → `200`, dan di Jenkins muncul job `tes-web` (sebelumnya hanya 3 job: autore-e2e, autore-dummy, diag-ws).
- `GET /api/status` tetap `stale: false` dan isinya tidak berubah bentuk.

Lalu di browser (user, dari tailnet):

```
http://100.80.3.14:9120/               → tombol hijau "Deploy Sekarang" di kanan atas
http://100.80.3.14:9120/applications   → tombol "Scan Keamanan" per baris
http://100.80.3.14:9120/pipeline?app=tes-web → tombol "Jalankan Ulang"
```

Cek perilaku yang diminta: modal muncul sebelum aksi, tombol jadi spinner, toast
"… sedang berjalan…", lalu toast hasil.

### COMMIT

`docs(web): dokumentasi tombol aksi + kontrak efek sampingnya`

---

## Ringkas: tabel RED → GREEN

| Task | RED (perintah + kegagalan yang diharapkan) | GREEN (kode) | Bukti hijau |
|---|---|---|---|
| 1 | `cargo test --test deploy_cli` → `left: Some(0)` | `main.rs` exit 1 non-interaktif | 174 passed, clippy 0 |
| 2 | `npm test --workspace @autore/api` → import `./actions` gagal | `actions.ts` | 10 passed |
| 3 | `app.request(/api/actions/scan)` → 404 | endpoint di `index.ts` | api hijau |
| 4 | `npm test -w @autore/dashboard` → import komponen gagal | `action-button.tsx`, `actions-client.ts` | 58 passed |
| 5 | test halaman → `Unable to find role="button" name:"Scan Keamanan"` | 3 halaman | 65+ passed, build hijau |
| 6 | — | README + unit + deploy | curl 200/400/409, job Jenkins baru, screenshot UI |

---

## Review Focus (5 hal yang paling mungkin menggigit)

1. **Tidak ada autentikasi di `:9120`, dan sekarang halaman itu bisa menyuruh server bekerja.**
   Terukur: dari internet port 9120/9121/9119 semuanya tertutup (000), dari tailnet 9120 `200`.
   Jadi paparannya = perangkat di tailnet. Dengan argv hardcoded, ini bukan RCE, tapi tetap
   "siapa pun yang bisa buka halaman bisa memicu deploy + push". Mitigasi minimal yang disarankan
   (di luar scope, terserah user): bind dashboard ke IP tailnet saja, atau header token
   bersama di proxy. Kalau tidak dikerjakan, tulis eksplisit di README bahwa aksi mengandalkan
   tailnet sebagai batas kepercayaan.
2. **Deploy auto-commit + push repo aplikasi** (`jenkins.rs:299-313` memakai `--no-verify`,
   melewati security gate pre-commit). Satu klik tombol = kode user naik ke origin.
   Mitigasi: konfirmasi modal (Task 5) + dokumentasi; jangan dijalankan terhadap repo Autore
   sendiri tanpa sadar.
3. **Scan menulis `.security-gate-reason` di direktori aplikasi**, lalu deploy berikutnya bisa
   meng-commit berkas itu (`git add .`). Cek apakah `.gitignore` aplikasi sudah memuatnya;
   kalau belum, tambahkan di Task 6 (satu baris) atau catat sebagai Known Issue.
4. **Dua klik cepat / dua tab.** Lock global menahan ini di sisi API (409). Tapi kalau halaman
   di-refresh saat aksi berjalan, tombol kembali aktif dan user tidak tahu aksi masih jalan —
   pesan 409 harus terbaca sebagai "aksi lain sedang berjalan", bukan "gagal".
5. **Klien putus ≠ proses berhenti.** `execFile` di sisi server tetap jalan walau tab ditutup;
   spinner hilang tapi deploy lanjut. Ini perilaku yang benar (deploy tidak boleh batal di tengah),
   tapi harus ditulis di README supaya tidak dikira bug.

---

## Out of scope (sengaja tidak dikerjakan)

- Log streaming realtime aksi ke UI (butuh job store + SSE).
- Riwayat aksi / audit trail siapa menekan apa.
- Autentikasi & role di dashboard.
- Endpoint untuk tombol per-aplikasi selain scan (mis. deploy app tertentu dari halaman Aplikasi).
- Menampilkan `running_containers` per aplikasi (data belum ada di `autore status --json`).
- Perbaikan `~/.local/bin/autore` (serve manual `:9119`) yang masih versi lama.
