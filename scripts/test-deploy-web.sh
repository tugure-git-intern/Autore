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

# Alur tukar direktori diuji dengan build palsu: `npm run build:dashboard` diganti
# skrip yang membuat distDir dari AUTORE_NEXT_DIST, jadi tidak ada Next.js nyata.
# Ini menangkap kelas bug "build menulis ke A, mv mencari B".
jalur() { mkdir -p "${REPO}/web/apps/dashboard/$1" && printf 'x\n' >"${REPO}/web/apps/dashboard/$1/penanda"; }

# 1) Jalur bahagia: `.next` lama -> `.next-lama` -> dibuang, `.next-baru` jadi `.next`.
jalur .next
mkdir -p "${REPO}/web"

# `systemctl` diganti stub (tak ada unit nyata di uji ini) dan server probe
# dinyalakan sungguhan di port acak, supaya `hidup` benar-benar memeriksa socket.
mkdir -p "${TMP}/bin"
printf '#!/usr/bin/env bash\nexit 0\n' >"${TMP}/bin/systemctl"
chmod +x "${TMP}/bin/systemctl"
PORT_UJI=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
python3 -m http.server "${PORT_UJI}" --bind 127.0.0.1 >/dev/null 2>&1 &
HTTP=$!
trap 'kill ${HTTP} 2>/dev/null; rm -rf "${TMP}"' EXIT
sleep 1
deploy() { env PATH="${TMP}/bin:${PATH}" AUTORE_REPO="${REPO}" AUTORE_WEB_LOCK="${LOCK}" \
  AUTORE_WEB_PORT="${PORT_UJI}" bash "${SKRIP}" "$@"; }

printf '{"name":"@autore/web","private":true,"scripts":{"build:dashboard":"bash ./build-palsu.sh"}}\n' >"${REPO}/web/package.json"
printf '{"name":"@autore/dashboard","scripts":{}}\n' \
  >"${REPO}/web/apps/dashboard/package.json"
cat >"${REPO}/web/build-palsu.sh" <<'PALSU'
d="apps/dashboard/${AUTORE_NEXT_DIST:?distDir kosong}"
mkdir -p "$d" && printf 'baru\n' >"$d/penanda"
PALSU
git -C "${REPO}" add -A
git -C "${REPO}" -c user.email=t@t -c user.name=t commit -qm "build palsu"

if keluar=$(deploy 2>&1); then
  if [ -f "${REPO}/web/apps/dashboard/.next/penanda" ] \
    && grep -qx baru "${REPO}/web/apps/dashboard/.next/penanda" \
    && [ ! -d "${REPO}/web/apps/dashboard/.next-baru" ] \
    && [ ! -d "${REPO}/web/apps/dashboard/.next-lama" ]; then
    ok "build baru menggantikan .next dan sisa dibersihkan"
  else
    fail "hasil tukar salah: $(ls -d "${REPO}"/web/apps/dashboard/.next* 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')"
  fi
else
  fail "deploy jalur bahagia gagal: ${keluar@Q}"
fi

# 2) Build yang tidak menghasilkan distDir harus berhenti sebelum menyentuh `.next`.
printf '#!/usr/bin/env bash\nexit 0\n' >"${REPO}/web/build-palsu.sh"
git -C "${REPO}" -c user.email=t@t -c user.name=t commit -qam "build tanpa keluaran"
if keluar=$(deploy 2>&1); then
  fail "build tanpa keluaran seharusnya gagal"
elif grep -q "tidak ada" <<<"${keluar}" \
  && [ -f "${REPO}/web/apps/dashboard/.next/penanda" ] \
  && grep -qx baru "${REPO}/web/apps/dashboard/.next/penanda"; then
  ok "build tanpa keluaran tidak merusak .next"
else
  fail "build tanpa keluaran: ${keluar@Q}"
fi

printf 'dashboard: %s\n' "$([ "${GAGAL}" -eq 0 ] && echo 'semua uji lulus' || echo 'ADA YANG GAGAL')"
exit "${GAGAL}"
