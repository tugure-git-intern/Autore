# Plan — SBOM Viewer (Autore dashboard)

Status: **rencana, belum dieksekusi**. Tanggal: 2026-11-05.
Repo: `~/Autore` (VPS `100.80.3.14`, user `tugure`). Semua perintah di plan ini dijalankan **di VPS**, bukan laptop.

---

## 1. Apa yang diminta

Halaman dashboard yang menampilkan daftar dependensi dari `sbom.cdx.json` hasil build Autore:

1. **Rust CLI**: `autore sbom --app <app> --json` → baca SBOM terakhir, keluarkan JSON ringkas `[{name, version, type}]`.
2. **Hono**: `GET /api/sbom/:app` → spawn command di atas.
3. **Next.js**: halaman `/applications/[app]/sbom` → tabel (Nama Library, Versi, Tipe), search bar, tombol "Kembali ke Detail Aplikasi"; di halaman detail aplikasi ada link "Lihat SBOM".
4. **Tes**: parsing SBOM di Rust, tabel di UI.

---

## 2. Fakta lapangan (hasil investigasi, sudah diverifikasi)

Ini bagian terpenting: **SBOM hari ini tidak ada di tempat yang bisa dibaca dashboard.**

| Fakta | Bukti |
|---|---|
| Stage 6 pipeline menulis SBOM | `vars/autorePipeline.groovy:169-180` → `autore scan-image --image ... --sbom-output dist/sbom.cdx.json` lalu `sha256sum` |
| Build #21 benar-benar menghasilkan SBOM | log build #21: `dist/sbom.cdx.json (193KB)`, 8/8 stage hijau |
| Lokasi `dist/` = workspace **agent**, bukan workspace Autore | log: `Running on Jenkins agent vps-runner-1 in /home/jenkins/agent/workspace/tes-web` |
| `dist/` itu **tidak terbaca** user `tugure` | `/home/jenkins` mode `0700`; `/home/jenkins/agent/workspace/tes-web/dist` tidak bisa diakses; 0 file `*sbom*` di `/home/tugure/**` |
| Salinan durabel = Nexus raw | `scripts/ci-nexus-publish.sh:103-131` → `http://127.0.0.1:8082/repository/autore-releases/build-<n>-commit-<sha>/sbom.cdx.json`; browse anonim → **401** (butuh `NEXUS_USER`/`NEXUS_PASS`, yang datang dari env Jenkins, bukan file lokal) |
| Folder `~/autore-workspace/<app>/dist/` belum ada | `ls ~/autore-workspace/tes-web` → hanya `app.py`, `Dockerfile`, `Jenkinsfile`, `test_app.py`, `.git`, `dist` **tidak ada** |
| Agent Jenkins **boleh** nulis ke `~/autore-workspace` | `~/autore-workspace/dashboard-status.json` owner `jenkins:jenkins`, mtime Nov 5 15:27; dir `0775 tugure:tugure`, user `jenkins` (uid 996) anggota grup `tugure` |

**Konsekuensi:** command Rust tidak bisa hanya "baca file yang sudah ada" — tidak ada file yang bisa dibaca. Harus ada satu langkah kecil di pipeline yang **menyalin** SBOM ke `$AUTORE_WORKSPACE/<app>/dist/` (persis path yang bos alif sebut). Ini Task 3, wajib, dan butuh 1 build nyata supaya ada data.

`AUTORE_WORKSPACE` sudah terpasang di unit API (`/home/tugure/autore-workspace`), jadi endpoint tidak perlu env baru:

```
Environment=AUTORE_BIN=/home/tugure/Autore/cli/target/release/autore
Environment=AUTORE_WORKSPACE=/home/tugure/autore-workspace
Environment=AUTORE_DEPLOY_APP=tes-web
```

---

## 3. Keputusan desain

### 3.1 Sumber data (bertingkat, jujur soal keterbatasan)

1. **Utama**: `<AUTORE_WORKSPACE>/<app>/dist/sbom.cdx.json` — diisi pipeline (Task 3). Tanpa kredensial, tanpa jaringan, langsung bisa dibaca `tugure`.
2. **Fallback Nexus**: `NEXUS_RAW_URL/build-<n>-commit-<sha>/sbom.cdx.json` — **ditunda (T7 opsional)**, karena butuh sumber kredensial Nexus di luar Jenkins (belum ada file lokal). Tidak masuk lingkup sekarang; dicatat sebagai jalan keluar kalau salinan workspace hilang.
3. **Fallback baca langsung `/home/jenkins/...`**: **ditolak**. Butuh sudo/`setfacl`; hak akses tidak boleh dibuka demi tampilan.

