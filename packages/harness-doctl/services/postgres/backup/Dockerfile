# Backup sidecar: pg_dump -> gzip -> DO Spaces (S3), on the exact cron schedule
# from the spec, via supercronic. Also ships the restore-drill (threat model T-DB-1).
FROM postgres:16-bookworm@sha256:67d92986b34dce02e7a8fc0c3cbed2f905356d74c8e52b96b898e48b18e20018

RUN apt-get update \
  && apt-get install -y --no-install-recommends awscli ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# supercronic: container-friendly cron that reads a crontab with the spec's schedule.
ADD https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 /usr/local/bin/supercronic
RUN chmod +x /usr/local/bin/supercronic

COPY backup.sh restore-drill.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-drill.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
