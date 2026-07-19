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

function safePath(path: string): string | null {
  const cleaned = path.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("..") || cleaned.startsWith(".git/")) return null;
  if (cleaned.length > 200) return null;
  return cleaned;
}

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
  <link rel="stylesheet" href="./styles.css"/>
</head>
<body>
  <main class="shell">
    <p class="kicker">Teamvinsible</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lead">${escapeHtml(brief.slice(0, 320))}</p>
    <section class="panel">
      <h2>Built by the Mediator crew</h2>
      <p>This preview was generated on Cloudflare with DeepSeek.</p>
    </section>
  </main>
  <script type="module" src="./app.js"></script>
</body>
</html>`;

  const css = `:root{color-scheme:dark;--bg:#090909;--ink:#f3f1ec;--muted:#9a9690;--accent:#6ea8ff;--panel:#141414}
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:"Segoe UI",system-ui,sans-serif;background:
radial-gradient(900px 500px at 10% -10%,rgba(110,168,255,.18),transparent),
radial-gradient(700px 400px at 90% 0%,rgba(118,184,82,.12),transparent),var(--bg);color:var(--ink)}
.shell{max-width:40rem;margin:0 auto;padding:4.5rem 1.5rem}
.kicker{letter-spacing:.14em;text-transform:uppercase;font-size:.7rem;color:var(--muted);margin:0 0 .75rem}
h1{font-size:clamp(2rem,5vw,3rem);letter-spacing:-.04em;line-height:1.05;margin:0}
.lead{color:var(--muted);line-height:1.55;margin:1rem 0 2rem}
.panel{border:1px solid rgba(255,255,255,.08);background:rgba(20,20,20,.72);backdrop-filter:blur(16px);border-radius:1.25rem;padding:1.25rem 1.35rem}
.panel h2{margin:0 0 .5rem;font-size:1rem}
.panel p{margin:0;color:var(--muted);font-size:.95rem}`;

  const js = `document.querySelector('.panel')?.addEventListener('click',()=>{
  console.log('Teamvinsible preview ready for ${swarmName}');
});`;

  const pkg = JSON.stringify(
    {
      name: swarmName,
      private: true,
      scripts: { start: "npx --yes serve -l 5173 ." },
    },
    null,
    2,
  );

  const files = [
    ["index.html", html],
    ["styles.css", css],
    ["app.js", js],
    ["package.json", pkg],
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
  opts: { projectId: string; phase: string; title: string; brief: string; label: string },
): Promise<string> {
  let body = `# ${opts.label}\n\n## Brief\n${opts.brief}\n\n## Notes\nGenerated by the Teamvinsible Mediator on Cloudflare (DeepSeek).\n`;

  if (deepseekConfigured(env)) {
    try {
      const text = await deepseekText(
        env,
        `You are the ${opts.label} agent on Teamvinsible. Write a concise markdown artifact for this product brief. No preamble.\n\nTitle: ${opts.title}\nPhase: ${opts.phase}\nBrief:\n${opts.brief}`,
        { maxTokens: 1200 },
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

async function runDeepseekBuild(
  env: Env,
  opts: { projectId: string; title: string; brief: string; swarmName: string },
): Promise<BuildResult> {
  const written = new Set<string>();
  let finishedSummary = "";
  let done = false;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are an engineering agent on Teamvinsible. Build small static web apps using tools. Prefer index.html, styles.css, app.js, package.json.",
    },
    {
      role: "user",
      content: `Build a small, beautiful static web app for this product brief.
Use write_file for index.html, styles.css, app.js, and package.json (serve on port 5173).
Keep it self-contained (no bundler required). Then call finish.

Title: ${opts.title}
Slug: ${opts.swarmName}
Brief:
${opts.brief}`,
    },
  ];

  const tools = toDeepSeekTools(TOOL_SPECS);

  for (let turn = 0; turn < 8 && !done; turn++) {
    let result;
    try {
      result = await deepseekChat(env, {
        messages,
        tools,
        maxTokens: 4096,
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

  return {
    ok: true,
    filesWritten: [...written],
    summary: finishedSummary || `Wrote ${written.size} files for ${opts.title}`,
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
