#!/usr/bin/env bash
# scripts/test-deploy-web.sh — kontrak penjaga scripts/deploy-web.sh.
#
# Tidak membangun Next.js dan tidak menyentuh dashboard sungguhan: setiap uji
# berhenti di penjaga sebelum build. Repo tiruan dibuat di direktori sementara.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKRIP="${ROOT}/scripts/deploy-web.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
REPO="${TMP}/repo"
LOCK="${TMP}/lock"
GAGAL=0

ok() { printf 'ok - %s\n' "$*"; }
fail() { printf 'not ok - %s\n' "$*" >&2; GAGAL=1; }

mkdir -p "${REPO}/web/apps/dashboard" "${REPO}/cli"
printf '[package]\nname = "autore"\nversion = "9.9.9"\n' >"${REPO}/cli/Cargo.toml"
git -C "${REPO}" init -q
git -C "${REPO}" add -A
git -C "${REPO}" -c user.email=t@t -c user.name=t commit -qm init
# `git pull --ff-only` harus lulus di repo tiruan, jadi sediakan origin yang nyata.
git init -q --bare "${TMP}/origin.git"
git -C "${REPO}" remote add origin "${TMP}/origin.git"
git -C "${REPO}" push -q -u origin HEAD

# Setiap penolakan harus menyebut sebabnya, bukan bocoran perintah lain.
# tolak <label> <pola pesan> <ENV=nilai|-> [argumen skrip...]
tolak() {
  local label="$1" pola="$2" envs="$3" keluar
  shift 3
  local -a tambahan=()
  [ "${envs}" != "-" ] && tambahan+=("${envs}")
  if keluar=$(env AUTORE_REPO="${REPO}" AUTORE_WEB_LOCK="${LOCK}" "${tambahan[@]}" \
    bash "${SKRIP}" "$@" 2>&1); then
    fail "${label}: skrip keluar 0"
  elif grep -q -- "${pola}" <<<"${keluar}"; then
    ok "${label}"
  else
    fail "${label}: keluaran tidak memuat '${pola}': ${keluar@Q}"
  fi
}

tolak "argumen asing ditolak" "tidak menerima argumen" - percobaan
tolak "build dipaksa gagal berhenti sebelum tukar" "dipaksa gagal" \
  AUTORE_WEB_BUILD_FORCE_FAIL=1

printf '\n' >>"${REPO}/cli/Cargo.toml"
tolak "pohon kotor ditolak" "kotor" -
git -C "${REPO}" checkout -- cli/Cargo.toml

# Deploy kedua saat kunci dipegang: menolak, bukan menunggu.
bash -c "exec 9>\"${LOCK}\"; flock 9; sleep 5" &
PEMEGANG=$!
sleep 0.5
tolak "kunci dipegang run lain ditolak" "deploy lain masih berjalan" -
kill "${PEMEGANG}" 2>/dev/null || true
wait "${PEMEGANG}" 2>/dev/null || true

# Kunci yang dilepas pemegang mati tidak menahan run berikutnya.
if keluar=$(env AUTORE_REPO="${REPO}" AUTORE_WEB_LOCK="${LOCK}" bash "${SKRIP}" --help 2>&1); then
  grep -q "Bangun ulang dashboard" <<<"${keluar}" \
    && ok "--help berjalan setelah kunci dilepas" \
    || fail "--help tidak mencetak ringkasan: ${keluar@Q}"
else
  fail "--help gagal setelah kunci dilepas: ${keluar@Q}"
fi

printf 'dashboard: %s\n' "$([ "${GAGAL}" -eq 0 ] && echo 'semua uji lulus' || echo 'ADA YANG GAGAL')"
exit "${GAGAL}"
