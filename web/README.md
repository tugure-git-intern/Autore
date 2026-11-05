# Autore Web

Isolated npm workspace for the Autore dashboard front-end and its API shim.
Lives entirely under `web/` so the Rust CLI build stays untouched.

## Layout

```
web/
  apps/dashboard   Next.js 15 App Router UI   (port 9120)
  apps/api         Hono JSON API              (port 9121)
```

## Commands

Run from `web/`:

| Command                     | What it does                              |
| --------------------------- | ----------------------------------------- |
| `npm install`               | install workspace deps (hoisted)          |
| `npm run dev:dashboard`     | Next dev server on 0.0.0.0:9120           |
| `npm run dev:api`           | Hono dev server on 9121                   |
| `npm run build:dashboard`   | production build (`apps/dashboard/.next`) |
| `npm run start:dashboard`   | serve the production build on 9120        |
| `npm run start:api`         | serve the API on 9121 (override `PORT`)   |
| `npm test`                  | run every workspace test suite            |

Browser requests to `/api/*` on the dashboard are proxied to the Hono app on
`127.0.0.1:9121` (see `apps/dashboard/next.config.ts`).

## Requirements

Node 18.18+ (pinned to the toolchain the CLI release uses). Dependency
versions are pinned, not floated — bump them deliberately.

## Tests

`vitest` with a root config that fans out to each app: the dashboard uses
`jsdom` + Testing Library, the API uses plain `node`.

## E2E (Playwright)

Visual contract for the dashboard at 1280x720: `Dashboard` heading visible, no
horizontal overflow (`scrollWidth <= 1280`), the sidebar links to `/`,
`/applications` and `/pipeline`, no element with a gradient background, and no
`box-shadow` heavier than `box-shadow-sm`. Screenshots land in
`apps/dashboard/e2e/__screenshots__/` (gitignored) for a human to eyeball — no
golden image diff is frozen.

```bash
npx playwright install chromium   # one-off browser download
npm run build:dashboard           # e2e hits the production build
npm run start:api &               # Hono on 9121
npm run start:dashboard &         # Next on 9120
npm run test:e2e                  # == npm run test:e2e --workspace @autore/dashboard
```

Both services must already be up; the Playwright config does not start them.

## Deploy (systemd user units)

`deploy/autore-web-api.service` and `deploy/autore-web-dashboard.service` are
systemd *user* units: they run as the invoking user (`tugure`), no root, no
system units touched.

Build once before enabling — `next start` serves the existing `.next` output:

```bash
cargo build --release --manifest-path cli/Cargo.toml
npm run build:dashboard
```

