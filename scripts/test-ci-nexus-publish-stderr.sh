#!/usr/bin/env bash
# Hermetic test: probe kebijakan Nexus harus menampilkan penyebab gagal konek.
# Stub curl mengembalikan exit 7 + pesan "Failed to connect" ke stderr.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/ci-nexus-publish.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

mkdir -p "$SCRATCH/bin"
cat > "$SCRATCH/bin/curl" <<'STUBEOF'
#!/usr/bin/env bash
echo 'curl: (7) Failed to connect to 10.0.0.9 port 8082 after 0 ms: Could not connect to server' >&2
exit 7
STUBEOF
chmod +x "$SCRATCH/bin/curl"

export PATH="$SCRATCH/bin:$PATH"
export APP_NAME=test-autore-dummy
export BUILD_NUMBER=1
export GIT_COMMIT=0123456789abcdef0123456789abcdef01234567
export NEXUS_USER=test
export NEXUS_PASS=test
export NEXUS_API_URL=http://10.0.0.9:8082
export NEXUS_DOCKER_REGISTRY=10.0.0.9:5000
export WORKSPACE="$SCRATCH"

set +e
bash "$SCRIPT" > "$SCRATCH/out.txt" 2>&1
rc=$?
set -e

if (( rc == 0 )); then
  echo "GAGAL: script seharusnya keluar non-zero saat Nexus tidak terjangkau" >&2
  cat "$SCRATCH/out.txt" >&2
  exit 1
fi

if ! grep -q 'Failed to connect' "$SCRATCH/out.txt"; then
  echo "GAGAL: penyebab gagal konek tidak tampil di keluaran (stderr ditelan)" >&2
  echo "--- keluaran:" >&2
  cat "$SCRATCH/out.txt" >&2
  exit 1
fi

echo "LULUS: penyebab gagal konek Nexus tampil di keluaran"
