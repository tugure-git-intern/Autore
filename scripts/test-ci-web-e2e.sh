#!/usr/bin/env bash
# scripts/test-ci-web-e2e.sh — kontrak hermetik untuk gate E2E Playwright.
#
# Tidak menjalankan Playwright, Next.js, atau jaringan: `npm` adalah stub dan
# browser hanya file palsu. Yang diuji adalah perilaku gate (argumen, env,
# fail-closed saat prasyarat hilang), bukan suite E2E itu sendiri.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${ROOT}/scripts/ci-web-e2e.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
GAGAL=0

ok() { printf 'ok - %s\n' "$*"; }
fail() { printf 'not ok - %s\n' "$*" >&2; GAGAL=1; }

mkdir -p "${TMP}/bin"
cat > "${TMP}/bin/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${NPM_LOG:?}"
printf 'CI=%s\n' "${CI:-}" >> "${NPM_ENV:?}"
printf 'E2E_LIVE=%s\n' "${E2E_LIVE:-}" >> "${NPM_ENV:?}"
printf 'PLAYWRIGHT_BASE_URL=%s\n' "${PLAYWRIGHT_BASE_URL:-}" >> "${NPM_ENV:?}"
printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "${PLAYWRIGHT_BROWSERS_PATH:-}" >> "${NPM_ENV:?}"
exit "${NPM_EXIT:-0}"
STUB
chmod 0755 "${TMP}/bin/npm"

buat_workspace() {
  local ws="$1"
  mkdir -p "${ws}/web/apps/dashboard" "${ws}/web/node_modules" "${ws}/browsers/chromium-9999/chrome-linux64"
  printf '{"name":"@autore/web","private":true}\n' > "${ws}/web/package.json"
  printf '{"name":"@autore/dashboard","scripts":{"test:e2e":"playwright test"}}\n' > "${ws}/web/apps/dashboard/package.json"
  printf '#!/bin/sh\nexit 0\n' > "${ws}/browsers/chromium-9999/chrome-linux64/chrome"
  chmod 0755 "${ws}/browsers/chromium-9999/chrome-linux64/chrome"
}

jalankan() {
  local ws="$1" npm_exit="${2:-0}" out="$3" browsers="${4:-${ws}/browsers}"
  : > "${TMP}/npm.log"
  : > "${TMP}/npm.env"
  ( cd "${ws}" \
      && PATH="${TMP}/bin:${PATH}" \
         NPM_LOG="${TMP}/npm.log" \
         NPM_ENV="${TMP}/npm.env" \
         NPM_EXIT="${npm_exit}" \
         E2E_LIVE=1 \
         PLAYWRIGHT_BASE_URL="http://100.80.3.14:9120" \
         WORKSPACE="${ws}" \
         PLAYWRIGHT_BROWSERS_PATH="${browsers}" \
         bash "${TARGET}" ) > "${out}" 2>&1
}

# 1. Jalur sukses: argumen project, CI=1, E2E_LIVE dibuang.
ws="${TMP}/ws-sukses"
buat_workspace "${ws}"
rc=0
jalankan "${ws}" 0 "${TMP}/out-sukses" || rc=$?
if [[ "${rc}" -eq 0 ]]; then
  ok "exit 0 saat npm sukses"
else
  fail "exit ${rc}, harus 0"
  cat "${TMP}/out-sukses" >&2
fi
if grep -Fqx 'run test:e2e -- --project=chromium --project=mobile' "${TMP}/npm.log"; then
  ok "argumen test:e2e + dua project"
else
  fail "argumen npm salah: $(tr '\n' '|' < "${TMP}/npm.log")"
fi
if grep -Fqx 'CI=1' "${TMP}/npm.env"; then
  ok "CI=1 diteruskan"
else
  fail "CI bukan 1: $(tr '\n' '|' < "${TMP}/npm.env")"
fi
if grep -Fqx 'E2E_LIVE=' "${TMP}/npm.env"; then
  ok "E2E_LIVE dibuang"
