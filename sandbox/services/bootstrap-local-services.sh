#!/usr/bin/env bash
# scripts/bootstrap-local-services.sh — Bootstrap SonarQube (eMudhra CA mitigated) & Nexus (ALLOW_ONCE repos).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
MITIGATED_CACERTS="${SCRIPT_DIR}/mitigated-cacerts"
SONAR_IMAGE="sonarqube:26.10.0.133078-community@sha256:aa0d41212704d1ed35f7ae3b49886b39f639590baf8020cdb191c2a2eb8f9eae"

log() { printf '\n==> [Bootstrap Services] %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Mitigasi Resmi Advisory Keamanan SonarQube: Hapus eMudhra Root CA dari cacerts
# ---------------------------------------------------------------------------
log "1/4: Menerapkan mitigasi resmi pencabutan trust root CA eMudhra (emSign)..."
if [[ ! -f "${MITIGATED_CACERTS}" ]]; then
  tmp_extract_dir="$(mktemp -d)"
  log "Mengekstrak cacerts asli dari image SonarQube..."
  # Create a dummy container to copy cacerts without running
  cid=$(docker create "${SONAR_IMAGE}")
  docker cp "${cid}:/opt/java/openjdk/lib/security/cacerts" "${tmp_extract_dir}/cacerts"
  docker rm -f "${cid}" >/dev/null

  log "Menghapus seluruh alias sertifikat eMudhra (emSign) dengan keytool -delete..."
  # Official SonarSource mitigation for untrusted eMudhra root certificates in JDK:
  for alias in emsignrootcag1 emsignrootcag2 emsigneccrootcag3; do
    keytool -delete -alias "${alias} [jdk]" -keystore "${tmp_extract_dir}/cacerts" -storepass changeit 2>/dev/null || true
    keytool -delete -alias "${alias}" -keystore "${tmp_extract_dir}/cacerts" -storepass changeit 2>/dev/null || true
  done

  # Also search and delete any remaining aliases matching emsign or emudhra using verbose list
  # Parsing from 'keytool -list -v' (line 'Alias name:') ensures aliases containing commas are preserved
  while IFS= read -r alias_name; do
    if [[ -n "${alias_name}" ]]; then
      log "Menghapus alias: ${alias_name}"
      keytool -delete -alias "${alias_name}" -keystore "${tmp_extract_dir}/cacerts" -storepass changeit 2>/dev/null || true
    fi
  done < <(keytool -list -v -keystore "${tmp_extract_dir}/cacerts" -storepass changeit 2>/dev/null \
    | awk -F': ' '/^Alias name:/{print $2}' | grep -iE 'emsign|emudhra' || true)

  # Verifikasi truststore sudah 100% bersih dari eMudhra
  if keytool -list -v -keystore "${tmp_extract_dir}/cacerts" -storepass changeit 2>/dev/null \
    | awk -F': ' '/^Alias name:/{print $2}' | grep -qiE 'emsign|emudhra'; then
    echo "ERROR: Gagal menghapus seluruh sertifikat eMudhra dari truststore cacerts!" >&2
    rm -rf "${tmp_extract_dir}"
    exit 1
  fi

  chmod 0644 "${tmp_extract_dir}/cacerts"
  mv "${tmp_extract_dir}/cacerts" "${MITIGATED_CACERTS}"
  rm -rf "${tmp_extract_dir}"
  log "Truststore cacerts ter-mitigasi berhasil dibuat di: ${MITIGATED_CACERTS}"
else
  log "Truststore cacerts ter-mitigasi sudah ada: ${MITIGATED_CACERTS}"
fi

# ---------------------------------------------------------------------------
# 2. Jalankan Container SonarQube & Nexus
# ---------------------------------------------------------------------------
log "2/4: Menjalankan container SonarQube & Nexus via Docker Compose..."
docker compose -f "${COMPOSE_FILE}" up -d

# ---------------------------------------------------------------------------
# 3. Tunggu & Konfigurasi SonarQube (Token + Verifikasi Plugin Rust)
# ---------------------------------------------------------------------------
log "3/4: Menunggu SonarQube siap di http://127.0.0.1:9000..."
sonar_ready=0
for i in {1..90}; do
  status="$(curl -fsS http://127.0.0.1:9000/api/system/status 2>/dev/null | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('status', ''))" 2>/dev/null || true)"
  if [[ "${status}" == "UP" ]]; then
    sonar_ready=1
    break
  fi
  sleep 2
done

if [[ "${sonar_ready}" == "1" ]]; then
  log "SonarQube aktif! Memverifikasi ketersediaan plugin native Rust..."
  if curl -fsS -u admin:admin http://127.0.0.1:9000/api/languages/list 2>/dev/null | grep -q '"key":"rust"'; then
    log "✔ Plugin Rust aktif di SonarQube server."
  else
    echo "WARN: Plugin Rust belum terdeteksi di /api/languages/list" >&2
  fi
