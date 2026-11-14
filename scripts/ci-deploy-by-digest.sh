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
DEPLOY_PORT_DIISI=1
if [[ -z "${DEPLOY_PORT:-}" ]]; then
  DEPLOY_PORT_DIISI=""
fi
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

# Smoke sebenarnya: 2xx saja tidak cukup. Untuk /health, body harus JSON
# dengan status "ok"; path lain cukup menjawab 2xx (app lama tanpa /health).
health_at() {
  local port="$1" i path body
  for i in {1..10}; do
    # /health adalah kontrak utama: kalau menjawab, body WAJIB JSON status "ok".
    # Jangan jatuh ke path lain saat body salah, itu justru meloloskan app rusak.
    if body="$(curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" 2>/dev/null)"; then
      if printf '%s' "$body" | python3 -c 'import json, sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' 2>/dev/null; then
        return 0
      fi
    else
      # App lama tanpa /health: cukup 2xx di path yang disepakati.
      for path in "${HEALTH_PATHS[@]}"; do
        [[ "$path" == "/health" ]] && continue
        curl -fsS --max-time 2 "http://127.0.0.1:${port}${path}" >/dev/null 2>&1 && return 0
      done
    fi
    sleep 1
  done
  return 1
}

# Container aktif harus benar-benar memakai image yang baru diverifikasi,
# bukan image lain yang kebetulan menjawab di port itu.
image_aktif_sesuai() {
  local id
  id="$(docker inspect -f '{{.Image}}' "${ACTIVE_CONTAINER}" 2>/dev/null || true)"
  [[ -n "${id}" && "${id}" == "${IMAGE_ID}" ]]
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
  RESULT_HEALTH="${RESULT_HEALTH:-}" \
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

# Health dari FAKTA cek, bukan dari outcome: jalur rollback yang sehat juga
# ber-outcome "rolled_back", jadi turunan lama ("ok" hanya saat "success")
# akan mencatat rollback sehat sebagai "gagal". Pemanggil mengisi RESULT_HEALTH
# saat tahu hasil ceknya sendiri; sisanya jatuh ke turunan lama.
health = os.environ.get("RESULT_HEALTH") or (
    "ok" if os.environ["RESULT_OUTCOME"] == "success" else "gagal"
)

payload = {
    "requested_digest": os.environ["RESULT_IMAGE_REF"].split("@", 1)[1],
    "image_ref": os.environ["RESULT_IMAGE_REF"],
    "image_id": os.environ.get("RESULT_IMAGE_ID", ""),
    "deployment_id": os.environ.get("RESULT_DEPLOYMENT_ID", ""),
    "outcome": os.environ["RESULT_OUTCOME"],
    "health": health,
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

# Registry bisa membalas 429 saat banyak build; ulangi HANYA 429/5xx,
# maksimal 3 percobaan (5/15/45 detik). 4xx lain langsung gagal.
retry_registry() {
  local attempt=1 jeda=5 out
  while true; do
    if out="$("$@" 2>&1)"; then
      [[ -n "$out" ]] && printf '%s\n' "$out"
      return 0
    fi
    case "$out" in
      *" 429 "*|*"429 Too Many"*|*" 500 "*|*" 502 "*|*" 503 "*|*" 504 "*)
        if (( attempt >= 3 )); then
          printf '%s\n' "$out" >&2
          echo "ERROR: registry masih menolak setelah 3 percobaan (429/5xx): $*" >&2
          return 1
        fi
        echo "Registry sibuk (percobaan ${attempt}/3), ulangi dalam ${jeda} detik: $*" >&2
        sleep "$jeda"
        attempt=$((attempt + 1))
        jeda=$((jeda * 3))
        ;;
      *)
        printf '%s\n' "$out" >&2
        return 1
        ;;
    esac
  done
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
    RESULT_HEALTH="ok" write_result "rolled_back" "$1"
    echo "Rollback SUKSES: layanan lama sehat kembali di port ${DEPLOY_PORT}." >&2
  else
    ACTIVE_AFTER_ID=""
    ACTIVE_AFTER_DIGEST=""
    RESULT_HEALTH="gagal" write_result "rollback_failed" "$1"
    echo "Rollback GAGAL: layanan lama juga tidak sehat — perlu intervensi manual." >&2
  fi
  return 1
}

