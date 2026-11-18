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
trap 'rm -rf "${TMP}"' EXIT
mkdir -p "${TMP}/bin" "${TMP}/cache"
export PATH="${TMP}/bin:${PATH}"
export URUTAN_LOG="${TMP}/urutan.log"

# --- stub docker: catat awal/akhir tahap Rust; urutan log jadi bukti antre ---
cat > "${TMP}/bin/docker" <<'EOS'
#!/usr/bin/env bash
args="$*"
if [[ "${args}" == *":/work"* ]]; then
  ws="$(sed -n 's/.*-v \([^ ]*\):\/work.*/\1/p' <<< "${args}")"
  echo "mulai rust" >> "${URUTAN_LOG}"
  sleep "${RUST_SLEEP:-3}"
  printf '[]' > "${ws}/clippy-report.json"
  printf 'SF:/work/cli/src/main.rs\nDA:1,1\n' > "${ws}/lcov.info"
  echo "selesai rust" >> "${URUTAN_LOG}"
elif [[ "${args}" == *":/usr/src"* ]]; then
  ws="$(sed -n 's/.*-v \([^ ]*\):\/usr\/src.*/\1/p' <<< "${args}")"
  mkdir -p "${ws}/.scannerwork"
  printf 'ceTaskId=uji\n' > "${ws}/.scannerwork/report-task.txt"
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

# --- stub flock: validasi opsi gate, percepat batas tunggu bila diminta ---
# Stub bernama sama tanpa validasi membuat mutasi gate (mis. lock dihapus)
# tetap hijau, jadi opsi yang tak terduga harus FAIL di sini.
cat > "${TMP}/bin/flock" <<'EOS'
#!/usr/bin/env bash
opts=("$@")
if [[ "${opts[0]:-}" != "-x" || "${opts[1]:-}" != "-w" || "${opts[2]:-}" != "900" \
      || "${opts[3]:-}" != "-E" || "${opts[4]:-}" != "75" ]]; then
  echo "stub flock: opsi tak terduga: $*" >&2
  exit 99
fi
exec /usr/bin/flock -x -w "${FAKE_LOCK_WAIT:-900}" -E 75 "${opts[@]:5}"
EOS
chmod +x "${TMP}/bin/docker" "${TMP}/bin/curl" "${TMP}/bin/flock"

buat_repo_rust() {
  mkdir -p "$1/cli/src"
  : > "$1/cli/Cargo.toml"
  echo 'fn main() {}' > "$1/cli/src/main.rs"
}

# Kasus 1: dua gate paralel, cache sama -> harus antre, bukan tumpang tindih.
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
  if [[ "$(tr '\n' '|' < "${URUTAN_LOG}")" == "mulai rust|selesai rust|mulai rust|selesai rust|" ]]; then
    ok "urutan build bersambung (selesai sebelum mulai berikutnya)"
  else
    not_ok "urutan build bersambung: $(tr '\n' '|' < "${URUTAN_LOG}")"
  fi
  grep -qh 'Menunggu lock cache Rust' "${TMP}/a.log" "${TMP}/b.log" && ok "pesan tunggu lock muncul" || not_ok "pesan tunggu lock muncul"
}

# Kasus 2: lock dipegang proses lain -> gagal cepat dengan pesan jelas.
case2() {
  local a="${TMP}/ws-a" rc=0
  buat_repo_rust "${a}"
  : > "${URUTAN_LOG}"
  export RUST_CACHE_DIR="${TMP}/cache"
  touch "${TMP}/cache.lock"
  /usr/bin/flock -x "${TMP}/cache.lock" sleep 4 & local hold=$!
  sleep 0.2
  FAKE_LOCK_WAIT=1 WORKSPACE="${a}" bash "${TARGET}" > "${TMP}/lock.log" 2>&1 || rc=$?
  wait "${hold}"
  [[ ${rc} -eq 1 ]] && ok "gate berhenti (exit 1) saat lock sibuk" || not_ok "gate berhenti saat lock sibuk (exit ${rc})"
  grep -qh 'Menunggu lock cache Rust' "${TMP}/lock.log" && ok "pesan tunggu lock sebelum gagal" || not_ok "pesan tunggu lock sebelum gagal"
  grep -qh 'tidak didapat dalam 900 detik' "${TMP}/lock.log" && ok "pesan gagal menyebut batas 900 detik" || not_ok "pesan gagal menyebut batas 900 detik"
  grep -q 'mulai rust' "${URUTAN_LOG}" && not_ok "tahap Rust tidak dijalankan tanpa lock" || ok "tahap Rust tidak dijalankan tanpa lock"
}

# Kasus 3: repo tanpa cli/Cargo.toml -> tidak boleh mengunci apa pun.
case3() {
  local c="${TMP}/ws-c" rc=0
  mkdir -p "${c}"
  export RUST_CACHE_DIR="${TMP}/cache"
  touch "${TMP}/cache.lock"
  /usr/bin/flock -x "${TMP}/cache.lock" sleep 4 & local hold=$!
  sleep 0.2
  FAKE_LOCK_WAIT=1 WORKSPACE="${c}" bash "${TARGET}" > "${TMP}/norepo.log" 2>&1 || rc=$?
  wait "${hold}"
  [[ ${rc} -eq 1 ]] && grep -q 'cli/Cargo.toml tidak ada' "${TMP}/norepo.log" \
    && ok "repo non-Rust berhenti dengan pesan lama" || not_ok "repo non-Rust berhenti dengan pesan lama"
  grep -q 'Menunggu lock' "${TMP}/norepo.log" && not_ok "repo non-Rust tidak menyentuh lock" || ok "repo non-Rust tidak menyentuh lock"
}

case1
case2
case3

if (( FAIL > 0 )); then
  echo "GAGAL: ${FAIL} kasus gugur, ${PASS} lulus"
  exit 1
fi

echo "OK: semua kasus kontrak ci-sonarqube-gate.sh lulus."
