#!/usr/bin/env bash
set -euo pipefail

# Generate a per-project certificate on first initialization. Clients use
# sslmode=require and the database remains isolated on the internal network.
if [ ! -f "${PGDATA}/server.key" ]; then
  openssl req -new -x509 -days 825 -nodes -subj "/CN=postgres" \
    -keyout "${PGDATA}/server.key" -out "${PGDATA}/server.crt"
  chmod 0600 "${PGDATA}/server.key"
fi

cat >> "${PGDATA}/postgresql.conf" <<'EOF'
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
EOF
