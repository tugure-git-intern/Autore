# Autore Web Ikut Update — Implementation Plan

> **For agentic workers:** Kerjakan berurutan; setiap step punya checkbox. Task 2 ke atas menyentuh VPS (bukan laptop) — jangan lanjut sebelum Task 1 hijau.

**Goal:** Versi di sidebar dashboard selalu sama dengan `cli/Cargo.toml` setelah rilis, tanpa mengubah kode CLI dan tanpa mematikan dashboard saat build.

**Architecture:** Satu skrip `scripts/deploy-web.sh` yang dijalankan **sebagai pemilik repo** (`tugure`), bukan root. Alurnya: cek pohon bersih → `git pull` fast-forward saja → build ke distDir terpisah (`AUTORE_NEXT_DIST=.next-baru`, sudah didukung `next.config.ts:36`) → tukar `.next` ↔ `.next-lama` → restart `autore-web-dashboard` → health `/login` 307 → sukses: hapus `.next-lama`; gagal: tukar balik dan restart lagi. Build gagal = dashboard lama tetap jalan, tak pernah di-restart.

**Tech Stack:** Bash, Next.js (`next build`/`next start`), systemd --user, curl. Tanpa dependensi baru, tanpa perubahan Rust/TypeScript.

**Spec:** Dashboard menampilkan `v0.6.3` padahal CLI `0.6.8` karena `NEXT_PUBLIC_APP_VERSION` di-inline saat build; `autore update` hanya mengganti biner. Yang perlu: satu langkah yang bisa diulang dan aman kalau gagal.

## Fakta yang sudah diverifikasi

- `web/apps/dashboard/next.config.ts:12-17,33` — versi dibaca dari `../../../cli/Cargo.toml` saat build lalu di-inline; gagal keras kalau berkas hilang.
- `web/apps/dashboard/next.config.ts:36` — `distDir: process.env.AUTORE_NEXT_DIST ?? ".next"`; build ke direktori lain **sudah** didukung, tak perlu config baru.
- `web/packages/.../sidebar.tsx:15` — fallback `"v0.6.2"` hanya untuk tes satuan tanpa build; bukan penyebab angka `v0.6.3`.
- `cli/src/main.rs:508` — `autore update` hanya unduh rilis + verifikasi SHA-256 + ganti biner. Tak menyentuh web.
- `.gitignore:31` — `web/apps/dashboard/.next/` diabaikan; `.next-baru`/`.next-lama` juga harus diabaikan (Task 1 Step 1).
- VPS `vps`: `.next` dan `node_modules` milik `tugure:tugure`; node login `/usr/local/bin/node v22.23.4`; unit `autore-web-dashboard` `WorkingDirectory=/home/tugure/Autore/web`, `ExecStart=/usr/bin/env npm run start:dashboard`, `EnvironmentFile=-/home/tugure/Autore/web/.env`.
- Pohon VPS `~/Autore` sempat kotor (berkas API modif tak ter-commit) — skrip wajib berhenti, bukan `reset --hard`.
- Dashboard live: `http://100.80.3.14:9120/` → 307 ke `/login` (normal, bukan tanda mati).

## Global Constraints

- Skrip **tidak** menyentuh biner CLI, unit API (`autore-web-api`), atau Jenkins.
- Dilarang `git reset --hard`, `git clean`, `git checkout --`, `npm ci` tanpa perubahan lockfile — kerja orang tak boleh hilang.
- Dilarang jalan sebagai root atau `jenkins`; kalau `id -un` bukan pemilik `web/apps/dashboard`, keluar exit 1.
- Restart hanya setelah `next build` exit 0. Build gagal = dashboard lama hidup, exit != 0, tanpa restart.
- Tukar direktori dengan dua `mv` berurutan; `.next-lama` disimpan sampai health lolos, lalu dihapus.
- `.next-baru`/`.next-lama` masuk `.gitignore`; tak ada berkas build yang bisa ter-commit.
- Idempoten: dijalankan dua kali berturut-turut hasilnya sama, run kedua boleh berhenti cepat kalau `.next` sudah memuat versi `cli/Cargo.toml` (lewati build) — hemat 60 detik.
- `XDG_RUNTIME_DIR=/run/user/<uid>` wajib di-set sebelum `systemctl --user`.
- Health check: `curl -o /dev/null -w '%{http_code}'` ke `http://127.0.0.1:9120/login` harus `307` atau `200`, retry 10×1 detik.

