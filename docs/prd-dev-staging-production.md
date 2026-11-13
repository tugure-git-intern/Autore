# PRD: Autore sebagai Platform CI/CD Internal (dev → staging → approval → production)

Status: Draf untuk review. Tanggal: 2026-11-12.
Asumsi yang belum dikonfirmasi kantor ditandai **[Asumsi]**. Semua keputusan lain mengikuti brief.

## 1. Latar Belakang, Masalah, Tujuan, Keberhasilan

Autore hari ini: CLI Rust sebagai fondasi engine, dashboard Next.js + API Hono, Jenkins,
Docker, Nexus, SonarQube, security gate, dan deploy berbasis immutable image digest.
Deploy saat ini berarti "build lalu jalan di satu VPS" — tidak ada konsep environment,
tidak ada gerbang persetujuan, dan production belum punya target.

Masalah: pegawai non-developer tidak bisa melepas aplikasi ke staging/production tanpa
membuka Jenkins atau menjalankan CLI; tidak ada jejak "siapa menyetujui apa"; satu
dashboard berpotensi menampilkan status production yang belum ada sebagai seolah online.

Tujuan: satu dashboard untuk semua environment; build image sekali, staging dan
production memakai digest yang sama; staging→production selalu lewat approval manual;
reject menyimpan alasan dan tidak menghapus history; production yang belum dikonfigurasi
tampil "Belum dikonfigurasi".

Indikator keberhasilan (terukur):
- Developer/pegawai dapat deploy ke staging dari dashboard tanpa membuka Jenkins/CLI.
- 100% deployment production tercatat punya approval; 0 auto-production.
- Digest image di staging == digest di production untuk release yang sama (diverifikasi otomatis).
- Setiap mutasi (deploy, approve, reject, rollback) punya baris audit ber-actor dan timestamp.
- Environment tanpa target tidak pernah menampilkan status "online".

## 2. Persona

- **Developer**: coding dan uji lokal di Docker Desktop; push ke repo; memicu deploy
  staging dari dashboard; membaca log dan status.
- **Approver**: pegawai yang ditunjuk kantor (daftar nama/jabatan ditentukan kemudian,
  tidak di-hardcode); meninjau release di staging, approve atau reject dengan alasan.
- **Admin**: mendaftarkan aplikasi dan environment, mengelola secret per environment,
  mengelola daftar approver, melihat audit trail.

## 3. User Journey Developer

1. Coding lokal, uji dengan Docker Desktop.
2. Push ke branch utama repo aplikasi.
3. Buka dashboard → aplikasi → klik "Deploy". (CLI tetap tersedia, bukan kewajiban.)
4. Pipeline Jenkins berjalan: security gate → build image sekali → push digest ke
   registry → deploy ke **staging** → health check.
5. Dashboard menampilkan release `menunggu_persetujuan` beserta digest, hasil health
   check, dan link log.
6. Approver meninjau. Approve → deploy ke **production** memakai digest yang sama →
   health check → `aktif`. Reject dengan alasan → release `ditolak`, history tetap ada.
7. Jika production gagal health check: status `gagal`, tombol rollback ke release
   production aktif sebelumnya.

## 4. State Machine

Release (satu per commit yang di-deploy):

```
draft → build_berjalan → siap_staging → staging_berjalan → menunggu_persetujuan
                                                              ├─(approve)→ production_berjalan → aktif
                                                              │                                  └─(health gagal)→ gagal
                                                              └─(reject+alasan)→ ditolak   [terminal, history utuh]
release gagal di production ─(rollback selesai)→ rolled_back  [bukan aktif]
setiap tahap build/staging ─(gagal)→ gagal
```

Deployment (satu per release per environment):
`antri → berjalan → sehat | gagal`. `aktif` adalah penunjuk environment ke deployment
sehat terakhir, bukan status terpisah.

Aturan transisi: hanya API yang mengubah status, lewat transisi bernama; transisi ilegal
ditolak dan diaudit sebagai percobaan. `menunggu_persetujuan → production_berjalan`
wajib `approved_by` terisi; `ditolak` wajib `alasan` non-kosong; tidak ada transisi
langsung build→production.

Klarifikasi wajib (disetujui 2026-11-12, direvisi 2026-11-13):
1. `staging_berjalan → menunggu_persetujuan` hanya sah jika deployment staging berstatus
   `sehat`. Health check staging yang gagal mengarah ke `gagal` dan tidak membuka approval.
2. `environment.active_deployment_id` adalah pointer deployment sehat milik environment,
   terpisah dari status release. Release staging yang sehat berstatus `menunggu_persetujuan`,
   bukan `aktif`; status `aktif` hanya untuk release yang deployment production-nya sehat.
