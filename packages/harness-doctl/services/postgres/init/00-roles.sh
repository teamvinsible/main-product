#!/usr/bin/env bash
# Runs once at DB init (mounted into /docker-entrypoint-initdb.d). Creates the
# PostgREST role chain: `authenticator` logs in and can SET ROLE to `web_anon`
# (unauthenticated) or `authenticated`. RLS policies decide row access from there.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE web_anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '${AUTHENTICATOR_PASSWORD:-$POSTGRES_PASSWORD}';

  GRANT web_anon      TO authenticator;
  GRANT authenticated TO authenticator;

  GRANT USAGE ON SCHEMA public TO web_anon, authenticated;

  -- Least privilege: anon can read, authenticated can write. RLS still gates rows.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO web_anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
SQL
