#!/usr/bin/env bash
# notify-telegram.sh — Laporan audit CI/CD & DevSecOps transparan tanpa emoji ke Telegram & log Jenkins.
set -euo pipefail

WORKSPACE="${WORKSPACE:-$(pwd)}"
BUILD_STATUS="${BUILD_STATUS:-UNKNOWN}"
APP_NAME="${APP_NAME:-autore-dummy}"
APP_PORT="${APP_PORT:-8000}"
DEPLOY_PORT="${DEPLOY_PORT:-8081}"
BUILD_NUMBER="${BUILD_NUMBER:-0}"
GIT_BRANCH="${GIT_BRANCH:-main}"
FULL_GIT_COMMIT="${FULL_GIT_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
SHORT_SHA="${SHORT_SHA:-${FULL_GIT_COMMIT:0:7}}"
AUDIT_AUTHOR="${AUDIT_AUTHOR:-$(git log -1 --pretty='%an <%ae>' 2>/dev/null || echo unknown)}"
AUDIT_MESSAGE="${AUDIT_MESSAGE:-$(git log -1 --pretty=%s 2>/dev/null || echo -)}"
AUDIT_CAUSES="${AUDIT_CAUSES:-SCM / Manual Trigger}"
NODE_NAME="${NODE_NAME:-vps-runner-1}"
IMAGE_TAG="${IMAGE_TAG:-build-${BUILD_NUMBER}-commit-${FULL_GIT_COMMIT}}"
IMMUTABLE_IMAGE_TAG="${IMMUTABLE_IMAGE_TAG:-127.0.0.1:5000/${APP_NAME}:${IMAGE_TAG}}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-autore-cli}"
JOB_NAME_SAFE="${JOB_NAME:-autore-e2e}"
FAILED_STAGE="${FAILED_STAGE:--}"
REASON_FILE="${WORKSPACE}/.security-gate-reason"
TIMESTAMP="$(TZ='Asia/Jakarta' date '+%Y-%m-%d %H:%M:%S WIB')"

GATE_REASON=""
if [[ -f "${REASON_FILE}" ]]; then
  GATE_REASON="$(cat "${REASON_FILE}")"
fi

VERIFIED_DIGEST="Belum tersedia (tahap publish belum tercapai)"
if [[ -f "${WORKSPACE}/.verified-image-digest" ]]; then
  VERIFIED_DIGEST="$(tr -d '\r\n' < "${WORKSPACE}/.verified-image-digest")"
fi

BIN_SHA256="Tidak berlaku (repo non-CLI)"
if [[ -f "${WORKSPACE}/dist/SHA256SUMS" ]]; then
  BIN_SHA256="$(head -n 1 "${WORKSPACE}/dist/SHA256SUMS" | awk '{print $1 " (" $2 ")"}')"
fi

SBOM_INFO="Belum dibuat"
if [[ -f "${WORKSPACE}/dist/sbom.cdx.json" ]]; then
  SBOM_BYTES="$(wc -c < "${WORKSPACE}/dist/sbom.cdx.json" | tr -d ' ')"
  SBOM_INFO="dist/sbom.cdx.json (${SBOM_BYTES} bytes, CycloneDX)"
fi

STAGES=(
  "1. Checkout & Audit Metadata"
  "2. Autore Static Guard & Gitleaks"
  "3. Trivy Source & Config Scan"
  "4. Clippy & SonarQube SAST Gate"
  "5. Build Image & Static musl Binary"
  "6. Trivy Final Image Scan & SBOM"
  "7. Verify Checksums"
  "8. Push to Nexus & Verify Remote Digest"
  "9. Deploy by Verified Digest"
)

STAGE_SUMMARY=""
failed_seen=0
for st in "${STAGES[@]}"; do
  if [[ "${BUILD_STATUS}" == "SUCCESS" ]]; then
    mark="[LULUS]   "
  elif [[ "${st}" == "${FAILED_STAGE}" ]]; then
    mark="[GAGAL]   "
    failed_seen=1
  elif [[ "${failed_seen}" -eq 1 ]]; then
    mark="[DILEWATI]"
  elif [[ "${FAILED_STAGE}" == "-" ]]; then
    mark="[CEK LOG] "
  else
    mark="[LULUS]   "
  fi
  STAGE_SUMMARY="${STAGE_SUMMARY}${mark} ${st}