3. Rollback staging mengembalikan pointer staging ke deployment sehat lama dan menandai
   deployment/release baru sesuai fakta (`gagal` atau `rolled_back`), tanpa mengaktifkan
   production. Release baru yang gagal tidak pernah menjadi `aktif`.

## 5. Scope Bertahap

- **Fase 1** (tanpa server production): model data Application/Release/Environment/
  Deployment/Approval; kontrak API di `@autore/contracts`; unit test transisi state
  machine; mockup UI satu dashboard dengan tab environment dan label "Belum dikonfigurasi".
  Tidak ada deployment nyata.
- **Fase 2A** (vertical slice, dashboard read-only): deploy staging nyata untuk satu
  aplikasi uji lewat pipeline yang ada, health check HTTP, event log append-only, fold
  state machine di TypeScript, dan dashboard yang hanya membaca hasil. Deploy dari
  dashboard tidak termasuk 2A. Tidak ada tombol deploy/redeploy/rollback, endpoint POST,
  approval, atau production.
- **Fase 2B** (aksi dashboard): deploy/redeploy/rollback staging dari dashboard memakai
  digest, audit actor sesi, lock deploy per `app:environment`, dan rekonsiliasi build
  Jenkins. 2B dimulai hanya setelah 2A terbukti.
- **Fase 3**: autentikasi/role minimal (developer, approver, admin) memanfaatkan sesi
  Auth.js yang sudah ada; endpoint approve/reject dengan alasan wajib; audit trail
  untuk semua mutasi (memperluas `audit.ts`).
- **Fase 4**: target production saat server tersedia; promote by digest (tanpa rebuild);
  health check production; rollback ke deployment sehat sebelumnya.

Non-goals: Kubernetes; migrasi ke GitHub Actions; auto-production; dashboard terpisah
per environment; sistem role kompleks (RBAC granular, SSO LDAP). Fondasi engine tetap
CLI Autore; API Hono mengorkestrasi CLI, bukan mesin pipeline kedua di Next.js.

## 6. Aturan Data

- **Application**: `id`, `nama`, `repo_url`, `default_branch`. Relasi: punya banyak
  Release dan Environment. Sudah ada padanannya di `registry.tsv` + konfigurasi aplikasi.
- **Release**: `id`, `application_id`, `commit_sha`, `image_digest`, `status`
  (`draft` | `build_berjalan` | `siap_staging` | `staging_berjalan` |
  `menunggu_persetujuan` | `production_berjalan` | `aktif` | `gagal` |
  `ditolak` | `rolled_back`), `approved_by` (opsional, wajib saat production
  berjalan), `alasan` (wajib saat `ditolak`), `dibuat_oleh`, `dibuat_pada`.
  `image_digest` boleh `null` hanya pada `draft`/`build_berjalan` dan wajib terisi
  sejak `siap_staging`. Satu release = satu digest; digest tidak boleh berubah setelah
  build sukses.
- **Environment**: `id`, `application_id`, `nama` (`staging`|`production`),
  `target` (host/runner tujuan), `status_konfigurasi` (`terkonfigurasi`|
  `belum_dikonfigurasi`), `active_deployment_id` (pointer deployment sehat milik
  environment, bukan status release). Production baru dibuat dengan
  `belum_dikonfigurasi` sampai admin mengisi target. Staging sehat menunjuk deployment
  sehat terakhir tanpa membuat release staging menjadi `aktif`.
- **Deployment**: `id`, `release_id`, `environment_id`, `image_digest`, `status`,
  `health_check_url`, `mulai_pada`, `selesai_pada`, `error`. Invariant:
  `deployment.image_digest == release.image_digest` (diuji).
- **Approval**: `id`, `release_id`, `keputusan` (`approve`|`reject`), `alasan`
  (wajib untuk reject), `actor`, `pada`. Append-only; tidak ada UPDATE/DELETE.

Penyimpanan Fase 2A: **[Asumsi]** file event log JSON per workspace
(`autore-workspace/release-state.json`) mengikuti pola `dashboard-status.json` yang sudah
ada. Penulisan memakai lock append terpisah yang dipegang hanya selama read-modify-write,
lalu atomic rename; atomic rename saja tidak mencegah lost update. Lock deploy
`app:environment` bukan lock append. Migrasi ke database hanya jika konkurensi menuntut
(lihat Risiko).

## 7. Aturan Keamanan

- Secret per environment disimpan di luar repo (file konfigurasi VPS atau secret store
  Jenkins), direferensikan per environment, tidak pernah masuk kontrak API response.
- Aksi production (approve, reject, rollback, ubah target) hanya untuk role approver/
  admin; deploy staging untuk developer. Daftar approver dikelola admin, bukan konstanta.
