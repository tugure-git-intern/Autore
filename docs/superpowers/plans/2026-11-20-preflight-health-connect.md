# Preflight `/health` saat Sambungkan Repo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development atau superpowers:executing-plans. Kerjakan task berurutan (native), steps pakai checkbox.

**Goal:** Repo yang tidak punya endpoint `/health` diberi peringatan saat dev klik "Sambungkan Repo", bukan baru ketahuan setelah build gagal di tahap 10.

**Architecture:** Pemeriksaan statis di CLI setelah clone (baca berkas sumber, cari `/health`), hasilnya satu baris berprefiks tetap di stdout. API membaca baris itu jadi field `peringatan` pada hasil aksi. Dialog menampilkan peringatan itu setelah sukses. Tidak memblokir: framework yang menyediakan health sendiri (mis. Spring Actuator) tetap boleh lanjut, dan pipeline tetap jadi penentu akhir.

**Tech Stack:** Rust (crate `autore`, tanpa dependensi baru), TypeScript (Hono API + React dashboard), vitest, Playwright.

**Spec:** tidak ada dokumen spec terpisah; kebutuhan dari percobaan user 2026-11-19 (`coba-alif-2` build #2 gagal di `10. Deploy by Verified Digest` karena `app.py` hanya `print`).

## Global Constraints

- Tanpa dependensi baru di `cli/Cargo.toml` maupun `web/package.json`.
- CLI non-interaktif saat dipanggil web: tidak ada prompt, tidak ada exit code baru. Peringatan TIDAK menggagalkan connect (exit tetap 0).
- Prefiks baris peringatan verbatim: `PERINGATAN_HEALTH: ` (satu spasi setelah kolon).
- Teks peringatan verbatim: `Repo ini belum punya endpoint /health. Deploy akan gagal di tahap 10 sampai aplikasi menjawab /health di port bawaan stack.`
- Pemeriksaan hanya membaca berkas; tidak menjalankan kode repo, tidak jaringan.
- Batas baca: lewati folder `.git`, `node_modules`, `target`, `vendor`, `dist`, `build`, `tests`, `test`, `__tests__`; lewati berkas > 512 KiB; berhenti setelah 2.000 berkas diperiksa.
- Hanya berkas kode yang dibaca: `.py`, `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.java`, `.go`. Dokumentasi (`.md`, `.txt`, `.rst`) dan berkas lain tidak dihitung.
- File test dilewati walau ekstensinya kode: nama diawali `test_`, atau berakhiran `_test.<ext>`, `.test.<ext>`, `.spec.<ext>`.
- Tidak memakai `progress::tahap`: penanda `@@AUTORE` tidak punya konsumen di repo ini (hanya produsen `cli/src/progress.rs`), jadi baris itu tidak akan terlihat di dashboard. Peringatan sampai ke UI lewat stdout berprefiks + field API.
- argv tetap `shell: false`; tidak ada kunci body baru di API.
- Nama aksesibel tombol tidak berubah (`Sambungkan Repo` vs `Sambungkan Sekarang`).
- Tes Rust: `cargo test --bin autore`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check` (setelah fmt, buang perubahan berkas di luar task).
- Tes web WAJIB pakai Node 22 (`.nvmrc` = 22): `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH` dulu. Node 18 bawaan laptop bikin `src/node-version.test.ts` merah padahal kodenya benar.
- Tes web: `npx vitest run` dari `web/` (baseline terverifikasi 2026-11-20: 877 lulus), `npm run lint`, `npm run typecheck` (sudah mencakup api + dashboard + contracts).
- Sebelum push `main`: deploy web ke VPS lalu `npx playwright test` di `web/apps/dashboard`.
- Runtime/verifikasi Jenkins di VPS (`ssh -o BatchMode=yes vps`); laptop hanya dev.

## Review Focus

- Repo kosong sama sekali (0 berkas sumber) → tetap pesan lama "Folder ini belum berisi kode aplikasi", bukan pesan health; connect tetap sukses.
- Repo besar / ada berkas biner (mis. `.png`, `.jar`) → tidak panic, tidak membaca berkas > 512 KiB, tidak menelusuri `node_modules`.
- Health ditulis framework (`/actuator/health`, `@GetMapping("/health")`, `app.get("/health")`) → dianggap ada, tidak ada peringatan palsu.
- Repo punya `/health` hanya di dalam `.git` atau `node_modules` → tetap diperingatkan (bukan kode aplikasi).
- `README.md` menyebut `/health` tapi kodenya tidak → tetap diperingatkan (dokumentasi bukan bukti).
- `test_app.py` / `app.test.js` menembak `/health` tapi aplikasi tidak menyediakannya → tetap diperingatkan.
- `/health` hanya di dalam komentar kode sumber → tidak terdeteksi sebagai masalah (false positive yang diterima; peringatan bukan gerbang, pipeline tetap penentu).
- API menerima stdout tanpa baris peringatan → field `peringatan` tidak ada, dialog tidak berubah dari perilaku sekarang.

---

### Task 1: Perluas peringatan yang sudah ada di CLI

Sudah ada `peringatkan_folder_kosong(dir)` di `cli/src/main.rs:104` (dipanggil dua jalur `init`, baris 1213 dan 1817) beserta `tanpa_kode_aplikasi(dir)` di baris 89. Jangan bikin mekanisme baru: perluas fungsi itu, lalu panggil dari `connect`. Folder kosong tetap pakai pesan lama; pesan health hanya untuk folder yang ADA kodenya tapi tanpa `/health`, supaya tidak dobel.

**Files:**
- Modify: `cli/src/main.rs` (`punya_endpoint_health` baru + cabang baru di `peringatkan_folder_kosong`)
- Modify: `cli/src/connect.rs` (panggil `crate::peringatkan_folder_kosong(&target)` setelah clone + `pilih_stack`, sebelum file pipeline dibuat)
- Test: `cli/src/main.rs` (`mod tests` yang sudah ada)

**Interfaces:**
- Consumes: `tanpa_kode_aplikasi(dir)` yang sudah ada, `std::fs`, `std::path::Path`. Tanpa `progress::tahap` (tidak ada konsumen).
- Produces:
  - `pub fn punya_endpoint_health(dir: &Path) -> bool`
  - `pub const PERINGATAN_HEALTH: &str = "Repo ini belum punya endpoint /health. Deploy akan gagal di tahap 10 sampai aplikasi menjawab /health di port bawaan stack.";`
  - Baris stdout saat folder berisi kode tanpa health: `PERINGATAN_HEALTH: {PERINGATAN_HEALTH}`

- [ ] **Step 1: Tulis tes gagal**

Nama tes dan assertion (pakai `TempDir` seperti tes lain di berkas itu):
- `repo_tanpa_health_terdeteksi`: tulis `app.py` isi `print("halo")` → `assert!(!punya_endpoint_health(tmp.path()))`
- `repo_dengan_health_terdeteksi`: tulis `app.py` isi `if self.path == "/health":` → `assert!(punya_endpoint_health(tmp.path()))`
- `health_milik_framework_tetap_terdeteksi`: tulis `Main.java` isi `@GetMapping("/actuator/health")` → `assert!(punya_endpoint_health(...))`
- `health_di_folder_abaikan_tidak_dihitung`: tulis `node_modules/lib/x.js` isi `"/health"` dan `app.py` isi `print(1)` → `assert!(!punya_endpoint_health(...))`
- `folder_kosong_tidak_memicu_pesan_health`: direktori kosong → `assert!(tanpa_kode_aplikasi(tmp.path()))` dan `assert!(!punya_endpoint_health(...))`; jalur ini tetap memakai pesan lama, bukan `PERINGATAN_HEALTH`
- `readme_yang_menyebut_health_tidak_dihitung`: tulis `README.md` isi `GET /health` dan `app.py` isi `print(1)` → `assert!(!punya_endpoint_health(...))`
- `file_test_yang_menembak_health_tidak_dihitung`: tulis `test_app.py` isi `client.get("/health")` dan `app.py` isi `print(1)` → `assert!(!punya_endpoint_health(...))`; ulang untuk `app.test.js` dan `tests/api.py`
- `ekstensi_di_luar_daftar_tidak_dihitung`: tulis `catatan.txt` dan `openapi.yaml` berisi `/health`, plus `app.py` isi `print(1)` → `assert!(!punya_endpoint_health(...))`
- `berkas_besar_dilewati`: tulis `besar.py` berisi komentar padding 600 KiB lalu `"/health"` → `assert!(!punya_endpoint_health(...))` (pakai `.py`, bukan `.txt`, supaya yang terbukti batas ukuran bukan filter ekstensi)

- [ ] **Step 2: Jalankan, pastikan merah**

Run: `cd cli && cargo test --bin autore health`
Expected: FAIL — `cannot find function punya_endpoint_health`.

- [ ] **Step 3: Implementasi**

`punya_endpoint_health(dir: &Path) -> bool`: telusuri direktori secara rekursi dengan tumpukan `Vec<PathBuf>` (tanpa dependensi walkdir). Urutan saringan per entri: (1) lewati folder terlarang termasuk `tests`/`test`/`__tests__`; (2) lewati berkas > 512 KiB lewat `fs::metadata`; (3) ambil ekstensi huruf kecil dan hanya terima daftar kode di Global Constraints; (4) lewati nama file test (`test_` di awal, `_test.`/`.test.`/`.spec.` sebelum ekstensi); (5) baca `fs::read_to_string`, lewati yang gagal UTF-8 (biner); (6) `true` pada substring `"/health"` pertama. Hitung berkas yang benar-benar dibaca dan berhenti di 2.000.

`peringatkan_folder_kosong`: cabang kosong yang sekarang tetap apa adanya; tambah `else if !punya_endpoint_health(dir)` yang mencetak `println!("PERINGATAN_HEALTH: {PERINGATAN_HEALTH}")` saja. Jangan memanggil `progress::tahap` — tidak ada yang mengurai penanda itu di web.

`connect.rs`: panggil `crate::peringatkan_folder_kosong(&target)` setelah stack ditentukan. Jangan `return gagal(...)` — connect tetap exit 0.

- [ ] **Step 4: Jalankan, pastikan hijau**

Run: `cd cli && cargo test --bin autore && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: semua tes lulus (325 + 9), clippy tanpa warning, fmt bersih. Jalankan juga `autore init` di workspace sementara dan pastikan pesan lama untuk folder kosong tidak berubah.

- [ ] **Step 5: Commit**

```bash
git add cli/src/main.rs cli/src/connect.rs
git commit -m "feat(connect): peringatkan repo tanpa endpoint /health sebelum build"
```

---

### Task 2: API meneruskan peringatan

**Files:**
- Modify: `web/apps/api/src/quick-start.ts` (`peringatanDariOutput`, sebelah `repoDariOutput`)
- Modify: `web/apps/api/src/actions.ts` (tambah field pada `ActionResult` sukses; import helper + pemakaian di `buatBaru`)
- Test: `web/apps/api/src/actions.test.ts`

**Interfaces:**
- Consumes: `output` yang sudah disusun di `buatBaru` (stdout + stderr + catatan registry), pola helper `repoDariOutput`.
- Produces:
  - `ActionResult` sukses bertambah `peringatan?: string`
  - `function peringatanDariOutput(output: string): string | undefined` di `web/apps/api/src/quick-start.ts`, sebelah `repoDariOutput` yang sudah ada di sana (bukan di `actions.ts`), lalu di-import ke `actions.ts` mengikuti pola import baris 8. Ambil baris pertama yang diawali `PERINGATAN_HEALTH: `, kembalikan sisinya yang sudah di-trim; `undefined` bila tidak ada.

- [ ] **Step 1: Tulis tes gagal**

Di `actions.test.ts`, pakai stub spawn yang sudah ada di berkas itu:
- `connect meneruskan peringatan health dari stdout`: stdout berisi `PERINGATAN_HEALTH: Repo ini belum punya endpoint /health.` → `expect(hasil.peringatan).toBe("Repo ini belum punya endpoint /health.")`
- `connect tanpa peringatan tidak menambah field`: stdout biasa → `expect(hasil.peringatan).toBeUndefined()`
- `quick-start juga meneruskan peringatan`: stdout quick-start berisi baris itu → `peringatan` terisi (helper dipakai di `buatBaru`, jadi dua jalur ikut).

- [ ] **Step 2: Jalankan, pastikan merah**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: FAIL — `hasil.peringatan` undefined pada kasus pertama.

- [ ] **Step 3: Implementasi**

Tambah `peringatan?: string` pada varian sukses `ActionResult`, tulis `peringatanDariOutput`, dan di `buatBaru` isi `peringatan: peringatanDariOutput(output)` spreads-only bila ada (ikuti pola `repo:` yang sudah ada). Jangan ubah `capped`, `MAX_OUTPUT`, atau jalur gagal.

- [ ] **Step 4: Jalankan, pastikan hijau**

Run: `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH; cd web && npx vitest run && npm run lint && npm run typecheck`
Expected: 877 + 3 lulus. Bila `typecheck` menegur stub tulisan tangan di berkas tes lain, lengkapi stub itu (bukan mengubah tipe).

- [ ] **Step 5: Commit**

```bash
git add web/apps/api/src/actions.ts web/apps/api/src/actions.test.ts
git commit -m "feat(api): teruskan peringatan health CLI sebagai field peringatan"
```

---

### Task 3: Dialog menampilkan peringatan

**Files:**
- Modify: `web/apps/dashboard/src/lib/connect-client.ts` (`HasilConnect` + cabang `response.ok`)
- Modify: `web/apps/dashboard/src/components/actions/connect-dialog.tsx` (state + render)
- Test: `web/apps/dashboard/src/lib/connect-client.test.ts`, `web/apps/dashboard/src/components/actions/connect-dialog.test.tsx`

**Interfaces:**
- Consumes: `peringatan?: string` dari Task 2; `Toast` dengan `JenisToast = "sukses" | "gagal"` (tidak diubah).
- Produces: `HasilConnect.peringatan?: string`; elemen peringatan ber-`role="note"` dengan teks peringatan verbatim dari API.

- [ ] **Step 1: Tulis tes gagal**

`connect-client.test.ts`:
- `peringatan dari server diteruskan`: fetch mock balas `{repo: "...", peringatan: "belum ada /health"}` → `expect(hasil.peringatan).toBe("belum ada /health")`
- `tanpa peringatan field tidak ada`: payload hanya `{repo}` → `expect(hasil.peringatan).toBeUndefined()`

`connect-dialog.test.tsx`:
- `peringatan tampil setelah sambung sukses`: mock klien mengembalikan `peringatan` → setelah submit, `screen.getByRole("note")` memuat teks itu, dan toast sukses tetap muncul.
- `tanpa peringatan tidak ada note`: mock tanpa `peringatan` → `expect(screen.queryByRole("note")).toBeNull()`
- Pertahankan tes yang sudah ada: label `Nama Aplikasi` tetap tunggal saat dua dialog dipasang bersamaan.

- [ ] **Step 2: Jalankan, pastikan merah**

Run: `cd web && npx vitest run apps/dashboard/src/lib/connect-client.test.ts apps/dashboard/src/components/actions/connect-dialog.test.tsx`
Expected: FAIL — `getByRole("note")` tidak ditemukan / field belum ada.

- [ ] **Step 3: Implementasi**

Klien: tambah `peringatan?: string` pada `HasilConnect` dan teruskan dari payload hanya bila ada. Dialog: satu state `peringatan: string | null`, direset saat dialog dibuka dan saat submit baru, diisi dari hasil; render `{peringatan && <p role="note">{peringatan}</p>}` di dalam dialog di bawah toast. Jangan menambah varian `JenisToast`.

- [ ] **Step 4: Jalankan, pastikan hijau**

Run: `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH; cd web && npx vitest run && npm run lint && npm run typecheck`
Expected: semua lulus.

- [ ] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/connect-client.ts web/apps/dashboard/src/lib/connect-client.test.ts web/apps/dashboard/src/components/actions/connect-dialog.tsx web/apps/dashboard/src/components/actions/connect-dialog.test.tsx
git commit -m "feat(dashboard): tampilkan peringatan health setelah sambungkan repo"
```

---

### Task 4: Dokumentasi, deploy, bukti nyata

**Files:**
- Modify: `web/README.md` (satu paragraf: peringatan health, tidak memblokir, pipeline tetap penentu)
- Modify: `docs/superpowers/plans/2026-11-20-preflight-health-connect.md` (centang checkbox)

**Interfaces:**
- Consumes: ketiga task sebelumnya sudah ter-commit di `main` lokal.
- Produces: bukti E2E (SHA commit repo uji + teks peringatan yang terlihat di dashboard) dan CLI baru terpasang di VPS.

- [ ] **Step 1: Tulis dokumentasi**

Satu paragraf di `web/README.md` bagian aksi: apa yang diperiksa, kapan muncul, bahwa connect tetap lanjut, dan bahwa `/actuator/health` juga dihitung.

- [ ] **Step 2: Gerbang lokal penuh**

Run: `cd cli && cargo test --bin autore && cargo clippy --all-targets -- -D warnings && cargo fmt --check && cd ../web && export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH && npx vitest run && npm run lint && npm run typecheck`
Expected: semua hijau (Rust 325 + 9, web 877 + 3 + tes dialog baru).

- [ ] **Step 3: Push dan tunggu pipeline**

Push lewat VPS (`git am` dari `format-patch`, lalu `git push origin HEAD:main`). Pantau `autore-e2e` dengan parse JSON `number`/`building`/`result` — jangan glob urutan field.
Expected: build baru `SUCCESS`.

- [ ] **Step 4: Pasang CLI + web baru di VPS**

`cargo build --release` di VPS, backup `.bak-<ts>`, lalu `sudo install` ke KEDUA jalur: `/usr/local/bin/autore` (pipeline) dan `/usr/local/lib/autore-ci/autore` (API dashboard — unit API menyetel `AUTORE_BIN` ke jalur lib; pasang satu saja bikin web tetap pakai perilaku lama). Deploy web sesuai prosedur repo. API men-spawn biner per request, jadi tidak perlu restart unit.
Expected: `sha256sum` kedua jalur sama; dashboard merespons 200.

- [ ] **Step 5: Playwright di VPS**

Run: `cd web/apps/dashboard && npx playwright test`
Expected: semua spec lulus. Catatan terverifikasi: belum ada spec E2E untuk connect (yang ada `quick-start-e2e.spec.ts`), jadi suite ini hanya menjaga regresi; bukti fitur baru datang dari Step 6. Jangan menambah spec connect di plan ini.

- [ ] **Step 6: Bukti nyata satu repo tanpa health**

Buat repo uji `coba-alif-3` di org `tugure-reasuransi` berisi `app.py` tanpa `/health`, sambungkan lewat dashboard, catat: teks peringatan yang muncul, SHA commit scaffold, dan bahwa build tetap jalan lalu gagal di tahap 10 (perilaku yang diharapkan). Lalu sambungkan repo yang punya `/health` dan pastikan tidak ada peringatan.
Expected: dua hasil berbeda sesuai rancangan; laporkan SHA + teks ke user.

- [ ] **Step 7: Commit dokumentasi + centang plan**

```bash
git add web/README.md docs/superpowers/plans/2026-11-20-preflight-health-connect.md
git commit -m "docs(web): catat peringatan /health pada aksi sambungkan repo"
```

---

## Di luar plan ini (gap lain, urutan separate)

Sudah beres dan terpasang di VPS: pasangan staging + production otomatis untuk app baru (commit `eafed12`, pipeline `autore-e2e` #275 SUCCESS, diverifikasi lewat `autore init` di workspace sementara).

1. Staging dan production masih satu VPS (`vps-staging` belum ada host-nya).
2. Port aplikasi hanya `127.0.0.1`; belum ada alamat tailnet otomatis per app.
3. Repo pribadi butuh undangan collaborator bot manual; belum ada pemeriksaan hak tulis di awal.
4. Pemicu masih polling 5 menit, belum webhook GitHub.