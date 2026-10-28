#!/usr/bin/env bash
# security-check.sh — DevSecOps Security Gate for Autore CI/CD pipeline.
#
# Runs three checks before any image is built or deployed:
#   1. Static Dangerous Code & Dockerfile Guard (instant local check)
#   2. Gitleaks Secret Scanner (via Docker container, --no-git --redact)
#   3. Trivy Vulnerability & Misconfig Scanner (via Docker container, CRITICAL)
#
# When a check fails, the human-readable reason is written to
# "$WORKSPACE/.security-gate-reason" so notify-telegram.sh can include it.

set -euo pipefail

WORKSPACE="${WORKSPACE:-$(pwd)}"
APP_DIR="${APP_DIR:-sandbox/dummy-app}"
TARGET_DIR="${WORKSPACE}/${APP_DIR}"
REASON_FILE="${WORKSPACE}/.security-gate-reason"

rm -f "${REASON_FILE}"

log() { printf '\n==> [Security Gate] %s\n' "$*"; }

fail_gate() {
  local reason="$1"
  printf '%s\n' "${reason}" > "${REASON_FILE}"
  printf '\n🚫 [SECURITY GATE BLOCKED] %s\n' "${reason}" >&2
  exit 1
}

[[ -d "${TARGET_DIR}" ]] || fail_gate "Direktori aplikasi '${APP_DIR}' tidak ditemukan"

# ---------------------------------------------------------------------------
# 1. Static Dangerous Code & Dockerfile Guard
# ---------------------------------------------------------------------------
log "Lapis 1/3: Memeriksa pola kode berbahaya & konfigurasi Dockerfile..."

shopt -s nullglob
code_files=()
for f in "${TARGET_DIR}"/*.py "${TARGET_DIR}"/*.js "${TARGET_DIR}"/*.sh; do
  base="$(basename "$f")"
  [[ "${base}" == test_* ]] && continue
  [[ "${base}" == *_test.* ]] && continue
  code_files+=("$f")
done
shopt -u nullglob

if [[ ${#code_files[@]} -gt 0 ]]; then
  declare -A dangerous_patterns=(
    ["os.system()"]='os\.system[[:space:]]*\('
    ["eval()"]='eval[[:space:]]*\('
    ["exec()"]='exec[[:space:]]*\('
    ["subprocess shell=True"]='shell[[:space:]]*=[[:space:]]*True'
  )
  for label in "${!dangerous_patterns[@]}"; do
    regex="${dangerous_patterns[$label]}"
    if match=$(grep -nE "${regex}" "${code_files[@]}" 2>/dev/null | head -1); then
      file_line="${match%%:*}"
      fail_gate "Terdeteksi fungsi berbahaya (${label}) pada $(basename "${file_line}")"
    fi
  done

  # Hardcoded secret / token patterns (redacted in output)
  secret_regex='(ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----|(PASSWORD|SECRET|API_KEY|PRIVATE_KEY|BOT_TOKEN)[[:space:]]*=[[:space:]]*['\''"][^'\''"]{6,}['\''"])'
  if match=$(grep -nE "${secret_regex}" "${code_files[@]}" 2>/dev/null | head -1); then
    file_only="$(basename "${match%%:*}")"
    fail_gate "Terdeteksi kredensial/secret tertulis langsung (hardcoded) di dalam ${file_only}"
  fi
fi

if [[ -f "${TARGET_DIR}/Dockerfile" ]]; then
  # Check that the final stage of the Dockerfile specifies a non-root USER
  last_from_line=$(grep -nE '^[[:space:]]*FROM[[:space:]]+' "${TARGET_DIR}/Dockerfile" | tail -1 | cut -d: -f1)
  last_user=$(tail -n +"${last_from_line:-1}" "${TARGET_DIR}/Dockerfile" | grep -E '^[[:space:]]*USER[[:space:]]+' | tail -1 | awk '{print $2}' || true)
  if [[ -z "${last_user}" || "${last_user}" == "root" || "${last_user}" == "0" ]]; then
    fail_gate "Dockerfile wajib menggunakan non-root USER pada stage akhir"
  fi
fi

log "Lapis 1/3: LULUS (tidak ada pola berbahaya pada source code & Dockerfile)."

if [[ "${SECURITY_SKIP_DOCKER:-0}" == "1" ]]; then
  log "Mode test lokal (SECURITY_SKIP_DOCKER=1): melewati pemindaian container Gitleaks & Trivy."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Gitleaks Secret Scan (Docker Container)
# ---------------------------------------------------------------------------
log "Lapis 2/3: Menjalankan Gitleaks Secret Scanner (Docker)..."
if ! docker run --rm \
  -v "${WORKSPACE}:/repo:ro" \
  zricethezav/gitleaks:v8.21.2 \
  detect --source="/repo" --no-git --redact -v; then
  fail_gate "Gitleaks mendeteksi kebocoran Secret / API Key / Password di dalam repositori"
fi
log "Lapis 2/3: LULUS (tidak ada secret bocor)."

# ---------------------------------------------------------------------------
# 3. Trivy Vulnerability & Misconfiguration Scan (Docker Container)
# ---------------------------------------------------------------------------
log "Lapis 3/3: Menjalankan Trivy Vulnerability & Misconfig Scanner (Docker)..."
if ! docker run --rm \
  -v "${WORKSPACE}:/repo:ro" \
  -v trivy-cache:/root/.cache/ \
  aquasec/trivy:0.58.1 fs \
  --scanners vuln,misconfig \
  --skip-check-update \
  --severity CRITICAL \
  --exit-code 1 \
  "/repo/${APP_DIR}"; then
  fail_gate "Trivy mendeteksi celah keamanan CRITICAL atau salah konfigurasi pada ${APP_DIR}"
fi
log "Lapis 3/3: LULUS (tidak ada celah keamanan CRITICAL)."

log "SEMUA PEMERIKSAAN KEAMANAN LULUS!"
