#!/usr/bin/env bash
# scripts/test-ci-sonarqube-gate.sh — kontrak antrean cache Rust pada gate SonarQube.
# Dua job Jenkins membangun repo yang sama dan berbagi RUST_CACHE_DIR; tanpa
# lock, satu build menghapus binary tes yang sedang dipakai build lain
# ("never executed ... os error 2"). Uji ini menjalankan gate dengan stub
# docker/curl/flock, tanpa SonarQube maupun Docker nyata.
set -uo pipefail

TARGET="${TARGET:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ci-sonarqube-gate.sh}"
PASS=0
FAIL=0
ok() { echo "ok - $*"; PASS=$((PASS + 1)); }
not_ok() { echo "not ok - $*"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
trap 'chmod -R u+rwX "${TMP}" 2>/dev/null; rm -rf "${TMP}"' EXIT
mkdir -p "${TMP}/bin" "${TMP}/cache"
export PATH="${TMP}/bin:${PATH}"
export URUTAN_LOG="${TMP}/urutan.log"

# --- stub docker: catat waktu mulai/selesai tahap Rust dan scanner ---
cat > "${TMP}/bin/docker" <<'EOS'
#!/usr/bin/env bash
args="$*"
if [[ "${args}" == *":/work"* ]]; then
  ws="$(sed -n 's/.*-v \([^ ]*\):\/work.*/\1/p' <<< "${args}")"
  echo "mulai rust $(date +%s%3N)" >> "${URUTAN_LOG}"
  sleep "${RUST_SLEEP:-3}"
  printf '[]' > "${ws}/clippy-report.json"
  printf 'SF:/work/cli/src/main.rs\nDA:1,1\n' > "${ws}/lcov.info"
  echo "selesai rust $(date +%s%3N)" >> "${URUTAN_LOG}"
elif [[ "${args}" == *":/usr/src"* ]]; then
  ws="$(sed -n 's/.*-v \([^ ]*\):\/usr\/src.*/\1/p' <<< "${args}")"
  echo "mulai scan $(date +%s%3N)" >> "${URUTAN_LOG}"
  sleep "${SCAN_SLEEP:-3}"
  mkdir -p "${ws}/.scannerwork"
  printf 'ceTaskId=uji\n' > "${ws}/.scannerwork/report-task.txt"
  echo "selesai scan $(date +%s%3N)" >> "${URUTAN_LOG}"
fi
exit 0
EOS

# --- stub curl: balasan SonarQube tetap, tanpa jaringan ---
cat > "${TMP}/bin/curl" <<'EOS'
#!/usr/bin/env bash
url="${!#}"
case "${url}" in
  */api/languages/list) printf '{"languages":[{"key":"rust"}]}' ;;
  */api/ce/task*) printf '{"task":{"status":"SUCCESS","analysisId":"a1"}}' ;;
  */api/qualitygates/project_status*) printf '{"projectStatus":{"status":"OK"}}' ;;
  */api/measures/component*) printf '{"component":{"measures":[{"metric":"ncloc_language_distribution","value":"rust=42"}]}}' ;;
  *) printf '{}' ;;
esac
EOS

# --- stub flock: validasi bentuk panggilan gate, percepat batas tunggu ---
# Stub bernama sama tanpa validasi membuat mutasi gate (mis. lock dihapus)
# tetap hijau, jadi bentuk panggilan yang tak terduga harus FAIL di sini.
cat > "${TMP}/bin/flock" <<'EOS'
#!/usr/bin/env bash
opts=("$@")
if [[ "${opts[0]:-}" == "-x" && "${opts[1]:-}" == "-n" && "${opts[2]:-}" == "9" ]]; then
  exec /usr/bin/flock -x -n 9
fi
if [[ "${opts[0]:-}" == "-x" && "${opts[1]:-}" == "-w" && "${opts[2]:-}" =~ ^[0-9]+$ \
      && "${opts[3]:-}" == "-E" && "${opts[4]:-}" == "75" && "${opts[5]:-}" == "9" ]]; then
  exec /usr/bin/flock -x -w "${FAKE_LOCK_WAIT:-${opts[2]}}" -E 75 9
fi
echo "stub flock: bentuk panggilan tak terduga: $*" >&2
exit 99
EOS
chmod +x "${TMP}/bin/docker" "${TMP}/bin/curl" "${TMP}/bin/flock"

buat_repo_rust() {
  mkdir -p "$1/cli/src"
  : > "$1/cli/Cargo.toml"
  echo 'fn main() {}' > "$1/cli/src/main.rs"
}

