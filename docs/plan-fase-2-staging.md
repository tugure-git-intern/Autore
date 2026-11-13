# Rencana Implementasi Fase 2A/2B: Staging Nyata (Vertical Slice)

Status: revisi untuk review. Tanggal: 2026-11-13.
Sumber utama: `/home/tugure/Autore`. Preview laptop: `~/.hermes/plans/plan-fase-2-staging.md`.
Ruang lingkup: perencanaan saja. Tidak ada implementasi, deploy, restart, perubahan Jenkins job, atau systemd unit.

## 0. Keputusan Revisi

- **2A** adalah vertical slice kecil: event + fold TypeScript, event store Rust dengan append lock, satu pipeline `tes-testing` yang menulis fakta deploy nyata, dashboard read-only, dan bukti dua deployment.
- **2B** adalah aksi dashboard: deploy/redeploy/rollback, audit actor sesi, deploy lock persisten per `app:environment`, `--require-clean`, dan rekonsiliasi Jenkins.
- 2A tidak mengklaim lock deploy end-to-end, auto-commit protection, atau reconcile lengkap. Itu eksplisit milik 2B.
- Production tetap `belum_dikonfigurasi`; tidak ada approval, promote, endpoint POST, tombol aksi, atau database.

## 1. Aturan yang Tidak Boleh Dilanggar

### 1.1 Satu pemilik state machine

TypeScript tetap pemilik transisi. Rust hanya menulis event mentah.

- Event: `requested`, `build_started`, `digest_verified`, `deploy_result`, `build_failed`.
- Rust tidak menyimpan status release, tidak tahu `aktif`/`rolled_back`, dan tidak memvalidasi urutan transisi.
- TypeScript `foldReleaseEvents` memakai `transisiRelease` Fase 1 untuk menghasilkan release, deployment, dan pointer environment.
- `rollback_selesai` ditambahkan sebagai aksi transisi TypeScript untuk memindahkan release baru dari `gagal` ke `rolled_back`.
- `image_digest` boleh `null` hanya pada `draft`/`build_berjalan`; validator mewajibkan digest sejak `siap_staging`.
- Event yang tidak bisa dilipat menghasilkan status `stale`/error, bukan status sehat palsu.

### 1.2 Pointer deployment terpisah dari status release

- `environment.active_deployment_id` adalah pointer deployment sehat milik environment, bukan status release.
- Release staging yang sehat berstatus **`menunggu_persetujuan`**, bukan `aktif`.
- Status `aktif` hanya untuk release yang deployment production-nya sehat. 2A tidak membuat production.
- Rollback staging mengembalikan pointer staging ke deployment sehat lama dan menandai deployment/release baru sesuai fakta: `gagal` atau `rolled_back`; release baru tidak pernah `aktif`.
- UI menyebut pointer sebagai "Deployment aktif di staging", bukan "Release aktif".

### 1.3 Event append lock terpisah

Atomic rename saja tidak mencegah lost update.

- File event: `release-state.json`.
- File lock append: `release-state.append.lock`.
- Append melakukan: acquire append lock, baca event, tambah event, tulis tmp, rename, release lock.
- Lock append hanya dipegang selama read-modify-write, bukan selama build.
- Lock deploy `app:environment` (2B) **tidak boleh** dipakai sebagai lock append. Event terminal harus tetap bisa ditulis saat lock deploy masih held.
- Lock append bukan lock global untuk semua aksi bisnis; ia hanya melindungi file event.
- Tes konkurensi: dua penulis paralel, semua event bertahan, tidak ada lost update.

### 1.4 Digest, bukan `.Image`

`.Image` adalah image config ID, bukan repo digest Nexus.

Bukti digest yang diuji:
1. Referensi immutable `<registry>/<app>@sha256:<64hex>` berasal dari stage verifikasi Nexus.
2. `docker pull --quiet <ref>` mengambil manifest registry; bukan build.
3. `docker image inspect <ref> --format '{{.Id}}'` menghasilkan `image_id`.
4. `.RepoDigests` wajib memuat `<ref>`.
5. `docker inspect --format '{{.Image}}' <container>` wajib sama dengan `image_id`.
6. Credential Docker tidak dicetak.