Kalau file tidak ada → command keluar non-zero + pesan jalan keluar yang jelas ("build ulang supaya stage 6 menyalin SBOM"). Bukan tebakan, bukan tampil kosong.

### 3.2 "Halaman Detail Aplikasi" belum ada

Di dashboard hari ini **tidak ada route detail per aplikasi**. Kolom Aksi di `/applications` menautkan "Detail" ke `/pipeline?app=<id>`. Jadi:

- Link **"Lihat SBOM"** dipasang di kolom Aksi tabel `/applications` (sebelah "Detail" dan "Scan Keamanan"). Ini padanan paling dekat dari "halaman Detail Aplikasi".
- Tombol **"Kembali ke Detail Aplikasi"** di halaman SBOM menuju `/applications` (daftar aplikasi). Label tetap verbatim seperti permintaan.
- Membuat halaman detail aplikasi sungguhan = perubahan lingkup besar; **tidak** dikerjakan di plan ini. Kalau bos alif mau, jadi plan terpisah.

### 3.3 Kontrak JSON (dikunci di tiga lapis: Rust → Hono → TS)

`autore sbom --app tes-web --json`:

```json
{
  "app": "tes-web",
  "generated_at": "2026-11-05T08:27:11Z",
  "source": "/home/tugure/autore-workspace/tes-web/dist/sbom.cdx.json",
  "total": 137,
  "packages": [
    { "name": "express", "version": "4.18.2", "type": "language" },
    { "name": "openssl", "version": "3.0.11", "type": "os" }
  ]
}
```

Aturan:

- `type` = `"os"` untuk CycloneDX `type == "operating-system"`, `"language"` untuk sisanya (di luar itu dipetakan ke `language`, dicatat di plan ini).
- `version` tidak ada di SBOM → `""` (UI menampilkan `—`, bukan `null`; mengikuti gaya "text yang tidak tersedia adalah `\"\"`" yang sudah dipakai `DashboardStatus`).
- Komponen tanpa `name` dilewati. Duplikat `(name, version, type)` dibuang. Urutan: nama (case-insensitive) lalu versi.
- `components` dibaca **rekursif satu level** (`components[].components`) karena CycloneDX mengizinkan sarang; Trivy taruh OS package + language lib di level atas, tapi resiliensi satu baris ini murah.
- `generated_at` = `metadata.timestamp` CycloneDX; kalau tidak ada → mtime file (UTC RFC3339); kalau tidak ada dua-duanya → `""`.
- `total` = `packages.length` (dihitung CLI, bukan dihitung ulang UI).

Bentuk ini dipakai apa adanya oleh Hono (passthrough) dan `contracts.ts` (mirror), jadi tidak ada penerjemahan kedua.

### 3.4 Keamanan (mengikuti aturan Phase 3 yang sudah dikunci)

- `shell: false`, argv disusun di server: `["sbom", "--app", <id>, "--json"]`. Tidak pernah ada string JSON/argv dari browser.
- `:app` divalidasi ulang: `^[A-Za-z0-9._-]{1,64}$` (tolak `/`, `..`, spasi, NUL) **dan** harus ada di registry (`autore status --json`) — sama seperti `resolveTarget` di `actions.ts`. Snapshot basi → 503, bukan tebakan.
- Hanya baca (tidak mengubah sistem) → **tanpa sesi**, konsisten dengan `GET /api/status|runs|active` (unit API hanya listen `127.0.0.1`). Otomatis jadi terbuka kalau nanti ekspos keluar — dicatat sebagai batas sadar.

---

## 4. Task (RED → GREEN, satu commit per task)

Aturan tetap: **jangan pernah merantai tes ke `git commit`** (pakai `;`/`&&` salah → commit merah, sudah pernah kejadian), dan setiap task: tulis tes dulu, lihat merah, baru implementasi.

### T1 — Rust: `autore sbom --app <id> --json`

File: `cli/src/sbom.rs` (baru), `cli/src/main.rs` (varian `Commands::Sbom` + dispatch), `cli/tests/sbom_cli.rs` (baru).
Reuse: `crate::serve::workspace_dir()` (`cli/src/serve.rs:137`) untuk `AUTORE_WORKSPACE` → fallback `$HOME/.autore-workspace`. Tidak menambah env var baru.

