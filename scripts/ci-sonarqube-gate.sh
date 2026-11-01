#!/usr/bin/env bash
# scripts/ci-sonarqube-gate.sh — SonarQube SAST, Clippy import, CE wait, and Quality Gate enforcer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

WORKSPACE="${WORKSPACE:-$(pwd)}"
SONAR_HOST_URL="${SONAR_HOST_URL:-http://127.0.0.1:9000}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-autore-cli}"
SONAR_TOKEN="${SONAR_TOKEN:-}"
SONAR_SCANNER_IMAGE="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:12.3.0.4285_8.1.0@sha256:47956b669bf486bdad919e1cbd0533223515aa0b6d1d31763e5a3754942df6d7}"
RUST_IMAGE="${RUST_IMAGE:-clux/muslrust@sha256:15a72a4abf1c593b0bea63a4a8f20e95c1e5a0696d7051eca87b9b850b2d7e43}"
RUST_CACHE_DIR="${RUST_CACHE_DIR:-${HOME}/.cache/autore/rust-ci}"
CE_TASK_TIMEOUT="${CE_TASK_TIMEOUT:-300}"
CACERTS_MOUNT="${CACERTS_MOUNT:-}"

log() { printf '\n==> [SonarQube Gate] %s\n' "$*"; }

# Secret-safe curl invocation (token via stdin config, never in argv)
sonar_api_get() {
  local endpoint="$1"
  if [[ -n "${SONAR_TOKEN}" ]]; then
    printf 'header = "Authorization: Bearer %s"\nurl = "%s%s"\n' \
      "${SONAR_TOKEN}" "${SONAR_HOST_URL}" "${endpoint}" \
      | curl -fsS --max-time 15 --config -
  else
    curl -fsS --max-time 15 "${SONAR_HOST_URL}${endpoint}"
  fi
}

# ---------------------------------------------------------------------------
# 1. Preflight: Pastikan bahasa 'rust' terdaftar di server
# ---------------------------------------------------------------------------
log "1/5: Preflight check server & plugin bahasa di SonarQube..."
LANGUAGES_JSON="$(sonar_api_get "/api/languages/list")"
if ! grep -q '"key":"rust"' <<< "${LANGUAGES_JSON}"; then
  echo "ERROR: Server SonarQube (${SONAR_HOST_URL}) tidak memiliki plugin bahasa 'rust'" >&2
  exit 1
fi
log "Preflight LULUS: bahasa 'rust' terdaftar di server (catatan: ini preflight, belum bukti analisis kode)."

# ---------------------------------------------------------------------------
# 2. Clippy + lcov coverage di container Rust (toolchain host tidak dipakai)
# ---------------------------------------------------------------------------
# Sebelumnya `command -v cargo` gagal di agent Jenkins, sehingga script menulis
# clippy-report.json = "[]" (fallback) dan import clippy jadi tidak ada isinya.
log "2/5: Menjalankan clippy + cargo llvm-cov di container Rust terpin..."
CLIPPY_REPORT="${WORKSPACE}/clippy-report.json"
LCOV_FILE="${WORKSPACE}/lcov.info"
rm -f "${CLIPPY_REPORT}" "${LCOV_FILE}"

rust_tool() {
  local host_uid host_gid
  host_uid="$(id -u)"; host_gid="$(id -g)"
  docker run --rm \
    -e HOME=/tmp -e CARGO_HOME=/cargo \
    -e PATH="/cargo/bin:/opt/cargo/bin:/usr/local/bin:/usr/bin:/bin" \
    -e CARGO_TARGET_DIR=/cargo/target \
    -e HOST_UID="${host_uid}" -e HOST_GID="${host_gid}" \
    -v "${WORKSPACE}:/work" \
    -v "${RUST_CACHE_DIR}:/cargo" \
    -w /work \
    "${RUST_IMAGE}" bash -lc "$1"
}

