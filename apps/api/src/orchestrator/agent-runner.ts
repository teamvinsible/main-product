/**
 * Cloudflare-native agent build loop (DeepSeek only).
 * Writes generated app files into R2 under workspaces/{projectId}/.
 */
import type { Env } from "../env";
import {
  deepseekChat,
  deepseekConfigured,
  deepseekText,
  toDeepSeekTools,
  type ChatMessage,
} from "../llm/deepseek";
import { ensureFaviconLink, PLATFORM_FAVICON_SVG } from "../brand/favicon";
import { normalizeWorkspaceAssets, safePath } from "./workspace-assets";

export type BuildResult = {
  ok: boolean;
  filesWritten: string[];
  summary: string;
  mode: "deepseek" | "scaffold";
};

type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

const TOOL_SPECS: ToolDef[] = [
  {
    name: "write_file",
    description: "Write or overwrite a UTF-8 file in the project workspace (relative path).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 file from the workspace.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List files currently in the workspace.",
    input_schema: {
      type: "object",
      properties: { prefix: { type: "string" } },
    },
  },
  {
    name: "finish",
    description: "Call when the app is ready to preview. Include a short summary.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
  },
];

async function r2Put(env: Env, projectId: string, path: string, content: string) {
  if (!env.WORKSPACES) throw new Error("WORKSPACES R2 binding missing");
  await env.WORKSPACES.put(`workspaces/${projectId}/${path}`, content, {
    httpMetadata: {
      contentType: path.endsWith(".html")
        ? "text/html"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".js") || path.endsWith(".mjs")
            ? "text/javascript"
            : path.endsWith(".json")
              ? "application/json"
              : "text/plain",
    },
  });
}

async function r2Get(env: Env, projectId: string, path: string): Promise<string | null> {
  if (!env.WORKSPACES) return null;
  const obj = await env.WORKSPACES.get(`workspaces/${projectId}/${path}`);
  return obj ? obj.text() : null;
}

async function r2List(env: Env, projectId: string, prefix = ""): Promise<string[]> {
  if (!env.WORKSPACES) return [];
  const listed = await env.WORKSPACES.list({
    prefix: `workspaces/${projectId}/${prefix}`,
  });
  return listed.objects.map((o) => o.key.replace(`workspaces/${projectId}/`, ""));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function scaffoldApp(
  env: Env,
  opts: { projectId: string; title: string; brief: string; swarmName: string },
): Promise<BuildResult> {
  const { projectId, title, brief, swarmName } = opts;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <style>
    :root{color-scheme:dark;--bg:#090909;--ink:#f3f1ec;--muted:#9a9690;--accent:#6ea8ff;--panel:#141414}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:"Segoe UI",system-ui,sans-serif;
      background:radial-gradient(900px 500px at 10% -10%,rgba(110,168,255,.18),transparent),
      radial-gradient(700px 400px at 90% 0%,rgba(118,184,82,.12),transparent),var(--bg);color:var(--ink)}
    .shell{max-width:40rem;margin:0 auto;padding:4.5rem 1.5rem}
    .kicker{letter-spacing:.14em;text-transform:uppercase;font-size:.7rem;color:var(--muted);margin:0 0 .75rem}
    h1{font-size:clamp(2rem,5vw,3rem);letter-spacing:-.04em;line-height:1.05;margin:0}
    .lead{color:var(--muted);line-height:1.55;margin:1rem 0 2rem}
    .panel{border:1px solid rgba(255,255,255,.08);background:rgba(20,20,20,.72);backdrop-filter:blur(16px);border-radius:1.25rem;padding:1.25rem 1.35rem}
    .panel h2{margin:0 0 .5rem;font-size:1rem}
    .panel p{margin:0;color:var(--muted);font-size:.95rem}
  </style>
</head>
<body>
  <main class="shell">
    <p class="kicker">Teamvinsible</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lead">${escapeHtml(brief.slice(0, 320))}</p>
    <section class="panel">
      <h2>Built by the Nexus crew</h2>
      <p>This preview was generated on Cloudflare with DeepSeek.</p>
    </section>
  </main>
</body>
</html>`;

  const pkg = JSON.stringify(
    { name: swarmName, private: true, scripts: { start: "npx --yes serve -l 5173 ." } },
    null,
    2,
  );

  const files = [
    ["index.html", html],
    ["package.json", pkg],
    ["favicon.svg", PLATFORM_FAVICON_SVG],
    ["artifacts/eng.md", `# Engineering\n\nScaffolded app for **${title}**.\n\n${brief}\n`],
  ] as const;

  for (const [path, content] of files) {
    await r2Put(env, projectId, path, content);
  }

  return {
    ok: true,
    filesWritten: files.map(([p]) => p),
    summary: `Scaffolded preview app for ${title}`,
    mode: "scaffold",
  };
}