**RED** — `cli/tests/sbom_cli.rs`, pola `env!("CARGO_BIN_EXE_autore")` + `TempDir` (sama seperti `runs_cli.rs`). Fixture `sbom.cdx.json` di `<tmp>/ws/tes-web/dist/`:

| # | Kasus | Harapan |
|---|---|---|
| 1 | fixture normal (openssl+libc6 `operating-system`, express `library`, satu komponen tanpa `version`, satu kandidat duplikat, satu komponen bersarang) | exit 0; `packages` terurut; type `os`/`language` benar; duplikat jadi satu; komponen tanpa version → `""`; `total == packages.length`; `app == "tes-web"` |
| 2 | file SBOM tidak ada | exit ≠ 0; stderr menyebut path lengkapnya; stdout kosong |
| 3 | `--app ../rahasia` dan `--app a/b` | exit ≠ 0; tidak ada pembacaan di luar workspace |
| 4 | `AUTORE_WORKSPACE` tidak diset | exit ≠ 0 + pesan jelas |
| 5 | file ada tapi bukan CycloneDX (JSON sampah) | exit ≠ 0 + pesan jelas |

Jalankan: `cd ~/Autore/cli && PATH=$HOME/.cargo/bin:$PATH cargo test --test sbom_cli` → **merah** (subcommand belum ada).

**GREEN** — implementasi `cli/src/sbom.rs`: baca file, `serde_json::Value`, petakan komponen, cetak JSON (`serde_json::to_string_pretty`?) — **satu baris** JSON (`to_string`) supaya Hono tinggal `JSON.parse`, mode manusia tanpa `--json` cukup tabel ringkas + jumlah. Semua jalur gagal → `eprintln!` + `process::exit(1)`.
Jalankan tes lagi → hijau. `cargo fmt` + `cargo clippy` bersih.

Commit: `feat(cli): autore sbom — baca sbom.cdx.json jadi daftar paket ringkas`

### T2 — Hono: `GET /api/sbom/:app`

File: `web/apps/api/src/sbom.ts` (baru), `src/sbom.test.ts` (baru), `src/index.ts` (wiring + param loader), `src/index.test.ts` (+1 tes route).

**RED** — `src/sbom.test.ts`, pola `actions.test.ts` (`make(dir, {spawn})` dengan spawn palsu):

| # | Kasus | Harapan |
|---|---|---|
| 1 | app terdaftar | spawn dipanggil sekali, `file = AUTORE_BIN || "autore"`, `args` **persis** `["sbom","--app","tes-web","--json"]`, `shell: false`, `cwd` = workspace, `env.AUTORE_WORKSPACE` = workspace |
| 2 | CLI exit 1 (SBOM hilang) | status **404**, body memuat pesan stderr CLI |
| 3 | id tidak sah (`../x`) | 400, spawn **tidak** dipanggil |
| 4 | app tidak ada di registry | 404, spawn tidak dipanggil |
| 5 | `AUTORE_WORKSPACE` kosong | 503, spawn tidak dipanggil |
| 6 | `autore` hilang / timeout | 503 / **504** |
| 7 | stdout CLI bukan JSON sah | **422**, body jelas (kontrak CLI rusak, bukan salah user) |

Route: di `index.test.ts` tambah 1 tes — `GET /api/sbom/tes-web` → 200 + body identik keluaran CLI, `Cache-Control: no-store`, **tanpa cookie** (read-only).

**GREEN** — implementasi mengikuti `actions.ts`: `hatchSbom({workspace, run, spawn, bin})`, `APP_ID` dipakai ulang, allowlist dari `loadDashboardStatus`, timeout `30_000`, output stderr/`error` dipotong 4 000 char (`MAX_OUTPUT`).
Commit: `feat(api): GET /api/sbom/:app — meneruskan autore sbom --json`

### T3 — Pipeline menyalin SBOM ke workspace yang bisa dibaca

File: `vars/autorePipeline.groovy` (stage 6, di dalam blok `sh` yang sudah ada).

```
mkdir -p "${AUTORE_WORKSPACE}/${APP_NAME}/dist"
cp -f dist/sbom.cdx.json "${AUTORE_WORKSPACE}/${APP_NAME}/dist/sbom.cdx.json"
```

