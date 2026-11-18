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
PLAYWRIGHT="${WEB_DIR}/node_modules/.bin/playwright"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-/opt/autore/ms-playwright}"

log() { printf '\n==> [E2E Regression Gate] %s\n' "$*"; }
gagal() { printf '\n[GAGAL] %s\n' "$*" >&2; exit 1; }

[[ -f "${WEB_DIR}/package.json" ]] || gagal "web/package.json tidak ada di ${WORKSPACE} — gate E2E hanya untuk repo web."
[[ -d "${WEB_DIR}/node_modules" ]] || gagal "web/node_modules tidak ada — stage 5 (Web Quality Gate) harus lulus lebih dulu."
[[ -f "${DASHBOARD_DIR}/package.json" ]] || gagal "web/apps/dashboard/package.json tidak ada — workspace dashboard tidak lengkap."
[[ -x "${PLAYWRIGHT}" ]] || gagal "Playwright tidak ada di ${PLAYWRIGHT}; jalankan npm ci di web lebih dulu."

# Channel chromium memakai browser penuh (bukan headless-shell). Path mengikuti
# PLAYWRIGHT_BROWSERS_PATH; chrome-linux64/chrome-linux tergantung versi.
if ! compgen -G "${BROWSERS}/chromium-*/chrome-linux*/chrome" >/dev/null; then
  gagal "Chromium Playwright tidak ada di ${BROWSERS}. Jalankan runner/setup-agent.sh di runner, atau set PLAYWRIGHT_BROWSERS_PATH ke cache browser yang sudah terpasang."
fi

# Lock direktori tepercaya agar semua workspace di runner berbagi lock yang
# sama, termasuk setelah skrip diganti. Tidak perlu izin tulis di runner.
LOCK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)" || gagal "Tidak bisa menentukan direktori lock E2E."
if ! { exec 9<"${LOCK_DIR}"; }; then
  gagal "Tidak bisa membuka direktori lock E2E: ${LOCK_DIR}"
fi

cd "${DASHBOARD_DIR}"

# Jangan pernah mewarisi mode live atau base URL production dari shell pemanggil.
unset E2E_LIVE
unset PLAYWRIGHT_BASE_URL
export CI=1
export PLAYWRIGHT_BROWSERS_PATH="${BROWSERS}"

log "Menunggu lock E2E runner (maks. 600 detik)"
flock -x -w 600 -E 75 9 || {
  [[ "$?" -ne 75 ]] || gagal "Timeout menunggu lock E2E setelah 600 detik."
  gagal "Tidak bisa mengambil lock E2E di ${LOCK_DIR}."
}

log "Menjalankan Playwright (chromium + mobile), hermetik di 9198/9199"
# Playwright dijalankan di sesi sendiri: SIGTERM ke grup gate (abort Jenkins)
# tidak boleh mematikannya sebelum teardown webServer selesai. Gate memegang
# fd 9 sampai CLI benar-benar keluar, jadi job lain tetap antre.
status=0
anak=0
dibatalkan=0
teruskan() {
  trap '' INT TERM
  dibatalkan=1
  if [[ "${anak}" -ne 0 ]]; then
    kill -INT "${anak}" 2>/dev/null || true
  fi
}
trap teruskan INT TERM
setsid env --default-signal=INT "${PLAYWRIGHT}" test --project=chromium --project=mobile 9<&- &
anak=$!
if [[ "${dibatalkan}" -ne 0 ]]; then
  kill -INT "${anak}" 2>/dev/null || true
fi
wait "${anak}" || status=$?
# Trap bisa memutus `wait` walau CLI belum keluar; ulangi sampai benar-benar selesai.
while kill -0 "${anak}" 2>/dev/null; do
  wait "${anak}" 2>/dev/null || status=$?
done
trap - INT TERM

if [[ "${status}" -eq 0 && "${dibatalkan}" -eq 0 ]]; then
  log "SELESAI: seluruh test E2E dashboard lulus."
  exit 0
fi
if [[ "${dibatalkan}" -ne 0 || "${status}" -eq 130 || "${status}" -eq 143 ]]; then
  gagal "E2E dibatalkan sebelum selesai (sinyal abort diteruskan ke Playwright; exit ${status})."
fi
gagal "E2E gagal (exit ${status}). Reproduksi: jalankan ${LOCK_DIR}/${BASH_SOURCE[0]##*/} dari ${WORKSPACE}."
