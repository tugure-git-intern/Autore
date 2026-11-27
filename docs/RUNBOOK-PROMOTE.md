# Runbook Promosi Production

Satu halaman. Dipakai saat rilis sudah sehat dan disetujui di staging, lalu harus naik ke production.

## Apa arti promosi di Autore

Promosi = **memasang image yang sedang aktif di staging ke port production**, memakai **digest** yang sudah tercatat di ledger — bukan rebuild, bukan tag, bukan build baru. Image yang sama dibuktikan sehat dulu di staging; kalau digest berbeda dari deployment staging aktif, promosi ditolak.

Setiap promosi dicatat sebagai event `deploy_result` environment `production` di `~/autore-workspace/release-state.json`. Release yang dipromosikan menjadi `aktif`; release `aktif` sebelumnya otomatis turun (satu release aktif per app).

## Prasyarat

Semua harus benar sebelum tombol promosi ditekan:

| Syarat | Kenapa |
|---|---|
| Release berstatus `disetujui` | `menunggu_persetujuan` tidak boleh langsung ke production |
| Deployment staging aktif memakai digest release ini | production hanya menerima gambar yang sudah lolos staging |
| Release ini **belum digantikan** build lain di staging | pointer staging yang sudah pindah berarti rilis lama |
| Pelaku promosi ≠ penyetuju | gerbang empat mata |
| `environments.json` punya `production.deploy_port` + `production.container_port` untuk app | port tidak pernah ditebak |
| Digest belum dipakai production | promosi ulang digest yang sama ditolak |

## Siapa yang boleh

Role dibaca server dari `web/allowed-users.json` tiap request, bukan dari token browser.

| Aksi | Role minimum | Syarat status release |
|---|---|---|
| Setujui / Tolak staging | `qa` | `menunggu_persetujuan` |
| Promosikan ke production | `admin` | `disetujui` |
| Rollback production | `admin` | `aktif` dengan deployment sehat sebelumnya |

Gerbang empat mata berlaku dua lapis: API menolak promosi oleh penyetuju, dan Jenkins job memeriksa ulang aturan yang sama lewat `autore release verify-approval` atas ledger yang sama. Jadi memicu job langsung ke Jenkins tidak melewati aturan.

## Jalur 1 — UI (production)

1. Login dashboard sebagai `admin`.
2. Buka `/pipeline?app=<app>`.
3. Pada kartu release berstatus **Disetujui**, tekan **Promosikan ke Production**.
4. `202` berarti job `<app>-promote` sudah dipicu, **bukan** berarti production sudah berganti. Tunggu build selesai lalu muat ulang halaman.

Tombol hanya disembunyikan untuk role/status yang tidak memenuhi; penolakan sebenarnya ada di API.

## Jalur 2 — API

```bash
curl -sS -X POST "http://127.0.0.1:9121/api/releases/<release-id>/promote" \
  -H 'content-type: application/json' \
  --data '{}' \
  -b <cookie-sesi-dashboard>
```

`<release-id>` berbentuk `app:commit:build`, contoh `tes:be99a959…:5`. Body tidak dipakai; semua data (digest, build, port) diambil server dari ledger + `environments.json`.

| Respons | Arti |
|---|---|
| `202` | Job promosi dipicu; response memuat `job`, `release_id`, `digest` |
| `400` | ID release tidak sah (bukan `app:commit:build`) |
| `403` | Role bukan `admin`, atau pelaku sama dengan penyetuju |
| `404` | Release tidak ditemukan di ledger |
| `409` | Status belum `disetujui`, sudah digantikan di staging, digest ≠ staging aktif, environment/port belum dikonfigurasi, digest sudah di production, atau promosi lain sedang berjalan |
| `502` | CLI gagal memicu job Jenkins (cek `autore` + konfigurasi Jenkins) |

Kunci per app berlaku: satu promosi sekaligus. Promosi kedua yang datang bersamaan dapat `409 promosi <app> sedang berjalan`.

## Jalur 3 — Jenkins langsung (darurat)

Job `<app>-promote` memakai `Jenkinsfile.promote`, agent `vps-runner-1`, timeout 15 menit, `disableConcurrentBuilds`.

