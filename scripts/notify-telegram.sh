#!/usr/bin/env bash
# notify-telegram.sh — Kirim laporan audit CI/CD ringkas (parse_mode=HTML) ke Telegram
# dan cetak hash lengkap di log konsol Jenkins.
set -euo pipefail

html_escape() {
  printf '%s' "${1:-}" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

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
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-autore-cli}"
JOB_NAME_SAFE="${JOB_NAME:-autore-e2e}"
FAILED_STAGE="${FAILED_STAGE:--}"
# Pipeline mencatat tahap yang sedang dicoba, jadi pada build sukses nilainya
# masih terisi tahap terakhir. Tidak ada tahap gagal kalau statusnya SUCCESS.
if [[ "${BUILD_STATUS}" == "SUCCESS" ]]; then
  FAILED_STAGE="-"
fi
REASON_FILE="${WORKSPACE}/.security-gate-reason"
TIMESTAMP="$(TZ='Asia/Jakarta' date '+%Y-%m-%d %H:%M:%S WIB')"

GATE_REASON=""
if [[ -f "${REASON_FILE}" ]]; then
  GATE_REASON="$(cat "${REASON_FILE}")"
fi

FULL_DIGEST="belum-tersedia"
SHORT_DIGEST="belum dibuat (diblokir sebelum publish)"
if [[ -f "${WORKSPACE}/.verified-image-digest" ]]; then
  FULL_DIGEST="$(tr -d '\r\n' < "${WORKSPACE}/.verified-image-digest")"
  DIGEST_HEX="${FULL_DIGEST#*@sha256:}"
  SHORT_DIGEST="sha256:${DIGEST_HEX:0:12}"
fi

FULL_BIN_SHA="tidak-berlaku"
SHORT_BIN_SHA="n/a"
if [[ -f "${WORKSPACE}/dist/SHA256SUMS" ]]; then
  FULL_BIN_SHA="$(head -n 1 "${WORKSPACE}/dist/SHA256SUMS" | awk '{print $1}')"
  SHORT_BIN_SHA="${FULL_BIN_SHA:0:12}"
fi

SBOM_SHORT="belum dibuat (diblokir sebelum image scan)"
if [[ -f "${WORKSPACE}/dist/sbom.cdx.json" ]]; then
  SBOM_KB="$(( ($(wc -c < "${WORKSPACE}/dist/sbom.cdx.json" | tr -d ' ') + 1023) / 1024 ))KB"
  SBOM_SHORT="dist/sbom.cdx.json (${SBOM_KB})"
fi

SHORT_IMAGE_TAG="${APP_NAME}:build-${BUILD_NUMBER}-${SHORT_SHA}"

# Escape semua nilai dinamis untuk HTML Telegram
E_APP="$(html_escape "${APP_NAME}")"
E_BUILD="$(html_escape "${BUILD_NUMBER}")"
E_TIME="$(html_escape "${TIMESTAMP}")"
E_RUNNER="$(html_escape "${NODE_NAME}")"
E_CAUSE="$(html_escape "${AUDIT_CAUSES}")"
E_BRANCH="$(html_escape "${GIT_BRANCH}")"
E_SHA="$(html_escape "${SHORT_SHA}")"
E_AUTHOR="$(html_escape "${AUDIT_AUTHOR}")"
E_MSG="$(html_escape "${AUDIT_MESSAGE}")"
E_STAGE="$(html_escape "${FAILED_STAGE}")"
E_IMG_TAG="$(html_escape "${SHORT_IMAGE_TAG}")"
E_DIGEST="$(html_escape "${SHORT_DIGEST}")"
E_BIN_SHA="$(html_escape "${SHORT_BIN_SHA}")"
E_SBOM="$(html_escape "${SBOM_SHORT}")"

JENKINS_URL="http://100.80.3.14:8080/job/${JOB_NAME_SAFE}/${BUILD_NUMBER}/console"
SONAR_URL="http://100.80.3.14:9000/dashboard?id=${SONAR_PROJECT_KEY}"
NEXUS_URL="http://100.80.3.14:8082/#browse/browse:autore-releases"

if [[ "${BUILD_STATUS}" == "SUCCESS" ]]; then
  HEADLINE="✅ <b>AUTORE CI/CD — ${E_APP} (SUKSES)</b>"
  SECURITY_BLOCK="<b>Keamanan</b>
