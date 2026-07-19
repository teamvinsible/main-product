import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8080);
const ROOT = "/workspace/app";
const DEEPSEEK_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 file relative to the app root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "Recursively list files under a prefix.",
      parameters: {
        type: "object",
        properties: { prefix: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a safe allowlisted shell command (npm, node, ls, cat).",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Mark the build complete.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  },
];

function safeRel(p) {
  const cleaned = String(p || "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("..")) return null;
  return cleaned;
}

async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true });
}

async function writeFileRel(rel, content) {
  const safe = safeRel(rel);
  if (!safe) throw new Error("bad path");
  const full = path.join(ROOT, safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

async function readFileRel(rel) {
  const safe = safeRel(rel);
  if (!safe) throw new Error("bad path");
  return fs.readFile(path.join(ROOT, safe), "utf8");
}

async function listFiles(prefix = "") {
  const safe = safeRel(prefix) || "";
  const base = path.join(ROOT, safe);
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  }
  await walk(base, safe);
  return out;
}

const ALLOWED_COMMANDS = new Set(["npm", "npx", "node", "ls", "cat", "pwd", "mkdir"]);

async function runCommand(command) {
  const cmd = String(command || "").trim();
  // No shell: reject metacharacters outright, then exec argv directly so the
  // allowlist cannot be bypassed with `ls; …` style chaining. Quoted arguments
  // are not supported by design.
  if (/[;&|`$<>(){}\n\r\\'"*?~#]/.test(cmd)) {
    return { stdout: "", stderr: "shell metacharacters are not allowed", code: 1 };
  }
  const argv = cmd.split(/\s+/).filter(Boolean);
  if (!argv[0] || !ALLOWED_COMMANDS.has(argv[0])) {
    return { stdout: "", stderr: "command not allowlisted", code: 1 };
  }
  try {
    const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
      cwd: ROOT,
      timeout: 60_000,
      maxBuffer: 2_000_000,
      env: { ...process.env, CI: "1" },
    });
    return { stdout: String(stdout).slice(0, 20_000), stderr: String(stderr).slice(0, 5_000), code: 0 };
  } catch (err) {
    return {
      stdout: String(err.stdout || "").slice(0, 20_000),
      stderr: String(err.stderr || err.message || "").slice(0, 5_000),
      code: err.code || 1,
    };
  }
}

async function collectAllFiles() {
  const files = await listFiles("");
  const map = {};
  for (const f of files.slice(0, 80)) {
    try {
      const content = await readFileRel(f);
      if (content.length <= 200_000) map[f] = content;
    } catch {
      /* skip */
    }
  }
  return map;
}

async function deepseekChat(apiKey, model, messages) {
  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 4096,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${t}`);
  }
  return res.json();
}

async function buildWithDeepseek(body) {
  const apiKey = body.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "";
  const model = body.deepseekModel || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  await ensureRoot();

  for (const [p, content] of Object.entries(body.seedFiles || {})) {
    try {
      await writeFileRel(p, content);
    } catch {
      /* skip */
    }
  }

  if (!apiKey) {
    await writeFileRel(
      "index.html",
      `<!doctype html><html><head><meta charset="utf-8"/><title>${body.title}</title></head>
<body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh">
<main><h1>${body.title}</h1><p>${String(body.brief || "").slice(0, 240)}</p></main></body></html>`,
    );
    await writeFileRel(
      "package.json",
      JSON.stringify({ name: body.swarmName, private: true, scripts: { start: "npx --yes serve -l 5173 ." } }, null, 2),
    );
    return { files: await collectAllFiles(), summary: "Scaffolded without DeepSeek key" };
  }

  const messages = [
    {
      role: "system",
      content: "You are an engineering agent. Build small static web apps using tools. Call finish when ready.",
    },
    {
      role: "user",
      content: `Build a small static web app in the workspace. Prefer index.html + styles.css + app.js + package.json.

Title: ${body.title}
Slug: ${body.swarmName}
Brief:
${body.brief}`,
    },
  ];

  let summary = "Build complete";
  let done = false;

  for (let turn = 0; turn < 10 && !done; turn++) {
    const data = await deepseekChat(apiKey, model, messages);
    const message = data.choices?.[0]?.message || {};
    const toolCalls = message.tool_calls || [];

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    });

    if (!toolCalls.length) break;

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      let content = "";
      try {
        const name = call.function?.name;
        if (name === "write_file") {
          await writeFileRel(args.path, args.content ?? "");
          content = JSON.stringify({ ok: true, path: args.path });
        } else if (name === "read_file") {
          content = await readFileRel(args.path);
        } else if (name === "list_files") {
          content = JSON.stringify({ files: await listFiles(args.prefix || "") });
        } else if (name === "run_command") {
          content = JSON.stringify(await runCommand(args.command));
        } else if (name === "finish") {
          done = true;
          summary = args.summary || summary;
          content = JSON.stringify({ ok: true });
        } else {
          content = JSON.stringify({ error: "unknown tool" });
        }
      } catch (err) {
        content = JSON.stringify({ error: String(err.message || err) });
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content,
      });
    }
  }

  const files = await collectAllFiles();
  if (!files["package.json"]) {
    await writeFileRel(
      "package.json",
      JSON.stringify(
        { name: body.swarmName || "app", private: true, scripts: { start: "npx --yes serve -l 5173 ." } },
        null,
        2,
      ),
    );
  }

  return { files: await collectAllFiles(), summary };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "swarm-runtime", llm: "deepseek" }));
      return;
    }
    if (req.method === "POST" && req.url === "/build") {
      const body = await readJson(req);
      const result = await buildWithDeepseek(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`swarm-runtime listening on ${PORT} (DeepSeek)`);
});
