import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import type { PreviewStatus } from "@teamvinsible/shared";
import type { Env } from "./env";
import { listSwarmArtifacts, readSwarmArtifact, useLegacyArtifacts } from "./swarm";

const PREVIEW_PORT = 5173;
const MAX_FILES = 80;
const MAX_FILE_BYTES = 200_000;

const TEXT_EXT =
  /\.(html?|css|js|jsx|ts|tsx|json|md|txt|svg|mjs|cjs|vue|svelte|yml|yaml|toml|env|gitignore)$/i;

function isUsefulPath(p: string): boolean {
  if (!TEXT_EXT.test(p) && !p.endsWith("Dockerfile") && p !== "package.json") return false;
  if (p.includes("node_modules/") || p.includes("dist/") || p.includes(".swarm/")) return false;
  if (p.startsWith("_artifacts/")) return false;
  return true;
}

export async function maybeProxySandbox(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!env.Sandbox) return null;
  try {
    return (
      (await proxyToSandbox(
        request,
        env as Env & { Sandbox: DurableObjectNamespace<import("@cloudflare/sandbox").Sandbox> },
      )) ?? null
    );
  } catch {
    return null;
  }
}

async function loadWorkspaceFiles(
  env: Env,
  projectId: string,
  swarmName: string,
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];

  if (env.WORKSPACES) {
    const listed = await env.WORKSPACES.list({ prefix: `workspaces/${projectId}/` });
    for (const obj of listed.objects.slice(0, MAX_FILES)) {
      const key = obj.key;
      const rel = key.replace(`workspaces/${projectId}/`, "");
      if (!rel || !isUsefulPath(rel)) continue;
      if ((obj.size || 0) > MAX_FILE_BYTES) continue;
      const got = await env.WORKSPACES.get(key);
      if (!got) continue;
      files.push({ path: rel, content: await got.text() });
    }
  }

  if (files.length === 0 && useLegacyArtifacts(env)) {
    const artifacts = await listSwarmArtifacts(env, swarmName);
    const usable = artifacts
      .filter((a) => isUsefulPath(a.path) && a.size <= MAX_FILE_BYTES)
      .slice(0, MAX_FILES);
    for (const file of usable) {
      const content = await readSwarmArtifact(env, swarmName, file.path);
      if (content != null) files.push({ path: file.path, content });
    }
  }

  return files;
}

export async function startProjectPreview(
  env: Env,
  opts: { projectId: string; swarmName: string; hostname: string },
): Promise<PreviewStatus> {
  if (!env.Sandbox) {
    return {
      ok: false,
      projectId: opts.projectId,
      swarmName: opts.swarmName,
      previewUrl: null,
      sandboxId: null,
      status: "unavailable",
      message: "Sandbox binding not configured.",
    };
  }

  const sandboxId = `tv-${opts.projectId.replace(/-/g, "").slice(0, 20)}`;
  const sandbox = getSandbox(env.Sandbox!, sandboxId);
  const files = await loadWorkspaceFiles(env, opts.projectId, opts.swarmName);

  await sandbox.mkdir("/workspace/app", { recursive: true });

  if (files.length === 0) {
    await sandbox.writeFile(
      "/workspace/app/index.html",
      `<!doctype html>
<html><head><meta charset="utf-8"/><title>${opts.swarmName}</title>
<style>body{font-family:system-ui;background:#0b0b0b;color:#f5f5f5;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:28rem;text-align:center}h1{font-weight:600;letter-spacing:-.02em}p{opacity:.7}</style>
</head><body><main>
<h1>Teamvinsible</h1>
<p>Waiting for Mediator artifacts for <strong>${opts.swarmName}</strong>.</p>
</main></body></html>`,
    );
    await sandbox.writeFile(
      "/workspace/app/package.json",
      JSON.stringify(
        { name: opts.swarmName, private: true, scripts: { start: "npx --yes serve -l 5173 ." } },
        null,
        2,
      ),
    );
  } else {
    for (const file of files) {
      const target = `/workspace/app/${file.path}`;
      const parent = target.slice(0, target.lastIndexOf("/"));
      if (parent) await sandbox.mkdir(parent, { recursive: true });
      await sandbox.writeFile(target, file.content);
    }
    if (!files.some((f) => f.path === "package.json" || f.path.endsWith("/package.json"))) {
      await sandbox.writeFile(
        "/workspace/app/package.json",
        JSON.stringify(
          { name: opts.swarmName, private: true, scripts: { start: "npx --yes serve -l 5173 ." } },
          null,
          2,
        ),
      );
    }
  }

  const pkgRaw = await sandbox.readFile("/workspace/app/package.json").catch(() => null);
  let useVite = false;
  if (pkgRaw?.content) {
    try {
      const pkg = JSON.parse(pkgRaw.content) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      useVite = Boolean(pkg.scripts?.dev?.includes("vite") || pkg.devDependencies?.vite);
      const hasDeps =
        Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length > 0;
      if (hasDeps) {
        await sandbox.exec("npm install", { cwd: "/workspace/app" });
      }
    } catch {
      /* ignore */
    }
  }

  const startCmd = useVite
    ? "npx --yes vite --host 0.0.0.0 --port 5173"
    : "npx --yes serve -l 5173 /workspace/app";

  await sandbox.startProcess(startCmd, { cwd: "/workspace/app" }).catch(async () => {
    await sandbox.exec(`${startCmd} &`, { cwd: "/workspace/app" });
  });
  await sandbox.exec("sleep 2").catch(() => undefined);

  let previewUrl: string | null = null;
  try {
    const exposed = await sandbox.exposePort(PREVIEW_PORT, { hostname: opts.hostname });
    previewUrl = exposed.url;
  } catch {
    previewUrl = `http://${opts.hostname}/sandbox/${sandboxId}`;
  }

  return {
    ok: true,
    projectId: opts.projectId,
    swarmName: opts.swarmName,
    previewUrl,
    sandboxId,
    status: "ready",
    message: files.length
      ? `Synced ${files.length} workspace file(s) into Sandbox.`
      : "Placeholder preview — Mediator artifacts pending.",
  };
}
