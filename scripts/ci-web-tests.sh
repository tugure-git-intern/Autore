#!/usr/bin/env bash
# scripts/ci-web-tests.sh — Gerbang mutu web: vitest + tsc --noEmit + next build.
#
# Dipanggil vars/autorePipeline.groovy dari /usr/local/lib/autore-ci/ (admin-installed),
# sama seperti ci-*.sh lain: repo yang dipindai TIDAK boleh menyediakan skrip ini.
# Repo yang diuji datang dari WORKSPACE (atau cwd), bukan dari lokasi skrip.
#
# Hanya berlaku untuk repo yang punya web/package.json; repo aplikasi non-web
# dilewati oleh stage sebelum skrip ini dipanggil.
set -euo pipefail

WORKSPACE="${WORKSPACE:-$(pwd)}"
WEB_DIR="${WORKSPACE}/web"

log() { printf '\n==> [Web Quality Gate] %s\n' "$*"; }
gagal() { printf '\n[GAGAL] %s\n' "$*" >&2; exit 1; }

[[ -f "${WEB_DIR}/package.json" ]] || gagal "web/package.json tidak ada di ${WORKSPACE} — gerbang web tidak berlaku untuk repo ini."

cd "${WEB_DIR}"

# next build berhenti di tahap "Collecting page data" kalau AUTH_SECRET /
# NEXTAUTH_SECRET kosong (lihat petunjuk di web/.env.example). CI tidak punya
# web/.env karena gitignored, jadi nilai contoh yang dilacak git dipakai — dan
# berkas sementara ini dihapus lagi walau build gagal: kalau tertinggal,
# gitleaks build berikutnya menandainya sebagai secret.
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || gagal "web/.env.example tidak ada — env build tidak bisa disiapkan."
  cp .env.example .env
  # .env.example sengaja mengosongkan semua secret, dan auth-secret.ts fail
  # closed saat kosong — jadi build selalu butuh nilai. Nilai sekali-pakai:
  # artefak .next juga tidak pernah dipakai/di-deploy oleh gerbang ini.
  sesi="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  if grep -q '^NEXTAUTH_SECRET=' .env; then
    sed -i "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=${sesi}|" .env
  else
    printf 'NEXTAUTH_SECRET=%s\n' "${sesi}" >> .env
  fi
  trap 'rm -f "${WEB_DIR}/.env"' EXIT
  log "0/4 web/.env sementara dibuat dari .env.example + secret sekali-pakai (dihapus saat skrip keluar)"
fi

log "1/4 npm ci (pasang dari lockfile, node_modules bersih)"
npm ci --no-audit --no-fund

log "2/4 vitest run (suite dashboard + api + paket kontrak)"
npx vitest run || gagal "Tes web gagal. Jalankan dari web/: npx vitest run"

log "3/4 tsc --noEmit (web/packages/contracts + web/apps/api + web/apps/dashboard)"
( cd packages/contracts && npx tsc --noEmit ) || gagal "Type check paket kontrak gagal. Jalankan: cd web/packages/contracts && npx tsc --noEmit"
( cd apps/api && npx tsc --noEmit ) || gagal "Type check API gagal. Jalankan: cd web/apps/api && npx tsc --noEmit"
( cd apps/dashboard && npx tsc --noEmit ) || gagal "Type check dashboard gagal. Jalankan: cd web/apps/dashboard && npx tsc --noEmit"

log "4/4 next build (dashboard produksi)"
npm run build:dashboard || gagal "Build dashboard gagal. Jalankan dari web/: npm run build:dashboard"

log "SELESAI: vitest, tsc --noEmit, dan next build semuanya lulus."