export async function writePhaseArtifact(
  env: Env,
  opts: {
    projectId: string;
    phase: string;
    title: string;
    brief: string;
    label: string;
    briefHint?: string;
  },
): Promise<string> {
  let body = `# ${opts.label}\n\n## Brief\n${opts.brief}\n\n## Notes\nGenerated by Teamvinsible Nexus on Cloudflare (DeepSeek).\n`;

  if (deepseekConfigured(env)) {
    try {
      const hint = opts.briefHint || `You are the ${opts.label} agent on Teamvinsible.`;
      const text = await deepseekText(
        env,
        `${hint}\n\nWrite a detailed, actionable markdown artifact. Include specific decisions, recommendations, and implementation notes. Output ONLY the markdown body — no preamble, no surrounding code fences (\`\`\`).\n\nTitle: ${opts.title}\nPhase: ${opts.phase}\nBrief:\n${opts.brief}`,
        { maxTokens: 2000 },
      );
      if (text) body = text;
    } catch {
      /* keep fallback */
    }
  }

  const path = `artifacts/${opts.phase}.md`;
  if (env.WORKSPACES) {
    await r2Put(env, opts.projectId, path, body);
  }
  return body.slice(0, 280);
}

export async function runEngineeringBuild(
  env: Env,
  opts: { projectId: string; title: string; brief: string; swarmName: string },
): Promise<BuildResult> {
  if (!env.WORKSPACES) {
    return { ok: false, filesWritten: [], summary: "WORKSPACES R2 missing", mode: "scaffold" };
  }

  if (env.SwarmRuntime) {
    try {
      const fromContainer = await runViaContainer(env, opts);
      if (fromContainer.ok) return fromContainer;
    } catch (err) {
      console.warn("SwarmRuntime failed, falling back", err);
    }
  }

  if (!deepseekConfigured(env)) {
    return scaffoldApp(env, opts);
  }

  return runDeepseekBuild(env, opts);
}

async function runViaContainer(
  env: Env,
  opts: { projectId: string; title: string; brief: string; swarmName: string },
): Promise<BuildResult> {
  const { getContainer } = await import("@cloudflare/containers");
  const stub = getContainer(env.SwarmRuntime!, opts.projectId);
  const existing = await r2List(env, opts.projectId);
  const seed: Record<string, string> = {};
  for (const path of existing.slice(0, 40)) {
    const content = await r2Get(env, opts.projectId, path);
    if (content != null && content.length < 120_000) seed[path] = content;
  }

  const res = await stub.fetch(
    new Request("http://swarm-runtime/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: opts.projectId,
        title: opts.title,
        brief: opts.brief,
        swarmName: opts.swarmName,
        deepseekApiKey: env.DEEPSEEK_API_KEY || "",
        deepseekModel: env.DEEPSEEK_MODEL || "",
        seedFiles: seed,
      }),
    }),
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Container build failed: ${text}`);
  }

  const payload = (await res.json()) as {
    files?: Record<string, string>;
    summary?: string;
  };

  const written: string[] = [];
  for (const [path, content] of Object.entries(payload.files || {})) {
    const safe = safePath(path);
    if (!safe) continue;
    await r2Put(env, opts.projectId, safe, content);
    written.push(safe);
  }

  return {
    ok: written.length > 0,
    filesWritten: written,
    summary: payload.summary || "Container build complete",
    mode: "deepseek",
  };
}

async function loadPriorArtifacts(env: Env, projectId: string): Promise<string> {
  const keys = ["artifacts/research.md", "artifacts/product.md", "artifacts/design.md"];
  const sections: string[] = [];
  for (const key of keys) {
    const content = await r2Get(env, projectId, key);
    if (content) sections.push(`### ${key}\n${content.slice(0, 3000)}`);
  }
  return sections.length > 0 ? `\n\n---\nPRIOR PHASE ARTIFACTS (use these to inform the build):\n\n${sections.join("\n\n")}` : "";
}