Parameter wajib: `PROMOTE_APP`, `PROMOTE_DIGEST` (`sha256:<64 hex>`), `PROMOTE_RELEASE_ID` (`app:commit:build`), `PROMOTE_BUILD` (angka), `PROMOTE_ACTOR` (login pelaku). `PROMOTE_CONTAINER_PORT` dan `PROMOTE_DEPLOY_PORT` **wajib diisi eksplisit** di jalur manual; default `8080`/`8154` di Jenkinsfile bukan nilai untuk app Anda — ambil dari `environments.json`. Tanpa `PROMOTE_ACTOR`, stage 2 langsung gagal.

Jalur ini tetap melewati `release verify-approval`; approval dan empat mata tetap berlaku.

## Yang dijalankan di belakang

1. API mengambil kunci app, membaca ledger, dan menjalankan semua gerbang di atas.
2. API memanggil `autore release trigger-promote` → CLI mendaftarkan job dari `Jenkinsfile.promote` (repo Autore `main`) bila belum ada, lalu memicunya dengan digest + port eksplisit.
3. Stage 1 memvalidasi parameter; stage 2 menjalankan `verify-approval`; stage 3 menjalankan `/usr/local/lib/autore-ci/ci-deploy-by-digest.sh`:
   - container kandidat `<app>-production-candidate` di port `deploy_port + 100`;
   - health kandidat; bila gagal, container production lama tidak disentuh dan hasil dicatat `rolled_back` (`failed_no_active` bila memang belum ada container lama);
   - container aktif `<app>-production` diganti, health akhir + kecocokan digest diperiksa; gagal di sini memulihkan image lama dan outcome dicatat `rolled_back`.
4. Job mencatat fakta hasil ke ledger: `autore release promote-id` (id unik `<app>-<build>-promote-<n>`) lalu `autore release record --from-deploy-result … --environment production`.
5. `post { always }` mengirim kabar Telegram berisi hasil, app, release, digest, pelaku, port, dan URL console.

Health adalah kontrak: `/health` harus menjawab JSON `status: "ok"`; app lama tanpa `/health` cukup 2xx di path yang disepakati.

## Verifikasi setelah promosi

```bash
curl -s "http://127.0.0.1:9121/api/releases?app=<app>" | jq '.data.releases[0], .data.environments'
docker inspect -f '{{index .Config.Image}}' <app>-production
curl -s http://127.0.0.1:<deploy_port>/health
```

Lulus kalau:

- release target berstatus `aktif` dan hanya satu release `aktif` untuk app itu;
- `environments[]` production `active_deployment_id` menunjuk deployment `…-production-<build>`;
- image container = digest release (`@sha256:…`, bukan tag);
- `/health` balas `{"status":"ok"}`;
- release sebelumnya tidak lagi `aktif`.

## Kalau gagal

1. `409` → baca pesannya: status belum disetujui, digantikan di staging (promosikan rilis yang sekarang aktif), digest bukan staging aktif, port/environment belum dikonfigurasi, atau digest sudah di production.
2. `403` dengan "harus oleh orang berbeda" → minta admin lain menekan promosi.
3. Job sukses tapi dashboard belum berubah → cek event `deploy_result` production terakhir; job tanpa `PROMOTE_ACTOR` atau tanpa `RESULT_JSON` tidak mencatat apa pun.
4. Health akhir merah → script sudah memulihkan container lama; perbaiki penyebabnya (registry 429, port bentrok, container crash) lalu promosikan ulang. Jangan mengulang berkali-kali.
5. Production sakit setelah promosi dinyatakan sukses → ikuti [`RUNBOOK-ROLLBACK.md`](RUNBOOK-ROLLBACK.md); watchdog production juga bisa memicu rollback otomatis ([`RUNBOOK-WATCHDOG.md`](RUNBOOK-WATCHDOG.md)).
6. Ledger perlu dikoreksi → backup dulu dan sentuh hanya field yang salah; satu event rusak membuat `/api/releases` gagal dibaca (502).

## Larangan

- Promosi memakai tag (`:latest`, `build-N`) — hanya digest.
- Membangun ulang image untuk production; production memakai image staging yang sama.
- Menyetujui dan mempromosikan rilis yang sama sendiri.
- Promosi tanpa port eksplisit dari `environments.json`, atau menebak port default.
- Mempromosikan rilis lama yang sudah digantikan di staging.
- Menjalankan dua promosi bersamaan untuk app yang sama.
- Mengedit `release-state.json` tanpa backup.
