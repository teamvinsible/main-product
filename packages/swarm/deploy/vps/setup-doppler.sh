#!/usr/bin/env bash
# Configure Doppler for Agent Swarm on an existing VPS install.
#
# Prerequisites:
#   1. Doppler project "agent-swarm" + config "prd" with secrets (see doppler-secrets.template)
#   2. Service Token scoped to that config (Dashboard → Access → Service Tokens)
#
# Usage:
#   export DOPPLER_TOKEN=dp.st.prd.xxxx
#   sudo -E bash deploy/vps/setup-doppler.sh
#
# https://docs.doppler.com/docs/install-cli
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/agent-swarm}"
SWARM_USER="${SWARM_USER:-swarm}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo -E bash $0"
  exit 1
fi

if [[ -z "${DOPPLER_TOKEN:-}" ]]; then
  echo "ERROR: Set DOPPLER_TOKEN to a Doppler Service Token (config-scoped)."
  echo "  export DOPPLER_TOKEN=dp.st.prd.xxxx"
  exit 1
fi

bash "$(dirname "$0")/install-doppler-cli.sh"

mkdir -p /etc/doppler
cat > /etc/doppler/agent-swarm.env <<EOF
DOPPLER_TOKEN=${DOPPLER_TOKEN}
EOF
chmod 640 /etc/doppler/agent-swarm.env
chown root:${SWARM_USER} /etc/doppler/agent-swarm.env

cp "${INSTALL_DIR}/deploy/vps/doppler.yaml" "${INSTALL_DIR}/doppler.yaml"
chown ${SWARM_USER}:${SWARM_USER} "${INSTALL_DIR}/doppler.yaml"

# Verify Doppler can fetch secrets before switching systemd unit
set -a
# shellcheck source=/dev/null
source /etc/doppler/agent-swarm.env
set +a
cd "${INSTALL_DIR}"
sudo -u "${SWARM_USER}" env DOPPLER_TOKEN="${DOPPLER_TOKEN}" doppler run -- printenv SWARM_DASHBOARD_TOKEN >/dev/null \
  || { echo "ERROR: Doppler could not fetch secrets. Check project/config/token and doppler.yaml."; exit 1; }

echo "==> Restarting Postgres with Doppler-injected POSTGRES_PASSWORD..."
set -a
source /etc/doppler/agent-swarm.env
set +a
doppler run -- docker compose -f docker-compose.yml -f deploy/vps/docker-compose.prod.yml up -d

echo "==> Migrating database..."
doppler run -- npm run db:migrate

cp "${INSTALL_DIR}/deploy/vps/agent-swarm-doppler.service" /etc/systemd/system/agent-swarm.service
systemctl daemon-reload
systemctl enable agent-swarm
systemctl restart agent-swarm

echo ""
echo "==> Doppler enabled. API keys are no longer required in ${INSTALL_DIR}/.env"
echo "    Manage secrets at https://dashboard.doppler.com"
echo "    Only /etc/doppler/agent-swarm.env contains the Service Token."
echo ""
echo "    systemctl status agent-swarm"
echo "    doppler secrets --project agent-swarm --config prd"
