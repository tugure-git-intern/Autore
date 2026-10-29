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
# 2. Ekspor Laporan Clippy Host (sonar.rust.clippy.enabled=false + import report)
# ---------------------------------------------------------------------------
log "2/5: Menjalankan cargo clippy dan mengekspor clippy-report.json..."
CLIPPY_REPORT="${WORKSPACE}/clippy-report.json"
rm -f "${CLIPPY_REPORT}"

if command -v cargo >/dev/null 2>&1 && [[ -f "${WORKSPACE}/cli/Cargo.toml" || -f "${WORKSPACE}/Cargo.toml" ]]; then
  manifest_arg=()
  if [[ -f "${WORKSPACE}/cli/Cargo.toml" ]]; then
    manifest_arg=(--manifest-path "${WORKSPACE}/cli/Cargo.toml")
  fi
  cargo clippy --all-targets --message-format=json -- -D warnings "${manifest_arg[@]}" > "${CLIPPY_REPORT}"
elif [[ ! -f "${CLIPPY_REPORT}" ]]; then
  # Fallback dummy JSON report for testing if cargo not present
  echo '[]' > "${CLIPPY_REPORT}"
fi
log "Clippy report siap di: ${CLIPPY_REPORT}"

# ---------------------------------------------------------------------------
# 3. Jalankan SonarScanner CLI (Digest Pinned, clippy.enabled=false)
# ---------------------------------------------------------------------------
log "3/5: Menjalankan SonarScanner CLI container..."
extra_mounts=()
if [[ -n "${CACERTS_MOUNT}" && -f "${CACERTS_MOUNT}" ]]; then
  extra_mounts+=(-v "${CACERTS_MOUNT}:/opt/java/openjdk/lib/security/cacerts:ro")
elif [[ -f "${REPO_ROOT}/sandbox/services/mitigated-cacerts" ]]; then
  extra_mounts+=(-v "${REPO_ROOT}/sandbox/services/mitigated-cacerts:/opt/java/openjdk/lib/security/cacerts:ro")
fi

docker run --rm \
  -e SONAR_HOST_URL="${SONAR_HOST_URL}" \
  -e SONAR_TOKEN="${SONAR_TOKEN}" \
  -v "${WORKSPACE}:/usr/src" \
  "${extra_mounts[@]}" \
  "${SONAR_SCANNER_IMAGE}" \
  -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
  -Dsonar.sources="." \
  -Dsonar.rust.clippy.enabled=false \
  -Dsonar.rust.clippyReport.reportPaths=clippy-report.json

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
