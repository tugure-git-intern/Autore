#!/usr/bin/env bash
# scripts/ci-deploy-by-digest.sh — Rollback-safe deployment using immutable digest reference (@sha256:<64-hex>).
# Alur: verifikasi manifest registry -> kandidat -> health -> simpan image lama ->
#       ganti container aktif -> health akhir -> rollback bila gagal.
# Menulis .deploy-result.json agar CLI dapat mencatat fakta, bukan menebak status.
set -euo pipefail

log() { printf '\n==> [Deploy By Digest] %s\n' "$*"; }

IMAGE_REF="${1:-}"
RESULT_JSON="${RESULT_JSON:-${WORKSPACE:-$PWD}/.deploy-result.json}"
DEPLOYMENT_ID="${DEPLOYMENT_ID:-${APP_NAME:-autore-dummy}-${BUILD_NUMBER:-manual}}"

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
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-}"
if [[ -n "${HEALTH_ENDPOINT}" ]]; then
  HEALTH_PATHS=("${HEALTH_ENDPOINT}")
else
  HEALTH_PATHS=(/health /)
fi
CANDIDATE_PORT=$((DEPLOY_PORT + 100))

ACTIVE_CONTAINER="${ACTIVE_CONTAINER_NAME:-${APP_NAME}-active}"
CANDIDATE_CONTAINER="${CANDIDATE_CONTAINER_NAME:-${APP_NAME}-candidate}"
OLD_DEPLOYMENT_ID=""
OLD_IMAGE=""
OLD_DIGEST=""
IMAGE_ID=""
ACTIVE_AFTER_ID=""
ACTIVE_AFTER_DIGEST=""

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

write_result() {
  local outcome="$1" error="${2:-}"
  RESULT_JSON="$RESULT_JSON" \
  RESULT_OUTCOME="$outcome" \
  RESULT_ERROR="$error" \
  RESULT_IMAGE_REF="$IMAGE_REF" \
  RESULT_IMAGE_ID="$IMAGE_ID" \
  RESULT_DEPLOYMENT_ID="$DEPLOYMENT_ID" \
  RESULT_ACTIVE_BEFORE_ID="$OLD_DEPLOYMENT_ID" \
  RESULT_ACTIVE_BEFORE_DIGEST="$OLD_DIGEST" \
  RESULT_ACTIVE_AFTER_ID="$ACTIVE_AFTER_ID" \
  RESULT_ACTIVE_AFTER_DIGEST="$ACTIVE_AFTER_DIGEST" \
  RESULT_HEALTH_URL="http://127.0.0.1:${DEPLOY_PORT}${HEALTH_PATHS[0]}" \
  python3 - <<'PY'
import json
import os

def ref(prefix):
    ident = os.environ.get(prefix + "_ID", "")
    digest = os.environ.get(prefix + "_DIGEST", "")
    if not ident or not digest:
        return None
    return {"deployment_id": ident, "digest": digest}

payload = {
    "requested_digest": os.environ["RESULT_IMAGE_REF"].split("@", 1)[1],
    "image_ref": os.environ["RESULT_IMAGE_REF"],
    "image_id": os.environ.get("RESULT_IMAGE_ID", ""),
    "deployment_id": os.environ.get("RESULT_DEPLOYMENT_ID", ""),
    "outcome": os.environ["RESULT_OUTCOME"],
    "health": "ok" if os.environ["RESULT_OUTCOME"] == "success" else "gagal",
    "health_url": os.environ["RESULT_HEALTH_URL"],
    "active_before": ref("RESULT_ACTIVE_BEFORE"),
    "active_after": ref("RESULT_ACTIVE_AFTER"),
    "error": os.environ.get("RESULT_ERROR", ""),
}
with open(os.environ["RESULT_JSON"], "w", encoding="utf-8") as handle:
    json.dump(payload, handle, sort_keys=True)
    handle.write("\n")
PY
}

start_container() {
  local name="$1" image="$2" port="$3" label="$4"
  docker run -d --name "${name}" \
    --restart unless-stopped \
    --label "autore.deployment_id=${label}" \
    -p "127.0.0.1:${port}:${CONTAINER_PORT}" \
    "${image}"
}

inspect_old() {
  OLD_IMAGE="$(docker inspect -f '{{.Config.Image}}' "${ACTIVE_CONTAINER}" 2>/dev/null || true)"
  OLD_DEPLOYMENT_ID="$(docker inspect -f '{{ index .Config.Labels "autore.deployment_id" }}' "${ACTIVE_CONTAINER}" 2>/dev/null || true)"
  OLD_DIGEST="${OLD_IMAGE##*@}"
  if [[ -z "${OLD_DEPLOYMENT_ID}" && -n "${OLD_IMAGE}" ]]; then
    OLD_DEPLOYMENT_ID="legacy-${ACTIVE_CONTAINER}"
  fi
}