Install and start (as `tugure`):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/autore-web-api.service deploy/autore-web-dashboard.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now autore-web-api.service autore-web-dashboard.service
```

Kedua unit memuat `web/.env` lewat
`EnvironmentFile=-/home/tugure/Autore/web/.env` (`-` = jangan gagal kalau berkas
itu belum ada). Setelah mengubah `.env` atau berkas unit:

```bash
systemctl --user daemon-reload
systemctl --user restart autore-web-api autore-web-dashboard
systemctl --user is-active autore-web-api autore-web-dashboard   # dua kali "active"
```

Rahasia auth dan cara mengisinya: lihat [Auth (GitHub OAuth +
whitelist)](#auth-github-oauth--whitelist).

Health probes:

```bash
curl -fsS http://127.0.0.1:9121/healthz      # {"ok":true}
curl -fsS http://127.0.0.1:9121/api/status   # CLI status snapshot JSON
curl -fsS http://127.0.0.1:9120/ | grep -q Dashboard && echo dashboard ok
```

## Aksi dari dashboard (deploy & scan)

Dashboard tidak lagi read-only. Tiga tombol memanggil dua endpoint:

| Tombol | Halaman | Endpoint | Perintah yang dijalankan |
| --- | --- | --- | --- |
| Deploy Sekarang | `/` (pojok kanan header) | `POST /api/actions/deploy` | `autore deploy --path <workspace>/<AUTORE_DEPLOY_APP>` |
| Jalankan Ulang | `/pipeline?app=<id>` | `POST /api/actions/deploy` | sama dengan di atas |
| Scan Keamanan | `/applications` (tiap baris) | `POST /api/actions/scan` | `autore scan --no-docker --path <workspace>/<id>` |

Deploy bukan sekadar "build": CLI menjalankan `git add`/`git commit` di
direktori aplikasi, push ke remote, lalu memicu build Jenkins. Karena itu tombol
deploy dan jalankan-ulang selalu lewat modal konfirmasi yang menyebut
commit+push.

`POST /api/actions/scan` menerima tepat satu kunci `{"app":"<id>"}`. Id harus
terdaftar di `registry.tsv`; bentuknya dibatasi `^[A-Za-z0-9._-]{1,64}$` dan
path hasil gabungan wajib satu tingkat di bawah workspace. `deploy` tidak
membaca body sama sekali: targetnya milik unit, bukan milik pemanggil.

Konfigurasi unit API — bukan body request:

| Variabel | Wajib | Arti | Kalau kosong |
| --- | --- | --- | --- |
| `AUTORE_WORKSPACE` | ya | akar direktori aplikasi | semua aksi 503 |
| `AUTORE_DEPLOY_APP` | untuk deploy | aplikasi target tombol Deploy | deploy 503 |
| `AUTORE_BIN` | tidak | path binary `autore` | pakai `autore` dari `PATH` |

Balasan: `200` sukses · `400` body/id tidak sah · `404` id tidak terdaftar atau
direktori hilang · `409` aksi lain masih berjalan (satu lock global) · `422` CLI
keluar non-nol (potongan output CLI ikut di field `output`) · `503` konfigurasi
kurang atau CLI gagal dijalankan · `504` lewat batas waktu (scan 60 s, deploy
180 s). Body sukses dan gagal berbentuk sama: `{ok, status, ...}`.

Probe yang tidak mengubah apa pun:

```bash
curl -s -w "\n%{http_code}\n" -X POST http://127.0.0.1:9121/api/actions/scan \
  -H 'content-type: application/json' -d '{"app":"tidak-ada"}'          # 404
curl -s -w "\n%{http_code}\n" -X POST http://127.0.0.1:9121/api/actions/scan \
  -H 'content-type: application/json' -d '{"app":"tes-web","x":1}'      # 400: kunci ekstra
