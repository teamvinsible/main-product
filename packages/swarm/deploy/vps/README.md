# Secure VPS deployment (dark factory)

Run Agent Swarm 24/7 on a cheap VPS with defense-in-depth: loopback-only app + database, TLS reverse proxy, firewall, fail2ban, dedicated service user, and token/webhook auth.

## Architecture

```
Internet → :443 Caddy (TLS) → 127.0.0.1:3456 swarm serve → Docker sandbox runs
                              ↘ 127.0.0.1:5432 Postgres (never public)
```

| Layer | What | Public? |
|-------|------|---------|
| UFW | Allow 22, 80, 443 only | Yes (SSH/HTTPS) |
| Caddy | TLS + security headers | Yes |
| `swarm serve` | Control API + dashboard | **No** (127.0.0.1) |
| Postgres | Run state | **No** (127.0.0.1) |
| Agent shell | `SWARM_SANDBOX=exec` | Isolated in Docker |

## Provider comparison (cheap)

| Provider | Plan | RAM | ~$/mo | Notes |
|----------|------|-----|-------|-------|
| [DigitalOcean](https://www.digitalocean.com/pricing/droplets) | Basic | 2 GB | ~$12 | Simple, good docs |
| [Hetzner](https://www.hetzner.com/cloud) | CX22 | 4 GB | ~€4 | Best value EU |
| [Vultr](https://www.vultr.com/pricing/) | Cloud Compute | 2 GB | ~$10 | Many regions |
| [Linode/Akamai](https://www.linode.com/pricing/) | Shared | 2 GB | ~$12 | Stable |

Minimum: **2 GB RAM** (4 GB recommended for parallel agents + Docker).

## DigitalOcean quick start

### 1. Create droplet

- **Image:** Ubuntu 24.04 LTS
- **Size:** 2 GB RAM / 1 vCPU (or 4 GB)
- **Auth:** SSH key only (disable password login)
- **Hostname:** `agent-swarm`

### 2. DNS

Create an **A record**: `swarm.yourdomain.com` → droplet IP.

### 3. Install (one command)

SSH in as root:

```bash
export DOMAIN=swarm.yourdomain.com
git clone https://github.com/ansi2u/agent-swarm.git /opt/agent-swarm
cd /opt/agent-swarm
chmod +x deploy/vps/*.sh
DOMAIN=$DOMAIN bash deploy/vps/install.sh
```

The installer:

- Installs Node 22, Docker, Caddy, UFW, fail2ban
- Creates `swarm` system user (non-root service)
- Generates strong `SWARM_DASHBOARD_TOKEN`, webhook secrets, DB password
- Binds Postgres + app to **127.0.0.1 only**
- Enables systemd service + firewall

### 4. Add API keys

```bash
nano /opt/agent-swarm/.env
```

Required (at least one LLM provider):

```env
ANTHROPIC_API_KEY=sk-ant-...
# or DEEPSEEK_API_KEY / OPENROUTER_API_KEY
```

Optional:

```env
GITHUB_TOKEN=ghp_...
SWARM_NOTIFICATION_WEBHOOK_URL=https://notifications.example.com/swarm
SWARM_NOTIFICATION_WEBHOOK_TOKEN=...
SWARM_GITHUB_ALLOWED_REPOS=your-org/your-repo
```

Restart:

```bash
systemctl restart agent-swarm
```

### 5. Open dashboard

```
https://swarm.yourdomain.com/?token=<SWARM_DASHBOARD_TOKEN>
```

Token is in `/opt/agent-swarm/.env`. Save it in a password manager — it gates the entire control plane.

---

## Security checklist

### Network

- [ ] UFW: only 22, 80, 443 (`deploy/vps/setup-firewall.sh`)
- [ ] `swarm serve` on `127.0.0.1` only (systemd sets `SWARM_BIND=127.0.0.1`)
- [ ] Postgres on `127.0.0.1:5432` (`docker-compose.prod.yml`)
- [ ] Never expose port 3456 or 5432 in cloud firewall / DO networking

### Authentication

- [ ] `SWARM_DASHBOARD_TOKEN` — long random (installer generates)
- [ ] `SWARM_GITHUB_WEBHOOK_SECRET` — matches GitHub webhook config
- [ ] `SWARM_GITHUB_ALLOWED_REPOS` — repo allowlist

### SSH

```bash
# /etc/ssh/sshd_config.d/hardening.conf
PasswordAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
```

Then `systemctl restart sshd`. **Test SSH in a second terminal before closing your session.**

### Files

```bash
chmod 600 /opt/agent-swarm/.env
chown -R swarm:swarm /opt/agent-swarm
```

### Agent execution

```env
SWARM_SANDBOX=exec
```

Agent shell commands run in Docker with workspace mounted at `/work`.

### Backups

```bash
# Postgres dump (cron nightly)
docker exec agent-swarm-db pg_dump -U swarm swarm | gzip > /var/backups/swarm-$(date +%F).sql.gz
tar czf /var/backups/swarm-workspaces-$(date +%F).tar.gz /opt/agent-swarm/.swarm/workspaces
```

---

## GitHub webhook (optional)

Repo → Settings → Webhooks → Add:

- **URL:** `https://swarm.yourdomain.com/api/webhooks/github`
- **Secret:** `SWARM_GITHUB_WEBHOOK_SECRET`
- **Events:** Issue comments, Workflow dispatch

Comment on an issue: `/swarm fix my-project Fix the login button`

## Google Chat app (optional)

1. Google Cloud Console → enable **Google Chat API** → **Configuration**.
2. Connection: **HTTP endpoint URL** → `https://swarm.yourdomain.com/api/webhooks/google-chat`
3. Authentication audience: same URL (or project number — then set `SWARM_GOOGLE_CHAT_PROJECT_NUMBER` in Doppler).
4. Install the app in a Chat space or DM.
5. Doppler / `.env`:
   ```env
   SWARM_GOOGLE_CHAT_AUDIENCE_URL=https://swarm.yourdomain.com/api/webhooks/google-chat
   SWARM_GOOGLE_CHAT_ALLOWED_USERS=you@company.com
   SWARM_GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...
   ```
6. Commands: `/run`, `/change`, `/status`, `/resume`.

---

## Cron (scheduled factory work)

```cron
# /etc/cron.d/agent-swarm
0 3 * * 1 swarm /opt/agent-swarm/scripts/trigger-run.sh my-app "Weekly dependency audit" >> /var/log/swarm-cron.log 2>&1
```

Set in `/opt/agent-swarm/.env`:

```env
SWARM_PUBLIC_URL=https://swarm.yourdomain.com
```

---

## Operations

```bash
systemctl status agent-swarm
journalctl -u agent-swarm -f
systemctl status caddy
docker compose -f /opt/agent-swarm/docker-compose.yml \
  -f /opt/agent-swarm/deploy/vps/docker-compose.prod.yml ps
```

Update:

```bash
cd /opt/agent-swarm && git pull && npm ci && npm run build
systemctl restart agent-swarm
```

---

## Alternative: Cloudflare Tunnel (no open HTTP ports)

If you prefer **no public 80/443** on the VPS:

1. Install `cloudflared` on the VPS
2. Tunnel `localhost:3456` to `swarm.yourdomain.com`
3. UFW: allow **SSH only** (port 22)
4. Keep `SWARM_DASHBOARD_TOKEN` required

Cloudflare Access can add SSO in front of the dashboard.

---

## Local CLI → remote factory

From your laptop (global `swarm` via `npm link`):

```bash
export SWARM_URL=https://swarm.yourdomain.com
export SWARM_TOKEN=<dashboard-token>

curl -sS -X POST "$SWARM_URL/api/run" \
  -H "Content-Type: application/json" \
  -H "x-swarm-token: $SWARM_TOKEN" \
  -d '{"mode":"change","project":"my-app","request":"Add dark mode","localOnly":true}'
```

Or use `scripts/trigger-run.sh` on the VPS or via cron.

---

## Doppler secrets (recommended for production)

Store API keys in [Doppler](https://docs.doppler.com/docs/install-cli), not in `.env` on the droplet. Only a **Service Token** sits on disk; everything else is injected at runtime via `doppler run`.

### Why Doppler

| Plain `.env` | Doppler |
|--------------|---------|
| All keys plaintext on disk | Only Service Token on disk |
| Rotate = SSH + edit file | Rotate in Doppler UI; restart service |
| Dashboard Settings writes `.env` | Manage secrets in Doppler dashboard |
| Backup leak exposes keys | Secrets not in repo/backups |

Doppler also has a [DigitalOcean Droplets integration](https://docs.doppler.com/docs/digitalocean-droplets) if you prefer their sync guide.

### 1. Create Doppler project

1. Sign up at [dashboard.doppler.com](https://dashboard.doppler.com)
2. Create project **`agent-swarm`**, config **`prd`**
3. Add secrets from [`doppler-secrets.template`](doppler-secrets.template) (key names must match)
4. Create a **Service Token** scoped to `agent-swarm` / `prd` (Dashboard → Access → Service Tokens)

Generate values in Doppler:

```bash
# Example values to set in Doppler UI (not on the VPS):
# SWARM_DASHBOARD_TOKEN  → openssl rand -hex 32
# POSTGRES_PASSWORD      → openssl rand -hex 24
# DATABASE_URL           → postgres://swarm:<POSTGRES_PASSWORD>@127.0.0.1:5432/swarm
```

### 2. Install CLI on the VPS

Per [Doppler install docs](https://docs.doppler.com/docs/install-cli):

```bash
sudo bash /opt/agent-swarm/deploy/vps/install-doppler-cli.sh
doppler --version
```

### 3. Enable Doppler for Agent Swarm

After the base `install.sh` has run:

```bash
export DOPPLER_TOKEN=dp.st.prd.xxxxxxxxx   # Service Token from Doppler
cd /opt/agent-swarm
sudo -E bash deploy/vps/setup-doppler.sh
```

This will:

- Store only `DOPPLER_TOKEN` in `/etc/doppler/agent-swarm.env` (chmod 640, group `swarm`)
- Copy [`doppler.yaml`](doppler.yaml) → `/opt/agent-swarm/doppler.yaml`
- Switch systemd to `doppler run -- node dist/index.js serve`
- Restart Postgres/migrations with Doppler-injected `POSTGRES_PASSWORD`

### 4. How it runs

```ini
# /etc/systemd/system/agent-swarm.service (Doppler mode)
EnvironmentFile=/etc/doppler/agent-swarm.env   # DOPPLER_TOKEN only
ExecStart=/usr/bin/doppler run -- /usr/bin/node dist/index.js serve --port 3456
```

Child runs spawned by the dashboard inherit secrets from the Doppler-injected process environment.

### 5. Dashboard + Doppler

- **Do not** paste API keys into Settings on a Doppler-backed VPS — they would write to `.env` and duplicate/conflict.
- Manage all secrets in the [Doppler dashboard](https://dashboard.doppler.com).
- Non-secret config (`SWARM_PUBLIC_URL`, `SWARM_SANDBOX`) can live in Doppler too (recommended) or a minimal `.env` without keys.

### 6. Rotate secrets

1. Update value in Doppler
2. `sudo systemctl restart agent-swarm`
3. Optional: [Doppler `--watch`](https://docs.doppler.com/docs/automatic-restart) for auto-restart on Team plan

### 7. Local dev with Doppler (optional)

```bash
doppler login          # once per machine
cd agent-swarm
cp deploy/vps/doppler.yaml doppler.yaml   # edit config to dev_personal
doppler setup
doppler run -- npm run dev -- run "Build a todo app" --name todo --no-ui
```

---

## Files in this directory

| File | Purpose |
|------|---------|
| `install.sh` | Full automated setup (plain `.env`) |
| `install-doppler-cli.sh` | Install Doppler CLI (apt) |
| `setup-doppler.sh` | Switch running install to Doppler |
| `doppler.yaml` | Project/config mapping |
| `doppler-secrets.template` | Secret keys to create in Doppler |
| `agent-swarm-doppler.service` | systemd unit with `doppler run` |
| `setup-firewall.sh` | UFW rules |
| `agent-swarm.service` | systemd unit (plain `.env` mode) |
| `Caddyfile` | TLS reverse proxy + security headers |
| `docker-compose.prod.yml` | Postgres localhost-only override |
