#!/usr/bin/env bash
# scripts/test-ci-web-e2e.sh — kontrak hermetik untuk gate E2E Playwright.
#
# Tidak menjalankan Playwright, Next.js, atau jaringan: `playwright` di
# node_modules/.bin adalah stub dan browser hanya file palsu. Yang diuji adalah
# perilaku gate (prasyarat, argumen, env, lock, pembatalan), bukan suite E2E.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
TARGET="${TMP}/ci-web-e2e.sh"
cp "${ROOT}/scripts/ci-web-e2e.sh" "${TARGET}"
GAGAL=0

ok() { printf 'ok - %s\n' "$*"; }
fail() { printf 'not ok - %s\n' "$*" >&2; GAGAL=1; }
ada() { grep -Fqx -- "$2" "$1"; }

buat_workspace() {
  local ws="$1"
  mkdir -p "${ws}/web/apps/dashboard" "${ws}/web/node_modules/.bin" \
    "${ws}/browsers/chromium-9999/chrome-linux64"
  printf '{"name":"@autore/web","private":true}\n' > "${ws}/web/package.json"
  printf '{"name":"@autore/dashboard","scripts":{"test:e2e":"playwright test"}}\n' \
    > "${ws}/web/apps/dashboard/package.json"
  printf '#!/bin/sh\nexit 0\n' > "${ws}/browsers/chromium-9999/chrome-linux64/chrome"
  chmod 0755 "${ws}/browsers/chromium-9999/chrome-linux64/chrome"
  cp "${TMP}/stub-playwright" "${ws}/web/node_modules/.bin/playwright"
  chmod 0755 "${ws}/web/node_modules/.bin/playwright"
}

# Stub CLI Playwright: catat argumen + env, tahan bila PW_RELEASE belum ada,
# dan sengaja bertahan setelah SIGINT supaya teardown bisa disimulasikan.
cat > "${TMP}/stub-playwright" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >> "${PW_LOG:?}"
{
  printf 'CI=%s\n' "${CI:-}"
  printf 'E2E_LIVE=%s\n' "${E2E_LIVE:-}"
  printf 'PLAYWRIGHT_BASE_URL=%s\n' "${PLAYWRIGHT_BASE_URL:-}"
  printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "${PLAYWRIGHT_BROWSERS_PATH:-}"
  if [[ "$(ps -o sid= -p "$$" | tr -d ' ')" == "$$" ]]; then
    printf 'SESI_SENDIRI=ya\n'
  else
    printf 'SESI_SENDIRI=tidak\n'
  fi
} >> "${PW_ENV:?}"
if [[ -n "${CANCEL_PROBE:-}" ]]; then
  trap 'printf "INT\n" >> "${CANCEL_PROBE}/signal"' INT
  printf '%s\n' "${PPID}" > "${CANCEL_PROBE}/gate-pid"
fi
if [[ -n "${PW_RELEASE:-}" ]]; then
  deadline=$((SECONDS + 15))
  until [[ -e "${PW_RELEASE}" ]]; do
    (( SECONDS < deadline )) || exit 99
    sleep 0.05
  done
fi
if [[ -n "${PW_SIGNAL:-}" ]]; then
  kill -"${PW_SIGNAL}" "$$"
  sleep 2
fi
exit "${PW_EXIT:-0}"
STUB

jalankan() {
  local ws="$1" pw_exit="${2:-0}" out="$3" browsers="${4:-${ws}/browsers}"
  local log="${5:-${TMP}/pw}"
  local cancel_probe="${CANCEL_PROBE:-}"
  : > "${log}.log"
  : > "${log}.env"
  ( cd "${ws}" \
      && CANCEL_PROBE="${cancel_probe}" \
         PW_LOG="${log}.log" \
         PW_ENV="${log}.env" \
         PW_EXIT="${pw_exit}" \
         PW_SIGNAL="${PW_SIGNAL:-}" \
         E2E_LIVE=1 \
         PLAYWRIGHT_BASE_URL="http://100.80.3.14:9120" \
         WORKSPACE="${ws}" \
         PLAYWRIGHT_BROWSERS_PATH="${browsers}" \
         bash "${TARGET}" ) > "${out}" 2>&1
}

# 1. Jalur sukses: argumen project, CI=1, env produksi dibuang, sesi sendiri.
ws="${TMP}/ws-sukses"
buat_workspace "${ws}"
rc=0
jalankan "${ws}" 0 "${TMP}/out-sukses" || rc=$?
if [[ "${rc}" -eq 0 ]]; then
  ok "exit 0 saat Playwright sukses"
else
  fail "exit ${rc}, harus 0"
  cat "${TMP}/out-sukses" >&2
fi
if ada "${TMP}/pw.log" 'test --project=chromium --project=mobile'; then
  ok "argumen playwright + dua project"
else
  fail "argumen playwright salah: $(tr '\n' '|' < "${TMP}/pw.log")"
fi
if ada "${TMP}/pw.env" 'CI=1'; then
  ok "CI=1 diteruskan"
