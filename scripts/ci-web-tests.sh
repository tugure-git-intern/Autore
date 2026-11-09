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

log "1/4 npm ci (pasang dari lockfile, node_modules bersih)"
npm ci --no-audit --no-fund

log "2/4 vitest run (suite dashboard + api)"
npx vitest run || gagal "Tes web gagal. Jalankan dari web/: npx vitest run"

log "3/4 tsc --noEmit (web/apps/api + web/apps/dashboard)"
( cd apps/api && npx tsc --noEmit ) || gagal "Type check API gagal. Jalankan: cd web/apps/api && npx tsc --noEmit"
( cd apps/dashboard && npx tsc --noEmit ) || gagal "Type check dashboard gagal. Jalankan: cd web/apps/dashboard && npx tsc --noEmit"

log "4/4 next build (dashboard produksi)"
npm run build:dashboard || gagal "Build dashboard gagal. Jalankan dari web/: npm run build:dashboard"

log "SELESAI: vitest, tsc --noEmit, dan next build semuanya lulus."
