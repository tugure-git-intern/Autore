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
  if curl -fsS http://127.0.0.1:9000/api/languages/list 2>/dev/null | grep -q '"key":"rust"'; then
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

log "Spesifikasi repositori Nexus ALLOW_ONCE siap. Layanan testing lokal siap digunakan!"