else
  fail "CI bukan 1: $(tr '\n' '|' < "${TMP}/pw.env")"
fi
if ada "${TMP}/pw.env" 'E2E_LIVE='; then
  ok "E2E_LIVE dibuang"
else
  fail "E2E_LIVE masih ada: $(tr '\n' '|' < "${TMP}/pw.env")"
fi
if ada "${TMP}/pw.env" 'PLAYWRIGHT_BASE_URL='; then
  ok "PLAYWRIGHT_BASE_URL production dibuang"
else
  fail "PLAYWRIGHT_BASE_URL masih ada: $(tr '\n' '|' < "${TMP}/pw.env")"
fi
if ada "${TMP}/pw.env" "PLAYWRIGHT_BROWSERS_PATH=${ws}/browsers"; then
  ok "PLAYWRIGHT_BROWSERS_PATH diteruskan"
else
  fail "PLAYWRIGHT_BROWSERS_PATH salah: $(tr '\n' '|' < "${TMP}/pw.env")"
fi
if ada "${TMP}/pw.env" 'SESI_SENDIRI=ya'; then
  ok "Playwright berjalan di sesi sendiri"
else
  fail "Playwright tidak punya sesi sendiri"
fi

# 2. Playwright gagal: gate ikut gagal, bukan menelan error.
ws="${TMP}/ws-gagal"
buat_workspace "${ws}"
rc=0
jalankan "${ws}" 1 "${TMP}/out-gagal" || rc=$?
if [[ "${rc}" -eq 1 ]]; then
  ok "exit 1 saat Playwright gagal"
else
  fail "exit ${rc}, harus 1"
fi
if grep -Fq 'E2E gagal' "${TMP}/out-gagal"; then
  ok "pesan kegagalan E2E jelas"
else
  fail "pesan kegagalan tidak memuat 'E2E gagal'"
  cat "${TMP}/out-gagal" >&2
fi

# 2b. Abort Jenkins menyapu proses Playwright dengan SIGTERM: gate harus
# melaporkan pembatalan, bukan kegagalan generik.
ws="${TMP}/ws-terbunuh"
buat_workspace "${ws}"
rc=0
PW_SIGNAL=TERM jalankan "${ws}" 0 "${TMP}/out-terbunuh" || rc=$?
if [[ "${rc}" -eq 1 ]] && grep -Fq 'E2E dibatalkan' "${TMP}/out-terbunuh"; then
  ok "SIGTERM ke Playwright dilaporkan sebagai pembatalan"
else
  fail "SIGTERM ke Playwright bukan pembatalan (exit ${rc})"
  cat "${TMP}/out-terbunuh" >&2
fi

# 3. Browser hilang: gagal sebelum Playwright, beri petunjuk setup.
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
if [[ ! -s "${TMP}/pw.log" ]]; then
  ok "Playwright tidak dipanggil saat browser hilang"
else
  fail "Playwright terlanjur dipanggil: $(tr '\n' '|' < "${TMP}/pw.log")"
fi

# 4. CLI Playwright hilang: gagal dengan pesan jelas, bukan error samar.
ws="${TMP}/ws-tanpa-playwright"
buat_workspace "${ws}"
rm -f "${ws}/web/node_modules/.bin/playwright"
rc=0
jalankan "${ws}" 0 "${TMP}/out-tanpa-playwright" || rc=$?
if [[ "${rc}" -eq 1 ]] && grep -Fq 'Playwright tidak ada' "${TMP}/out-tanpa-playwright" \
   && [[ ! -s "${TMP}/pw.log" ]]; then
  ok "CLI Playwright hilang ditolak sebelum jalan"
else
  fail "CLI Playwright hilang tidak ditolak dengan pesan yang benar"
  cat "${TMP}/out-tanpa-playwright" >&2
fi

# 5. Repo non-web: gagal terang-terangan kalau stage memanggil skrip ini.
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

# 6. node_modules belum ada: stage 5 harus jalan dulu.
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

# 7. Dua workspace memakai lock runner yang sama, termasuk saat A gagal.
#    Wrapper ini hanya memendekkan durasi setelah memvalidasi argumen asli;
#    mutasi `-w 601`, `-s`, atau tanpa `-E 75` harus membuat tes gagal.
export FLOCK_BIN="$(command -v flock)"
cat > "${TMP}/flock" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 6 || $1 != -x || $2 != -w || $3 != 600 || $4 != -E || $5 != 75 || $6 != 9 ]]; then
  printf 'argumen flock tidak sesuai kontrak: %s\n' "$*" >&2
  exit 2
fi
if [[ -n "${LOCK_TEST_TIMEOUT:-}" ]]; then
  export LC_ALL=C  # util-linux mem-parse durasi pecahan menurut locale.
  set -- "$1" "$2" "${LOCK_TEST_TIMEOUT}" "${@:4}"
fi
if [[ -n "${LOCK_CONTENDED:-}" ]]; then
  if "${FLOCK_BIN}" -x -n -E "$5" "$6"; then
    exit 0
  else
    [[ $? -eq "$5" ]] || exit 2
  fi
  printf 'busy\n' > "${LOCK_CONTENDED}"
