#!/usr/bin/env bash
# scripts/ci-web-e2e.sh — gerbang regresi E2E dashboard (Playwright).
#
# Dipanggil stage 5.5 dari /usr/local/lib/autore-ci/ (admin-installed). Stage 5
# sudah menjalankan `npm ci` dan `next build`; skrip ini memakai node_modules
# yang sama dan hanya menyalakan server E2E hermetik di 9198/9199.
#
# E2E_LIVE sengaja dibuang: pipeline tidak boleh menembak dashboard production
# 9120/9121. Untuk uji lawan sistem nyata, jalankan manual dari laptop.
set -euo pipefail

WORKSPACE="${WORKSPACE:-$(pwd)}"
WEB_DIR="${WORKSPACE}/web"
DASHBOARD_DIR="${WEB_DIR}/apps/dashboard"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-/opt/autore/ms-playwright}"

log() { printf '\n==> [E2E Regression Gate] %s\n' "$*"; }
gagal() { printf '\n[GAGAL] %s\n' "$*" >&2; exit 1; }

[[ -f "${WEB_DIR}/package.json" ]] || gagal "web/package.json tidak ada di ${WORKSPACE} — gate E2E hanya untuk repo web."
[[ -d "${WEB_DIR}/node_modules" ]] || gagal "web/node_modules tidak ada — stage 5 (Web Quality Gate) harus lulus lebih dulu."
[[ -f "${DASHBOARD_DIR}/package.json" ]] || gagal "web/apps/dashboard/package.json tidak ada — workspace dashboard tidak lengkap."

# Channel chromium memakai browser penuh (bukan headless-shell). Path mengikuti
# PLAYWRIGHT_BROWSERS_PATH; chrome-linux64/chrome-linux tergantung versi.
if ! compgen -G "${BROWSERS}/chromium-*/chrome-linux*/chrome" >/dev/null; then
  gagal "Chromium Playwright tidak ada di ${BROWSERS}. Jalankan runner/setup-agent.sh di runner, atau set PLAYWRIGHT_BROWSERS_PATH ke cache browser yang sudah terpasang."
fi

cd "${DASHBOARD_DIR}"

# Jangan pernah mewarisi mode live atau base URL production dari shell pemanggil.
unset E2E_LIVE
unset PLAYWRIGHT_BASE_URL
export CI=1
export PLAYWRIGHT_BROWSERS_PATH="${BROWSERS}"

log "Menjalankan Playwright (chromium + mobile), hermetik di 9198/9199"
if ! npm run test:e2e -- --project=chromium --project=mobile; then
  gagal "E2E gagal. Reproduksi: cd ${DASHBOARD_DIR} && CI=1 PLAYWRIGHT_BROWSERS_PATH=${BROWSERS} npm run test:e2e -- --project=chromium --project=mobile"
fi

log "SELESAI: seluruh test E2E dashboard lulus."
