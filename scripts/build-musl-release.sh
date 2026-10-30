#!/usr/bin/env bash
# scripts/build-musl-release.sh — Build static x86_64-unknown-linux-musl release binary & SHA256SUMS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${DIST_DIR:-${REPO_ROOT}/dist}"
TARGET="x86_64-unknown-linux-musl"

mkdir -p "${DIST_DIR}"

log() { printf '\n==> [Build Release musl] %s\n' "$*"; }

MUSL_BUILDER_IMAGE="${MUSL_BUILDER_IMAGE:-autore/rust-musl-builder:1.85-alpine}"
MUSL_BUILDER_DOCKERFILE="${REPO_ROOT}/sandbox/services/rust-musl-builder.Dockerfile"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if ! docker image inspect "${MUSL_BUILDER_IMAGE}" >/dev/null 2>&1; then
    log "Membangun image builder ${MUSL_BUILDER_IMAGE} (sekali saja)..."
    docker build -q -t "${MUSL_BUILDER_IMAGE}" \
      -f "${MUSL_BUILDER_DOCKERFILE}" "$(dirname "${MUSL_BUILDER_DOCKERFILE}")"
  fi
  CARGO_CACHE="${REPO_ROOT}/.cargo-cache"
  mkdir -p "${CARGO_CACHE}"
  log "Menjalankan kompilasi release musl di container ${MUSL_BUILDER_IMAGE}..."
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e CARGO_HOME="/tmp/cargo-home" \
    -v "${CARGO_CACHE}:/tmp/cargo-home" \
    -v "${REPO_ROOT}:/workspace" \
    -w /workspace \
    "${MUSL_BUILDER_IMAGE}" \
    cargo build --manifest-path /workspace/cli/Cargo.toml --target "${TARGET}" --release
else
  log "docker tidak tersedia; fallback ke toolchain rustup host..."
  if ! rustup target list --installed | grep -q "^${TARGET}$"; then
    rustup target add "${TARGET}"
  fi
  cargo build --manifest-path "${REPO_ROOT}/cli/Cargo.toml" --target "${TARGET}" --release
fi

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
