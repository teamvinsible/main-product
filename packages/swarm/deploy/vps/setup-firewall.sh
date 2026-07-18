#!/usr/bin/env bash
# UFW firewall for Agent Swarm VPS. Run as root after SSH is key-based.
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"

if ! command -v ufw >/dev/null 2>&1; then
  echo "Installing ufw..."
  apt-get update -qq && apt-get install -y ufw
fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow "${SSH_PORT}/tcp" comment "SSH"
ufw allow 80/tcp comment "HTTP (ACME + redirect)"
ufw allow 443/tcp comment "HTTPS"

# NEVER open 3456 (swarm) or 5432 (postgres) publicly — loopback + Caddy only.

ufw --force enable
ufw status verbose

echo "Firewall enabled. Verify SSH on port ${SSH_PORT} before closing this session."
