#!/usr/bin/env bash
# install.sh — One-line installer untuk Autore CLI (static Linux x86_64 musl).
# Penggunaan:
#   curl -fsSL https://raw.githubusercontent.com/tugure-git-intern/Autore/main/install.sh | bash
set -euo pipefail

REPO="tugure-git-intern/Autore"
BIN_NAME="autore-linux-x86_64-musl"
SUM_NAME="SHA256SUMS"
RELEASE_BASE="https://github.com/${REPO}/releases/latest/download"

ORANGE="\033[38;2;217;119;87m"
GREEN="\033[1;32m"
DIM="\033[2m"
BOLD="\033[1m"
RESET="\033[0m"

printf "\n${ORANGE}${BOLD}● Autore CLI Installer${RESET}\n"

ARCH="$(uname -m)"
OS="$(uname -s)"
if [[ "${OS}" != "Linux" || "${ARCH}" != "x86_64" ]]; then
  echo "ERROR: Installer ini hanya mendukung Linux x86_64 (terdeteksi: ${OS}/${ARCH})." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

printf "  ${ORANGE}•${RESET} Mengunduh binary statis & SHA256SUMS dari GitHub Releases...\n"
curl -fsSL "${RELEASE_BASE}/${BIN_NAME}" -o "${TMP_DIR}/${BIN_NAME}"
curl -fsSL "${RELEASE_BASE}/${SUM_NAME}" -o "${TMP_DIR}/${SUM_NAME}"

printf "  ${ORANGE}•${RESET} Memverifikasi integritas SHA-256 (fail-closed)...\n"
(
  cd "${TMP_DIR}"
  grep " ${BIN_NAME}\$" "${SUM_NAME}" | sha256sum -c - >/dev/null
)
chmod 0755 "${TMP_DIR}/${BIN_NAME}"

TARGET_DIR="${AUTORE_INSTALL_DIR:-}"
if [[ -z "${TARGET_DIR}" ]]; then
  if [[ "$(id -u)" == "0" ]]; then
    TARGET_DIR="/usr/local/bin"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    TARGET_DIR="/usr/local/bin"
  else
    TARGET_DIR="${HOME}/.local/bin"
  fi
fi

mkdir -p "${TARGET_DIR}" 2>/dev/null || sudo mkdir -p "${TARGET_DIR}"
DEST="${TARGET_DIR}/autore"

if [[ -w "${TARGET_DIR}" ]]; then
  install -m 0755 "${TMP_DIR}/${BIN_NAME}" "${DEST}"
else
  sudo install -m 0755 "${TMP_DIR}/${BIN_NAME}" "${DEST}"
fi

if [[ ":${PATH}:" != *":${TARGET_DIR}:"* ]]; then
  for rc in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
    if [[ -f "${rc}" ]] && ! grep -q "${TARGET_DIR}" "${rc}"; then
      printf '\nexport PATH="%s:$PATH"\n' "${TARGET_DIR}" >> "${rc}"
    fi
  done
  printf "  ${DIM}Info: ${TARGET_DIR} ditambahkan ke PATH shell Anda.${RESET}\n"
fi

printf "\n${GREEN}✔ Autore CLI berhasil terpasang di ${DEST}${RESET}\n"
printf "  Ketik ${ORANGE}${BOLD}autore${RESET} di terminal untuk membuka menu interaktif!\n\n"
