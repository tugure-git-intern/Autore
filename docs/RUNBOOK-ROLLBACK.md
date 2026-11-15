# Runbook Rollback Release

Satu halaman. Dipakai saat rilis di staging/production bermasalah dan harus dikembalikan ke deployment sebelumnya.

## Apa arti rollback di Autore

Rollback = **deploy ulang deployment sehat terakhir** di environment itu (yang bukan deployment aktif), memakai **digest image** yang tercatat di ledger — bukan rebuild, bukan tag. Setiap rollback dicatat sebagai event baru di
`~/autore-workspace/release-state.json` dan mengubah pointer `active_deployment_id` environment tersebut.

Target yang dipilih sistem: deployment sehat terakhir di environment itu, id-nya bukan yang sedang aktif.

## Siapa yang boleh

Role dibaca server dari `web/allowed-users.json`, bukan dari token browser.

| Aksi | Role minimum | Syarat status release |
|---|---|---|
| Setujui / Tolak staging | `qa` | `menunggu_persetujuan` |
| Promosikan ke production | `admin` | `disetujui` |
| Rollback (tombol UI: production) | `qa` | `aktif` |
| Rollback staging lewat API | `qa` | release apa pun yang punya deployment sehat sebelumnya |

Penolakan wajib menyertakan alasan (tombol **Tolak** → isi alasan → kirim).

## Jalur 1 — UI (production)

1. Login dashboard `http://100.80.3.14:9120` dengan akun role `qa`/`admin`.
2. Buka `/pipeline?app=<app>`.
3. Pada kartu release yang statusnya **Aktif**, klik **Rollback Production**.
4. Konfirmasi. Respons `202` berarti job `<app>-rollback` dipicu; halaman dimuat ulang setelah build selesai.

Tombol tidak muncul untuk role `dev` — itu memang gerbangnya, bukan bug.

## Jalur 2 — API (staging atau production)

```bash
curl -sS -X POST "http://127.0.0.1:9121/api/releases/<release-id>/rollback" \
  -H 'content-type: application/json' \
  --data '{"environment":"staging"}' \
  -b <cookie-sesi-dashboard>
```

Aturan body (ditegakkan 400):

- `environment` **wajib**, hanya `staging` atau `production` — persis, huruf kecil.
- `Production`, `prod`, `""`, `null`, atau kunci tambahan lain ditolak.
- Tidak ada nilai default: rollback tanpa environment tidak pernah jalan.

Respons: `202` job dipicu, `400` body salah, `403` role kurang, `404` app/release/job tidak ada, `409` tidak ada target sehat atau sudah ada rollback berjalan, `502` gagal baca ledger.

## Yang dijalankan di belakang

1. API memicu job Jenkins `<app>-rollback` (`Jenkinsfile.rollback`), agent `vps-runner-1`.
2. Job memakai binary kanonik `/usr/local/lib/autore-ci/autore` + `ci-deploy-by-digest.sh` mode rollback.
3. Skrip menarik image **by digest**, mengganti container, lalu health check.
4. Hasil ditulis sebagai event `rollback` dengan `outcome` `rolled_back` atau `rollback_failed` dan `health` `ok`/`gagal`.

Satu job per commit; tidak ada retry otomatis dan tidak ada rollback berantai.

## Verifikasi setelah rollback

```bash
curl -s "http://127.0.0.1:9121/api/releases?app=<app>" | jq '.data.releases[0], .data.environments'
docker inspect -f '{{index .Config.Image}}' <app>-<environment>     # harus @sha256:...
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<health-port>/
```

Lulus kalau:

- release target berstatus `rolled_back`, `health` = `ok`;
- `environments[].active_deployment_id` menunjuk deployment target (bukan yang lama);
- image container = digest target;
- health endpoint balas `200`.

Dashboard akan menampilkan badge **Rolled Back** pada kartu release tersebut.

## Kalau gagal

1. Baca `health`/`outcome` event terakhir: `rollback_failed` + `gagal` berarti container sudah diganti tapi tidak sehat atau pull gagal.
2. Buka console job `<app>-rollback` di Jenkins (build terakhir) — di situ tertulis digest yang dipakai dan error-nya.
3. Jangan mengulang berkali-kali: perbaiki penyebabnya dulu (registry 429, digest salah, port bentrok).
4. Kalau ledger perlu dikoreksi, backup dulu dan hanya sentuh field yang salah — satu event rusak membuat seluruh `/api/releases` gagal dibaca (502).

## Larangan

- Rollback memakai tag (`:latest`, `build-N`) — hanya digest.
- Mengedit `release-state.json` tanpa backup.
- Rollback aplikasi lain sebagai "percobaan" di production.
- Menjalankan dua rollback bersamaan untuk app yang sama.