fi
exec "${FLOCK_BIN}" "$@"
STUB
chmod 0755 "${TMP}/flock"

nunggu() {
  local deadline=$((SECONDS + 6))
  until [[ -s "$1" || -s "${2:-/dev/null}" ]]; do
    (( SECONDS < deadline )) || return 1
    sleep 0.05
  done
}

buat_workspace "${TMP}/a"
buat_workspace "${TMP}/b"
PATH="${TMP}:${PATH}" PW_RELEASE="${TMP}/release" jalankan "${TMP}/a" 1 "${TMP}/out-a" "" "${TMP}/pw-a" &
a=$!
nunggu "${TMP}/pw-a.log" || fail "A belum masuk Playwright"

rc=0
PATH="${TMP}:${PATH}" LOCK_TEST_TIMEOUT=0.1 jalankan "${TMP}/b" 0 "${TMP}/out-timeout" "" "${TMP}/pw-timeout" || rc=$?
if [[ "${rc}" -ne 0 && ! -s "${TMP}/pw-timeout.log" ]] && grep -Fq 'Timeout menunggu lock E2E' "${TMP}/out-timeout"; then
  ok "timeout lock menolak gate sebelum Playwright"
else
  fail "timeout lock tidak menolak gate sebelum Playwright"
fi

PATH="${TMP}:${PATH}" LOCK_CONTENDED="${TMP}/lock-busy" jalankan "${TMP}/b" 0 "${TMP}/out-b" "" "${TMP}/pw-b" &
b=$!
if nunggu "${TMP}/lock-busy" "${TMP}/pw-b.log" && [[ ! -s "${TMP}/pw-b.log" ]]; then
  ok "workspace B antre saat A masih di Playwright"
else
  fail "workspace B tidak antre saat A masih di Playwright"
fi
: > "${TMP}/release"
rc=0
wait "${a}" || rc=$?
if [[ "${rc}" -eq 1 ]] && wait "${b}" && [[ -s "${TMP}/pw-b.log" ]]; then
  ok "workspace B jalan setelah A gagal dan melepas lock"
else
  fail "workspace B tidak jalan setelah A gagal"
fi

# 8. Pembatalan tidak boleh melepas lock selama teardown Playwright berjalan.
probe="${TMP}/cancel"
mkdir "${probe}"
buat_workspace "${TMP}/c"
buat_workspace "${TMP}/d"
PATH="${TMP}:${PATH}" CANCEL_PROBE="${probe}" PW_RELEASE="${probe}/release" \
  jalankan "${TMP}/c" 0 "${TMP}/out-cancel-c" "" "${probe}/pw-c" &
c=$!
if nunggu "${probe}/gate-pid" && read -r gate_pid < "${probe}/gate-pid" && kill -TERM "${gate_pid}"; then
  if nunggu "${probe}/signal"; then
    ok "SIGTERM gate diteruskan ke Playwright sebagai SIGINT"
  else
    fail "Playwright tidak menerima SIGINT"
  fi
  PATH="${TMP}:${PATH}" LOCK_CONTENDED="${probe}/busy" jalankan "${TMP}/d" 0 "${TMP}/out-cancel-d" "" "${probe}/pw-d" &
  d=$!
  if nunggu "${probe}/busy" && [[ -s "${probe}/busy" ]] && kill -TERM "${gate_pid}"; then
    rc=0
    PATH="${TMP}:${PATH}" LOCK_TEST_TIMEOUT=0.1 jalankan "${TMP}/d" 0 "${TMP}/out-cancel-timeout" "" "${probe}/pw-timeout" || rc=$?
    if [[ "${rc}" -ne 0 && ! -s "${probe}/pw-timeout.log" && ! -s "${probe}/pw-d.log" ]] \
       && grep -Fq 'Timeout menunggu lock E2E' "${TMP}/out-cancel-timeout"; then
      ok "SIGTERM kedua tidak melepas lock saat teardown"
    else
      fail "lock lepas sebelum teardown Playwright selesai"
    fi
  else
    fail "gate tidak bertahan saat dibatalkan atau D tidak antre"
  fi
  : > "${probe}/release"
  rc=0
  wait "${c}" || rc=$?
  if [[ "${rc}" -ne 0 ]] && wait "${d}" && [[ -s "${probe}/pw-d.log" ]]; then
    ok "A batal dengan exit nonzero dan D jalan setelah teardown"
  else
    fail "exit A ${rc} atau D tidak jalan setelah pembatalan"
  fi
else
  : > "${probe}/release"
  wait "${c}" || true
  fail "tidak bisa membatalkan gate A"
fi

if [[ "${GAGAL}" -ne 0 ]]; then
  printf '\nGAGAL: ada kasus kontrak yang tidak lulus.\n' >&2
  exit 1
fi
printf '\nOK: semua kasus kontrak ci-web-e2e.sh lulus.\n'