```

**Butuh sesi GitHub.** `POST /api/actions/*` menjawab 401 tanpa cookie
`authjs.session-token` yang sah — lihat
[Auth (GitHub OAuth + whitelist)](#auth-github-oauth--whitelist). Perintah tidak
pernah disusun dari string kiriman browser (`execFile` + `shell: false`, argv
tetap), jadi ini bukan jalur eksekusi perintah sembarang — tapi tetap jalur yang
mengubah repo dan memicu build Jenkins, dan sekarang hanya akun di whitelist
yang bisa memicunya. Port ini tetap jangan di-expose ke internet; biarkan hanya
di tailnet/jaringan internal.

## Auth (GitHub OAuth + whitelist)

Identitas dipegang GitHub: tidak ada kata sandi, tidak ada credential store,
tidak ada database. Login menerbitkan cookie JWE `authjs.session-token`
(ditandatangani `AUTH_SECRET`/`NEXTAUTH_SECRET`, umur 8 jam) yang dibaca tiga
tempat: halaman (`apps/dashboard/src/middleware.ts`), API aksi
(`apps/api/src/session.ts`), dan tombol Keluar (`signOut()`).

- Semua route butuh sesi kecuali `/login`, `/403` dan `/api/auth/*`. Tanpa sesi →
  `/login?callbackUrl=...`; login sah tapi di luar whitelist → `/403`.
- Username GitHub diperiksa dua kali — saat login (`auth.config.ts`) dan tiap
  request (`middleware.ts`) — jadi mencabut user dari whitelist berlaku begitu
  service di-restart.
- Whitelist: `web/allowed-users.json` (array login GitHub, huruf besar-kecil
  diabaikan). `AUTORE_ALLOWED_USERS` di `web/.env` (dipisah koma) **menimpa**
  berkas itu kalau tidak kosong.

### Environment

`web/.env` satu-satunya tempat rahasia dan ter-ignore git (`.gitignore:3`).

```bash
cp .env.example .env     # lalu isi nilainya; jangan pernah commit
grep -c . .env           # memastikan berkasnya berisi
```

| Variabel | Isi |
| --- | --- |
| `GITHUB_ID`, `GITHUB_SECRET` | OAuth App GitHub (akun pemilik repo) |
| `NEXTAUTH_SECRET` (atau `AUTH_SECRET`) | penandatangan cookie; `openssl rand -base64 32` |
| `NEXTAUTH_URL` | URL yang dilihat browser, mis. `http://100.80.3.14:9120` |
| `AUTH_TRUST_HOST` | `true` — wajib di belakang tailnet (host bukan localhost) |
| `AUTORE_ALLOWED_USERS` | opsional; menimpa `allowed-users.json` |

Callback URL OAuth App GitHub harus `http://<host>:9120/api/auth/callback/github`.

### Apa yang terbuka, apa yang ditolak

| Endpoint | Tanpa sesi |
| --- | --- |
| `GET /healthz`, `GET /api/status`, `GET /api/runs` | 200 — hanya baca, dan unit listen di `127.0.0.1` |
| `POST /api/actions/deploy`, `POST /api/actions/scan` | **401** `{"ok":false,"status":401}` |
| Aksi dari login di luar whitelist | **401** dari API, `/403` dari halaman |
| `AUTH_SECRET` kosong di unit API | **503** — fail closed, bukan 200 tanpa pemeriksaan |

UI menampilkan "Sesi Anda sudah berakhir. Silakan login ulang." lalu berpindah ke
`/login` begitu API menjawab 401/403.

### Batas jujur

- Kalau `AUTORE_ALLOWED_USERS` kosong, API hanya memverifikasi tanda tangan
  token: pencabutan user baru efektif setelah cookie habis (maks 8 jam) atau
  setelah whitelist diubah **dan** service di-restart. Isi
  `AUTORE_ALLOWED_USERS` kalau ingin API ikut mencocokkan daftar tiap request.
- Middleware sengaja tidak menyaring `/api/*`: redirect 307 di dalam `fetch()`
  terbaca sebagai HTML 200 oleh klien. Boundary API dipegang Hono dengan JSON
  401, bukan redirect.
- Verifikasi sesi butuh `globalThis.crypto`; Node 18 belum menyediakannya, jadi
  `apps/api/src/session.ts` memasang `webcrypto` sendiri. Jangan hapus.

### Uji login manual

```bash
systemctl --user daemon-reload
systemctl --user restart autore-web-api autore-web-dashboard
systemctl --user is-active autore-web-api autore-web-dashboard
```

Buka `http://100.80.3.14:9120/` → harus mendarat di `/login` → `Lanjut dengan
GitHub`. Akun di whitelist masuk ke `/` dengan avatar + username di topbar
(tombol Keluar kembali ke `/login`); akun di luar whitelist mendarat di `/403`.

## Live status contract check

Proves the chain CLI → Hono (`9121`) → Next (`9120`) while the deployed
services keep running.

```bash
# Same workspace the deploy unit uses: registry.tsv and per-app build dirs.
AUTORE_WORKSPACE="$HOME/autore-workspace" \
  "$HOME/Autore/cli/target/release/autore" status --json | python3 -m json.tool
curl -fsS http://127.0.0.1:9121/api/status | python3 -m json.tool

# Both pages render their rows in the browser from /api/status, so the payload is
# the assertion; the HTML only proves the route answers.
curl -fsS http://127.0.0.1:9120/api/status | python3 -c '
import json,sys
payload=json.load(sys.stdin)
assert payload["stale"] is False
assert payload["data"]["applications"], "registry kosong: cek AUTORE_WORKSPACE"
print(len(payload["data"]["applications"]), "aplikasi terdaftar")
'
curl -fsS -o /dev/null -w "applications %{http_code}\n" http://127.0.0.1:9120/applications
curl -fsS -o /dev/null -w "pipeline %{http_code}\n" "http://127.0.0.1:9120/pipeline?app=tes-web"
curl -fsS -o /dev/null -w "security %{http_code}\n" http://127.0.0.1:9120/security

# Riwayat build: satu-satunya endpoint yang isinya bukan snapshot status.
curl -fsS http://127.0.0.1:9121/api/runs | python3 -c '
import json,sys
payload=json.load(sys.stdin)
assert payload["stale"] is False, "CLI runs gagal: cek ~/.config/autore/jenkins.conf"
print(payload["data"]["totals"], len(payload["data"]["runs"]), "run dalam", payload["data"]["window_days"], "hari")
'
# Tahap terekam hanya setelah biner baru terpasang di /usr/local/bin/autore.
curl -fsS http://127.0.0.1:9121/api/status | python3 -c '
import json,sys
p=json.load(sys.stdin)["data"]["latest_pipeline"]
print("gates", p.get("gates_passed"), "/", p.get("gates_total"), "stage_times", len(p.get("stage_times") or []))
'
```

Expected: the CLI and API dumps match, `<n> aplikasi terdaftar`, then
`applications 200` and `pipeline 200`. Grepping the HTML for row text does not
work: the dashboard fetches in the browser, so SSR emits only the loading
skeleton.

`AUTORE_WORKSPACE` must point at `$HOME/autore-workspace` — the directory the
Jenkins pipeline fills with `registry.tsv` and one build dir per app. Pointing
it at the repo root is not an error the API can detect: it just reports zero
applications.

Smoke the API alone on a spare port without touching `9121`. `PORT` defaults to
`9121` and the server binds loopback only:

```bash
cd web
PORT=9123 \
AUTORE_BIN="$HOME/Autore/cli/target/release/autore" \
AUTORE_WORKSPACE="$(mktemp -d)" \
  npm run start:api > /tmp/autore-api-smoke.log 2>&1 &
curl -fsS http://127.0.0.1:9123/api/status | python3 -c '
import json,sys
payload=json.load(sys.stdin)
assert payload["stale"] is False
assert payload["data"]["applications"] == []
print("api contract OK")
'
```

`stale: false` means the CLI answered; `stale: true` means the shim kept the
last good snapshot because the call failed.

Installing units, restarting production (`systemctl --user restart
autore-web-api.service autore-web-dashboard.service`) and deploying are
deliberate manual steps — never part of a check.

## Who writes `dashboard-status.json`

One file, two writers, one contract (`cli/src/status.rs`):

| Writer | Runs as | When |
| --- | --- | --- |
| `autore serve` (the 1-click web flow) | `tugure` | after each deploy step in the UI |
| `autore pipeline record` | `jenkins` (Jenkins agent) | every pipeline stage + the final `post` |

`autore pipeline record` is the only command the Jenkins library
(`vars/autorePipeline.groovy`) calls:

```bash
# Writes the same file the dashboard reads: expect /pipeline to show `running`
# until the next build finishes.
AUTORE_WORKSPACE="$HOME/autore-workspace" /usr/local/bin/autore pipeline record \
  --reset --status running --stage checkout \
  --commit 0770f21 --author "uji manual" --log "[checkout] uji manual"
AUTORE_WORKSPACE="$HOME/autore-workspace" /usr/local/bin/autore status --json | python3 -m json.tool
```

Both writers go through `status::save`: serialise, write
`dashboard-status.json.tmp`, then rename — a reader never sees a half file, and
the last writer wins. `--reset` clears the previous build's stages and log, so
the first call of every build passes it; other flags leave untouched fields
alone. Karena itu **jangan menjalankan dua build bersamaan**: build yang saling
tumpang tindih bisa saling menghapus tahap, jadi matriks di `/pipeline` tampil
tanpa satu tahap (mis. `build`) dengan urutan waktu yang aneh. Satu build dulu,
build berikutnya setelah yang sebelumnya SUCCESS.

**Permission prerequisite.** The agent runs as the `jenkins` user, which is not
in `tugure`'s group, and `$HOME` is `0750` — so the workspace is unreachable
until it is opened:

```bash
sudo usermod -aG tugure jenkins        # the workspace dir itself is 0775 tugure:tugure
sudo systemctl restart jenkins-agent   # the agent only picks up the new group on restart
```

Without it the build still succeeds — recording is best-effort on purpose, so a
dashboard hiccup cannot fail a security pipeline — but the dashboard stays
`idle` and the console shows `WARNING: dashboard record gagal (exit 1)`. A stale
`/usr/local/bin/autore` without the subcommand fails earlier and harder, in
stage 1, with the `sudo install` command in the message.

Stage ids the dashboard understands — `checkout`, `scan`, `build`, `pasang`,
`periksa` — are mapped in
`web/apps/dashboard/src/components/pipeline/stage-matrix.tsx`.

## `GET /api/runs` — riwayat build untuk grafik

`autore runs --json` membaca Jenkins API, jadi dashboard bisa menggambar tren
7 hari tanpa menyimpan datanya sendiri.

```bash
curl -fsS http://127.0.0.1:9121/api/runs | python3 -m json.tool | head -30
```

```json
{
  "data": {
    "generated_at": "2026-11-04T14:33:46Z",
    "window_days": 7,
    "runs": [
      {
        "app": "tes-web",
        "number": 10,
        "status": "passed",
        "duration_ms": 45222,
        "started_at": "2026-11-04T14:21:07Z",
        "commit_sha": "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
        "author": "Autore CLI <autore@tugu-re.com>",
        "url": "http://100.80.3.14:8080/job/tes-web/10"
      }
    ],
    "daily": [{ "date": "2026-11-04", "passed": 4, "failed": 1 }],
    "totals": { "passed": 4, "failed": 1, "running": 0 }
  },
  "stale": false
}
```

Sumber data: `GET /job/<app>/api/json` (nomor, result, durasi, timestamp, SHA
dari `lastBuiltRevision` untuk branch `origin/*`), plus `git log -1` di repo
lokal untuk nama penulis — Jenkins tidak mengisi `changeSet` untuk job pipeline
ini. Hasilnya di-cache 60 detik di API; kalau CLI gagal, endpoint tetap 200 dan
`stale: true` dengan data terakhir yang bagus.

Tiga batasan yang jujur:

1. **Durasi tahap pertama tidak terekam.** `stage_times` mencatat waktu *mulai*
   tiap tahap, jadi durasi `checkout` dihitung dari selisih ke tahap berikutnya;
   tahap terakhir memakai `finished_at`.
2. **Penulis hanya terbaca kalau commit-nya ada di repo lokal.** Commit dari
   mesin lain tampil `—`, bukan nama karangan.
3. **Riwayat hanya untuk aplikasi yang punya job Jenkins.** Sembilan aplikasi lain
   di `registry.tsv` belum punya job, jadi mereka tidak pernah muncul di Recent
   Runs (dan tidak dihitung di Cakupan).

`stage_times`, `finished_at`, `gates_passed`, dan `gates_total` bersifat opsional
di kontrak: snapshot yang ditulis CLI lama tetap terbaca, dashboard cuma
menampilkan kartu tahap tanpa durasi.

Logs, status and restart:

```bash
systemctl --user status autore-web-api.service autore-web-dashboard.service
journalctl --user -u autore-web-api.service -f
journalctl --user -u autore-web-dashboard.service -f
systemctl --user restart autore-web-dashboard.service
```

On a headless VPS, keep the units alive after logout with
`loginctl enable-linger tugure`.

The API binds loopback `127.0.0.1:9121`; the dashboard binds `0.0.0.0:9120`. The
legacy `autore serve` on `9119` is **untouched** — these units add the two new
web services alongside it.