## Review Focus

- Versi `cli/Cargo.toml` naik → jalankan skrip → sidebar `v<versi baru>`, dashboard tak pernah 5xx selama proses.
- Build dipaksa gagal (mis. `AUTORE_WEB_BUILD_FORCE_FAIL=1` di tes) → exit != 0, `.next` lama utuh, versi lama masih tampil, dashboard tetap 200/307.
- Pohon kotor → berhenti sebelum build, pesan menyebut berkasnya, tak ada perubahan apa pun.
- Varian "sudah versi terbaru" → berhenti cepat tanpa rebuild dan tanpa restart (tak memicu downtime yang tak perlu).
- Dijalankan sebagai `root` → tolak sebelum menyentuh apa pun (cegah `.next` milik root).
- Health gagal setelah tukar → otomatis balik ke `.next-lama`, restart, dan laporkan versi yang aktif.
- Dijalankan dua kali → run kedua tak merusak, tak menyisakan `.next-baru`/`.next-lama`.

---

### Task 0: Audit read-only di VPS

**Files:** tidak ada perubahan.

- [ ] Catat versi aktif: `grep -o "v0\.[0-9]\+\.[0-9]\+" ~/Autore/web/apps/dashboard/.next/static/chunks/*.js | sort -u` dan `grep -m1 ^version ~/Autore/cli/Cargo.toml`.
- [ ] Catat pemilik `~/Autore/web/apps/dashboard/.next`, `~/Autore/web/node_modules`, dan `node -v`.
- [ ] Catat isi `~/Autore/web/.env` (kunci saja, jangan nilai rahasia) untuk tahu `AUTORE_NEXT_DIST`/`AUTORE_API_ASAL` tidak bentrok.
- [ ] **Stop condition:** kalau `.next` atau `node_modules` milik `root`, jangan lanjut — `chown -R tugure:tugure` dulu (keputusan bos alif), karena build sebagai `tugure` akan gagal.

### Task 1: Skrip + tes hermetic (laptop)

**Files:**
- Create: `scripts/deploy-web.sh`
- Create: `scripts/test-deploy-web.sh`
- Modify: `.gitignore` (tambah `web/apps/dashboard/.next-baru/`, `.next-lama/`)

**Interfaces:**
- `versi_aktif()` → isi global `VERSI_NEXT_DIR` dari `grep` chunk `.next`; 0 kalau ketemu, 1 kalau tidak.
- `versi_cli()` → cetak `v<version>` dari `cli/Cargo.toml`.
- `tukar_maju()` / `tukar_mundur()` → dua `mv`, exit 1 kalau `.next-baru` tidak ada.
- `tunggu_health()` → 0/1 setelah maksimal 10 detik.
- Env: `AUTORE_REPO` (default `$HOME/Autore`), `AUTORE_WEB_PORT` (default 9120), `AUTORE_WEB_UNIT` (default `autore-web-dashboard`), `AUTORE_WEB_FORCE_BUILD=1`, dan `AUTORE_WEB_BUILD_FORCE_FAIL=1` (hanya untuk tes).
- Stub di tes: `PATH=$SCRATCH/bin:$PATH` untuk `npm`, `systemctl`, `curl`, `id`, `git` (pola sama seperti `scripts/test-ci-deploy-by-digest.sh`).