rollback() {
  echo "ERROR: $1" >&2
  if [[ -z "${OLD_IMAGE:-}" ]]; then
    ACTIVE_AFTER_ID=""
    ACTIVE_AFTER_DIGEST=""
    write_result "failed_no_active" "$1"
    echo "Tidak ada image lama untuk rollback — port ${DEPLOY_PORT} kosong, perlu intervensi manual." >&2
    return 1
  fi
  echo "Rollback: menjalankan kembali container lama (${OLD_IMAGE})..." >&2
  docker rm -f "${ACTIVE_CONTAINER}" >/dev/null 2>&1 || true
  if start_container "${ACTIVE_CONTAINER}" "${OLD_IMAGE}" "${DEPLOY_PORT}" "${OLD_DEPLOYMENT_ID}" && health_at "${DEPLOY_PORT}"; then
    ACTIVE_AFTER_ID="${OLD_DEPLOYMENT_ID}"
    ACTIVE_AFTER_DIGEST="${OLD_DIGEST}"
    write_result "rolled_back" "$1"
    echo "Rollback SUKSES: layanan lama sehat kembali di port ${DEPLOY_PORT}." >&2
  else
    ACTIVE_AFTER_ID=""
    ACTIVE_AFTER_DIGEST=""
    write_result "rollback_failed" "$1"
    echo "Rollback GAGAL: layanan lama juga tidak sehat — perlu intervensi manual." >&2
  fi
  return 1
}

log "Memverifikasi manifest registry: ${IMAGE_REF}"
docker pull --quiet "${IMAGE_REF}" >/dev/null
IMAGE_ID="$(docker image inspect "${IMAGE_REF}" --format '{{.Id}}')"
if ! docker image inspect "${IMAGE_REF}" --format '{{json .RepoDigests}}' | grep -Fq "${IMAGE_REF}"; then
  echo "ERROR: RepoDigests tidak memuat ${IMAGE_REF}; verifikasi digest gagal." >&2
  exit 1
fi
log "Digest terverifikasi: image ID ${IMAGE_ID}"

inspect_old
log "Menyiapkan deployment ${DEPLOYMENT_ID}; container lama: ${OLD_DEPLOYMENT_ID:-tidak ada}"

docker stop "${CANDIDATE_CONTAINER}" 2>/dev/null || true
docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true

docker run -d --name "${CANDIDATE_CONTAINER}" \
  --label "autore.deployment_id=${DEPLOYMENT_ID}" \
  -p "127.0.0.1:${CANDIDATE_PORT}:${CONTAINER_PORT}" \
  "${IMAGE_REF}"

log "Memeriksa health kandidat pada http://127.0.0.1:${CANDIDATE_PORT}${HEALTH_PATHS[*]}..."
if ! health_at "${CANDIDATE_PORT}"; then
  echo "ERROR: Container kandidat gagal lolos uji kesehatan." >&2
  cand_logs="$(docker logs --tail 20 "${CANDIDATE_CONTAINER}" 2>&1 || true)"
  docker stop "${CANDIDATE_CONTAINER}" >/dev/null 2>&1 || true
  docker rm -f "${CANDIDATE_CONTAINER}" >/dev/null 2>&1 || true
  if [[ -n "${cand_logs}" ]]; then
    printf '%s\n' "${cand_logs}" | sed 's/^/    | /' >&2
  fi
  if [[ -n "${OLD_IMAGE}" ]]; then
    ACTIVE_AFTER_ID="${OLD_DEPLOYMENT_ID}"
    ACTIVE_AFTER_DIGEST="${OLD_DIGEST}"
    write_result "rolled_back" "kandidat gagal health; container lama tetap aktif"
  else
    ACTIVE_AFTER_ID=""
    ACTIVE_AFTER_DIGEST=""
    write_result "failed_no_active" "kandidat gagal health; tidak ada container lama"
  fi
  exit 1
fi

log "Kandidat sehat. Mengganti container aktif di port ${DEPLOY_PORT}..."
docker stop "${CANDIDATE_CONTAINER}" >/dev/null 2>&1 || true
docker rm -f "${CANDIDATE_CONTAINER}" >/dev/null 2>&1 || true
docker stop "${ACTIVE_CONTAINER}" >/dev/null 2>&1 || true
docker rm -f "${ACTIVE_CONTAINER}" >/dev/null 2>&1 || true

start_container "${ACTIVE_CONTAINER}" "${IMAGE_REF}" "${DEPLOY_PORT}" "${DEPLOYMENT_ID}" || rollback "container baru gagal dijalankan."

log "Verifikasi akhir port ${DEPLOY_PORT}${HEALTH_PATHS[*]}..."
health_at "${DEPLOY_PORT}" || rollback "verifikasi port akhir gagal."

ACTIVE_AFTER_ID="${DEPLOYMENT_ID}"
ACTIVE_AFTER_DIGEST="${IMAGE_REF##*@}"
write_result "success" ""
log "SUKSES: deployment ${DEPLOYMENT_ID} berjalan dari ${IMAGE_REF}"
