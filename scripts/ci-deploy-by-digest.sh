#!/usr/bin/env bash
# scripts/ci-deploy-by-digest.sh — Rollback-safe deployment using immutable digest reference (@sha256:<64-hex>).
set -euo pipefail

log() { printf '\n==> [Deploy By Digest] %s\n' "$*"; }

IMAGE_REF="${1:-}"

if [[ -z "${IMAGE_REF}" ]]; then
  echo "Usage: $0 <REGISTRY/APP@sha256:DIGEST>" >&2
  exit 1
fi

if [[ "${IMAGE_REF}" == *":latest"* || "${IMAGE_REF}" == "latest" ]]; then
  echo "ERROR: Tag :latest dilarang keras untuk deployment. Gunakan referensi immutable digest (@sha256:<64-hex>)." >&2
  exit 1
fi

if ! grep -qE '^.+@sha256:[0-9a-f]{64}$' <<< "${IMAGE_REF}"; then
  echo "ERROR: Format image ref tidak valid ('${IMAGE_REF}'). Wajib menggunakan format <REGISTRY/APP@sha256:64-hex-digest>." >&2
  exit 1
fi

APP_NAME="${APP_NAME:-autore-dummy}"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
DEPLOY_PORT="${DEPLOY_PORT:-8081}"
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-/health}"
CANDIDATE_PORT=$((DEPLOY_PORT + 100))

ACTIVE_CONTAINER="${ACTIVE_CONTAINER_NAME:-${APP_NAME}-active}"
CANDIDATE_CONTAINER="${CANDIDATE_CONTAINER_NAME:-${APP_NAME}-candidate}"

log "Mempersiapkan deployment untuk image terverifikasi: ${IMAGE_REF}"
log "Menjalankan container kandidat pada port sementara 127.0.0.1:${CANDIDATE_PORT}..."

docker stop "${CANDIDATE_CONTAINER}" 2>/dev/null || true
docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true

docker run -d --name "${CANDIDATE_CONTAINER}" \
  -p "127.0.0.1:${CANDIDATE_PORT}:${CONTAINER_PORT}" \
  "${IMAGE_REF}"

log "Memeriksa health check kandidat pada http://127.0.0.1:${CANDIDATE_PORT}${HEALTH_ENDPOINT} (maks 10 detik)..."
healthy=0
for i in {1..10}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:${CANDIDATE_PORT}${HEALTH_ENDPOINT}" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "${healthy}" != "1" ]]; then
  echo "ERROR: Container kandidat gagal lolos uji kesehatan (health check). Menghentikan kandidat..." >&2
  docker stop "${CANDIDATE_CONTAINER}" 2>/dev/null || true
  docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true
  echo "Container aktif lama dipertahankan tanpa gangguan (rollback aman)." >&2
  exit 1
fi

log "Kandidat sehat! Melakukan pergantian ke port produksi 127.0.0.1:${DEPLOY_PORT}..."

docker stop "${ACTIVE_CONTAINER}" 2>/dev/null || true
docker rm -f "${ACTIVE_CONTAINER}" 2>/dev/null || true

docker stop "${CANDIDATE_CONTAINER}" 2>/dev/null || true
docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true

docker run -d --name "${ACTIVE_CONTAINER}" \
  --restart unless-stopped \
  -p "127.0.0.1:${DEPLOY_PORT}:${CONTAINER_PORT}" \
  "${IMAGE_REF}"

log "Verifikasi akhir port produksi http://127.0.0.1:${DEPLOY_PORT}${HEALTH_ENDPOINT} (maks 10 detik)..."
healthy=0
for i in {1..10}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:${DEPLOY_PORT}${HEALTH_ENDPOINT}" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "${healthy}" != "1" ]]; then
  echo "ERROR: Verifikasi port produksi gagal!" >&2
  exit 1
fi

log "SUKSES: Deployment berbasis digest @sha256 selesai dan berjalan aman!"
