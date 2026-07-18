import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderedStack } from "../render/types.js";
import { buildDotenv, computeRequiredEnv } from "../secrets/index.js";
import type { SecretsProvider } from "../secrets/types.js";
import { commandExists, run } from "./exec.js";
import { materialize, packageRoot, type Layout } from "./materialize.js";
import type { ApplyResult, BackendHealth, LogFn, PlanDiff, StateRef } from "./types.js";

export type { ApplyResult, BackendHealth, PlanDiff, StateRef, LogFn } from "./types.js";
export { materialize, packageRoot } from "./materialize.js";
export type { Layout } from "./materialize.js";

export interface ProvisionerOpts {
  /** DO API token — passed to OpenTofu via TF_VAR (env), never on argv. */
  token?: string;
  spacesKey?: string;
  spacesSecret?: string;
  /** Optional encrypted, lock-enabled S3 backend (DigitalOcean Spaces compatible). */
  stateBucket?: string;
  stateRegion?: string;
  stateEndpoint?: string;
  /** Headscale control URL (required TF var for the droplet join). */
  headscaleUrl?: string;
  tailscaleAuthkey?: string;
  /** Where to materialize. Default: a fresh temp dir per run (destroy needs a stable one). */
  workRoot?: string;
  /** Where modules/ + services/ live. Default: package root. */
  assetsRoot?: string;
  /** Public URL for ApplyResult (the site domain fronting Caddy). */
  siteDomain?: string;
  remoteUser?: string; // default "deploy"
  remoteDir?: string; // default "/opt/harness/<project>"
  /** "tofu" | "terraform". Auto-detected when omitted. */
  tofuBin?: string;
  /** Secrets backend (sops default). Resolved at apply time -> .env on the Droplet. */
  secrets?: SecretsProvider;
  log?: LogFn;
}

export class ProvisionError extends Error {}

// Runs OpenTofu to provision the DO substrate, then ships the compose stack to the
// Droplet over the Headscale tailnet. External tools (tofu/ssh/rsync) are invoked
// for real; each is checked first with an actionable error if missing.
export class Provisioner {
  private opts: ProvisionerOpts;
  private log: LogFn;
  /** Resolved secret values, collected for log redaction on later commands. */
  private secretValues: string[] = [];

  constructor(opts: ProvisionerOpts = {}) {
    this.opts = opts;
    this.log = opts.log ?? (() => {});
  }

  // `tofu plan` only — no mutation. Returns a human-reviewable diff.
  async plan(stack: RenderedStack, state: StateRef): Promise<PlanDiff> {
    const layout = this.stage(stack, state);
    const bin = await this.resolveTofu();
    const env = this.tofuEnv();
    await this.tofu(bin, layout, this.initArgs(stack.project), env);
    const res = await this.tofu(bin, layout, ["plan", "-input=false", "-no-color"], env);
    const changes = res.stdout.split(/\r?\n/).filter((l) => /^[+~-]|Plan:|No changes/.test(l.trim()));
    const summary = changes.find((l) => /Plan:|No changes/.test(l))?.trim() ?? "plan complete";
    return { summary, changes };
  }

  // Full deploy: tofu apply -> read outputs -> rsync + `docker compose up -d`.
  async apply(stack: RenderedStack, state: StateRef): Promise<ApplyResult> {
    const layout = this.stage(stack, state);
    const bin = await this.resolveTofu();
    const env = this.tofuEnv();

    await this.tofu(bin, layout, this.initArgs(stack.project), env);
    await this.tofu(bin, layout, ["apply", "-auto-approve", "-input=false", "-no-color"], env);
    const outputs = await this.tofuOutputs(bin, layout, env);

    const tailnetHost = str(outputs.tailnet_host);
    const dropletId = str(outputs.droplet_id);
    const ipv4 = str(outputs.droplet_ipv4);

    if (!tailnetHost) {
      throw new ProvisionError("tofu did not emit tailnet_host; cannot reach the Droplet to deploy compose.");
    }
    await this.writeSecretsEnv(layout, stack);
    await this.deployCompose(layout, tailnetHost, stack.project);

    const url = this.opts.siteDomain ? `https://${this.opts.siteDomain}` : ipv4 ? `http://${ipv4}` : undefined;
    return {
      url,
      logsUrl: dropletId ? `https://cloud.digitalocean.com/droplets/${dropletId}` : undefined,
      dropletId,
      stateRef: this.opts.stateBucket ? `s3://${this.opts.stateBucket}/projects/${stack.project}/terraform.tfstate` : layout.tofuDir,
    };
  }

