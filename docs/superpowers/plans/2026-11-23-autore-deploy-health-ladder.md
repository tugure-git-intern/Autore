# Autore Health: Staging-Only Smoke Fallback — Implementation Plan

> **For agentic workers:** Kerjakan berurutan; setiap step punya checkbox. Jangan sentuh production/VPS sebelum Task 0 selesai dan bos alif menyetujui. Sub-skill: `superpowers:executing-plans`.

**Goal:** App staging tanpa `/health` tetap bisa deploy lewat smoke `GET /`, tanpa melonggarkan gerbang production. Production/promote/rollback tetap wajib `/health` JSON `{"status":"ok"}`.

**Architecture:** Satu-satunya ladder ada di `scripts/ci-deploy-by-digest.sh`, aktif hanya saat `AUTORE_RELEASE_ENV=staging` dan `HEALTH_ENDPOINT` kosong. Rung 1 `/health` ketat; hanya 404/405/410 yang boleh turun ke rung 2 `GET /` 2xx. Respons 5xx, 401/403, body salah, timeout, dan koneksi ditolak TIDAK pernah fallback. Tanpa `AUTORE_RELEASE_ENV=staging`, script strict ke `/health` saja (fail closed). `vars/autorePipeline.groovy:30` berhenti memaksa `/health` untuk build staging; `Jenkinsfile.promote` dan rollback production memaku `AUTORE_RELEASE_ENV=production` + `HEALTH_ENDPOINT=/health`.

**Tech Stack:** Bash, curl, python3, Groovy Jenkins Shared Library, Rust CLI, Vitest. Tanpa dependensi baru, tanpa perubahan skema event.

**Spec:** Developer memilih stack apa pun (PHP/Node/Python/Java/Go) tanpa menulis `/health` dan tetap ingin build staging hijau. `/health` tetap kontrak readiness production. Smoke `/` hanya bukti proses HTTP hidup, bukan readiness.

## Fakta yang sudah diverifikasi

- `vars/autorePipeline.groovy:30` — `releaseEnvironment ? '/health' : ''`; app hasil `connect` selalu `releaseEnvironment: 'staging'`, jadi `/health` dipaksa.
- `vars/autorePipeline.groovy:70` — pipeline sudah mengekspor `AUTORE_RELEASE_ENV`.
- `scripts/ci-deploy-by-digest.sh:48-53` — `HEALTH_ENDPOINT` kosong berarti `HEALTH_PATHS=(/health /)`.
- `scripts/ci-deploy-by-digest.sh:72-82` — bug sekarang: kegagalan curl APA PUN (termasuk 500) jatuh ke `GET /`; dan `GET /` menerima 2xx saja lewat `curl -f`.
- `scripts/ci-deploy-by-digest.sh:109` — `health_url` selalu ditulis `/health`, walau probe yang lolos bukan `/health`.
- `Jenkinsfile.promote` — tidak mengirim `HEALTH_ENDPOINT`/`AUTORE_RELEASE_ENV`; promosi production saat ini ikut fallback implisit.
- `Jenkinsfile.rollback` — mengirim `RB_ENV` tapi tidak mengirim `AUTORE_RELEASE_ENV`/`HEALTH_ENDPOINT`.
- `web/packages/contracts/src/release-events.ts:111` — `outcome=success` wajib `health=ok`; ini gerbang kandidat promosi.
- `web/packages/contracts/src/release-events.ts:359` — rollback sehat = `rolled_back` + `health=ok`.
- `README.md:108-112` — masih menjanjikan “no fallback to `/`”.

## Global Constraints

- Fallback smoke hanya untuk `AUTORE_RELEASE_ENV=staging`. Nilai kosong/unknown = strict.
- `HEALTH_ENDPOINT` non-kosong = satu path, tanpa fallback (test lama `HEALTH_ENDPOINT=/fail` tetap merah).
- `/health` strict: 2xx + JSON `status=="ok"`. Selain itu gagal; tidak turun rung.
- Rung 2 hanya `GET /` dengan 2xx. 3xx/4xx/5xx bukan bukti hidup.
- Tanpa rung TCP. Tanpa flag baru, tanpa config per bahasa.
- `health_url` jujur: `/health` saat rung 1, `/` saat rung 2. Skema event tidak berubah.
- `outcome`/`health` tidak berubah arti; JANGAN menambah field event tanpa persetujuan.
- Tes hermetic (stub docker/curl), retry tetap 10×1 detik.
- Tidak ada perubahan production live sebelum Task 0 lolos.