else
  echo "WARN: SonarQube masih dalam proses inisialisasi background."
fi

# ---------------------------------------------------------------------------
# 4. Inisialisasi Repositori Nexus (ALLOW_ONCE / Disable redeploy)
# ---------------------------------------------------------------------------
log "4/4: Menyiapkan repositori Nexus dengan kebijakan ALLOW_ONCE (Disable redeploy)..."
# Repositories configured:
#   - docker-hosted (port 5000, writePolicy: ALLOW_ONCE)
#   - autore-releases (raw, writePolicy: ALLOW_ONCE)

cat << 'EOF' > "${SCRIPT_DIR}/.nexus-policy-spec.json"
{
  "docker-hosted": {
    "format": "docker",
    "type": "hosted",
    "storage": {
      "blobStoreName": "default",
      "strictContentTypeValidation": true,
      "writePolicy": "ALLOW_ONCE"
    },
    "docker": {
      "v1Enabled": false,
      "forceBasicAuth": true,
      "httpPort": 5000
    }
  },
  "autore-releases": {
    "format": "raw",
    "type": "hosted",
    "storage": {
      "blobStoreName": "default",
      "strictContentTypeValidation": true,
      "writePolicy": "ALLOW_ONCE"
    }
  }
}
EOF

NEXUS_URL="${NEXUS_URL:-http://127.0.0.1:8082}"

# 4.1 Tunggu Nexus UP (poll GET /service/rest/v1/status sampai siap, max ~180s, sleep 5)
log "4.1: Menunggu Nexus siap di ${NEXUS_URL}/service/rest/v1/status (maks 180 detik)..."
nexus_ready=0
for i in {1..36}; do
  if status_resp="$(curl -fsS "${NEXUS_URL}/service/rest/v1/status" 2>/dev/null)"; then
    if [[ -z "${status_resp}" ]] || echo "${status_resp}" | grep -q '"status"[[:space:]]*:[[:space:]]*"OK"'; then
      nexus_ready=1
      break
    fi
  fi
  sleep 5
done

if [[ "${nexus_ready}" != "1" ]]; then
  echo "ERROR: Nexus belum siap setelah 180 detik di ${NEXUS_URL}/service/rest/v1/status" >&2
  exit 1
fi
log "✔ Nexus aktif di ${NEXUS_URL}."

# 4.2 Ambil admin password dari container autore-nexus
log "4.2: Mengambil password admin Nexus dari container autore-nexus..."
NX_ADMIN="$(docker exec autore-nexus cat /nexus-data/admin.password 2>/dev/null | tr -d '\r\n')"
if [[ -z "${NX_ADMIN}" ]]; then
  echo "ERROR: Gagal membaca /nexus-data/admin.password dari container autore-nexus" >&2
  exit 1
fi

# 4.3 Accept EULA Nexus 3.96 Community (idempotent)
log "4.3: Memeriksa & menyetujui EULA Nexus Community Edition..."
eula_resp="$(curl -fsS -u "admin:${NX_ADMIN}" "${NEXUS_URL}/service/rest/v1/system/eula")"
if echo "${eula_resp}" | grep -q '"accepted"[[:space:]]*:[[:space:]]*true'; then
  log "✔ EULA Nexus sudah disetujui sebelumnya (skip)."
else
  # Target persis '"accepted" : false' (dengan spasi sebelum colon) agar tidak mengubah 'accepted:false' di dalam teks disclaimer
  eula_accept_body="$(printf '%s' "${eula_resp}" | sed 's/"accepted" : false/"accepted" : true/')"
  curl -fsS -u "admin:${NX_ADMIN}" \
    -X POST "${NEXUS_URL}/service/rest/v1/system/eula" \
    -H "Content-Type: application/json" \
    -d "${eula_accept_body}" >/dev/null
  log "✔ EULA Nexus berhasil disetujui."
fi

# 4.4 Buat repository docker-hosted & autore-releases jika belum ada (idempotent)
log "4.4: Memeriksa & membuat repository docker-hosted dan autore-releases (ALLOW_ONCE)..."
repos_resp="$(curl -fsS -u "admin:${NX_ADMIN}" "${NEXUS_URL}/service/rest/v1/repositories")"

repo_exists() {
  local target_repo="$1"
  python3 -c 'import sys, json; data = json.load(sys.stdin); sys.exit(0 if any(r.get("name") == sys.argv[1] for r in data) else 1)' "${target_repo}" <<< "${repos_resp}"
}

if repo_exists "docker-hosted"; then
  log "✔ Repository docker-hosted sudah ada (skip)."
