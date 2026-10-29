#!/usr/bin/env bash
# scripts/build-musl-release.sh — Build static x86_64-unknown-linux-musl release binary & SHA256SUMS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${DIST_DIR:-${REPO_ROOT}/dist}"
TARGET="x86_64-unknown-linux-musl"

mkdir -p "${DIST_DIR}"

log() { printf '\n==> [Build Release musl] %s\n' "$*"; }

log "Memeriksa ketersediaan target ${TARGET}..."
if ! rustup target list --installed | grep -q "^${TARGET}$"; then
  log "Menginstal target ${TARGET} via rustup..."
  rustup target add "${TARGET}"
fi

log "Menjalankan kompilasi release musl..."
cargo build --manifest-path "${REPO_ROOT}/cli/Cargo.toml" --target "${TARGET}" --release

SRC_BIN="${REPO_ROOT}/cli/target/${TARGET}/release/autore"
DEST_BIN="${DIST_DIR}/autore-linux-x86_64-musl"

[[ -f "${SRC_BIN}" ]] || { echo "ERROR: Binary hasil kompilasi tidak ditemukan di ${SRC_BIN}" >&2; exit 1; }

cp "${SRC_BIN}" "${DEST_BIN}"
chmod 0755 "${DEST_BIN}"

if command -v strip >/dev/null 2>&1; then
  log "Menghapus debug symbol dengan strip..."
  strip "${DEST_BIN}" || true
fi

log "Memverifikasi bahwa binary bertipe statically linked (bukan dynamic executable)..."
if command -v ldd >/dev/null 2>&1; then
  ldd_out="$(ldd "${DEST_BIN}" 2>&1 || true)"
  if ! echo "${ldd_out}" | grep -qE "statically linked|not a dynamic executable"; then
    echo "ERROR: ldd mendeteksi binary bergantung pada shared library: ${ldd_out}" >&2
    exit 1
  fi
fi

file_out="$(file "${DEST_BIN}" 2>&1 || true)"
if ! echo "${file_out}" | grep -qE "statically linked|static-pie linked"; then
  echo "ERROR: file command mendeteksi binary bukan static: ${file_out}" >&2
  exit 1
fi

log "Menghasilkan checksum SHA256SUMS..."
(
  cd "${DIST_DIR}"
  sha256sum "$(basename "${DEST_BIN}")" > SHA256SUMS
  sha256sum -c SHA256SUMS
)

log "SUKSES! Binary statis release & checksum tersedia di: ${DIST_DIR}"