## Review Focus

- Staging `/health` 404 + `/` 200 → sukses, `health_url` berakhir `/`.
- Staging `/health` 500 + `/` 200 → gagal, tidak fallback.
- Staging `/health` 200 body `{"status":"degraded"}` + `/` 200 → gagal.
- Staging `/health` 404 + `/` 500 → gagal.
- Production (env kosong atau `production`) `/health` 404 + `/` 200 → gagal.
- Staging `HEALTH_ENDPOINT=/health` eksplisit → strict, tanpa fallback.
- Rollback staging tanpa `/health` → sukses smoke; rollback production → strict.
- Event `success` staging hasil smoke tetap `health=ok` (kontrak lama), tapi job promote production tetap memverifikasi `/health` sendiri dan menolak app tanpa `/health` tanpa mengganti container aktif.

---

### Task 0: Audit read-only production sebelum mengubah apa pun

**Files:** tidak ada perubahan.

- [ ] Di VPS, baca daftar app/port production dari ledger dan container:
  `ssh vps "docker ps --format '{{.Names}}\t{{.Ports}}'"` dan cari deployment production terakhir di `~/autore-workspace`/ledger.
- [ ] Untuk tiap port production: `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 3 http://127.0.0.1:<port>/health` dan `curl -sS --max-time 3 http://127.0.0.1:<port>/health`.
- [ ] Catat hasil (app, port, status, body). Jangan ubah file/container.
- [ ] **Stop condition:** kalau ada app production tanpa `/health` valid, jangan lanjut ke Task 1. Laporkan ke bos alif: production strict akan membuat rollback image lama mustahil. Opsi: (a) tambah `/health` ke app itu lalu deploy normal, atau (b) izinkan smoke khusus rollback production (butuh persetujuan terpisah).
- [ ] Kalau semua production sudah punya `/health` valid, lanjut.

### Task 1: Tes perilaku gagal untuk staging-only fallback

**Files:**
- Test: `scripts/test-ci-deploy-by-digest.sh` (stub curl `:83-96`, kasus `:119-165`)
- Modify nanti: `scripts/ci-deploy-by-digest.sh`

**Interfaces:**
- `health_at <port>` → 0 sehat / 1 gagal; mengisi global `HEALTH_URL` dan `HEALTH_KIND` (`health|smoke`).
- `cek_ketat <path> <port>` → 0 lolos, 1 absen, 2 rusak (mengisi `SEBAB`).
- `cek_root <port>` → 0 lolos, 1 gagal (mengisi `SEBAB`).
- Consumes: `AUTORE_RELEASE_ENV`, `HEALTH_ENDPOINT`, `DEPLOY_PORT`, `CANDIDATE_PORT`.

- [ ] **Step 1: Ganti stub curl jadi per-path**

Format `$AUTORE_WORKSPACE/stub-http`: baris `path<TAB>code<TAB>body`; path tanpa entri = koneksi ditolak (`exit 7`, `http_code 000`). Dukung dua bentuk yang dipakai script:
- `curl -fsS --max-time 2 URL` → body ke stdout; exit non-zero bila code ≥400 atau 000.
- `curl -sS -o FILE -w '%{http_code}' --max-time 2 URL` → body ke FILE, cetak code; 000 → exit 7.
Pertahankan `stub-fail-health` (= `/health` 500) dan `/fail` (= 500) agar dua tes lama tetap merah. Tambah helper `http(path, code, body)`; hapus `stub-http` di `reset()`.

- [ ] **Step 2: Tulis delapan kasus baru**

