#!/usr/bin/env bash
# Writes a crontab from the spec's BACKUP_SCHEDULE and hands off to supercronic.
set -euo pipefail

SCHEDULE="${BACKUP_SCHEDULE:-0 */6 * * *}"
DRILL_SCHEDULE="${RESTORE_DRILL_SCHEDULE:-0 3 * * 0}"
echo "${SCHEDULE} /usr/local/bin/backup.sh" > /etc/crontab.harness
echo "${DRILL_SCHEDULE} /usr/local/bin/restore-drill.sh > /tmp/last-restore-drill.json" >> /etc/crontab.harness

echo "[pgbackup] schedule='${SCHEDULE}' restore_drill='${DRILL_SCHEDULE}' db='${PGDATABASE}' host='${PGHOST}' bucket='${S3_BUCKET:-?}'"
exec /usr/local/bin/supercronic /etc/crontab.harness