Unit test fake Docker mencakup ID cocok, ID beda, dan RepoDigests tidak memuat digest. Integration test memakai registry lokal.

### 1.5 Pipeline staging auto-deploy

- Pipeline staging selalu build lalu **auto-deploy ke staging setelah gate lulus**.
- Tidak ada approval pada 2A.
- Label UI: "Build + auto-deploy staging", bukan "Deploy" atau "Aktif".
- 2A dashboard hanya membaca; tidak ada tombol aksi.
- 2B baru boleh menambah tombol "Build + auto-deploy ke Staging"; response request hanya berarti pipeline diminta, bukan deployment selesai.

### 1.6 Kegagalan dan rekonsiliasi

2A:
- Pipeline `post always` menulis `build_failed` bila build gagal setelah event awal.
- Jika Jenkins tidak pernah mulai, event bisa tetap pending; 2A menampilkannya sebagai belum selesai, bukan aktif. Rekonsiliasi kompleks ditunda ke 2B.
- Tidak ada GET yang menulis ledger.

2B:
- `request_id` dikirim sebagai build parameter Jenkins, bukan mengandalkan `nextBuildNumber`.
- `nextBuildNumber` hanya kandidat; build aktual diverifikasi lewat parameter/queue/build Jenkins.
- Reconcile dijalankan CLI/worker terjadwal atau mekanisme internal terpisah, bukan `GET /api/releases`.
- Deploy lock per `app:environment` dibuat sebelum trigger dan bertahan saat API restart.
- `--require-clean` menolak tree kotor, commit belum di-push, atau remote tidak sinkron; tidak ada auto-commit/empty commit.
- Event terminal tetap ditulis walau deploy lock held.

## 2. Aplikasi Uji dan Target

Aplikasi: `tes-testing` di `/home/tugure/autore-workspace/tes-testing`.

Alasan: aplikasi sandbox, bukan production, Python tanpa database/state, punya `/health`, Jenkins job, dan image immutable Nexus. Container lama `tes-testing` di 8053 dipertahankan.

Target staging:
- container `tes-testing-staging`
- host port `8153`; preflight wajib memeriksa bebas
- app port `8000`
- candidate port `8253`
- health `http://127.0.0.1:8153/health`, hanya `/health`
- tanpa database, tanpa compose

## 3. Alur Nyata Saat Ini

1. Dashboard `/pipeline` mengirim `POST /api/actions/deploy`.
2. API `actions.ts` memvalidasi app, memakai lock in-memory, menjalankan `autore deploy`.
3. `autore deploy` saat ini auto-commit/empty commit, push, daftarkan job, trigger Jenkins.
4. Jenkins `autorePipeline` menjalankan 10 stage; stage 9 verifikasi digest Nexus; stage 10 `ci-deploy-by-digest.sh` membuat kandidat di port +100, health, swap, rollback otomatis bila gagal.
5. Pipeline menulis `dashboard-status.json`; dashboard membaca `/api/status`, `/api/runs`, `/api/active`.
6. Belum ada event release/deployment atau riwayat digest.

2A mengubah pencatatan dan tampilan, bukan membuat pipeline kedua.

## 4. Fase 2A: Vertical Slice

### 4.1 Event dan fold TypeScript

File: `web/packages/contracts/src/release-events.ts` (baru), `releases.ts`, tes.

Event minimal:
```json
{"id":"evt-1","ts":"...","kind":"requested","app":"tes-testing","environment":"staging","commit":"40hex","build_number":12,"actor":"operator"}
{"kind":"digest_verified","digest":"sha256:64hex","image_ref":"127.0.0.1:5000/tes-testing@sha256:64hex","build_number":12}
{"kind":"deploy_result","outcome":"success","requested_digest":"sha256:64hex","active_before":{"deployment_id":"dep-lama","digest":"sha256:lama"},"active_after":{"deployment_id":"dep-baru","digest":"sha256:64hex"},"health":"ok","image_id":"sha256:config"}
```