- Setiap mutasi menulis audit: actor dari sesi (bukan body), aksi, target, timestamp,
  alasan. Pola ini sudah dipakai `--author-name`/`--author-email` pada deploy.
- Token Jenkins/registry memakai akun service/bot, bukan akun pribadi pegawai.
  **[Asumsi]** akun bot perlu dibuatkan kantor; sampai ada, token yang ada dipakai
  hanya untuk staging.

## 8. Kebutuhan Infrastruktur (diminta ke tim server nanti)

1. Host production terpisah dari VPS staging, dengan Docker dan akses pull ke registry.
2. Kredensial SSH/deploy production untuk akun service, disimpan di Jenkins credentials.
3. DNS/internal URL untuk health check staging dan production per aplikasi.
4. Akun bot Jenkins + token registry non-pribadi.
5. **[Asumsi]** resource staging saat ini (1 VPS) cukup; tidak ada host tambahan untuk Fase 1–3.

## 9. Acceptance Criteria per Fase

- **Fase 1**: kontrak TypeScript untuk 5 entitas lolos validasi fail-closed; unit test
  state machine mencakup semua transisi legal + minimal 5 transisi ilegal ditolak;
  mockup menampilkan production "Belum dikonfigurasi"; `vitest` dan `tsc` hijau; tanpa
  perubahan pada service yang berjalan.
- **Fase 2A**: satu aplikasi uji ter-deploy ke staging lewat pipeline yang ada; health
  check 200; digest registry terverifikasi dan sama dengan image container; event log
  mencatat minimal dua deployment berurutan; dashboard read-only menampilkan staging dan
  production `Belum dikonfigurasi`; tidak ada tombol deploy/redeploy/rollback, endpoint
  POST, approval, atau production. Release staging sehat berstatus `menunggu_persetujuan`,
  bukan `aktif`; `active_deployment_id` staging tetap pointer deployment sehat.
- **Fase 2B**: deploy/redeploy/rollback staging dari dashboard berfungsi; audit actor
  sesi; lock deploy per `app:environment` dibuat sebelum trigger Jenkins dan bertahan
  saat API restart; response request tidak mengklaim deployment sudah aktif.
- **Fase 3**: user tanpa role approver mendapat 403 pada approve/reject; reject tanpa
  alasan ditolak (400); setiap approve/reject menghasilkan baris audit ber-actor;
  release `ditolak` tetap muncul di history.
- **Fase 4**: promote ke production memakai digest identik dengan staging (assert
  otomatis, bukan sekadar tampilan); health check production gagal memicu status
  `gagal`; rollback mengaktifkan kembali deployment sehat sebelumnya tanpa rebuild;
  production tanpa target tidak pernah berstatus online.

## 10. Risiko

- **Migrasi database**: jika JSON tidak lagi cukup, migrasi harus menyediakan skrip
  konversi + uji round-trip; jangan mulai dengan database (YAGNI).
- **Deploy bersamaan**: lock deploy per `app:environment`, bukan satu lock global;
  event terminal harus tetap bisa ditulis saat lock deploy dipegang. Penulisan event
  memakai lock append terpisah yang hanya dipegang selama read-modify-write.
- **Lost update event log**: atomic rename saja tidak mencegah dua penulis saling
  menimpa; lock append wajib, dan lock deploy tidak boleh dipakai untuk append.
- **Rollback database aplikasi**: rollback image tidak me-rollback skema DB milik
  aplikasi; PRD ini tidak menjanjikan rollback DB — dokumentasikan sebagai batasan,
  aplikasi wajib migrasi yang kompatibel mundur.
- **Perbedaan konfigurasi environment**: secret/konfigurasi disuntik per environment;
  image sama, konfigurasi boleh beda; perbedaan didaftarkan eksplisit di Environment.
- **Status palsu**: status hanya dari health check nyata dan output CLI; environment
  tanpa target = `belum_dikonfigurasi`; API memvalidasi kontrak fail-closed (pelajaran
  dari insiden `stale` kontrak lama).

## 11. Keputusan Terbuka (tidak menghalangi Fase 1)

1. Siapa approver per aplikasi (kantor menentukan; model data sudah menampung).
2. Apakah staging per aplikasi butuh hostname tetap atau cukup port di VPS.
3. Ambang health check (jumlah retry, timeout) — default **[Asumsi]** 3× jeda 5 detik.
4. Retensi history deployment/audit (default **[Asumsi]** simpan semua, pangkas kemudian).
5. Apakah reject masih mengizinkan re-approve release yang sama, atau harus release
   baru — **[Asumsi]** harus release baru (lebih sederhana, history bersih).
6. Bentuk akhir secret store (file VPS vs Jenkins credentials vs vault).

---

STOP: dokumen ini untuk review. Tidak ada implementasi sebelum disetujui.