else
  fail "E2E_LIVE masih ada: $(tr '\n' '|' < "${TMP}/npm.env")"
fi
if grep -Fqx 'PLAYWRIGHT_BASE_URL=' "${TMP}/npm.env"; then
  ok "PLAYWRIGHT_BASE_URL production dibuang"
else
  fail "PLAYWRIGHT_BASE_URL masih ada: $(tr '\n' '|' < "${TMP}/npm.env")"
fi
if grep -Fqx "PLAYWRIGHT_BROWSERS_PATH=${ws}/browsers" "${TMP}/npm.env"; then
  ok "PLAYWRIGHT_BROWSERS_PATH diteruskan"
else
  fail "PLAYWRIGHT_BROWSERS_PATH salah: $(tr '\n' '|' < "${TMP}/npm.env")"
fi

# 2. npm gagal: gate ikut gagal, bukan menelan error.
ws="${TMP}/ws-gagal"
buat_workspace "${ws}"
rc=0
jalankan "${ws}" 1 "${TMP}/out-gagal" || rc=$?
if [[ "${rc}" -eq 1 ]]; then
  ok "exit 1 saat npm gagal"
else
  fail "exit ${rc}, harus 1"
fi
if grep -Fq 'E2E gagal' "${TMP}/out-gagal"; then
  ok "pesan kegagalan E2E jelas"
else
  fail "pesan kegagalan tidak memuat 'E2E gagal'"
  cat "${TMP}/out-gagal" >&2
fi

# 3. Browser hilang: gagal sebelum npm, beri petunjuk setup.
ws="${TMP}/ws-tanpa-browser"
buat_workspace "${ws}"
rm -rf "${ws}/browsers"
rc=0
jalankan "${ws}" 0 "${TMP}/out-tanpa-browser" "${ws}/tanpa-browser" || rc=$?
if [[ "${rc}" -eq 1 ]]; then
  ok "exit 1 saat browser hilang"
else
  fail "exit ${rc}, harus 1"
fi
if grep -Fq 'Chromium Playwright' "${TMP}/out-tanpa-browser"; then
  ok "pesan browser hilang menyebut Chromium Playwright"
else
  fail "pesan browser tidak jelas"
  cat "${TMP}/out-tanpa-browser" >&2
fi
if [[ ! -s "${TMP}/npm.log" ]]; then
  ok "npm tidak dipanggil saat browser hilang"
else
  fail "npm terlanjur dipanggil: $(tr '\n' '|' < "${TMP}/npm.log")"
fi

# 4. Repo non-web: gagal terang-terangan kalau stage memanggil skrip ini.
ws="${TMP}/ws-non-web"
buat_workspace "${ws}"
rm -f "${ws}/web/package.json"
rc=0
jalankan "${ws}" 0 "${TMP}/out-non-web" || rc=$?
if [[ "${rc}" -eq 1 ]] && grep -Fq 'web/package.json' "${TMP}/out-non-web"; then
  ok "repo non-web ditolak dengan pesan web/package.json"
else
  fail "repo non-web tidak ditolak dengan pesan yang benar"
  cat "${TMP}/out-non-web" >&2
fi

# 5. node_modules belum ada: stage 5 harus jalan dulu.
ws="${TMP}/ws-tanpa-node-modules"
buat_workspace "${ws}"
rm -rf "${ws}/web/node_modules"
rc=0
jalankan "${ws}" 0 "${TMP}/out-tanpa-node-modules" || rc=$?
if [[ "${rc}" -eq 1 ]] && grep -Fq 'node_modules' "${TMP}/out-tanpa-node-modules"; then
  ok "node_modules hilang ditolak dengan pesan jelas"
else
  fail "node_modules hilang tidak ditolak dengan pesan yang benar"
  cat "${TMP}/out-tanpa-node-modules" >&2
fi

if [[ "${GAGAL}" -ne 0 ]]; then
  printf '\nGAGAL: ada kasus kontrak yang tidak lulus.\n' >&2
  exit 1
fi
printf '\nOK: semua kasus kontrak ci-web-e2e.sh lulus.\n'
