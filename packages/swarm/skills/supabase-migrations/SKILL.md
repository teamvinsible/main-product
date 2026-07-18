---
description: Supabase migration workflow — author SQL locally, apply via CI, never exec_sql in agents.
tags: [supabase, database, migrations]
---

# Supabase Migrations

## Authoring
- Add migrations under `supabase/migrations/*.sql` in the project app.
- Name files with timestamp prefix: `YYYYMMDDHHMMSS_description.sql`.

## Apply policy
- **Default:** migrations apply via generated GitHub CI workflows, not agent shell.
- Local validation: `supabase db reset --local` when CLI is available.
- Production requires `SWARM_MIGRATION_PRODUCTION_APPROVED=true` for privileged executor.

## Agent rules
- Never use `exec_sql` RPC to apply migrations in production.
- Write `_artifacts/backend/migration-readiness.json` before QA when migrations exist.