"
done

if [[ "${BUILD_STATUS}" == "SUCCESS" ]]; then
  STATUS_LABEL="SUKSES (DEPLOYED & VERIFIED)"
  OUTCOME_SECTION="--- BUKTI ARTIFACT & DEPLOYMENT ---
Image Tag       : ${IMMUTABLE_IMAGE_TAG}
Verified Digest : ${VERIFIED_DIGEST}
Binary SHA-256  : ${BIN_SHA256}
SBOM Artifact   : ${SBOM_INFO}
Health Check    : HTTP 200 OK (http://127.0.0.1:${DEPLOY_PORT}/health)"
else
  STATUS_LABEL="GAGAL / DIBLOKIR (FAIL-CLOSED)"
  if [[ -n "${GATE_REASON}" ]]; then
    REASON_TEXT="${GATE_REASON}"
  else
    REASON_TEXT="Proses dihentikan pada tahap '${FAILED_STAGE}' (periksa log konsol Jenkins)"
  fi
  OUTCOME_SECTION="--- DETAIL PENOLAKAN KEAMANAN / PIPELINE ---
Tahap Berhenti  : ${FAILED_STAGE}
Alasan Blokir   : ${REASON_TEXT}
Digest Terakhir : ${VERIFIED_DIGEST}
Tindakan Sistem : Deployment dibatalkan otomatis (container produksi lama tetap berjalan)"
fi

REPORT_TEXT="[AUTORE CI/CD AUDIT REPORT]
========================================================
Status          : ${STATUS_LABEL}
Build           : #${BUILD_NUMBER} (${JOB_NAME_SAFE})
Waktu           : ${TIMESTAMP}
Runner          : ${NODE_NAME}
Pemicu          : ${AUDIT_CAUSES}

--- IDENTITAS PERUBAHAN ---
Aplikasi        : ${APP_NAME} (127.0.0.1:${DEPLOY_PORT} -> container:${APP_PORT})
Branch          : ${GIT_BRANCH}
Commit SHA      : ${FULL_GIT_COMMIT}
Commit Pendek   : ${SHORT_SHA}
Penulis         : ${AUDIT_AUTHOR}
Pesan Commit    : ${AUDIT_MESSAGE}

--- STATUS 9 GERBANG KEAMANAN (FAIL-CLOSED) ---
${STAGE_SUMMARY%$'\n'}

${OUTCOME_SECTION}

--- TAUTAN AUDIT TRANSPARAN ---
Jenkins Log     : http://100.80.3.14:8080/job/${JOB_NAME_SAFE}/${BUILD_NUMBER}/console
SonarQube SAST  : http://100.80.3.14:9000/dashboard?id=${SONAR_PROJECT_KEY}
Nexus Registry  : http://100.80.3.14:8082/#browse/browse:autore-releases
========================================================"

printf '\n%s\n' "${REPORT_TEXT}"

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  if [[ ! "${TELEGRAM_CHAT_ID}" =~ ^-?[0-9]+$ ]]; then
    printf 'WARNING: TELEGRAM_CHAT_ID tidak valid (harus numerik); batal mengirim.\n' >&2
    exit 0
  fi
  printf '==> Mengirim laporan ke Bot Telegram (chat_id: %s)...\n' "${TELEGRAM_CHAT_ID}"
  if printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "${TELEGRAM_BOT_TOKEN}" \
    | curl -fsS --max-time 15 --config - -X POST \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${REPORT_TEXT}" >/dev/null; then
    printf '==> Laporan Telegram berhasil terkirim!\n'
  else
    printf 'WARNING: Gagal mengirim pesan ke API Telegram (cek token/chat_id).\n' >&2
  fi
elif [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  printf '==> Info: TELEGRAM_CHAT_ID wajib diset secara eksplisit di Jenkins Credentials (telegram-chat-id).\n'
  printf '==> Demi keamanan, auto-discovery getUpdates dinonaktifkan.\n'
else
  printf '==> Info: Kredensial Telegram (telegram-bot-token & telegram-chat-id) belum diset di Jenkins.\n'
  printf '==> Laporan tetap tercatat penuh di log audit di atas.\n'
fi