Fold:
- `success`: deployment baru `sehat`, pointer staging ke deployment baru, release `menunggu_persetujuan`; bukan `aktif`.
- `rolled_back`: release baru `gagal` lalu `rolled_back`, deployment baru `gagal`, pointer tetap deployment lama, release lama tetap `aktif` hanya jika production; staging pointer tetap.
- `failed_no_active`: release baru `gagal`, pointer `null`; tidak ada aktif palsu.
- `rollback_failed`: release baru `gagal`, pointer hanya nilai yang benar-benar teramati; tidak pernah deployment baru.
- Dua deployment berurutan menghasilkan dua release/deployment.
- Event asing/urutan rusak -> fold error/stale.

### 4.2 Event store Rust

File: `cli/src/release.rs`, `main.rs`.

Perintah 2A:
- `autore release record --from-deploy-result <file> --build <number> --json`
- `autore release record --event build_failed ...`
- `autore release status --json`

Rust:
- append event atomik dengan append lock;
- tidak ada status turunan/enum transisi;
- batas 500 event, pemangkasan mempertahankan minimal dua deployment terakhir;
- `status` hanya mengembalikan event mentah.

Tes:
- append paralel tidak kehilangan event;
- lock append tidak menahan build;
- event malformed ditolak;
- pemangkasan benar;
- tidak ada `aktif`/`rolled_back` yang dihitung Rust.

### 4.3 Pipeline aplikasi uji

Pemicu 2A: operator memicu Jenkins job `tes-testing` atau menjalankan CLI di luar dashboard. Tidak ada endpoint atau tombol dashboard pada 2A. Perubahan perilaku `autore deploy` (clean check, lock) adalah 2B; 2A tidak mengklaim perlindungan itu.

Shared library hanya opsi default-off:
- `deployName` default `appName`;
- `releaseEnvironment` default kosong.

`Jenkinsfile` `tes-testing`:
```groovy
autorePipeline(
  appName: 'tes-testing',
  appPort: 8000,
  deployPort: 8153,
  deployName: 'tes-testing-staging',
  releaseEnvironment: 'staging'
)
```

Stage 10:
- `ACTIVE_CONTAINER_NAME=tes-testing-staging`;
- `HEALTH_ENDPOINT=/health`;
- script menulis `.deploy-result.json` dengan `outcome`, `requested_digest`, `active_before`, `active_after`, `health`, `error`;
- stage 10 memanggil `autore release record --from-deploy-result "${WORKSPACE}/.deploy-result.json" --build "${BUILD_NUMBER}"`;
- `post always` menulis `build_failed` hanya bila `releaseEnvironment` diisi;
- pipeline lain tidak berubah.

Script `ci-deploy-by-digest.sh`:
- tetap candidate/health/swap/rollback;
- menulis result JSON pada semua jalur;
- `HEALTH_ENDPOINT=/health`; tanpa fallback `/`;
- tidak build ulang.

### 4.4 API read-only

- `GET /api/releases?app=tes-testing`: baca event store lewat `autore release status --json`, validasi, fold TypeScript.
- Tidak ada POST baru, tidak ada deploy/redeploy/rollback/approve.
- Endpoint lama `/api/actions/deploy` tidak diubah dan tidak dipakai untuk staging pada 2A; tidak ada tombol staging yang memanggilnya.
- GET tidak menulis event, lock, atau file apa pun.
- Tidak ada reconcile di GET.
- Response memakai pola `stale`/`stale_reason` yang ada.
- Production tidak pernah dikembalikan sebagai aktif.

### 4.5 Dashboard read-only

- Board menampilkan staging, dua deployment terakhir, digest, health, status release.
- Production `Belum dikonfigurasi`.
- Label pipeline "Build + auto-deploy staging".
- Tidak ada tombol deploy/redeploy/rollback/approve/promote.
- Tidak ada klaim release staging `aktif`; statusnya `menunggu_persetujuan`.
- Bila event belum ada: "Belum ada deployment staging".

### 4.6 Yang sengaja tidak dikerjakan di 2A

- Deploy lock persisten dan `--require-clean`.
- Reconcile GET/worker.
- Tombol/endpoint deploy.
- Redeploy/rollback.
- Audit aksi dashboard.
- Approval/promote/production.
- Database.

## 5. Fase 2B: Aksi Dashboard (Direncanakan Terpisah)