Dijaga `appReported` (sama seperti `pipeline record`): pipeline Autore sendiri tidak punya `appName`, jadi tidak menyalin apa-apa. Salinan **tidak boleh** menggagalkan pipeline keamanan (best-effort, `|| true` + `echo WARNING`) — sejalan dengan komentar `record` yang sudah ada.

**Verifikasi (bukan tes unit — ini bukti lapangan):**

1. `PATH=$HOME/.cargo/bin:$PATH cargo build --release` + `sudo install` biner baru.
2. Picu build nyata: `tes-web` (butuh crumb Jenkins).
3. Cek: `ls -la ~/autore-workspace/tes-web/dist/` → `sbom.cdx.json` ada, owner `jenkins`, **terbaca** tugure.
4. `curl -s http://127.0.0.1:9121/api/sbom/tes-web | python3 -m json.tool | head` → `total` ratusan, `packages[0]` berbentuk benar.
5. `sha256sum` salinan == isi `SHA256SUMS` di Nexus (opsional, kalau kredensial tidak tersedia cukup lewat `autore sbom` non-`--json`).

Commit: `feat(pipeline): salin sbom.cdx.json ke workspace Autore`

### T4 — Dashboard: tabel + search

File: `web/apps/dashboard/src/lib/contracts.ts` (+`SbomPackage`, `SbomPayload`), `src/lib/sbom-client.ts` (baru), `src/lib/filter-sbom.ts` (baru), `src/components/sbom-table.tsx` (baru), `src/app/applications/[app]/sbom/page.tsx` (baru). Tes: `filter-sbom.test.ts`, `sbom-table.test.tsx`, `sbom/page.test.tsx`.

**RED**

- `filter-sbom.test.ts`: `""` → semua; `"OPENSSL"` → cocok case-insensitive; `"  expr "` (spasi dipangkas); cocok juga di versi; `"zzz"` → `[]`.
- `sbom-table.test.tsx`: header menampilkan jumlah (`137 paket`) + isi SBOM tanggal; kolom verbatim **Nama Library**, **Versi**, **Tipe**; `type: "os"` → `OS Package`, `language` → `Language Package`; `version: ""` → `—`; search 1 baris pakai `type="search"` + `aria-label` dan memfilter baris (assert jumlah baris berubah); query tanpa hasil → `Tidak ada library yang cocok`; 500 baris tetap render (tanpa virtualisasi — dicatat batasnya).
- `sbom/page.test.tsx`: fetch dipalsukan; state **loading** (skeleton, `aria-busy`), **sukses** (tabel), **404** (`SBOM belum tersedia untuk aplikasi ini`), **error** (alert + tombol `Coba lagi` yang memicu refetch); link kembali `href="/applications"` berlabel `Kembali ke Detail Aplikasi`.

**GREEN** — `sbom-client.ts` pola `status-client.ts` (same-origin `/api/sbom/<app>`, `cache: "no-store"`); **404 → `null`** (bukan lempar), sisanya lempar. Halaman = client component, `useParams()` dari `next/navigation` (menghindari `params` sebagai Promise di Next 15), gaya visual mengikuti halaman lain (Light Mode, border tipis, Inter, copy Indonesia).

Commit: `feat(dashboard): halaman SBOM dengan tabel dan pencarian`

### T5 — Link "Lihat SBOM" di daftar aplikasi

File: `src/app/applications/page.tsx` (+ update `src/app/applications/page.test.tsx`).
RED: tes baru menuntut tiap baris punya tautan `Lihat SBOM` dengan `href="/applications/<id>/sbom"` (id di-encode), berdampingan dengan `Detail` dan `Scan Keamanan` — dan tidak muncul saat daftar kosong.
GREEN: satu elemen `<a>`.

Commit: `feat(dashboard): tautan Lihat SBOM di tabel aplikasi`

### T6 — Verifikasi hidup + bukti