else
  curl -fsS -u "admin:${NX_ADMIN}" \
    -X POST "${NEXUS_URL}/service/rest/v1/repositories/docker/hosted" \
    -H "Content-Type: application/json" \
    -d '{"name":"docker-hosted","online":true,"storage":{"blobStoreName":"default","strictContentTypeValidation":true,"writePolicy":"ALLOW_ONCE"},"docker":{"v1Enabled":false,"forceBasicAuth":true,"httpPort":5000}}' >/dev/null
  log "✔ Repository docker-hosted (port 5000, ALLOW_ONCE) berhasil dibuat."
fi

if repo_exists "autore-releases"; then
  log "✔ Repository autore-releases sudah ada (skip)."
else
  curl -fsS -u "admin:${NX_ADMIN}" \
    -X POST "${NEXUS_URL}/service/rest/v1/repositories/raw/hosted" \
    -H "Content-Type: application/json" \
    -d '{"name":"autore-releases","online":true,"storage":{"blobStoreName":"default","strictContentTypeValidation":true,"writePolicy":"ALLOW_ONCE"}}' >/dev/null
  log "✔ Repository autore-releases (raw, ALLOW_ONCE) berhasil dibuat."
fi

# 4.5 Nonaktifkan anonymous access (idempotent) agar docker login menerima 401 WWW-Authenticate
log "4.5: Memeriksa & menonaktifkan anonymous access di Nexus..."
anon_resp="$(curl -fsS -u "admin:${NX_ADMIN}" "${NEXUS_URL}/service/rest/v1/security/anonymous")"
if echo "${anon_resp}" | grep -q '"enabled"[[:space:]]*:[[:space:]]*false'; then
  log "✔ Anonymous access sudah nonaktif (skip)."
else
  curl -fsS -u "admin:${NX_ADMIN}" \
    -X PUT "${NEXUS_URL}/service/rest/v1/security/anonymous" \
    -H "Content-Type: application/json" \
    -d '{"enabled":false}' >/dev/null
  log "✔ Anonymous access berhasil dinonaktifkan."
fi

# 4.6 Verifikasi akhir: repositori docker-hosted & autore-releases (ALLOW_ONCE) dan anonymous enabled=false
log "4.6: Verifikasi akhir konfigurasi Nexus..."
final_repos="$(curl -fsS -u "admin:${NX_ADMIN}" "${NEXUS_URL}/service/rest/v1/repositories")"
docker_hosted_cfg="$(curl -fsS -u "admin:${NX_ADMIN}" "${NEXUS_URL}/service/rest/v1/repositories/docker/hosted/docker-hosted" 2>/dev/null || echo "{}")"
raw_hosted_cfg="$(curl -fsS -u "admin:${NX_ADMIN}" "${NEXUS_URL}/service/rest/v1/repositories/raw/hosted/autore-releases" 2>/dev/null || echo "{}")"
final_anon="$(curl -fsS -u "admin:${NX_ADMIN}" "${NEXUS_URL}/service/rest/v1/security/anonymous")"

python3 - "${final_repos}" "${docker_hosted_cfg}" "${raw_hosted_cfg}" "${final_anon}" << 'PYEOF'
import json
import sys

repos = json.loads(sys.argv[1])
docker_cfg = json.loads(sys.argv[2])
raw_cfg = json.loads(sys.argv[3])
anon = json.loads(sys.argv[4])

repo_map = {r.get("name"): r for r in repos}
for required in ("docker-hosted", "autore-releases"):
    if required not in repo_map:
        print(f"ERROR: Repository {required} tidak ditemukan di /service/rest/v1/repositories", file=sys.stderr)
        sys.exit(1)

docker_policy = (
    docker_cfg.get("storage", {}).get("writePolicy")
    or repo_map["docker-hosted"].get("storage", {}).get("writePolicy")
)
raw_policy = (
    raw_cfg.get("storage", {}).get("writePolicy")
    or repo_map["autore-releases"].get("storage", {}).get("writePolicy")
)

if docker_policy != "ALLOW_ONCE":
    print(f"ERROR: writePolicy docker-hosted bukan ALLOW_ONCE (aktual: {docker_policy})", file=sys.stderr)
    sys.exit(1)

if raw_policy != "ALLOW_ONCE":
    print(f"ERROR: writePolicy autore-releases bukan ALLOW_ONCE (aktual: {raw_policy})", file=sys.stderr)
    sys.exit(1)

if anon.get("enabled") is not False:
    print(f"ERROR: security/anonymous masih aktif (enabled={anon.get('enabled')})", file=sys.stderr)
    sys.exit(1)

print("✔ Verifikasi Nexus lulus: docker-hosted & autore-releases (ALLOW_ONCE), anonymous access nonaktif (enabled=false).")
PYEOF

log "Seluruh layanan lokal (SonarQube & Nexus) siap digunakan!"