log "Memverifikasi manifest registry: ${IMAGE_REF}"
retry_registry docker pull --quiet "${IMAGE_REF}" >/dev/null
IMAGE_ID="$(docker image inspect "${IMAGE_REF}" --format '{{.Id}}')"
if ! docker image inspect "${IMAGE_REF}" --format '{{json .RepoDigests}}' | grep -Fq "${IMAGE_REF}"; then
  echo "ERROR: RepoDigests tidak memuat ${IMAGE_REF}; verifikasi digest gagal." >&2
  exit 1
fi
log "Digest terverifikasi: image ID ${IMAGE_ID}"

# Mode rollback: port aktif dikembalikan ke digest lama. Tidak ada kandidat,
# tidak ada promosi — hanya container aktif diganti dan dicek sehat.
if [[ "${AUTORE_DEPLOY_MODE:-deploy}" == "rollback" ]]; then
  # ponytail: kalau DEPLOY_PORT tidak diisi, port diambil dari container aktif
  # (aplikasi satu port). Aplikasi multiport wajib mengirim DEPLOY_PORT.
  if [[ -z "${DEPLOY_PORT_DIISI}" ]]; then
    peta="$(docker inspect -f '{{range $p, $c := .NetworkSettings.Ports}}{{range $c}}{{.HostPort}} {{$p}}{{"\n"}}{{end}}{{end}}' "${ACTIVE_CONTAINER}" 2>/dev/null | head -n1 || true)"
    if [[ -n "${peta}" ]]; then
      DEPLOY_PORT="${peta%% *}"
      CONTAINER_PORT="${peta##* }"
      CONTAINER_PORT="${CONTAINER_PORT%%/*}"
    fi
  fi
  if [[ -z "${DEPLOY_PORT_DIISI}" && -z "${peta:-}" ]]; then
    ACTIVE_AFTER_ID=""
    ACTIVE_AFTER_DIGEST=""
    write_result "rollback_failed" "port aktif ${ACTIVE_CONTAINER} tidak ditemukan; isi DEPLOY_PORT"
    echo "ERROR: port aktif tidak bisa ditentukan dari ${ACTIVE_CONTAINER}; isi DEPLOY_PORT." >&2
    exit 1
  fi
  inspect_old
  log "Mode rollback: mengembalikan port ${DEPLOY_PORT} ke ${IMAGE_REF} (digantikan: ${OLD_DEPLOYMENT_ID:-tidak ada})"
  docker stop "${CANDIDATE_CONTAINER}" >/dev/null 2>&1 || true
  docker rm -f "${CANDIDATE_CONTAINER}" >/dev/null 2>&1 || true
  docker stop "${ACTIVE_CONTAINER}" >/dev/null 2>&1 || true
  docker rm -f "${ACTIVE_CONTAINER}" >/dev/null 2>&1 || true
  if start_container "${ACTIVE_CONTAINER}" "${IMAGE_REF}" "${DEPLOY_PORT}" "${DEPLOYMENT_ID}" && health_at "${DEPLOY_PORT}"; then
    ACTIVE_AFTER_ID="${DEPLOYMENT_ID}"
    ACTIVE_AFTER_DIGEST="${IMAGE_REF##*@}"
    RESULT_HEALTH="ok" write_result "rolled_back" "rollback by digest ke ${IMAGE_REF}"
    log "SUKSES: rollback ${DEPLOYMENT_ID} aktif di port ${DEPLOY_PORT} dari ${IMAGE_REF}"
    exit 0
  fi
  ACTIVE_AFTER_ID=""
  ACTIVE_AFTER_DIGEST=""
  write_result "rollback_failed" "rollback by digest gagal: ${DEPLOYMENT_ID} tidak sehat di port ${DEPLOY_PORT}"
  echo "ERROR: rollback GAGAL — port ${DEPLOY_PORT} tidak sehat, perlu intervensi manual." >&2
  exit 1
fi

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
    # Container lama tidak disentuh dan masih melayani port aktif, jadi sehat:
    # health diisi fakta, bukan turunan outcome "rolled_back".
    RESULT_HEALTH="ok" write_result "rolled_back" "kandidat gagal health; container lama tetap aktif"
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
image_aktif_sesuai || rollback "digest container aktif tidak sama dengan ${IMAGE_REF}."

ACTIVE_AFTER_ID="${DEPLOYMENT_ID}"
ACTIVE_AFTER_DIGEST="${IMAGE_REF##*@}"
write_result "success" ""
log "SUKSES: deployment ${DEPLOYMENT_ID} berjalan dari ${IMAGE_REF}"
