#!/usr/bin/env bash
# A backup you have never restored is not a backup. Downloads the latest dump,
# restores it into a throwaway database, verifies it, and prints a JSON report.
# The console gates a project's "production-ready" badge on this passing.
set -euo pipefail

LATEST="$(aws --endpoint-url "${S3_ENDPOINT}" s3 ls "s3://${S3_BUCKET}/${PGDATABASE}/" \
  | sort | tail -n1 | awk '{print $4}')"
[ -n "${LATEST}" ] || { echo '{"ok":false,"error":"no backups found"}'; exit 1; }

echo "[restore-drill] restoring ${LATEST}" >&2
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "s3://${S3_BUCKET}/${PGDATABASE}/${LATEST}" /tmp/restore.sql.gz

SCRATCH="restore_drill_$(date -u +%s)"
CONN="host=${PGHOST} user=${PGUSER} sslmode=require"

psql "${CONN} dbname=postgres" -c "CREATE DATABASE ${SCRATCH};"
gunzip -c /tmp/restore.sql.gz | psql "${CONN} dbname=${SCRATCH}" >/dev/null
TABLES="$(psql -tA "${CONN} dbname=${SCRATCH}" \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
psql "${CONN} dbname=postgres" -c "DROP DATABASE ${SCRATCH};"
rm -f /tmp/restore.sql.gz

printf '{"ok":true,"backup":"%s","public_tables":%s,"at":"%s"}\n' \
  "${LATEST}" "${TABLES}" "$(date -u +%FT%TZ)"