- [ ] **Step 1: `.gitignore`** — tambah dua baris direktori build sementara di bawah `.next/`.
- [ ] **Step 2: Tulis skrip fail-closed** dengan urutan: guard user → guard pohon kotor (`git status --porcelain`) → `git pull --ff-only` → bandingkan versi (berhenti cepat kalau sama dan `AUTORE_WEB_FORCE_BUILD` kosong) → `npm run build:dashboard` dengan `AUTORE_NEXT_DIST=.next-baru` → tukar → restart → health → hapus `.next-lama` atau tukar balik.
- [ ] **Step 3: Tulis 6 kasus tes hermetic** yang mencerminkan Review Focus di atas (versi naik, build gagal, pohon kotor, versi sama, jalan sebagai root, health gagal → balik). Tiap kasus memeriksa direktori mana yang jadi `.next` dan apakah restart dipanggil.
- [ ] **Step 4: Jalankan** `bash scripts/test-deploy-web.sh` → semua hijau. Lampirkan output di PR/commit message.

### Task 2: Pasang & uji di VPS

**Files:** tidak ada perubahan repo (skrip dijalankan dari pohon).

- [ ] `scp scripts/deploy-web.sh vps:/tmp/` lalu `mkdir -p ~/bin && install -m 0755 /tmp/deploy-web.sh ~/bin/autore-deploy-web`.
- [ ] Jalankan sekali: `~/bin/autore-deploy-web` (tanpa sudo). Harapan: build jalan, dashboard restart, versi sidebar = `cli/Cargo.toml`.
- [ ] Selama build berjalan, dari laptop: `for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code} ' http://100.80.3.14:9120/login; sleep 2; done` → semua 307/200, tak ada 5xx.
- [ ] Verifikasi versi live: `curl -s http://100.80.3.14:9120/_next/static/chunks/<chunk baru> | grep -o "v0\.[0-9]\+\.[0-9]\+"`.
- [ ] Jalankan skrip sekali lagi → berhenti cepat "sudah versi terbaru", unit tak restart (`systemctl --user show -p ActiveEnterTimestamp` tidak berubah).

### Task 3: Buktikan aman saat gagal

- [ ] Di VPS, jalankan `AUTORE_WEB_BUILD_FORCE_FAIL=1 ~/bin/autore-deploy-web` → exit != 0, pesan jelas.
- [ ] Sesudahnya: `systemctl --user is-active autore-web-dashboard` = `active`, versi sidebar tidak berubah, `.next-lama` tak tersisa.
- [ ] Pulihkan: jalankan `~/bin/autore-deploy-web` normal → hijau.

### Task 4: Sambungkan ke rilis (keputusan bos alif)

Dua opsi, pilih satu sebelum mulai:

- [ ] **Opsi A (murah):** tambahkan langkah manual di `README.md` + pesan akhir `autore update`: "jalankan `~/bin/autore-deploy-web` untuk dashboard". Nol risiko kode.
- [ ] **Opsi B (otomatis):** stage baru di `vars/autorePipeline.groovy` setelah stage 9 (push Nexus) yang menjalankan `~/bin/autore-deploy-web` di runner. Butuh: shared library di-deploy ulang ke Jenkins, dan runner harus pemilik `~/Autore` (sekarang `tugure` — cocok). Risiko: build rilis jadi merah kalau dashboard gagal build, padahal biner sudah rilis.

**Rekomendasi:** Opsi A sekarang, Opsi B hanya kalau rilis web memang harus tanpa sentuhan tangan.

### Task 5: Drill rollback

- [ ] Di VPS: simpan versi aktif, lalu `git -C ~/Autore stash`-kan perubahan versi (atau checkout commit lama) dan jalankan skrip → versi turun, dashboard hidup.
- [ ] Kembalikan ke `main` + versi terbaru, jalankan skrip lagi → naik lagi. Pastikan hanya 1 direktori `.next` tersisa dan tak ada `.next-lama`.