async function runDeepseekBuild(
  env: Env,
  opts: { projectId: string; title: string; brief: string; swarmName: string },
): Promise<BuildResult> {
  const written = new Set<string>();
  let finishedSummary = "";
  let done = false;

  const priorArtifacts = await loadPriorArtifacts(env, opts.projectId);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are an expert engineering agent on Teamvinsible. You build complete, polished, FUNCTIONAL web applications.

CRITICAL RULES — violating any of these produces a broken app:
1. All CSS MUST be written inside a <style> tag in the <head> of index.html. NEVER use an external stylesheet (<link href="styles.css">) — external files fail to load in this hosting environment.
2. Write COMPLETE files — never use "// ... rest of code", "<!-- more here -->", or any placeholder truncation. Every function, every rule, every element must be fully written out.
3. NEVER show loading spinners, results sections, or "analyzing..." states on initial page load. These must only appear AFTER the user takes an action.
4. All interactive elements MUST work. Buttons must do something. Forms must respond.
5. For AI-powered features (analysis, generation, scoring): implement realistic simulated responses using JavaScript. Use setTimeout (1–3 seconds) then reveal pre-written, context-aware results. The simulation should feel real and be specific to the actual use case.
6. Stats and metrics must start at 0 or be hidden until the user interacts — never display fake hardcoded "10,000 users" numbers.
7. Write ONLY workspace-relative paths: index.html, app.js, package.json. Never use /home, /Users, or absolute paths.
8. The app must work without any build step, npm install, or server — pure browser HTML/CSS/JS.`,
    },
    {
      role: "user",
      content: `Build a complete, beautiful, fully functional web application for this product brief.

Requirements:
- Write index.html with ALL CSS inline in a <style> tag (this is mandatory — no external .css files)
- Write app.js for JavaScript logic (or inline in index.html <script> tags)
- Write package.json with: { "scripts": { "start": "npx --yes serve -l 5173 ." } }
- The app must be visually stunning AND actually work end-to-end
- If it involves AI analysis: simulate it with a realistic delay + specific, context-aware output
- Call finish() when all files are written

Title: ${opts.title}
Slug: ${opts.swarmName}
Brief:
${opts.brief}${priorArtifacts}`,
    },
  ];

  const tools = toDeepSeekTools(TOOL_SPECS);

  for (let turn = 0; turn < 12 && !done; turn++) {
    let result;
    try {
      result = await deepseekChat(env, {
        messages,
        tools,
        maxTokens: 8000,
      });
    } catch (err) {
      console.error("deepseek error", err);
      break;
    }

    if (result.tool_calls.length === 0) {
      if (result.content) {
        messages.push({ role: "assistant", content: result.content });
      }
      break;
    }

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.tool_calls,
    });

    for (const call of result.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      if (call.function.name === "finish") {
        done = true;
        finishedSummary = String(args.summary || "Build finished");
      }
      const toolResult = await execTool(env, opts.projectId, call.function.name, args, written);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }
  }

  if (written.size === 0) {
    return scaffoldApp(env, opts);
  }

  if (![...written].some((p) => p === "package.json")) {
    await r2Put(
      env,
      opts.projectId,
      "package.json",
      JSON.stringify(
        { name: opts.swarmName, private: true, scripts: { start: "npx --yes serve -l 5173 ." } },
        null,
        2,
      ),
    );
    written.add("package.json");
  }

  const normalized = await normalizeWorkspaceAssets({
    list: (prefix) => r2List(env, opts.projectId, prefix),
    get: (path) => r2Get(env, opts.projectId, path),
    put: async (path, content) => {
      await r2Put(env, opts.projectId, path, content);
      written.add(path);
    },
  });
  if (normalized.fixed.length) {
    console.log("workspace.assets.normalized", opts.projectId, normalized.fixed);
  }

  // Platform brand mark for every generated app.
  await r2Put(env, opts.projectId, "favicon.svg", PLATFORM_FAVICON_SVG);
  written.add("favicon.svg");
  const indexHtml = await r2Get(env, opts.projectId, "index.html");
  if (indexHtml) {
    const withIcon = ensureFaviconLink(indexHtml);
    if (withIcon !== indexHtml) {
      await r2Put(env, opts.projectId, "index.html", withIcon);
    }
  }

  return {
    ok: true,
    filesWritten: [...written],
    summary: finishedSummary || `Wrote ${written.size} files for ${opts.title}`,
    mode: "deepseek",
  };
}

export async function improviseApp(
  env: Env,
  opts: { projectId: string; title: string; brief: string; swarmName: string },
): Promise<BuildResult> {
  if (!env.WORKSPACES) {
    return { ok: false, filesWritten: [], summary: "WORKSPACES R2 missing", mode: "scaffold" };
  }
  if (!deepseekConfigured(env)) {
    return { ok: false, filesWritten: [], summary: "DeepSeek not configured", mode: "scaffold" };
  }

  const priorArtifacts = await loadPriorArtifacts(env, opts.projectId);

  const written = new Set<string>();
  let finishedSummary = "";
  let done = false;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a senior engineer and code doctor on Teamvinsible. Your specialty: reading broken web apps and producing perfectly working, beautiful replacements.

WORKFLOW — follow this exactly:
1. Call list_files to see what exists in the workspace
2. Call read_file on index.html (and app.js if it exists) to inspect the broken code
3. Silently diagnose every issue you find
4. Rewrite ALL files from scratch with every issue fixed using write_file
5. Call finish() with a concise summary of what you fixed and enhanced

RULES that must be followed in the rewrite:
- All CSS MUST be inside a <style> tag in <head> — NEVER use <link href="styles.css"> or any external stylesheet
- Write COMPLETE files — no "// ... rest here" truncation, no placeholders
- Loading/results sections only appear AFTER the user takes an action — never visible on initial page load
- Every button and form must actually do something functional
- AI-powered features: implement with realistic simulated responses — use setTimeout (1–3 seconds), then reveal specific, context-aware output that feels real
- The app must work with zero build steps, zero npm install — pure browser HTML/CSS/JS`,
    },
    {
      role: "user",
      content: `This app was deployed but it's broken — CSS didn't load, layout is a mess, interactions don't work, loading states are permanently visible.

Your mission: read the existing files, diagnose every issue, then rewrite a completely fixed AND enhanced version. Make it stunning AND functional.

Project title: ${opts.title}
Original brief: ${opts.brief}${priorArtifacts}

Start with list_files → read each file → then fix and rewrite everything. Call finish() when done.`,
    },
  ];

  const tools = toDeepSeekTools(TOOL_SPECS);

  for (let turn = 0; turn < 14 && !done; turn++) {
    let result;
    try {
      result = await deepseekChat(env, { messages, tools, maxTokens: 8000 });
    } catch (err) {
      console.error("deepseek improvise error", err);
      break;
    }

    if (result.tool_calls.length === 0) {
      if (result.content) messages.push({ role: "assistant", content: result.content });
      break;
    }

    messages.push({ role: "assistant", content: result.content, tool_calls: result.tool_calls });

    for (const call of result.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      if (call.function.name === "finish") {
        done = true;
        finishedSummary = String(args.summary || "Improvised and fixed");
      }
      const toolResult = await execTool(env, opts.projectId, call.function.name, args, written);
      messages.push({ role: "tool", tool_call_id: call.id, content: toolResult });
    }
  }

  if (written.size === 0) {
    return { ok: false, filesWritten: [], summary: "No files rewritten", mode: "scaffold" };
  }

  if (![...written].some((p) => p === "package.json")) {
    await r2Put(
      env,
      opts.projectId,
      "package.json",
      JSON.stringify({ name: opts.swarmName, private: true, scripts: { start: "npx --yes serve -l 5173 ." } }, null, 2),
    );
    written.add("package.json");
  }

  return {
    ok: true,
    filesWritten: [...written],
    summary: finishedSummary || `Improvised ${written.size} files for ${opts.title}`,
    mode: "deepseek",
  };
}

async function execTool(
  env: Env,
  projectId: string,
  name: string,
  input: Record<string, unknown>,
  written: Set<string>,
): Promise<string> {
  if (name === "write_file") {
    const path = safePath(String(input.path || ""));
    if (!path) return JSON.stringify({ error: "invalid path" });
    const content = String(input.content ?? "");
    if (content.length > 200_000) return JSON.stringify({ error: "file too large" });
    await r2Put(env, projectId, path, content);
    written.add(path);
    return JSON.stringify({ ok: true, path });
  }
  if (name === "read_file") {
    const path = safePath(String(input.path || ""));
    if (!path) return JSON.stringify({ error: "invalid path" });
    const content = await r2Get(env, projectId, path);
    return content == null ? JSON.stringify({ error: "not found" }) : content;
  }
  if (name === "list_files") {
    const prefix = String(input.prefix || "");
    const files = await r2List(env, projectId, prefix);
    return JSON.stringify({ files });
  }
  if (name === "finish") {
    return JSON.stringify({ ok: true });
  }
  return JSON.stringify({ error: "unknown tool" });
}
