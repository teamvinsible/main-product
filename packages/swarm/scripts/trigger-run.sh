#!/usr/bin/env bash
# Trigger a swarm change via the control API. Requires SWARM_PUBLIC_URL and SWARM_DASHBOARD_TOKEN.
set -euo pipefail

URL="${SWARM_PUBLIC_URL:?Set SWARM_PUBLIC_URL}"
TOKEN="${SWARM_DASHBOARD_TOKEN:?Set SWARM_DASHBOARD_TOKEN}"
PROJECT="${1:?Usage: trigger-run.sh <project> <request>}"
REQUEST="${2:?Usage: trigger-run.sh <project> <request>}"

curl -sS -X POST "${URL%/}/api/run" \
  -H "Content-Type: application/json" \
  -H "x-swarm-token: ${TOKEN}" \
  -d "{\"mode\":\"change\",\"project\":\"${PROJECT}\",\"request\":$(printf '%s' "$REQUEST" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"intent\":\"change\",\"localOnly\":true}"

echo