if [[ -f "${WORKSPACE}/cli/Cargo.toml" ]]; then
  mkdir -p "${RUST_CACHE_DIR}"
  rust_tool '
    set -euo pipefail
    rustup component add clippy llvm-tools-preview >/dev/null 2>&1 || true
    if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
      echo "Memasang cargo-llvm-cov (sekali saja, tersimpan di cache volume)..."
      cargo install --locked cargo-llvm-cov >/dev/null 2>&1
    fi
    command -v cargo-llvm-cov >/dev/null 2>&1 || { echo "ERROR: cargo-llvm-cov tidak tersedia" >&2; exit 1; }
    command -v cargo-clippy >/dev/null 2>&1 || { echo "ERROR: komponen clippy tidak tersedia" >&2; exit 1; }

    echo "Menjalankan clippy (-D warnings)..."
    if ! cargo clippy --manifest-path cli/Cargo.toml --all-targets --message-format=json -- -D warnings > clippy-report.json 2> clippy-stderr.txt; then
      echo "ERROR: cargo clippy gagal (-D warnings). Ringkasan:" >&2
      tail -25 clippy-stderr.txt >&2
      exit 1
    fi
    # Build cache bisa membuat clippy tidak mengeluarkan apa pun; exit code 0
    # sudah membuktikan clippy jalan tanpa temuan.
    [[ -s clippy-report.json ]] || echo '[]' > clippy-report.json

    echo "Mengukur coverage (cargo llvm-cov, lcov)..."
    cargo llvm-cov --manifest-path cli/Cargo.toml --lcov --output-path lcov.info
    chown -R "${HOST_UID}:${HOST_GID}" /cargo /work/clippy-report.json /work/clippy-stderr.txt /work/lcov.info
  ' || { echo "ERROR: tahap clippy/coverage Rust gagal" >&2; exit 1; }
  [[ -s "${LCOV_FILE}" ]] || { echo "ERROR: ${LCOV_FILE} kosong — coverage tidak terukur" >&2; exit 1; }
  # lcov dari container memakai path absolut /work/...; Sonar membaca relatif
  # terhadap /usr/src sehingga tanpa ini semua baris dianggap tak terpetakan.
  sed -i "s|^SF:/work/|SF:|; s|^SF:${WORKSPACE}/|SF:|" "${LCOV_FILE}"
  log "Contoh path lcov: $(grep -m1 '^SF:' "${LCOV_FILE}")"
  log "Clippy report & lcov siap (clippy: $(wc -c < "${CLIPPY_REPORT}") byte, lcov: $(grep -c '^SF:' "${LCOV_FILE}") file)."
else
  echo "ERROR: ${WORKSPACE}/cli/Cargo.toml tidak ada — gerbang Rust tidak bisa dijalankan (dilarang lolos dengan laporan dummy)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Jalankan SonarScanner CLI (Digest Pinned, clippy.enabled=false)
# ---------------------------------------------------------------------------
log "3/5: Menjalankan SonarScanner CLI container..."
extra_mounts=()
if [[ -n "${CACERTS_MOUNT}" && -f "${CACERTS_MOUNT}" ]]; then
  extra_mounts+=(-v "${CACERTS_MOUNT}:/opt/java/openjdk/lib/security/cacerts:ro")
elif [[ -f "${REPO_ROOT}/sandbox/services/mitigated-cacerts" ]]; then
  extra_mounts+=(-v "${REPO_ROOT}/sandbox/services/mitigated-cacerts:/opt/java/openjdk/lib/security/cacerts:ro")
elif [[ -f "/usr/local/lib/autore-ci/mitigated-cacerts" ]]; then
  extra_mounts+=(-v "/usr/local/lib/autore-ci/mitigated-cacerts:/opt/java/openjdk/lib/security/cacerts:ro")
elif [[ -f "/home/tugure/Autore/sandbox/services/mitigated-cacerts" ]]; then
  extra_mounts+=(-v "/home/tugure/Autore/sandbox/services/mitigated-cacerts:/opt/java/openjdk/lib/security/cacerts:ro")
fi

export SONAR_TOKEN
docker run --rm \
  --network host \
  --user "$(id -u):$(id -g)" \
  -e SONAR_HOST_URL="${SONAR_HOST_URL}" \
  -e SONAR_TOKEN \
  -e SONAR_USER_HOME="/tmp/sonar-user-home-$(id -u)" \
  -v "${WORKSPACE}:/usr/src" \
  -w /usr/src \
  "${extra_mounts[@]}" \
  "${SONAR_SCANNER_IMAGE}" \
  -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
  -Dsonar.sources="." \
  -Dsonar.working.directory=/usr/src/.scannerwork \
  -Dsonar.rust.clippy.enabled=false \
  -Dsonar.rust.clippyReport.reportPaths=clippy-report.json \
  -Dsonar.rust.lcov.reportPaths=lcov.info

