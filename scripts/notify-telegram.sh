#!/usr/bin/env bash
# notify-telegram.sh — Send a complete CI/CD & Security Audit report to Telegram
# (and always print it to the Jenkins build log for full traceability).
#
# Reads Jenkins environment variables + optional "$WORKSPACE/.security-gate-reason".
# If TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are provided, sends the message via
# the Telegram Bot HTTP API using curl --data-urlencode (safe for all characters).

set -euo pipefail

WORKSPACE="${WORKSPACE:-$(pwd)}"
BUILD_STATUS="${BUILD_STATUS:-UNKNOWN}"
APP_NAME="${APP_NAME:-autore-dummy}"
BUILD_NUMBER="${BUILD_NUMBER:-0}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SHORT_SHA="${SHORT_SHA:-unknown}"
AUDIT_AUTHOR="${AUDIT_AUTHOR:-unknown}"
AUDIT_MESSAGE="${AUDIT_MESSAGE:--}"
AUDIT_CAUSES="${AUDIT_CAUSES:-manual}"
NODE_NAME="${NODE_NAME:-runner}"
IMAGE_TAG="${IMAGE_TAG:--}"
FAILED_STAGE="${FAILED_STAGE:--}"
REASON_FILE="${WORKSPACE}/.security-gate-reason"

 GATE_REASON=""
if [[ -f "${REASON_FILE}" ]]; then
  GATE_REASON="$(cat "${REASON_FILE}")"
fi

if [[ "${BUILD_STATUS}" == "SUCCESS" ]]; then
  HEADER="✅ [AUTORE CI/CD] BUILD #${BUILD_NUMBER} SUKSES & DEPLOYED"
  DETAIL_LINES="🐳 Image    : ${APP_NAME}:${IMAGE_TAG}
🩺 Health   : OK (Smoke Test Lulus)"
else
  HEADER="🚫 [AUTORE CI/CD] BUILD #${BUILD_NUMBER} GAGAL / KETANGKIS!"
  if [[ -n "${GATE_REASON}" ]]; then
    REASON_TEXT="${GATE_REASON}"
  else
    REASON_TEXT="Proses berhenti pada tahap '${FAILED_STAGE}' (cek log Jenkins)"
  fi
  DETAIL_LINES="❌ Tahap    : ${FAILED_STAGE}
⚠️ Alasan   : ${REASON_TEXT}
🛡 Tindakan : Deployment DIBATALKAN otomatis (container lama tetap aman)"
fi

REPORT_TEXT="${HEADER}

📦 Aplikasi : ${APP_NAME}
👤 Pelaku   : ${AUDIT_AUTHOR}
💬 Commit   : ${SHORT_SHA} (\"${AUDIT_MESSAGE}\")
🌿 Branch   : ${GIT_BRANCH}
🎯 Pemicu   : ${AUDIT_CAUSES}
🖥 Runner   : ${NODE_NAME}
${DETAIL_LINES}"

printf '\n================ LAPORAN AUDIT TELEGRAM ================\n%s\n========================================================\n' "${REPORT_TEXT}"

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  printf '==> Mengirim laporan ke Bot Telegram (chat_id: %s)...\n' "${TELEGRAM_CHAT_ID}"
  if curl -fsS --max-time 15 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${REPORT_TEXT}" >/dev/null; then
    printf '==> Laporan Telegram berhasil terkirim!\n'
  else
    printf 'WARNING: Gagal mengirim pesan ke API Telegram (cek token/chat_id).\n' >&2
  fi
else
  printf '==> Info: Kredensial Telegram (telegram-bot-token / telegram-chat-id) belum diset di Jenkins.\n'
  printf '==> Laporan tetap tercatat penuh di log audit di atas.\n'
fi