1. `staging tanpa /health, root 200`: `env AUTORE_RELEASE_ENV=staging`, `http /health 404 ""` + `http / 200 "ok"` → exit 0, `outcome=success`, `health=ok`, `health_url=http://127.0.0.1:8081/`.
2. `staging /health 500 tidak fallback`: `http /health 500 "boom"` + `http / 200 "ok"` → exit ≠ 0, stderr memuat `500`.
3. `staging body salah tidak fallback`: `http /health 200 '{"status":"degraded"}'` + `http / 200 "ok"` → exit ≠ 0.
4. `staging root 5xx gagal`: `http /health 404 ""` + `http / 500 "boom"` → exit ≠ 0.
5. `production strict`: tanpa `AUTORE_RELEASE_ENV`, `http /health 404 ""` + `http / 200 "ok"` → exit ≠ 0.
6. `endpoint eksplisit strict`: `env AUTORE_RELEASE_ENV=staging HEALTH_ENDPOINT=/health`, `http /health 404 ""` + `http / 200 "ok"` → exit ≠ 0.
7. `rollback staging tanpa /health`: `env AUTORE_RELEASE_ENV=staging AUTORE_DEPLOY_MODE=rollback DEPLOY_PORT=8081`, `http /health 404 ""` + `http / 200 "ok"` → exit 0, `outcome=rolled_back`, `health=ok`, `health_url` berakhir `/`.
8. `rollback production strict`: `env AUTORE_RELEASE_ENV=production AUTORE_DEPLOY_MODE=rollback`, `http /health 404 ""` + `http / 200 "ok"` → exit ≠ 0.

- [ ] **Step 3: Jalankan, catat yang merah**

`bash scripts/test-ci-deploy-by-digest.sh` → kasus 1 dan 7 gagal (belum ada fallback); kasus 5/6/8 kemungkinan sudah hijau karena bug lama; catat output sebelum implementasi.

### Task 2: Implementasi staging-only ladder

**Files:**
- Modify: `scripts/ci-deploy-by-digest.sh:48-53`, `:65-86`, `:96-143`, `:294`, `:325`

- [ ] **Step 1: Tambah klasifikasi probe**

Dalam `health_at`, satu `curl -sS -o <tmp> -w '%{http_code}'` per panggilan:
- `cek_ketat /health`: 2xx + JSON `status=="ok"` → 0; `404|405|410` → 1; selain itu → 2 dengan `SEBAB` memuat kode/body.
- `cek_root`: 2xx → 0; selain itu → 1 dengan `SEBAB` memuat kode.
- Hanya saat `AUTORE_RELEASE_ENV=staging` dan `HEALTH_ENDPOINT` kosong: rung 1, lalu rung 2 hanya bila rung 1 mengembalikan 1. Rung 1 `2` = gagal, retry, jangan turun.
- Selain itu: satu `cek_ketat /health`; gagal → retry.

- [ ] **Step 2: Perbaiki pelaporan**

- `HEALTH_KIND=health|smoke`, `HEALTH_URL=http://127.0.0.1:<port>/health` atau `.../`.
- `write_result`: `RESULT_HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${DEPLOY_PORT}/health}"`.
- Log setelah sukses menyebut `HEALTH_KIND`; saat gagal cetak `SEBAB` terakhir ke stderr.

- [ ] **Step 3: Hijau**

`bash scripts/test-ci-deploy-by-digest.sh && bash -n scripts/ci-deploy-by-digest.sh` → semua kasus PASS, tanpa `FAIL:`.

- [ ] **Step 4: Commit**

```bash
git add scripts/ci-deploy-by-digest.sh scripts/test-ci-deploy-by-digest.sh
git commit -m "feat(deploy): staging-only smoke fallback; production /health strict"
```

### Task 3: Paku intent environment di Jenkins

**Files:**
- Modify: `vars/autorePipeline.groovy:30`
- Modify: `Jenkinsfile.promote:88-99`
- Modify: `Jenkinsfile.rollback:71-82`

- [ ] **Step 1: Hentikan paksaan `/health` untuk build staging**

`vars/autorePipeline.groovy:30` → `def healthEndpoint = ''` + komentar: `// Kosong = ladder staging di deploy script; production tidak lewat pipeline ini.`.

- [ ] **Step 2: Promote production strict**

Di `Jenkinsfile.promote` `withEnv`, tambah `"AUTORE_RELEASE_ENV=production"` dan `"HEALTH_ENDPOINT=/health"`. Jangan mengubah parameter atau urutan stage.

- [ ] **Step 3: Rollback mengikuti environment**

Di `Jenkinsfile.rollback` `withEnv`, tambah:
`"AUTORE_RELEASE_ENV=${params.ROLLBACK_ENVIRONMENT}"` dan
`"HEALTH_ENDPOINT=${params.ROLLBACK_ENVIRONMENT == 'production' ? '/health' : ''}"`.
Rollback staging memakai ladder; production strict.

- [ ] **Step 4: Verifikasi statis**

