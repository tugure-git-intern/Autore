#!/usr/bin/env bash
# scripts/ci-deploy-by-digest.sh — Rollback-safe deployment using immutable digest reference (@sha256:<64-hex>).
# Alur: jalankan kandidat di port sementara -> health check -> simpan image lama ->
#       ganti container aktif -> health check produksi -> bila gagal, jalankan kembali image lama.
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
# Pintu uji: default coba /health dulu, kalau tidak ada (404) baru /.
# HEALTH_ENDPOINT diisi = hanya path itu yang dipakai (tidak ada fallback).
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-}"
if [[ -n "${HEALTH_ENDPOINT}" ]]; then
  HEALTH_PATHS=("${HEALTH_ENDPOINT}")
else
  HEALTH_PATHS=(/health /)
fi
CANDIDATE_PORT=$((DEPLOY_PORT + 100))

ACTIVE_CONTAINER="${ACTIVE_CONTAINER_NAME:-${APP_NAME}-active}"
CANDIDATE_CONTAINER="${CANDIDATE_CONTAINER_NAME:-${APP_NAME}-candidate}"

health_at() {
  local port="$1" i path
  for i in {1..10}; do
    for path in "${HEALTH_PATHS[@]}"; do
      curl -fsS --max-time 2 "http://127.0.0.1:${port}${path}" >/dev/null 2>&1 && return 0
    done
    sleep 1
  done
  return 1
}

start_active() {
  docker run -d --name "${ACTIVE_CONTAINER}" \
    --restart unless-stopped \
    -p "127.0.0.1:${DEPLOY_PORT}:${CONTAINER_PORT}" \
    "$1"
}

# Hanya dipanggil setelah container baru gagal; mengembalikan image yang tadinya aktif.
rollback() {
  echo "ERROR: $1" >&2
  if [[ -z "${old_image:-}" ]]; then
    echo "Tidak ada image lama untuk rollback — port ${DEPLOY_PORT} kosong, perlu intervensi manual." >&2
    return 1
  fi
  echo "Rollback: menjalankan kembali container lama (${old_image})..." >&2
  docker rm -f "${ACTIVE_CONTAINER}" >/dev/null 2>&1 || true
  if start_active "${old_image}" && health_at "${DEPLOY_PORT}"; then
    echo "Rollback SUKSES: layanan lama sehat kembali di port ${DEPLOY_PORT}." >&2
  else
    echo "Rollback GAGAL: layanan lama juga tidak sehat — perlu intervensi manual." >&2
  fi
  return 1
}

log "Mempersiapkan deployment untuk image terverifikasi: ${IMAGE_REF}"
log "Menjalankan container kandidat pada port sementara 127.0.0.1:${CANDIDATE_PORT}..."

docker stop "${CANDIDATE_CONTAINER}" 2>/dev/null || true
docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true

docker run -d --name "${CANDIDATE_CONTAINER}" \
  -p "127.0.0.1:${CANDIDATE_PORT}:${CONTAINER_PORT}" \
  "${IMAGE_REF}"

log "Memeriksa health check kandidat pada http://127.0.0.1:${CANDIDATE_PORT}${HEALTH_PATHS[*]} (maks 10 detik)..."

if ! health_at "${CANDIDATE_PORT}"; then
  echo "ERROR: Container kandidat gagal lolos uji kesehatan. Diuji: ${HEALTH_PATHS[*]} pada port ${CANDIDATE_PORT}." >&2
  echo "Petunjuk: aplikasi harus mendengarkan di 0.0.0.0:${CONTAINER_PORT} dan menjawab HTTP. Kalau folder project masih kosong (belum ada kode aplikasi), tidak ada yang bisa dijalankan." >&2
  cand_logs=""
  cand_logs=$(docker logs --tail 20 "${CANDIDATE_CONTAINER}" 2>&1 || true)
  docker stop "${CANDIDATE_CONTAINER}" 2>/dev/null >/dev/null || true
  docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null >/dev/null || true
  echo "Log terakhir container kandidat:" >&2
  if [[ -n "${cand_logs}" ]]; then
    printf '%s\n' "${cand_logs}" | sed 's/^/    | /' >&2
  else
    echo "    | (kosong — aplikasi tidak menulis apa pun, kemungkinan tidak ada entrypoint)" >&2
  fi
  echo "Container aktif lama dipertahankan tanpa gangguan (rollback aman)." >&2
  exit 1
fi

log "Kandidat sehat! Melakukan pergantian ke port produksi 127.0.0.1:${DEPLOY_PORT}..."

# Simpan image container aktif SEBELUM apa pun dihentikan, sebagai bahan rollback.
old_image="$(docker inspect -f '{{.Config.Image}}' "${ACTIVE_CONTAINER}" 2>/dev/null || true)"
if [[ -n "${old_image}" ]]; then
  log "Rollback tersedia: ${old_image}"
else
  log "Tidak ada container aktif sebelumnya — tanpa rollback."
fi

docker stop "${CANDIDATE_CONTAINER}" 2>/dev/null || true
docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true

docker stop "${ACTIVE_CONTAINER}" 2>/dev/null || true
docker rm -f "${ACTIVE_CONTAINER}" 2>/dev/null || true

start_active "${IMAGE_REF}" || rollback "container baru gagal dijalankan."

log "Verifikasi akhir port produksi http://127.0.0.1:${DEPLOY_PORT}${HEALTH_PATHS[*]} (maks 10 detik)..."
health_at "${DEPLOY_PORT}" || rollback "verifikasi port produksi gagal."

log "SUKSES: Deployment berbasis digest @sha256 selesai dan berjalan aman!"