# Kasus 1: dua gate paralel, cache sama -> antre di tahap Rust saja, lalu
# lock dilepas supaya scanner/CE/quality gate kedua build tetap paralel.
case1() {
  local a="${TMP}/ws-a" b="${TMP}/ws-b" ra=0 rb=0
  buat_repo_rust "${a}"
  buat_repo_rust "${b}"
  : > "${URUTAN_LOG}"
  export RUST_CACHE_DIR="${TMP}/cache"
  WORKSPACE="${a}" bash "${TARGET}" > "${TMP}/a.log" 2>&1 & local pa=$!
  WORKSPACE="${b}" bash "${TARGET}" > "${TMP}/b.log" 2>&1 & local pb=$!
  wait "${pa}" || ra=$?
  wait "${pb}" || rb=$?

  [[ ${ra} -eq 0 && ${rb} -eq 0 ]] && ok "dua gate paralel hijau" || not_ok "dua gate paralel hijau (exit ${ra}/${rb})"

  local rust_seq; rust_seq="$(awk '$2=="rust"{print $1" "$2}' "${URUTAN_LOG}" | sed 's/ [0-9]*$//' | tr '\n' '|')"
  [[ "${rust_seq}" == "mulai rust|selesai rust|mulai rust|selesai rust|" ]] \
    && ok "tahap Rust bersambung (selesai sebelum mulai berikutnya)" \
    || not_ok "tahap Rust bersambung: $(tr '\n' '|' < "${URUTAN_LOG}")"

  local rust2 scan1
  rust2="$(awk '$1=="mulai" && $2=="rust"{n++; if (n==2) print $3}' "${URUTAN_LOG}")"
  scan1="$(awk '$1=="selesai" && $2=="scan"{print $3; exit}' "${URUTAN_LOG}")"
  [[ -n "${rust2}" && -n "${scan1}" && "${rust2}" -lt "${scan1}" ]] \
    && ok "lock dilepas sebelum scanner (build kedua mulai Rust saat scanner pertama jalan)" \
    || not_ok "lock dilepas sebelum scanner (mulai rust#2=${rust2:-kosong}, selesai scan#1=${scan1:-kosong})"

  local waits; waits="$(cat "${TMP}/a.log" "${TMP}/b.log" | grep -c 'Menunggu lock cache Rust')"
  [[ "${waits}" -eq 1 ]] && ok "pesan tunggu hanya muncul di build yang benar-benar menunggu" \
    || not_ok "pesan tunggu muncul ${waits} kali (harus 1)"
}

# Kasus 2: lock dipegang proses lain -> berhenti dengan exit 75 dan pesan jelas.
case2() {
  local a="${TMP}/ws-a" rc=0
  buat_repo_rust "${a}"
  : > "${URUTAN_LOG}"
  export RUST_CACHE_DIR="${TMP}/cache"
  mkdir -p "${TMP}/cache.lock"
  /usr/bin/flock -x "${TMP}/cache.lock" sleep 4 & local hold=$!
  sleep 0.2
  FAKE_LOCK_WAIT=1 WORKSPACE="${a}" bash "${TARGET}" > "${TMP}/lock.log" 2>&1 || rc=$?
  wait "${hold}"
  [[ ${rc} -eq 75 ]] && ok "gate berhenti dengan exit 75 saat lock sibuk" || not_ok "gate berhenti dengan exit 75 saat lock sibuk (exit ${rc})"
  grep -qh 'Menunggu lock cache Rust' "${TMP}/lock.log" && ok "pesan tunggu lock sebelum gagal" || not_ok "pesan tunggu lock sebelum gagal"
  grep -qh 'tidak didapat dalam 900 detik' "${TMP}/lock.log" && ok "pesan gagal menyebut batas 900 detik" || not_ok "pesan gagal menyebut batas 900 detik"
  grep -q 'mulai rust' "${URUTAN_LOG}" && not_ok "tahap Rust tidak dijalankan tanpa lock" || ok "tahap Rust tidak dijalankan tanpa lock"
}

# Kasus 3: repo tanpa cli/Cargo.toml -> tidak boleh mengunci apa pun.
case3() {
  local c="${TMP}/ws-c" rc=0
  mkdir -p "${c}"
  export RUST_CACHE_DIR="${TMP}/cache"
  mkdir -p "${TMP}/cache.lock"
  /usr/bin/flock -x "${TMP}/cache.lock" sleep 4 & local hold=$!
  sleep 0.2
  FAKE_LOCK_WAIT=1 WORKSPACE="${c}" bash "${TARGET}" > "${TMP}/norepo.log" 2>&1 || rc=$?
  wait "${hold}"
  [[ ${rc} -eq 1 ]] && grep -q 'cli/Cargo.toml tidak ada' "${TMP}/norepo.log" \
    && ok "repo non-Rust berhenti dengan pesan lama" || not_ok "repo non-Rust berhenti dengan pesan lama"
  grep -q 'Menunggu lock' "${TMP}/norepo.log" && not_ok "repo non-Rust tidak menyentuh lock" || ok "repo non-Rust tidak menyentuh lock"
}

# Kasus 4: direktori induk cache tidak bisa ditulisi -> pesan jelas, bukan
# error mentah dari bash, dan tidak menjalankan tahap Rust tanpa lock.
case4() {
  local a="${TMP}/ws-a" rc=0
  buat_repo_rust "${a}"
  : > "${URUTAN_LOG}"
  mkdir -p "${TMP}/ro/cache"
  export RUST_CACHE_DIR="${TMP}/ro/cache"
  chmod 555 "${TMP}/ro"
  WORKSPACE="${a}" bash "${TARGET}" > "${TMP}/ro.log" 2>&1 || rc=$?
  chmod 755 "${TMP}/ro"
  [[ ${rc} -eq 1 ]] && grep -q 'tidak bisa menyiapkan lock cache Rust' "${TMP}/ro.log" \
    && ok "lock tak bisa disiapkan -> pesan jelas dan exit 1" \
    || not_ok "lock tak bisa disiapkan -> pesan jelas dan exit 1 (exit ${rc})"
  grep -q 'mulai rust' "${URUTAN_LOG}" && not_ok "tahap Rust tidak dijalankan tanpa lock" || ok "tahap Rust tidak dijalankan tanpa lock"
}

case1
case2
case3
case4

if (( FAIL > 0 )); then
  echo "GAGAL: ${FAIL} kasus gugur, ${PASS} lulus"
  exit 1
fi

echo "OK: semua kasus kontrak ci-sonarqube-gate.sh lulus."
