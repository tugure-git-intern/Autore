#!/usr/bin/env bash
# setup-agent.sh — prepare an Ubuntu 24.04 host to act as a Jenkins runner.
#
# Installs Java 21 (headless), Docker + Compose v2, Node.js >= 22, creates the
# `jenkins` system user and adds it to the `docker` group. Safe to run more
# than once.

# Why Node here: web/.nvmrc pins 22 and the guard test
# web/apps/api/src/node-version.test.ts fails the Web Quality Gate stage on an
# older runtime. The Ubuntu repo only ships 18 for this release, so Node comes
# from the official tarball into /usr/local — that directory is already on the
# systemd default PATH, so the agent picks it up without a unit override.
#
# Usage:
#   sudo ./runner/setup-agent.sh [--add-user <name>]...
#
#   --add-user <name>   Also add <name> to the docker group (e.g. your own
#                       login, so you can run `docker compose` without sudo).
#
# NOTE: members of the docker group are effectively root on this machine.

set -euo pipefail

AGENT_USER="jenkins"
AGENT_HOME="/home/${AGENT_USER}"
AGENT_WORKDIR="${AGENT_HOME}/agent"
PACKAGES=(openjdk-21-jre-headless docker.io docker-compose-v2 curl ca-certificates)

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

extra_users=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-user)
      [[ $# -ge 2 ]] || die "--add-user needs a user name"
      extra_users+=("$2")
      shift 2
      ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      die "unknown argument: $1 (see --help)"
      ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || die "must be run as root (use: sudo $0 ...)"

for u in "${extra_users[@]}"; do
  id "$u" >/dev/null 2>&1 || die "user '$u' does not exist"
done

log "Installing packages: ${PACKAGES[*]}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q "${PACKAGES[@]}"

log "Enabling Docker service"
systemctl enable --now docker

if id "${AGENT_USER}" >/dev/null 2>&1; then
  log "User '${AGENT_USER}' already exists — keeping it"
else
  log "Creating system user '${AGENT_USER}'"
  useradd --system --create-home --home-dir "${AGENT_HOME}" --shell /bin/bash "${AGENT_USER}"
fi

log "Adding '${AGENT_USER}' to the docker group"
usermod -aG docker "${AGENT_USER}"

for u in "${extra_users[@]}"; do
  log "Adding '$u' to the docker group (log out and back in to take effect)"
  usermod -aG docker "$u"
done

# --- Node.js >= 22 -----------------------------------------------------------
# Pinned the same major as web/.nvmrc; override with NODE_VERSION=<x.y.z>.
NODE_MAJOR_MIN="22"
NODE_VERSION="${NODE_VERSION:-22.23.4}"
NODE_PREFIX="/usr/local/lib/node22"
NODE_LINK_DIR="/usr/local/bin"

node_major() { "$1" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

install_node() {
  if [[ "$(node_major "${NODE_PREFIX}/bin/node")" -ge "${NODE_MAJOR_MIN}" ]]; then
    log "Node $("${NODE_PREFIX}/bin/node" -v) already installed — skipping"
  else
    local arch tarball url
    arch="$(uname -m)"
    [[ "${arch}" == "x86_64" ]] || die "this script only knows the x86_64 Node tarball (host is ${arch})"
    url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"
    log "Installing Node ${NODE_VERSION} into ${NODE_PREFIX}"
    tarball="$(mktemp)"
    curl -fsSL -o "${tarball}" "${url}" || die "could not download ${url}"
    rm -rf "${NODE_PREFIX}.new"
    install -d -m 0755 "${NODE_PREFIX}.new"
    tar -xzf "${tarball}" -C "${NODE_PREFIX}.new" --strip-components=1
    rm -f "${tarball}"
    rm -rf "${NODE_PREFIX}"
    mv "${NODE_PREFIX}.new" "${NODE_PREFIX}"
    chown -R root:root "${NODE_PREFIX}"
    chmod -R a+rX "${NODE_PREFIX}"
  fi

  local bin
  for bin in node npm npx; do
    ln -sfn "${NODE_PREFIX}/bin/${bin}" "${NODE_LINK_DIR}/${bin}"
  done

  [[ "$(node_major "${NODE_LINK_DIR}/node")" -ge "${NODE_MAJOR_MIN}" ]] \
    || die "node in ${NODE_LINK_DIR} is not >= ${NODE_MAJOR_MIN} — check PATH order"
  log "Node on PATH: $("${NODE_LINK_DIR}/node" -v) (npm $("${NODE_LINK_DIR}/npm" -v))"
}

install_node

log "Preparing agent work directory ${AGENT_WORKDIR}"
install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0750 "${AGENT_WORKDIR}"

# Install Autore CLI to /usr/local/bin so the jenkins runner can execute it
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${REPO_ROOT}/cli/target/release/autore" ]; then
  log "Installing Autore CLI to /usr/local/bin/autore"
  install -m 0755 "${REPO_ROOT}/cli/target/release/autore" /usr/local/bin/autore
elif [ -n "${SUDO_USER:-}" ] && [ -f "/home/${SUDO_USER}/.local/bin/autore" ]; then
  log "Installing Autore CLI to /usr/local/bin/autore"
  install -m 0755 "/home/${SUDO_USER}/.local/bin/autore" /usr/local/bin/autore
fi

if [ -d "${REPO_ROOT}/scripts" ]; then
  log "Installing CI orchestrator scripts to /usr/local/lib/autore-ci"
  install -d -o root -g root -m 0755 /usr/local/lib/autore-ci
  install -o root -g root -m 0755 "${REPO_ROOT}"/scripts/*.sh /usr/local/lib/autore-ci/
  if [ -f "${REPO_ROOT}/sandbox/services/mitigated-cacerts" ]; then
    install -o root -g root -m 0644 "${REPO_ROOT}/sandbox/services/mitigated-cacerts" /usr/local/lib/autore-ci/mitigated-cacerts
  fi
fi

log "Done. Versions:"
java -version 2>&1 | head -1
docker --version
docker compose version
node -v
npm -v
if [ -x /usr/local/bin/autore ]; then
  /usr/local/bin/autore --version
fi
