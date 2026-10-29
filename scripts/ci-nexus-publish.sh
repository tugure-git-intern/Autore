#!/usr/bin/env bash
# scripts/ci-nexus-publish.sh — Push Docker image to Nexus (Disable redeploy) & verify digest via authenticated HEAD.
set -euo pipefail

log() { printf '\n==> [Nexus Publish] %s\n' "$*"; }

WORKSPACE="${WORKSPACE:-$(pwd)}"
DIST_DIR="${DIST_DIR:-${WORKSPACE}/dist}"
APP_NAME="${APP_NAME:-autore-dummy}"
BUILD_NUMBER="${BUILD_NUMBER:-}"
GIT_COMMIT="${GIT_COMMIT:-}"
NEXUS_USER="${NEXUS_USER:-}"
NEXUS_PASS="${NEXUS_PASS:-}"
NEXUS_DOCKER_REGISTRY="${NEXUS_DOCKER_REGISTRY:-127.0.0.1:5000}"
NEXUS_API_URL="${NEXUS_API_URL:-http://127.0.0.1:8082}"
NEXUS_RAW_URL="${NEXUS_RAW_URL:-http://127.0.0.1:8082/repository/autore-releases}"

# ---------------------------------------------------------------------------
# 1. Validasi Input, Kredensial, & Format Tag (Wajib Full 40-Hex Commit SHA)
# ---------------------------------------------------------------------------
[[ -n "${BUILD_NUMBER}" ]] || { echo "ERROR: BUILD_NUMBER wajib diisi" >&2; exit 1; }
[[ -n "${NEXUS_USER}" ]] || { echo "ERROR: NEXUS_USER wajib diisi" >&2; exit 1; }
[[ -n "${NEXUS_PASS}" ]] || { echo "ERROR: NEXUS_PASS wajib diisi" >&2; exit 1; }

if [[ "${GIT_COMMIT}" == "latest" || "${GIT_COMMIT}" == *":latest"* ]]; then
  echo "ERROR: Tag 'latest' dilarang keras. Gunakan immutable commit tag." >&2
  exit 1
fi

if ! grep -qE '^[0-9a-f]{40}$' <<< "${GIT_COMMIT}"; then
  echo "ERROR: GIT_COMMIT wajib berupa 40 karakter hex (full commit SHA, bukan SHORT_SHA): '${GIT_COMMIT}'" >&2
  exit 1
fi

IMAGE_TAG="${NEXUS_DOCKER_REGISTRY}/${APP_NAME}:build-${BUILD_NUMBER}-commit-${GIT_COMMIT}"
log "Mempersiapkan rilis image immutable: ${IMAGE_TAG}"

# ---------------------------------------------------------------------------
# 2. Nexus Repository Preflight & Kebijakan Disable Redeploy (ALLOW_ONCE)
# ---------------------------------------------------------------------------
log "Memeriksa kebijakan repositori Nexus (Disable redeploy)..."
policy_resp="$(printf 'user = "%s:%s"\nurl = "%s/service/rest/v1/repositories/docker/hosted/docker-hosted"\n' \
  "${NEXUS_USER}" "${NEXUS_PASS}" "${NEXUS_API_URL}" \
  | curl -fsS --max-time 15 --config - 2>/dev/null)"

write_policy="$(python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('storage', {}).get('writePolicy', ''))" <<< "${policy_resp}" 2>/dev/null)"

if [[ "${write_policy}" != "ALLOW_ONCE" ]]; then
  echo "ERROR: Repositori Nexus docker-hosted tidak menerapkan writePolicy ALLOW_ONCE (Disable redeploy). Tolak rilis!" >&2
  exit 1
fi
log "Repositori Nexus terverifikasi: writePolicy == ALLOW_ONCE (Disable redeploy)."

# ---------------------------------------------------------------------------
# 3. Docker Login & Push Tag Immutable ke Nexus
# ---------------------------------------------------------------------------
log "Melakukan docker login ke registry ${NEXUS_DOCKER_REGISTRY} (credential via stdin)..."
printf '%s' "${NEXUS_PASS}" | docker login "${NEXUS_DOCKER_REGISTRY}" -u "${NEXUS_USER}" --password-stdin

log "Mendorong image ${IMAGE_TAG} ke Nexus..."
docker push "${IMAGE_TAG}"

