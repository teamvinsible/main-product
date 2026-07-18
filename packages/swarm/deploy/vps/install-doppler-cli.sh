#!/usr/bin/env bash
# Install Doppler CLI on Ubuntu/Debian (production VPS).
# https://docs.doppler.com/docs/install-cli
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y apt-transport-https ca-certificates curl gnupg

if command -v doppler >/dev/null 2>&1; then
  echo "Doppler CLI already installed: $(doppler --version)"
  exit 0
fi

# Debian/Ubuntu official package (docs.doppler.com)
curl -sLf --retry 3 --tlsv1.2 --proto "=https" \
  'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' \
  | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" \
  > /etc/apt/sources.list.d/doppler-cli.list
apt-get update -qq && apt-get install -y doppler

echo "Installed: $(doppler --version)"