  async destroy(state: StateRef): Promise<void> {
    if (!this.opts.workRoot) {
      throw new ProvisionError("destroy requires a stable workRoot (the materialized dir with tofu state). Set ProvisionerOpts.workRoot.");
    }
    const tofuDir = join(this.opts.workRoot, state.project, "tofu");
    const bin = await this.resolveTofu();
    const layout = { root: join(this.opts.workRoot, state.project), tofuDir };
    const env = this.tofuEnv();
    await this.tofu(bin, layout, this.initArgs(state.project), env);
    await this.tofu(bin, layout, ["destroy", "-auto-approve", "-input=false", "-no-color"], env);
  }

  async status(state: StateRef): Promise<BackendHealth> {
    const host = state.tailnetHost;
    if (!host) throw new ProvisionError("status requires state.tailnetHost.");
    await this.requireCommand("ssh");
    const user = this.opts.remoteUser ?? "deploy";
    const dir = this.opts.remoteDir ?? `/opt/harness/${state.project}`;
    const res = await run("ssh", [`${user}@${host}`, `cd ${dir} && docker compose ps --format json`], { log: this.log });
    const containers: Record<string, string> = {};
    for (const line of res.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line) as { Name?: string; Service?: string; State?: string };
        const name = p.Service ?? p.Name ?? "?";
        containers[name] = p.State ?? "unknown";
      } catch {
        /* non-JSON line */
      }
    }
    const db = Object.entries(containers).find(([n]) => /^postgres/.test(n))?.[1] ?? "absent";
    const backups = Object.keys(containers).some((n) => /^pgbackup/.test(n)) ? "configured" : "none";
    return { ok: res.code === 0 && Object.values(containers).every((s) => s === "running"), containers, db, backups };
  }

  // --- internals ---------------------------------------------------------

  private stage(stack: RenderedStack, state: StateRef): Layout {
    const base = this.opts.workRoot ? join(this.opts.workRoot, state.project) : mkdtempSync(join(tmpdir(), `harness-${stack.project}-`));
    this.log("info", `staging deploy artifacts in ${base}`);
    return materialize(stack, base, this.opts.assetsRoot ?? packageRoot());
  }

  private async resolveTofu(): Promise<string> {
    if (this.opts.tofuBin) return this.opts.tofuBin;
    if (await commandExists("tofu")) return "tofu";
    if (await commandExists("terraform")) return "terraform";
    throw new ProvisionError("neither `tofu` nor `terraform` is installed. Install OpenTofu to provision.");
  }

  private tofuEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const set = (k: string, v?: string) => {
      if (v) env[k] = v;
    };
    set("TF_VAR_do_token", this.opts.token);
    set("TF_VAR_spaces_access_id", this.opts.spacesKey);
    set("TF_VAR_spaces_secret_key", this.opts.spacesSecret);
    set("TF_VAR_headscale_url", this.opts.headscaleUrl);
    set("TF_VAR_tailscale_authkey", this.opts.tailscaleAuthkey);
    set("AWS_ACCESS_KEY_ID", this.opts.spacesKey);
    set("AWS_SECRET_ACCESS_KEY", this.opts.spacesSecret);
    return env;
  }

  private initArgs(project: string): string[] {
    const args = ["init", "-input=false", "-no-color"];
    if (!this.opts.stateBucket) return [...args, "-backend=false"];
    const region = this.opts.stateRegion ?? "nyc3";
    const endpoint = this.opts.stateEndpoint ?? `https://${region}.digitaloceanspaces.com`;
    return [
      ...args,
      `-backend-config=bucket=${this.opts.stateBucket}`,
      `-backend-config=key=projects/${project}/terraform.tfstate`,
      `-backend-config=region=${region}`,
      `-backend-config=endpoints.s3=${endpoint}`,
      "-backend-config=encrypt=true",
      "-backend-config=use_lockfile=true",
      "-backend-config=skip_credentials_validation=true",
      "-backend-config=skip_region_validation=true",
      "-backend-config=skip_requesting_account_id=true",
      "-backend-config=skip_metadata_api_check=true",
    ];
  }

  private async tofu(bin: string, layout: Layout, args: string[], env: NodeJS.ProcessEnv) {
    const redact = [this.opts.token, this.opts.spacesSecret, this.opts.tailscaleAuthkey].filter(Boolean) as string[];
    const res = await run(bin, args, { cwd: layout.tofuDir, env, log: this.log, redact });
    if (res.code !== 0) throw new ProvisionError(`${bin} ${args[0]} failed (exit ${res.code}). See logs above.`);
    return res;
  }

  private async tofuOutputs(bin: string, layout: Layout, env: NodeJS.ProcessEnv): Promise<Record<string, { value?: unknown }>> {
    const res = await run(bin, ["output", "-json"], { cwd: layout.tofuDir, env });
    try {
      return JSON.parse(res.stdout || "{}") as Record<string, { value?: unknown }>;
    } catch {
      return {};
    }
  }

  // Resolve secrets and write a 0600 .env into the deploy root so compose can
  // interpolate ${PG_PASSWORD}/${JWT_SECRET}/etc. The file rides along in the rsync.
  private async writeSecretsEnv(layout: Layout, stack: RenderedStack): Promise<void> {
    if (!this.opts.secrets) {
      const required = computeRequiredEnv(stack);
      if (required.length) throw new ProvisionError(`no secrets provider configured; required vars: ${required.join(", ")}`);
      return;
    }
    const env = await this.opts.secrets.resolve();
    this.secretValues = Object.values(env).filter((v) => v.length >= 4);

    const required = computeRequiredEnv(stack);
    const missing = required.filter((n) => !(n in env));
    if (missing.length) throw new ProvisionError(`secrets: ${missing.length} required var(s) missing: ${missing.join(", ")}`);

    writeFileSync(join(layout.root, ".env"), buildDotenv(env), { mode: 0o600 });
    this.log("info", `secrets: wrote ${Object.keys(env).length} var(s) to .env (0600) via '${this.opts.secrets.id}' provider`);
  }

  private async deployCompose(layout: Layout, host: string, project: string): Promise<void> {
    await this.requireCommand("ssh");
    const user = this.opts.remoteUser ?? "deploy";
    const dir = this.opts.remoteDir ?? `/opt/harness/${project}`;
    const target = `${user}@${host}`;
    const redact = this.secretValues;

    this.log("info", `deploying compose to ${target}:${dir}`);
    await run("ssh", [target, `mkdir -p ${dir}`], { log: this.log, redact });

    // rsync everything except the tofu dir (not needed on the Droplet); fall back to scp.
    // The 0600 .env is included so compose can start.
    if (await commandExists("rsync")) {
      const r = await run("rsync", ["-az", "--delete", "--exclude", "tofu", `${layout.root}/`, `${target}:${dir}/`], { log: this.log, redact });
      if (r.code !== 0) throw new ProvisionError(`rsync failed (exit ${r.code}).`);
    } else {
      this.log("warn", "rsync not found; falling back to scp -r (no --delete).");
      const r = await run("scp", ["-r", `${layout.root}/.`, `${target}:${dir}/`], { log: this.log, redact });
      if (r.code !== 0) throw new ProvisionError(`scp failed (exit ${r.code}).`);
    }

    const up = await run("ssh", [target, `cd ${dir} && docker compose up -d`], { log: this.log, redact });
    if (up.code !== 0) throw new ProvisionError(`docker compose up failed (exit ${up.code}).`);
  }

  private async requireCommand(cmd: string): Promise<void> {
    if (!(await commandExists(cmd))) {
      throw new ProvisionError(`required command \`${cmd}\` not found on PATH.`);
    }
  }
}

function str(o: { value?: unknown } | undefined): string | undefined {
  const v = o?.value;
  return typeof v === "string" ? v : v === undefined || v === null ? undefined : String(v);
}
