#!/usr/bin/env bash
# install-agent-service.sh — connect this host to a Jenkins controller as an
# inbound agent, running as a systemd service. Safe to run again (e.g. to
# rotate the secret or point at another controller).
#
# Usage:
#   sudo ./runner/install-agent-service.sh <JENKINS_URL> <AGENT_NAME>
#
#   Example: sudo ./runner/install-agent-service.sh http://localhost:8080/ vps-runner-1
#
# The agent secret (shown on the node's page in Jenkins) is asked
# interactively, so it never appears in shell history or `ps`.
#
# Requires: runner/setup-agent.sh has been run (user jenkins + Java 21).

set -euo pipefail

AGENT_USER="jenkins"
AGENT_WORKDIR="/home/${AGENT_USER}/agent"
JAR_DIR="/opt/jenkins-agent"
CONF_DIR="/etc/jenkins-agent"
UNIT_NAME="jenkins-agent.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '==> %s\n' "$*"; }

case "${1:-}" in
  -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

[[ $# -eq 2 ]] || die "usage: sudo $0 <JENKINS_URL> <AGENT_NAME>  (see --help)"
JENKINS_URL="$1"
AGENT_NAME="$2"

[[ "${JENKINS_URL}" =~ ^https?:// ]] || die "JENKINS_URL must start with http:// or https://"
[[ "${AGENT_NAME}" =~ ^[A-Za-z0-9._-]+$ ]] || die "AGENT_NAME may only contain letters, digits, '.', '_' and '-'"
[[ "${EUID}" -eq 0 ]] || die "must be run as root (use: sudo $0 ...)"
id "${AGENT_USER}" >/dev/null 2>&1 || die "user '${AGENT_USER}' not found — run runner/setup-agent.sh first"
[[ -x /usr/bin/java ]] || die "/usr/bin/java not found — run runner/setup-agent.sh first"
[[ -f "${SCRIPT_DIR}/${UNIT_NAME}" ]] || die "${UNIT_NAME} not found next to this script"

read -rsp "Agent secret for '${AGENT_NAME}': " AGENT_SECRET
echo
[[ -n "${AGENT_SECRET}" ]] || die "secret is empty"
[[ "${AGENT_SECRET}" =~ ^[^[:space:]]+$ ]] || die "secret must not contain spaces"

JAR_URL="${JENKINS_URL%/}/jnlpJars/agent.jar"
log "Downloading ${JAR_URL}"
tmp_jar="$(mktemp)"
trap 'rm -f "${tmp_jar}"' EXIT
curl -fsSL -o "${tmp_jar}" "${JAR_URL}" || die "could not download agent.jar — is the controller reachable at ${JENKINS_URL}?"
install -d -m 0755 "${JAR_DIR}"
install -m 0644 "${tmp_jar}" "${JAR_DIR}/agent.jar"

log "Writing ${CONF_DIR}/agent.env and secret"
install -d -o root -g "${AGENT_USER}" -m 0750 "${CONF_DIR}"
cat > "${CONF_DIR}/agent.env" <<EOF
JENKINS_URL=${JENKINS_URL}
AGENT_NAME=${AGENT_NAME}
AGENT_WORKDIR=${AGENT_WORKDIR}
EOF
chown root:"${AGENT_USER}" "${CONF_DIR}/agent.env"
chmod 0640 "${CONF_DIR}/agent.env"

( umask 077; printf '%s' "${AGENT_SECRET}" > "${CONF_DIR}/secret" )
chown "${AGENT_USER}:${AGENT_USER}" "${CONF_DIR}/secret"
chmod 0600 "${CONF_DIR}/secret"
unset AGENT_SECRET

install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0755 "${AGENT_WORKDIR}"

log "Installing systemd unit"
install -m 0644 "${SCRIPT_DIR}/${UNIT_NAME}" "/etc/systemd/system/${UNIT_NAME}"
systemctl daemon-reload
systemctl enable "${UNIT_NAME}"
systemctl restart "${UNIT_NAME}"

sleep 3
if systemctl is-active --quiet "${UNIT_NAME}"; then
  log "Agent service is active. Check the node page in Jenkins — '${AGENT_NAME}' should be online."
  log "Logs: journalctl -u ${UNIT_NAME} -f"
else
  journalctl -u "${UNIT_NAME}" -n 30 --no-pager >&2 || true
  die "agent service failed to start (logs above)"
fi
