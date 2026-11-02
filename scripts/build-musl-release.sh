#!/usr/bin/env bash
# scripts/build-musl-release.sh — Build static x86_64-unknown-linux-musl release binary & SHA256SUMS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)"
if [[ -n "${WORKSPACE:-}" && -f "${WORKSPACE}/cli/Cargo.toml" ]]; then
  REPO_ROOT="${WORKSPACE}"
elif [[ -f "$(pwd)/cli/Cargo.toml" ]]; then
  REPO_ROOT="$(pwd)"
else
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
DIST_DIR="${DIST_DIR:-${REPO_ROOT}/dist}"
TARGET="x86_64-unknown-linux-musl"
WIN_TARGET="x86_64-pc-windows-gnu"
VERSION="$(grep -E '^version\s*=\s*"' "${REPO_ROOT}/cli/Cargo.toml" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
RELEASE_TAG="v${VERSION}"

mkdir -p "${DIST_DIR}"

log() { printf '\n==> [Build Release musl + windows] %s\n' "$*"; }

MUSL_BUILDER_IMAGE="${MUSL_BUILDER_IMAGE:-autore/rust-cross-builder:1.95}"
MUSL_BUILDER_DOCKERFILE="${REPO_ROOT}/sandbox/services/rust-musl-builder.Dockerfile"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if ! docker image inspect "${MUSL_BUILDER_IMAGE}" >/dev/null 2>&1; then
    log "Membangun image builder ${MUSL_BUILDER_IMAGE} (sekali saja)..."
    docker build -q -t "${MUSL_BUILDER_IMAGE}" \
      -f "${MUSL_BUILDER_DOCKERFILE}" "$(dirname "${MUSL_BUILDER_DOCKERFILE}")"
  fi
  CARGO_CACHE="${CARGO_CACHE_DIR:-${HOME}/.cache/autore/musl-cargo}"
  mkdir -p "${CARGO_CACHE}"
  log "Menjalankan kompilasi release Linux musl & Windows (.exe) di container ${MUSL_BUILDER_IMAGE}..."
  docker run --rm \
    --user 0:0 \
    -e CARGO_HOME="/cargo" \
    -e AUTORE_RELEASE_VERSION="${RELEASE_TAG}" \
    -e HOST_UID="$(id -u)" \
    -e HOST_GID="$(id -g)" \
    -v "${CARGO_CACHE}:/cargo" \
    -v "${REPO_ROOT}:/workspace" \
    -w /workspace \
    "${MUSL_BUILDER_IMAGE}" \
    sh -c "cargo build --locked --manifest-path /workspace/cli/Cargo.toml --target ${TARGET} --release && cargo build --locked --manifest-path /workspace/cli/Cargo.toml --target ${WIN_TARGET} --release && chown -R \${HOST_UID}:\${HOST_GID} /workspace/cli/target /cargo"
else
  log "docker tidak tersedia; fallback ke toolchain rustup host..."
  for t in "${TARGET}" "${WIN_TARGET}"; do
    if ! rustup target list --installed | grep -q "^${t}$"; then
      rustup target add "${t}"
    fi
  done
  AUTORE_RELEASE_VERSION="${RELEASE_TAG}" cargo build --locked --manifest-path "${REPO_ROOT}/cli/Cargo.toml" --target "${TARGET}" --release
  AUTORE_RELEASE_VERSION="${RELEASE_TAG}" cargo build --locked --manifest-path "${REPO_ROOT}/cli/Cargo.toml" --target "${WIN_TARGET}" --release
fi

SRC_BIN="${REPO_ROOT}/cli/target/${TARGET}/release/autore"
DEST_BIN="${DIST_DIR}/autore-linux-x86_64-musl"
SRC_WIN="${REPO_ROOT}/cli/target/${WIN_TARGET}/release/autore.exe"
DEST_WIN="${DIST_DIR}/autore-windows-x86_64.exe"

[[ -f "${SRC_BIN}" ]] || { echo "ERROR: Binary hasil kompilasi tidak ditemukan di ${SRC_BIN}" >&2; exit 1; }
[[ -f "${SRC_WIN}" ]] || { echo "ERROR: Binary Windows hasil kompilasi tidak ditemukan di ${SRC_WIN}" >&2; exit 1; }

cp "${SRC_BIN}" "${DEST_BIN}"
chmod 0755 "${DEST_BIN}"
cp "${SRC_WIN}" "${DEST_WIN}"

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
  sha256sum "$(basename "${DEST_BIN}")" "$(basename "${DEST_WIN}")" > SHA256SUMS
  sha256sum -c SHA256SUMS
)

log "SUKSES! Binary statis release & checksum tersedia di: ${DIST_DIR}"
