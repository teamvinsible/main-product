# Agent Swarm

Agent Swarm is a local TypeScript CLI and dashboard for running an autonomous app-development agent pipeline. It can start greenfield builds, import existing source projects, apply follow-up changes, monitor runs, persist run state in Postgres, learn from completed projects, optionally work through GitHub branches and PRs, and trigger deployments through provider adapters.

The main executable is `swarm`.

## What It Does

- Builds new projects from a product idea.
- Imports existing local folders or GitHub repositories into managed workspaces.
- Applies feature, bugfix, refactor, SEO, and marketing requests to existing projects.
- Uses a Vite/React dashboard to launch, resume, inspect, configure, and deploy runs.
- Persists projects, runs, logs, agent output, evals, commits, deployments, prompt overrides, and learnings in Postgres.
- Supports provider routing across Claude (SDK + raw API), OpenRouter, Codex, DeepSeek, and custom provider hooks.
- Supports GitHub repo binding, credential profiles, work-order branches, PR creation, and optional CI repair loops.
- Supports project-level environment overrides, MCP server configuration, Docker command sandboxing, and deployment profiles.

Agent Swarm is a local developer tool, not a hosted cloud service. Keep the dashboard/API private unless you put an authenticated gateway in front of it.

## Requirements

- Node.js 18 or newer
- npm
- Docker, if you use the included Postgres setup or command sandboxing
- At least one configured agent provider
- GitHub token only if you want repo commits, branches, PRs, or CI feedback
- Provider deploy credentials only if you use `swarm deploy`

## Quick Start

```bash
git clone https://github.com/ansi2u/agent-swarm.git
cd agent-swarm
npm install
npm run web:install
cp .env.example .env
npm run db:up
npm run build
```

Run a new project without the dashboard:

```bash
npm run start -- run "Build a TypeScript tic-tac-toe CLI with tests" --name tictactoe --no-ui
```

Or link the CLI locally:

```bash
npm link
swarm run "Build a simple React todo app" --name todo --no-ui
```

Generated and imported projects are managed under `.swarm/workspaces/`.

## Environment

Copy the complete template once — all variables (providers, VPS, webhooks, skills, sandbox, deploy) are documented in [`.env.example`](.env.example):

```bash
cp .env.example .env
```

The local Docker database defaults to:

```env
DATABASE_URL=postgres://swarm:swarm@localhost:5432/swarm
```

Common provider variables:

```env
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
GITHUB_TOKEN=
GH_TOKEN=
```

Provider notes:

- `claude`: Uses Claude Code authentication when available. `ANTHROPIC_API_KEY` may be optional depending on your local auth.
- `anthropic`: Claude via the raw Messages API on the unified tool loop. Requires `ANTHROPIC_API_KEY`.
- `deepseek`: Requires `DEEPSEEK_API_KEY`.
- `openrouter`: One gateway fronting many providers (Anthropic/OpenAI/DeepSeek/Google/…). Requires `OPENROUTER_API_KEY`; pass models as OpenRouter slugs, e.g. `--high-model anthropic/claude-opus-4.8 --low-model deepseek/deepseek-chat`.
- `codex`: Available as a provider option in model routing.
- `custom`: Stubbed in `src/agent.ts` for local provider integration.
- `GITHUB_TOKEN` or `GH_TOKEN`: Required for GitHub repo automation.

Named GitHub credential profiles use suffixed environment variables. For example, profile `client-a` uses:

```env
GITHUB_TOKEN_CLIENT_A=
```

Per-project `.env` files in `.swarm/workspaces/<project>/.env` override the global `.env` for that project.

## CLI Usage

Show help:

```bash
swarm --help
```

Create a new project:

```bash
swarm run "A task management app with AI-powered prioritization"
```

Create a named project:

```bash
swarm run "A task management app" --name taskmate --no-ui
```

Force a project type:

```bash
swarm types
swarm run "A CLI tool for batch-renaming files" --type cli-tool --name renamer
```

Route models/providers:

```bash
swarm run "Chat app" --provider codex --low-model o4-mini
swarm run "Chat app" --high-provider claude --low-provider deepseek
```

Apply follow-up work to a registered project:

```bash
swarm feature taskmate "Add a weekly leaderboard"
swarm fix taskmate "Login button does nothing on Safari"
swarm change taskmate "Tighten the onboarding copy"
```

Use `--local-only` when changing a project that is not linked to GitHub:

```bash
swarm change taskmate "Refactor onboarding copy" --local-only
```

Resume the latest saved work order:

```bash
swarm resume ./.swarm/workspaces/taskmate
```

Check saved project state:

```bash
swarm status ./.swarm/workspaces/taskmate
```

## Existing Projects

For an existing project that is new to Agent Swarm, start with `swarm run`. If the prompt includes a local folder path, Agent Swarm copies that source into the managed workspace under the primary code root (usually `app/`, or an existing root like `web/` when present).

```bash
swarm run "Continue development on the existing project at 'C:\path\to\project'. Inspect it first, preserve current functionality, and make only the requested changes." --name my-project --no-ui
```

For a GitHub source project:

```bash
swarm run "Continue development on this existing app" --name my-project --repo owner/repo
```

After the first run registers the project, use `swarm feature`, `swarm fix`, or `swarm change` for follow-up work.

## Dashboard

Start the full control dashboard:

```bash
swarm serve --port 3456
```

`swarm dashboard` is also available. By default it runs in control mode; pass `--read-only` to disable launch/settings POST endpoints:

```bash
swarm dashboard --port 3456
swarm dashboard --read-only --port 3456
```

The dashboard supports:

- Chat-style Launch intake for new builds and existing-project changes.
- Project list and detail views.
- Live logs, agent runs, attempts, evals, commits, artifacts, and flow timeline.
- Project GitHub binding.
- Global and per-project environment variables.
- MCP configuration editing.
- Prompt override editing.
- Deploy target binding and deploy execution.
- Resume and stop controls for dashboard-launched work.

## Control API And Chat Integrations

`swarm serve` exposes a local HTTP API used by the dashboard:

- `POST /api/intake`: infer new-build vs. change from a free-form request.
- `POST /api/run`: launch a new project.
- `POST /api/run` with `mode: "change"`: launch a change request.
- `POST /api/resume`: resume a saved work order.
- `POST /api/run/stop`: stop a dashboard-launched process.
- `GET /api/projects`, `/api/running`, `/api/state`, `/api/logs`, `/api/agent-runs`, `/api/evals`, `/api/artifacts`: inspect run state.

Example new-run payload:

```json
{
  "idea": "Build a React CRM dashboard",
  "name": "crm-dashboard",
  "provider": "claude",
  "type": "auto"
}
```

Example change payload:

```json
{
  "mode": "change",
  "project": "crm-dashboard",
  "request": "Fix the broken customer search filter",
  "intent": "bugfix",
  "localOnly": true,
  "provider": "claude"
}
```

Telegram, Google Chat, Slack, Discord, or email initiation can use the built-in webhook adapters (`/api/webhooks/telegram`, `/api/webhooks/google-chat`) or a small custom adapter that validates the sender and calls the local API. Do not expose the dashboard API directly to the public internet without authentication.

### Built-in webhooks (`swarm serve`)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/webhooks/telegram` | Bot commands: `/run`, `/change`, `/status`, `/resume` |
| `POST /api/webhooks/google-chat` | Google Chat app commands (same verbs) |
| `POST /api/webhooks/github` | `issue_comment` with `/swarm fix …`, `workflow_dispatch` |

Configure in `.env`: `SWARM_TELEGRAM_*`, `SWARM_GOOGLE_CHAT_*`, `SWARM_GITHUB_WEBHOOK_SECRET`, `SWARM_GITHUB_ALLOWED_REPOS`. Webhooks use their own secrets (exempt from `SWARM_DASHBOARD_TOKEN`). Status push: Telegram (`SWARM_TELEGRAM_BOT_TOKEN` + `SWARM_TELEGRAM_CHAT_ID`) and/or Google Chat (`SWARM_GOOGLE_CHAT_WEBHOOK_URL`).

### VPS / always-on hosting (dark factory)

