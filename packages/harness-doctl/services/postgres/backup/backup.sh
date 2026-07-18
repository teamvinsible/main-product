#!/usr/bin/env bash
# One backup: pg_dump -> gzip -> DO Spaces with server-side encryption.
set -euo pipefail

TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/tmp/${PGDATABASE}-${TS}.sql.gz"
KEY="${PGDATABASE}/${TS}.sql.gz"

echo "[backup] dumping ${PGDATABASE}@${PGHOST}"
pg_dump --no-owner --no-privileges \
  "dbname=${PGDATABASE} host=${PGHOST} user=${PGUSER} sslmode=require" \
  | gzip > "${FILE}"

echo "[backup] uploading s3://${S3_BUCKET}/${KEY}"
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${FILE}" "s3://${S3_BUCKET}/${KEY}" --sse AES256

rm -f "${FILE}"
echo "[backup] done ${TS}"