- `POST /api/releases/deploy` untuk meminta pipeline staging; label "Build + auto-deploy ke Staging".
- `POST /api/releases/redeploy` by digest sehat terakhir.
- `POST /api/releases/rollback` hanya bila release terbaru gagal dan deployment sehat sebelumnya ada.
- Audit actor sesi; body actor diabaikan.
- Deploy lock per `app:environment`, file terpisah, dibuat sebelum trigger, bertahan saat API restart; event terminal tetap bisa menulis dengan append lock.
- `--require-clean`: tree kotor/commit belum di-push/remote tidak sinkron gagal jelas; tanpa auto-commit/empty commit.
- `request_id` menjadi build parameter Jenkins; `nextBuildNumber` hanya kandidat, build aktual diverifikasi.
- Reconcile CLI/worker, bukan GET.
- UI tombol hanya untuk aksi valid; production tetap tidak ada.

## 6. Urutan Commit 2A

1. `docs: perbarui PRD dan rencana 2A/2B` — dokumen ini.
2. `feat(contracts): event release dan fold state machine` — tipe, fold, tes.
3. `feat(cli): event store dengan append lock` — record/status, tes konkurensi.
4. `feat(cli): verifikasi digest dan result deploy` — pull by digest, health, result JSON.
5. `feat(ci): staging terisolasi untuk tes-testing` — shared library default-off, Jenkinsfile uji, script result.
6. `feat(api): endpoint release read-only` — GET, fold, stale, tes tanpa write.
7. `feat(ui): dashboard staging read-only` — board, label, tes.
8. `test(e2e): bukti dua deployment staging` — e2e + bukti digest/health.

Setiap commit hijau sebelum lanjut. Commit 5 hanya menyentuh aplikasi uji dan opsi default-off; tidak mengubah job.

2B memiliki urutan terpisah setelah acceptance 2A.

## 7. File 2A

Autore:
- `docs/prd-dev-staging-production.md`
- `docs/plan-fase-2-staging.md`
- `web/packages/contracts/src/releases.ts`
- `web/packages/contracts/src/release-events.ts` (baru)
- `web/packages/contracts/src/contracts.test.ts`
- `cli/src/release.rs` (baru)
- `cli/src/main.rs`
- `scripts/ci-deploy-by-digest.sh`
- `vars/autorePipeline.groovy`
- `web/apps/api/src/releases.ts` (baru)
- `web/apps/api/src/releases.test.ts` (baru)
- `web/apps/api/src/index.ts` dan tes
- `web/apps/dashboard/src/lib/releases-client.ts` dan tes
- `web/apps/dashboard/src/components/release-environment-board.tsx` dan tes
- `web/apps/dashboard/src/components/pipeline/app-detail.tsx`
- `web/apps/dashboard/src/app/pipeline/page.tsx` dan tes
- `web/apps/dashboard/e2e/*.spec.ts`

Di luar repo:
- `/home/tugure/autore-workspace/tes-testing/Jenkinsfile`
- `/home/tugure/autore-workspace/release-state.json`
- `/home/tugure/autore-workspace/release-state.append.lock`
- container `tes-testing-staging` port 8153

Tidak berubah: `.env`, credential, Jenkins job, systemd unit, production, container lama 8053, database.

## 8. Acceptance Criteria 2A

1. Staging terpisah: `tes-testing-staging` port 8153; container lama 8053 tetap berjalan dengan image ID sama sebelum/sesudah.
2. Health: `curl -fsS http://127.0.0.1:8153/health` = 200 `{"status":"ok"}`.
3. Digest: `docker pull` by digest berhasil, `.RepoDigests` memuat digest, image ID container = image ID hasil pull.
4. Dua deployment tercatat dan tampil; masing-masing punya build number, commit, digest, status, health.
5. Release staging sehat berstatus `menunggu_persetujuan`, bukan `aktif`; pointer staging menunjuk deployment sehat.
6. Kegagalan health/auto-rollback tidak menggeser pointer; release/deployment baru `gagal`/`rolled_back`, bukan `aktif`.
7. Append lock: dua penulis paralel tidak kehilangan event; atomic rename saja tidak dianggap cukup.
8. GET `/api/releases` tidak mengubah event log, lock, atau file lain; tidak ada POST release.
9. Dashboard read-only: production `Belum dikonfigurasi`; tidak ada tombol deploy/redeploy/rollback/approve/promote.
10. Pipeline auto-deploy setelah gate tertulis di label; tidak ada klaim request UI sudah aktif.
11. Tidak ada state machine di Rust; semua status turunan dari fold TypeScript.
12. `cargo test`, `cargo clippy`, `vitest`, `tsc -b apps/dashboard`, `tsc -b apps/api`, `npm run build:dashboard`, dan e2e hijau.
13. Tidak ada database baru.
14. 2A tidak mengklaim deploy lock, `--require-clean`, atau reconcile end-to-end; itu acceptance 2B.