Full secure deployment guide: **[`deploy/vps/README.md`](deploy/vps/README.md)** (DigitalOcean, Hetzner, Vultr, firewall, TLS, webhooks).

Quick install on Ubuntu:

```bash
export DOMAIN=swarm.yourdomain.com
git clone https://github.com/ansi2u/agent-swarm.git /opt/agent-swarm
cd /opt/agent-swarm && DOMAIN=$DOMAIN bash deploy/vps/install.sh
```

Templates: [`deploy/vps/`](deploy/vps/) (systemd, Caddy, firewall, **Doppler**). Cron: [`scripts/trigger-run.sh`](scripts/trigger-run.sh).

**Production secrets:** use [Doppler](https://docs.doppler.com/docs/install-cli) — see [`deploy/vps/README.md#doppler`](deploy/vps/README.md).

### Google Chat app setup

1. **Google Cloud Console** → APIs & Services → Enable **Google Chat API**.
2. **Google Chat API** → **Configuration** → Create app:
   - **App name:** Agent Swarm
   - **Connection settings:** HTTP endpoint URL
   - **URL:** `https://<your-domain>/api/webhooks/google-chat`
   - **Authentication Audience:** HTTP endpoint URL (same URL as above)
3. Under **Visibility**, choose who can install (domain or specific users).
4. **Publish** the app (or keep in test mode with tester emails).
5. In Google Chat, **Add apps** → install Agent Swarm in a space or DM.
6. Set in `.env` / Doppler:
   ```env
   SWARM_PUBLIC_URL=https://swarm.yourdomain.com
   SWARM_GOOGLE_CHAT_AUDIENCE_URL=https://swarm.yourdomain.com/api/webhooks/google-chat
   SWARM_GOOGLE_CHAT_ALLOWED_USERS=you@company.com
   ```
7. **Optional status push:** In the Chat space → **Apps & integrations** → **Webhooks** → create webhook → set `SWARM_GOOGLE_CHAT_WEBHOOK_URL`.

Commands in Chat: `/run <idea>`, `/change <project> <request>`, `/status [project]`, `/resume <project>`.

If you use **Project Number** auth in Google Console instead of endpoint URL audience, set `SWARM_GOOGLE_CHAT_PROJECT_NUMBER` and leave `SWARM_GOOGLE_CHAT_AUDIENCE_URL` empty.

### Skills

Agents discover `SKILL.md` files under `skills/`, `.swarm/skills/`, and per-project `skills/`. Bundled starters: `nextjs-app-router`, `supabase-migrations`, `vercel-deploy`, `seo-audit`. Tools: `list_skills`, `load_skill`, `propose_step` (route changes auto-applied when valid).

## GitHub Workflow

New builds can commit directly to a configured repo:

```bash
swarm run "A docs site" --name docs-site --repo ansi2u/docs-site
```

Existing-project changes use a dedicated work-order branch and can open a PR when GitHub credentials are configured:

```bash
swarm change docs-site "Add API reference pages" --repo ansi2u/docs-site --repo-profile default
```

Use named profiles for separate accounts or clients:

```bash
swarm change client-app "Fix checkout validation" --repo client/app --repo-profile client-a
```

Project GitHub bindings can also be saved from the dashboard.

## Deployments

Deploy from the CLI:

```bash
swarm deploy <project> --provider <vercel|digitalocean|gcp|aws> --profile default
swarm deploy <project> --provider vercel --prod
```

Supported providers and secret variables:

| Provider | Required secrets |
| --- | --- |
| Vercel | `VERCEL_TOKEN` |
| DigitalOcean | `DIGITALOCEAN_TOKEN` |
| GCP Cloud Run | `GCP_SA_KEY` |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |

Optional config variables include `GCP_PROJECT`, `GCP_REGION`, and `AWS_REGION`. Named deploy profiles append a suffix, for example `VERCEL_TOKEN_CLIENT_A`.

Deploy credentials stay in environment files. The database stores only provider/profile/target bindings and deployment records.

## MCP Servers

Agent Swarm loads MCP server configuration from:

1. `mcp.json` in the Agent Swarm root.
2. `.swarm/workspaces/<project>/mcp.json` for project-specific overrides.

Both shapes are accepted:

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "TOKEN": "${EXAMPLE_TOKEN}"
      }
    }
  }
}
```

or a direct server map. `${ENV_VAR}` placeholders are expanded from the process environment.

## Docker Sandbox

Command sandboxing is controlled by environment variables:

```env
SWARM_SANDBOX=off
SWARM_SANDBOX_IMAGE=node:22-bookworm
SWARM_SANDBOX_CPUS=2
SWARM_SANDBOX_MEMORY=4g
```

Modes:

- `off`: run commands on the host workspace.
- `exec`: run agent shell commands in Docker with the workspace mounted at `/work`.
- `full`: reserved for whole-run sandboxing behavior and uses the same Docker config helpers.

The included `Dockerfile.sandbox` can be used to build a custom sandbox image when the default Node image is not enough.

## Database Migration Policy

Agent Swarm treats project database migrations as privileged infrastructure work.
For Supabase projects, agents may author `supabase/migrations/*.sql`, but remote
schema changes are applied only by generated CI workflows or by the narrow
Supabase migration executor.

When Supabase migrations are detected, the orchestrator:

- creates missing Supabase CI workflows under the project app's `.github/workflows/`;
- adds local/remote DB scripts to the app `package.json` when possible;
- rejects unsafe `exec_sql` RPC migration appliers;
- validates local migrations with `supabase db reset --local` when the CLI is available;
- writes and verifies `_artifacts/backend/migration-readiness.json` before QA.

Normal agent shell commands do not receive Supabase production secrets. To opt in
to the privileged executor instead of CI, set:

```env
SWARM_MIGRATION_APPLY_REMOTE=true
SWARM_MIGRATION_ENVIRONMENT=staging
SUPABASE_ACCESS_TOKEN=...
SUPABASE_PROJECT_ID=...
SUPABASE_DB_PASSWORD=...
```

Production also requires:

```env
SWARM_MIGRATION_ENVIRONMENT=production
SWARM_MIGRATION_PRODUCTION_APPROVED=true
```

The recommended default is still CI: staging on `develop`, production on `main`
with a protected GitHub `production` environment requiring human approval.

## Development

Build everything:

```bash
npm run build
```

Build only the TypeScript server/CLI:

```bash
npm run build:server
```

Run from source:

```bash
npm run dev -- run "Build a small CLI app" --name sample --no-ui
```

Run the compiled CLI:

```bash
npm run start -- run "Build a small CLI app" --name sample --no-ui
```

Dashboard development:

```bash
npm run web:dev
npm run web:build
```

Database commands:

```bash
npm run db:up
npm run db:migrate
npm run db:down
```

## Repository Layout

```text
src/
  agents/          Agent roles, role prompts, and lead review logic
  dashboard/       Local API server and dashboard control endpoints
  db/              Postgres schema, migrations, and storage
  deploy/          Deployment adapters and credential profiles
  evals/           Runnable project evaluation
  git/             GitHub repo, branch, PR, and credential integration
  learning/        Cross-project learning and retrospectives
  mcp/             MCP client helpers
  pipeline/        Project and intent classification
  prompts/         Prompt templates and prompt override store
  utils/           Artifacts, indexing, files, logging, and output filtering
web/
  src/             React dashboard application
drizzle/           Database migrations
.swarm/           Local Agent Swarm runtime data, including managed workspaces
```

## Sharing With Colleagues

Recommended sharing path:

1. Push this repository to GitHub.
2. Ask colleagues to clone it.
3. Have them create their own `.env`.
4. Have them run `npm install`, `npm run web:install`, `npm run db:up`, and `npm run build`.
5. Use `npm link` locally if they want the `swarm` command on their PATH.

Once the CLI surface is stable, this can be published as a private npm package:

```bash
npm publish --access restricted
```

Then colleagues can install it with:

```bash
npm install -g @your-org/agent-swarm
```

## Current Status

The current local surface includes the React dashboard, chat-style launch intake, existing-project change flow, run attempts, artifact filtering, project-specific environment overrides, MCP configuration, deployment bindings, Docker sandbox helpers, GitHub credential profiles, and cross-project learning.

Before opening a PR, run at least:

```bash
npm run build
```