1. `cd ~/Autore/web && npx vitest run` → semua hijau (sebelumnya 40 berkas / 308 tes).
2. `npx tsc -p apps/dashboard --noEmit` → 0.
3. `npm run build:dashboard` → sukses, `systemctl --user restart autore-web-dashboard`.
4. `e2e/sbom.spec.ts` (Playwright, pola `dashboard.spec.ts`): buka `/applications/tes-web/sbom` → assert header jumlah paket, baris pertama ada, ketik `openssl` di search → baris menyempit, klik `Kembali ke Detail Aplikasi` → URL `/applications`. **Prasyarat: T3 sudah menghasilkan data nyata**; kalau belum, tes ini akan merah dan itu benar (bukan di-skip).
5. `LD_LIBRARY_PATH=/tmp/pwdeps/root/usr/lib/x86_64-linux-gnu npx dotenv -e .env -- npm run test:e2e --workspace @autore/dashboard`.
6. Bukti visual: screenshot `sbom-halaman.png` (1400×1000) + `sbom-search.png` (setelah ketik "openssl") → `~/.hermes/cache/scratch/p8/bukti/`, dianalisa `vision_analyze`, disalin ke `~/.hermes/plans/` biar bisa dibuka dari `:8899`.
7. Push; `git rev-parse HEAD origin/main` harus sama. Pipeline `autore-e2e` (poll 5 m) akan jalan sendiri.

---

## 5. Definisi selesai

- `autore sbom --app tes-web --json` di VPS mengeluarkan `packages` asli dari build nyata.
- `GET /api/sbom/tes-web` → 200 + JSON sama; app tak dikenal/ tidak sah → 400/404; tanpa SBOM → 404 + alasan.
- `/applications/tes-web/sbom` menampilkan tabel + search yang benar-benar menyaring, tombol kembali, dan bisa dibuka dari `/applications`.
- `cargo test`, `vitest`, `tsc`, build dashboard, e2e semua hijau; bukti visual ada.

---

## 6. Risiko & batas jujur

1. **Data baru ada setelah T3 + 1 build nyata.** Sebelum itu halaman menampilkan "SBOM belum tersedia". Ini bukan bug, tapi urutan kerja wajib: T3 tidak boleh ditunda.
2. **Biner baru (`cargo build --release` + `install`) wajib sebelum build nyata**, karena stage 6 memanggil `/usr/local/bin/autore` (path tetap di groovy).
3. **Nexus tanpa kredensial lokal**: fallback Nexus tidak diimplementasi sekarang (T7 opsional). Kalau `~/autore-workspace` dibersihkan, SBOM harus diambil dari Nexus — perlu kredensial di `~/.config/autore/nexus.conf` (belum ada).
4. **SBOM besar (193 KB, ratusan paket)**: tabel dirender penuh tanpa virtualisasi. Cukup untuk ratusan baris; kalau nanti ribuan, tambah paginasi (bukan sekarang).
5. **Enumerasi dependensi bersifat sensitif** (peta versi library). Endpoint read-only ini terbuka seperti `GET /api/*` lain, aman selama API hanya di `127.0.0.1`; kalau nanti diekspos keluar, guard sesi harus ditambahkan lebih dulu.
6. **Tidak ada halaman detail aplikasi** (lihat §3.2) — link dipasang di tabel aplikasi.
7. `generated_at` bisa kosong kalau CycloneDX tidak menulis `metadata.timestamp` dan mtime tidak terbaca; UI harus tahan `""`.

---

## 7. File yang disentuh

| Lapis | File |
|---|---|
| Rust | `cli/src/sbom.rs` (baru), `cli/src/main.rs`, `cli/tests/sbom_cli.rs` (baru) |
| Pipeline | `vars/autorePipeline.groovy` (stage 6, ~3 baris) |
| Hono | `web/apps/api/src/sbom.ts` (baru), `src/sbom.test.ts` (baru), `src/index.ts`, `src/index.test.ts` |
| Dashboard | `src/lib/contracts.ts`, `src/lib/sbom-client.ts` (baru), `src/lib/filter-sbom.ts` (baru), `src/components/sbom-table.tsx` (baru), `src/app/applications/[app]/sbom/page.tsx` (baru), `src/app/applications/page.tsx` (+ tes), `e2e/sbom.spec.ts` (baru) |

Tidak ada dependency baru di ketiga lapis (clap/serde_json sudah ada; dashboard pakai React + Tailwind yang sudah ada).

---

## 8. Urutan & gate

T1 (Rust) → T2 (Hono) → **T3 (pipeline + build nyata — gerbang data)** → T4 (UI) → T5 (link) → T6 (verifikasi hidup + push).
Gate tiap task: tes lapis itu hijau + `cargo clippy`/`tsc` bersih; lapor per task; **stop setelah T6** dan tunggu perintah bos alif.