## 9. Verifikasi

```bash
ss -ltn '( sport = :8153 )'
docker inspect -f '{{.Name}} {{.Image}}' tes-testing

curl -fsS -i http://127.0.0.1:8153/health
docker inspect -f '{{.Name}} {{.Image}}' tes-testing-staging

DIGEST="$(python3 -c "import json; d=json.load(open('/home/tugure/autore-workspace/release-state.json')); print([e['active_after']['digest'] for e in d['events'] if e.get('kind')=='deploy_result' and e.get('outcome')=='success'][-1])")"
docker pull --quiet "127.0.0.1:5000/tes-testing@${DIGEST}"
IMAGE_ID="$(docker image inspect "127.0.0.1:5000/tes-testing@${DIGEST}" --format '{{.Id}}')"
test "$(docker inspect -f '{{.Image}}' tes-testing-staging)" = "$IMAGE_ID"
docker image inspect "127.0.0.1:5000/tes-testing@${DIGEST}" --format '{{json .RepoDigests}}'

# GET read-only: catat mtime/ukuran, panggil endpoint, pastikan tidak berubah.
sha256sum /home/tugure/autore-workspace/release-state.json

cd /home/tugure/Autore
cargo test
cargo clippy --all-targets -- -D warnings
cd web
npx vitest run
npx tsc -b apps/dashboard
npx tsc -b apps/api
npm run build:dashboard
npm run test:e2e
```

Bukti akhir: health, image ID, `.RepoDigests`, dua deployment, status 8053, dan GET tidak mengubah file. Jangan cetak credential.

## 10. Rollback dan Risiko

Rollback kode:
- Revert commit 2A dari terbaru.
- Kembalikan `vars/autorePipeline.groovy`, script, dan Jenkinsfile uji; container 8053 tidak disentuh.
- Hapus `release-state.json`/append lock hanya setelah tidak ada build berjalan.

Runtime:
- Hentikan/hapus `tes-testing-staging` hanya setelah konfirmasi tidak ada build.
- Jangan hentikan `tes-testing` 8053.
- Port 8153 bentrok: hentikan, jangan menebak port.

Risiko:
- Shared library default-off tetap menyentuh file bersama; mitigasi default sama, hanya Jenkinsfile uji yang mengisi.
- Jenkins library mungkin perlu reload admin; hentikan bila tidak termuat.
- Nexus auth; gunakan Docker config yang ada, jangan cetak credential.
- `.Image` bukan digest; wajib pull + `.RepoDigests` + image ID.
- Event log konkuren; append lock terpisah wajib.
- 2A belum punya reconcile; event pending terlihat sebagai pending, bukan aktif. 2B menutupnya.
- Rollback database tidak dijanjikan; aplikasi uji tanpa database.

Ditunda ke 2B: deploy lock, `--require-clean`, reconcile, aksi dashboard, audit aksi, redeploy/rollback UI, approval/promotion/production, database.

## 11. Keputusan Terbuka

1. Apakah library Jenkins dimuat dari repo atau manual. Asumsi: repo; bila manual perlu admin.
2. Apakah status `menunggu_persetujuan` ditampilkan sebagai label display-only; rekomendasi ya, tanpa tombol approval.
3. Dua deployment memakai dua build atau dua commit; rekomendasi dua build berbeda.
4. Siapa yang menghapus container staging saat insiden; rekomendasi admin VPS.

STOP: rencana ini untuk review. Tidak ada implementasi 2A/2B sebelum disetujui.