`grep -n "healthEndpoint" vars/autorePipeline.groovy` → `''`;
`grep -n "AUTORE_RELEASE_ENV=production\|HEALTH_ENDPOINT=/health" Jenkinsfile.promote`;
`grep -n "AUTORE_RELEASE_ENV=\${params.ROLLBACK_ENVIRONMENT}" Jenkinsfile.rollback`.
Tidak ada tes Groovy di repo; bukti perilaku dari Task 1 + E2E Task 5.

### Task 4: Peringatan CLI + README jujur

**Files:**
- Modify: `cli/src/main.rs` (`PERINGATAN_HEALTH`, test di `mod tests`)
- Modify: `README.md:108-112`

- [ ] **Step 1: Tes merah teks peringatan**

Assert `PERINGATAN_HEALTH.contains("staging")`, `contains("smoke")`, `contains("/health")`, dan `!contains("Deploy akan gagal")`.

- [ ] **Step 2: Ubah teks**

Isi: repo belum punya `/health`; deploy staging tetap jalan lewat smoke `GET /` hanya bila `/health` tidak ada (404/405/410), sedangkan production wajib `/health` JSON `{"status":"ok"}`. Smoke bukan bukti readiness. Sertakan `curl -i http://127.0.0.1:<port>/health`.

- [ ] **Step 3: README**

Ganti bagian Stage 10: staging-only fallback, syarat 404/405/410, 5xx/body salah tidak fallback, production strict, `health_url` mencatat `/` vs `/health`, batas smoke. Hapus “no fallback to `/`”.

- [ ] **Step 4: Hijau**

`cd cli && cargo test --bin autore peringatan && cargo fmt --check && cargo clippy --all-targets -- -D warnings`.
`grep -rn "no fallback to\|Deploy akan gagal di tahap 10" README.md cli/src` → kosong.

- [ ] **Step 5: Commit**

```bash
git add cli/src/main.rs README.md vars/autorePipeline.groovy Jenkinsfile.promote Jenkinsfile.rollback
git commit -m "feat(pipeline): staging smoke fallback; production health strict"
```

### Task 5: Uji nyata staging (setelah approval)

**Files:** tidak ada perubahan repo.

- [ ] Pasang script di VPS **setelah backup**: `sudo install -m 0755 scripts/ci-deploy-by-digest.sh /usr/local/lib/autore-ci/ci-deploy-by-digest.sh.bak-$(date +%s)` lalu install versi baru. Library: cari path `vars/autorePipeline.groovy` via `sudo grep -rln "autorePipeline" /var/lib/jenkins 2>/dev/null`, backup, install. Tanpa langkah ini jangan klaim Jenkins memakai kode baru.
- [ ] Deploy ke app staging buangan tanpa `/health` (root 200). Expected: SUCCESS, `.deploy-result.json` `"health_url":"http://127.0.0.1:<port>/"`.
- [ ] `/health` balas 500 (root tetap 200). Expected: build GAGAL, log memuat `500`, container lama tetap aktif.
- [ ] Rollback staging ke build tanpa `/health`. Expected: `rolled_back`, `health=ok`, `health_url` berakhir `/`.
- [ ] Rollback staging ke build lama yang punya `/health` valid. Expected: `rolled_back`, `health_url` `/health`.
- [ ] Catat nomor build + JSON di `~/.hermes/skills/autore-cicd/references/health-checks.md`.

## Stop Conditions

- Task 0 menemukan production tanpa `/health` valid.
- Ada tes yang menunjukkan fallback terjadi di production/rollback production.
- `health_url` tidak jujur atau event `success` dibuat tanpa probe sukses.
- Target staging buangan belum disetujui.

Jangan push, install VPS, atau deploy sebelum Task 0–4 hijau dan bos alif menyetujui Task 5.

## Self-Review

- Cakupan: staging tanpa `/health` → smoke (Task 1–2); production strict (Task 2–3); peringatan + README jujur (Task 4); bukti nyata (Task 5).
- Kontrak lama: `HEALTH_ENDPOINT` eksplisit strict, body `/health` strict, 5xx bukan absen, rollback staging tetap bisa ke image tanpa `/health`.
- Kejujuran: hanya dua rung, `health_url` mencatat rung; tidak ada `tcp://`; skema event tidak berubah.
- Risiko sisa: event staging `health=ok` dari smoke masih terlihat seperti readiness penuh di ledger karena skema tidak punya `health_kind`; gerbang promote production tetap memverifikasi `/health` sendiri. Kalau bos alif ingin ledger membedakan, itu perubahan skema terpisah.