# ---------------------------------------------------------------------------
# 4. Polling Compute Engine Task hingga SUCCESS & Dapatkan analysisId
# ---------------------------------------------------------------------------
log "4/5: Membaca ceTaskId dan polling Compute Engine task..."
REPORT_TASK="${WORKSPACE}/.scannerwork/report-task.txt"
[[ -f "${REPORT_TASK}" ]] || { echo "ERROR: ${REPORT_TASK} tidak ditemukan" >&2; exit 1; }

CE_TASK_ID="$(grep -E '^ceTaskId=' "${REPORT_TASK}" | cut -d= -f2 | tr -d '\r\n')"
[[ -n "${CE_TASK_ID}" ]] || { echo "ERROR: ceTaskId tidak ditemukan di report-task.txt" >&2; exit 1; }

start_time=$(date +%s)
ANALYSIS_ID=""

while true; do
  task_resp="$(sonar_api_get "/api/ce/task?id=${CE_TASK_ID}")"
  status="$(python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('task', {}).get('status', ''))" <<< "${task_resp}")"
  
  if [[ "${status}" == "SUCCESS" ]]; then
    ANALYSIS_ID="$(python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('task', {}).get('analysisId', ''))" <<< "${task_resp}")"
    if [[ -z "${ANALYSIS_ID}" || "${ANALYSIS_ID}" == "None" ]]; then
      echo "ERROR: analysisId kosong setelah CE task SUCCESS" >&2
      exit 1
    fi
    log "Compute Engine task SUCCESS! analysisId: ${ANALYSIS_ID}"
    break
  elif [[ "${status}" == "FAILED" || "${status}" == "CANCELED" ]]; then
    echo "ERROR: Compute Engine task ${CE_TASK_ID} berstatus '${status}'" >&2
    exit 1
  fi

  now=$(date +%s)
  if (( now - start_time > CE_TASK_TIMEOUT )); then
    echo "ERROR: Timeout (> ${CE_TASK_TIMEOUT}s) menunggu CE task ${CE_TASK_ID}" >&2
    exit 1
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 5. Quality Gate via analysisId & Bukti Rust Measures (rust > 0)
# ---------------------------------------------------------------------------
log "5/5: Memeriksa Quality Gate via analysisId dan verifikasi ncloc Rust..."
QG_RESP="$(sonar_api_get "/api/qualitygates/project_status?analysisId=${ANALYSIS_ID}")"
QG_STATUS="$(python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('projectStatus', {}).get('status', ''))" <<< "${QG_RESP}")"

if [[ "${QG_STATUS}" != "OK" ]]; then
  echo "ERROR: Quality Gate SonarQube GAGAL! Status: ${QG_STATUS}" >&2
  exit 1
fi
log "Quality Gate LULUS (status: OK)!"

MEASURES_RESP="$(sonar_api_get "/api/measures/component?component=${SONAR_PROJECT_KEY}&metricKeys=ncloc,ncloc_language_distribution")"
rust_file_count=$(find "${WORKSPACE}" -name "*.rs" -not -path "*/target/*" 2>/dev/null | wc -l || echo 0)

if (( rust_file_count > 0 )); then
  rust_check="$(python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
measures = data.get('component', {}).get('measures', [])
rust_lines = 0
for m in measures:
    if m.get('metric') == 'ncloc_language_distribution':
        val = m.get('value', '')
        for part in val.split(';'):
            if '=' in part:
                lang, cnt = part.split('=', 1)
                if lang.strip().lower() == 'rust':
                    try:
                        rust_lines = int(cnt.strip())
                    except ValueError:
                        pass
print('OK' if rust_lines > 0 else 'FAIL')
" <<< "${MEASURES_RESP}")"

  if [[ "${rust_check}" != "OK" ]]; then
    echo "ERROR: Repositori mengandung kode Rust (${rust_file_count} file), tetapi metrik ncloc_language_distribution tidak memuat 'rust > 0'. Bukti analisis Rust tidak terpenuhi!" >&2
    exit 1
  fi
  log "Terbukti: native Rust analyzer SonarQube aktif dan menganalisis kode Rust (rust > 0)."
fi

log "SEMUA PEMERIKSAAN SONARQUBE & QUALITY GATE LULUS!"