✅ 9/9 gerbang lolos (Static, Gitleaks, Trivy FS/Image, SonarQube, SBOM, SHA256, Nexus ALLOW_ONCE, Digest)"
  EVIDENCE_BLOCK="<b>Bukti</b>
• Image: <code>${E_IMG_TAG}</code>
• Digest: <code>${E_DIGEST}</code>
• Binary SHA: <code>${E_BIN_SHA}</code> (<code>autore-linux-x86_64-musl</code>)
• SBOM: <code>${E_SBOM}</code>
• Health: <code>HTTP 200 OK</code> (<code>127.0.0.1:${DEPLOY_PORT}/health</code>)"
else
  HEADLINE="❌ <b>AUTORE CI/CD — ${E_APP} (GAGAL)</b>"
  if [[ -n "${GATE_REASON}" ]]; then
    RAW_REASON="${GATE_REASON}"
  else
    RAW_REASON="Proses berhenti pada tahap '${FAILED_STAGE}' (cek Jenkins Log)"
  fi
  E_REASON="$(html_escape "${RAW_REASON}")"
  SECURITY_BLOCK="<b>Keamanan</b>
❌ Gagal pada tahap: <code>${E_STAGE}</code>
• Alasan: ${E_REASON}
• Tindakan: Deployment dibatalkan otomatis (container lama tetap aman)"
  EVIDENCE_BLOCK="<b>Bukti</b>
• Image: <code>${E_IMG_TAG}</code>
• Digest: <code>${E_DIGEST}</code>
• SBOM: <code>${E_SBOM}</code>"
fi

TELEGRAM_HTML="${HEADLINE}
Build <code>#${E_BUILD}</code> • ${E_TIME} • Runner <code>${E_RUNNER}</code>

<b>Perubahan</b>
• Branch: <code>${E_BRANCH}</code> (<code>${E_SHA}</code>)
• Penulis: ${E_AUTHOR}
• Pesan: ${E_MSG}
• Pemicu: ${E_CAUSE}

${SECURITY_BLOCK}

${EVIDENCE_BLOCK}

<b>Tautan</b>
<a href=\"${JENKINS_URL}\">Jenkins Log</a> • <a href=\"${SONAR_URL}\">SonarQube</a> • <a href=\"${NEXUS_URL}\">Nexus</a>"

# Pastikan di bawah batas 4096 karakter Telegram
if (( ${#TELEGRAM_HTML} > 4000 )); then
  TELEGRAM_HTML="${TELEGRAM_HTML:0:3990}..."
fi

# Cetak hash lengkap di Jenkins console log untuk jejak audit penuh
printf '\n================ LAPORAN AUDIT JENKINS (HASH LENGKAP) ================\n'
printf 'Status          : %s\n' "${BUILD_STATUS}"
printf 'Aplikasi        : %s (Build #%s)\n' "${APP_NAME}" "${BUILD_NUMBER}"
printf 'Pelaku          : %s\n' "${AUDIT_AUTHOR}"
printf 'Commit Full SHA : %s ("%s")\n' "${FULL_GIT_COMMIT}" "${AUDIT_MESSAGE}"
printf 'Tahap Gagal     : %s\n' "${FAILED_STAGE}"
if [[ -n "${GATE_REASON}" ]]; then
  printf 'Alasan Gagal    : %s\n' "${GATE_REASON}"
fi
printf 'Verified Digest : %s\n' "${FULL_DIGEST}"
printf 'Binary SHA-256  : %s\n' "${FULL_BIN_SHA}"
printf '================ PAYLOAD HTML TELEGRAM (%d chars) ================\n%s\n==================================================================\n' "${#TELEGRAM_HTML}" "${TELEGRAM_HTML}"

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  if [[ ! "${TELEGRAM_CHAT_ID}" =~ ^-?[0-9]+$ ]]; then
    printf 'WARNING: TELEGRAM_CHAT_ID tidak valid (harus numerik); batal mengirim.\n' >&2
    exit 0
  fi
  printf '==> Mengirim laporan HTML ke Bot Telegram (chat_id: %s)...\n' "${TELEGRAM_CHAT_ID}"
  if printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "${TELEGRAM_BOT_TOKEN}" \
    | curl -fsS --max-time 15 --config - -X POST \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "parse_mode=HTML" \
      --data-urlencode "disable_web_page_preview=true" \
      --data-urlencode "text=${TELEGRAM_HTML}" >/dev/null; then
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
