#!/usr/bin/env bash
# Agent Swarm VPS installer (Ubuntu 22.04/24.04, Debian 12).
# Run as root on a fresh droplet:
#   curl -fsSL <raw-url>/deploy/vps/install.sh | bash
# Or from a cloned repo:
#   sudo bash deploy/vps/install.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/agent-swarm}"
SWARM_USER="${SWARM_USER:-swarm}"
DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-https://github.com/ansi2u/agent-swarm.git}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

echo "==> Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y curl git ufw fail2ban ca-certificates gnupg

# Node 22 via NodeSource
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p process.versions.node.split('.')[0])" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Docker
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# Caddy
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y caddy
fi

echo "==> Creating service user..."
if ! id "${SWARM_USER}" &>/dev/null; then
  useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SWARM_USER}"
fi
usermod -aG docker "${SWARM_USER}" || true

echo "==> Cloning / updating Agent Swarm..."
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" pull --ff-only
else
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
npm ci 2>/dev/null || npm install
npm run web:install
npm run build

echo "==> Environment file..."
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  cp .env.example .env
  TOKEN=$(openssl rand -hex 32)
  GH_SECRET=$(openssl rand -hex 32)
  DB_PASS=$(openssl rand -hex 24)
  sed -i "s|^SWARM_DASHBOARD_TOKEN=.*|SWARM_DASHBOARD_TOKEN=${TOKEN}|" .env
  sed -i "s|^SWARM_GITHUB_WEBHOOK_SECRET=.*|SWARM_GITHUB_WEBHOOK_SECRET=${GH_SECRET}|" .env
  sed -i "s|^SWARM_BIND=.*|SWARM_BIND=127.0.0.1|" .env
  sed -i "s|^SWARM_SANDBOX=.*|SWARM_SANDBOX=exec|" .env
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://swarm:${DB_PASS}@127.0.0.1:5432/swarm|" .env
  echo "POSTGRES_PASSWORD=${DB_PASS}" > "${INSTALL_DIR}/.postgres.env"
  chmod 600 .env .postgres.env
  echo ""
  echo "IMPORTANT: Edit ${INSTALL_DIR}/.env and add LLM API keys (ANTHROPIC_API_KEY, etc.)"
  echo "Dashboard token (save this): ${TOKEN}"
fi

chown -R "${SWARM_USER}:${SWARM_USER}" "${INSTALL_DIR}"

echo "==> Starting Postgres (localhost only)..."
if [[ -f .postgres.env ]]; then
  set -a; source .postgres.env; set +a
fi
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required; run the installer-generated .postgres.env setup first}"
export POSTGRES_PASSWORD
docker compose -f docker-compose.yml -f deploy/vps/docker-compose.prod.yml up -d
npm run db:migrate

echo "==> Installing systemd service..."
cp deploy/vps/agent-swarm.service /etc/systemd/system/agent-swarm.service
systemctl daemon-reload
systemctl enable agent-swarm
systemctl restart agent-swarm

echo "==> Firewall..."
bash deploy/vps/setup-firewall.sh

if [[ -n "${DOMAIN}" ]]; then
  echo "==> Configuring Caddy for ${DOMAIN}..."
  sed "s/swarm.example.com/${DOMAIN}/g" deploy/vps/Caddyfile > /etc/caddy/Caddyfile
  sed -i "s|^SWARM_PUBLIC_URL=.*|SWARM_PUBLIC_URL=https://${DOMAIN}|" .env
  sed -i "s|^SWARM_ALLOWED_ORIGINS=.*|SWARM_ALLOWED_ORIGINS=https://${DOMAIN}|" .env
  systemctl reload caddy
else
  cp deploy/vps/Caddyfile /etc/caddy/Caddyfile
  echo "Set DOMAIN=your.domain.com and re-run Caddy config, or edit /etc/caddy/Caddyfile"
fi

systemctl enable fail2ban
systemctl restart fail2ban

echo ""
echo "==> Done. Dark factory is running."
echo "    systemctl status agent-swarm"
echo "    journalctl -u agent-swarm -f"
if [[ -n "${DOMAIN}" ]]; then
  echo "    Dashboard: https://${DOMAIN}/?token=<SWARM_DASHBOARD_TOKEN from .env>"
fi
echo ""
echo "==> Optional: use Doppler for secrets (recommended production)"
echo "    1. Create Doppler project agent-swarm / config prd (see deploy/vps/doppler-secrets.template)"
echo "    2. export DOPPLER_TOKEN=dp.st.prd.xxx && sudo -E bash deploy/vps/setup-doppler.sh"
echo "    https://docs.doppler.com/docs/install-cli"
