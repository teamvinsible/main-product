import type { Env } from "../env";
import { runEngineeringBuild, scaffoldApp } from "./agent-runner";
import { htmlRelativeAssets, normalizeWorkspaceAssets, type WorkspaceIO } from "./workspace-assets";

export type LeadGateResult = {
  ok: boolean;
  ready: boolean;
  summary: string;
  required: string[];
  present: string[];
  missing: string[];
  fixed: string[];
  rebuilt: boolean;
  files: string[];
};

const REQUIRED_ROOT = ["index.html", "styles.css", "app.js", "package.json"] as const;
const MIN_BYTES: Record<string, number> = {
  "index.html": 80,
  "styles.css": 40,
  "app.js": 20,
  "package.json": 20,
};

function workspaceIo(env: Env, projectId: string): WorkspaceIO | null {
  if (!env.WORKSPACES) return null;
  return {
    list: async (prefix = "") => {
      const listed = await env.WORKSPACES!.list({
        prefix: `workspaces/${projectId}/${prefix}`,
        limit: 1_000,
      });
      return listed.objects.map((o) => o.key.replace(`workspaces/${projectId}/`, ""));
    },
    get: async (rel) => {
      const obj = await env.WORKSPACES!.get(`workspaces/${projectId}/${rel}`);
      return obj ? obj.text() : null;
    },
    put: async (rel, content) => {
      const type =
        rel.endsWith(".html")
          ? "text/html"
          : rel.endsWith(".css")
            ? "text/css"
            : rel.endsWith(".js") || rel.endsWith(".mjs")
              ? "text/javascript"
              : rel.endsWith(".json")
                ? "application/json"
                : "text/plain";
      await env.WORKSPACES!.put(`workspaces/${projectId}/${rel}`, content, {
        httpMetadata: { contentType: type },
      });
    },
  };
}

async function audit(io: WorkspaceIO): Promise<{
  required: string[];
  present: string[];
  missing: string[];
  weak: string[];
}> {
  const present: string[] = [];
  const missing: string[] = [];
  const weak: string[] = [];
  const required: string[] = [...REQUIRED_ROOT];

  for (const path of REQUIRED_ROOT) {
    const body = await io.get(path);
    if (body == null) {
      missing.push(path);
      continue;
    }
    present.push(path);
    const min = MIN_BYTES[path] ?? 1;
    if (body.trim().length < min) weak.push(path);
  }

  const index = await io.get("index.html");
  if (index) {
    for (const asset of htmlRelativeAssets(index)) {
      if ((REQUIRED_ROOT as readonly string[]).includes(asset)) continue;
      required.push(asset);
      const body = await io.get(asset);
      if (body == null) missing.push(asset);
      else present.push(asset);
    }
  }

  return { required, present, missing, weak };
}

/**
 * Mediator / Lead gate: ensure the workspace is a complete, linkable static app
 * before Ship/publish. Normalize misplaced LLM paths, rebuild once if needed.
 */
export async function leadEnsureWorkspaceReady(
  env: Env,
  opts: {
    projectId: string;
    title: string;
    brief: string;
    swarmName: string;
    /** When true, rebuild via eng if the gate still fails after normalize. */
    allowRebuild?: boolean;
  },
): Promise<LeadGateResult> {
  const io = workspaceIo(env, opts.projectId);
  if (!io) {
    return {
      ok: false,
      ready: false,
      summary: "Lead gate failed: WORKSPACES R2 binding missing",
      required: [...REQUIRED_ROOT],
      present: [],
      missing: [...REQUIRED_ROOT],
      fixed: [],
      rebuilt: false,
      files: [],
    };
  }

  const fixed: string[] = [];
  let rebuilt = false;

  // Pass 1 — flatten / copy misplaced assets referenced by HTML.
  const norm1 = await normalizeWorkspaceAssets(io);
  fixed.push(...norm1.fixed);

  let status = await audit(io);

  // Pass 2 — if core entry files are missing/weak, eng rebuild (or scaffold).
  const needsRebuild =
    Boolean(opts.allowRebuild !== false) &&
    (status.missing.includes("index.html") ||
      status.weak.includes("index.html") ||
      status.missing.includes("styles.css") ||
      status.missing.includes("app.js") ||
      status.weak.includes("styles.css") ||
      status.weak.includes("app.js"));

  if (needsRebuild) {
    rebuilt = true;
    const build = await runEngineeringBuild(env, {
      projectId: opts.projectId,
      title: opts.title,
      brief: opts.brief,
      swarmName: opts.swarmName,
    });
    if (!build.ok || build.filesWritten.length === 0) {
      await scaffoldApp(env, opts);
    }
    const norm2 = await normalizeWorkspaceAssets(io);
    fixed.push(...norm2.fixed);
    status = await audit(io);
  }

  // Pass 3 — still missing index? hard scaffold.
  if (status.missing.includes("index.html")) {
    await scaffoldApp(env, opts);
    const norm3 = await normalizeWorkspaceAssets(io);
    fixed.push(...norm3.fixed);
    status = await audit(io);
  }

  const files = await io.list();
  const ready =
    !status.missing.includes("index.html") &&
    status.missing.filter((m) => REQUIRED_ROOT.includes(m as (typeof REQUIRED_ROOT)[number])).length === 0 &&
    status.weak.filter((w) => w === "index.html").length === 0;

  const summaryParts = [
    ready ? "Lead gate passed — workspace is shippable." : "Lead gate incomplete.",
    `Present: ${status.present.join(", ") || "none"}.`,
  ];
  if (status.missing.length) summaryParts.push(`Missing: ${status.missing.join(", ")}.`);
  if (status.weak.length) summaryParts.push(`Weak/empty: ${status.weak.join(", ")}.`);
  if (fixed.length) summaryParts.push(`Repaired: ${fixed.join("; ")}.`);
  if (rebuilt) summaryParts.push("Eng rebuild invoked by Lead.");

  return {
    ok: ready,
    ready,
    summary: summaryParts.join(" "),
    required: status.required,
    present: status.present,
    missing: status.missing,
    fixed,
    rebuilt,
    files,
  };
}
