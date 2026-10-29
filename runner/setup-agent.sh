#!/usr/bin/env bash
# setup-agent.sh — prepare an Ubuntu 24.04 host to act as a Jenkins runner.
#
# Installs Java 21 (headless), Docker + Compose v2, creates the `jenkins`
# system user and adds it to the `docker` group. Safe to run more than once.
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

log "Done. Versions:"
java -version 2>&1 | head -1
docker --version
docker compose version
if [ -x /usr/local/bin/autore ]; then
  /usr/local/bin/autore --version
fi