# ---------------------------------------------------------------------------
# 4. Ambil LOCAL_DIGEST dari RepoDigests (Tanpa Menghapus Image Lokal)
# ---------------------------------------------------------------------------
log "Mengekstrak digest lokal dari RepoDigests..."
REPO_DIGEST_REF="$(docker image inspect --format '{{range .RepoDigests}}{{.}}{{"\n"}}{{end}}' "${IMAGE_TAG}" 2>/dev/null | grep -E "^${NEXUS_DOCKER_REGISTRY}/${APP_NAME}@sha256:[0-9a-f]{64}$" | head -n 1 || true)"

if [[ -z "${REPO_DIGEST_REF}" ]]; then
  REPO_DIGEST_REF="$(docker image inspect --format '{{range .RepoDigests}}{{.}}{{"\n"}}{{end}}' "${IMAGE_TAG}" 2>/dev/null | grep -E "@sha256:[0-9a-f]{64}$" | head -n 1 || true)"
fi

[[ -n "${REPO_DIGEST_REF}" ]] || { echo "ERROR: Gagal membaca RepoDigests untuk ${IMAGE_TAG} setelah push" >&2; exit 1; }
LOCAL_DIGEST="${REPO_DIGEST_REF#*@}"

log "Digest lokal: ${LOCAL_DIGEST}"

# ---------------------------------------------------------------------------
# 5. Verifikasi Remote Digest via Authenticated HEAD Manifest Request
# ---------------------------------------------------------------------------
log "Memverifikasi digest remote via authenticated HEAD manifest request ke Nexus..."
REMOTE_DIGEST="$(printf 'user = "%s:%s"\nurl = "http://%s/v2/%s/manifests/%s"\n' \
  "${NEXUS_USER}" "${NEXUS_PASS}" "${NEXUS_DOCKER_REGISTRY}" "${APP_NAME}" "${LOCAL_DIGEST}" \
  | curl -fsSI --max-time 15 --config - -X HEAD \
    -H 'Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' \
  | awk 'tolower($1) == "docker-content-digest:" {gsub(/\r/, "", $2); print $2}' | tail -n 1)"

if [[ -z "${REMOTE_DIGEST}" ]]; then
  echo "ERROR: Response HEAD manifest tidak mengandung header Docker-Content-Digest" >&2
  exit 1
fi

if [[ "${REMOTE_DIGEST}" != "${LOCAL_DIGEST}" ]]; then
  echo "ERROR: Remote Docker-Content-Digest (${REMOTE_DIGEST}) tidak cocok dengan LOCAL_DIGEST (${LOCAL_DIGEST})" >&2
  exit 1
fi

VERIFIED_REF="${NEXUS_DOCKER_REGISTRY}/${APP_NAME}@${LOCAL_DIGEST}"
printf '%s\n' "${VERIFIED_REF}" > "${WORKSPACE}/.verified-image-digest"
log "Digest terverifikasi secara kriptografis: ${VERIFIED_REF}"

# ---------------------------------------------------------------------------
# 6. Unggah Artifact Raw (Binary musl, SBOM, SHA256SUMS) ke Nexus Raw Repo
# ---------------------------------------------------------------------------
if [[ -d "${DIST_DIR}" ]]; then
  log "Mengunggah release artifacts dari ${DIST_DIR} ke Nexus Raw Repository..."
  RELEASE_PATH="build-${BUILD_NUMBER}-commit-${GIT_COMMIT}"
  
  if [[ -f "${DIST_DIR}/SHA256SUMS" ]]; then
    printf '\n# Docker Image Verified Digest\n%s  image-%s-build-%s\n' "${LOCAL_DIGEST}" "${APP_NAME}" "${BUILD_NUMBER}" >> "${DIST_DIR}/SHA256SUMS"
  fi

  for artifact in "${DIST_DIR}"/*; do
    if [[ -f "${artifact}" ]]; then
      artifact_name="$(basename "${artifact}")"
      log "Mengunggah ${artifact_name} ke ${NEXUS_RAW_URL}/${RELEASE_PATH}/${artifact_name}..."
      printf 'user = "%s:%s"\nurl = "%s/%s/%s"\n' \
        "${NEXUS_USER}" "${NEXUS_PASS}" "${NEXUS_RAW_URL}" "${RELEASE_PATH}" "${artifact_name}" \
        | curl -fsS --max-time 30 --config - --upload-file "${artifact}"
    fi
  done
  log "Seluruh artifact release berhasil diunggah ke Nexus Raw Repository!"
fi

log "SUKSES: Image dan release artifact berhasil dipublikasikan ke Nexus!"
