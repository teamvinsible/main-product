import type http from "node:http";
import { isGitHubRepoAllowed, verifyGitHubSignature } from "./auth.js";

interface GitHubPayload {
  action?: string;
  repository?: { full_name?: string };
  issue?: { number?: number };
  comment?: { body?: string };
  inputs?: Record<string, string>;
}

export function handleGitHubWebhook(
  body: string,
  headers: http.IncomingHttpHeaders,
  spawnRun: (args: string[]) => { pid?: number },
): { status: number; body: string } {
  const event = headers["x-github-event"] as string | undefined;
  const sig = headers["x-hub-signature-256"] as string | undefined;

  if (!verifyGitHubSignature(body, sig)) {
    return { status: 403, body: JSON.stringify({ error: "Invalid signature" }) };
  }

  let payload: GitHubPayload;
  try {
    payload = JSON.parse(body) as GitHubPayload;
  } catch {
    return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const repo = payload.repository?.full_name || "";
  if (repo && !isGitHubRepoAllowed(repo)) {
    return { status: 403, body: JSON.stringify({ error: "Repo not allowed" }) };
  }

  if (event === "issue_comment" && payload.action === "created") {
    const comment = payload.comment?.body?.trim() || "";
    const match = comment.match(/^\/swarm\s+(fix|feature|change)\s+(\S+)\s+([\s\S]+)/i);
    if (match) {
      const intent = match[1].toLowerCase() === "fix" ? "bugfix" : match[1].toLowerCase() === "feature" ? "feature" : "change";
      const project = match[2];
      const request = match[3].trim();
      spawnRun(["change", project, request, "--no-ui", "--intent", intent, "--local-only"]);
      return { status: 200, body: JSON.stringify({ ok: true, project, intent }) };
    }
  }

  if (event === "workflow_dispatch") {
    const inputs = payload.inputs || {};
    const mode = inputs.mode || "change";
    if (mode === "run" && inputs.idea) {
      const name = inputs.name || "github-run";
      spawnRun(["run", inputs.idea, "--no-ui", "--name", name, "--provider", inputs.provider || "claude"]);
      return { status: 200, body: JSON.stringify({ ok: true, mode: "run" }) };
    }
    if (inputs.project && inputs.request) {
      spawnRun(["change", inputs.project, inputs.request, "--no-ui", "--local-only"]);
      return { status: 200, body: JSON.stringify({ ok: true, mode: "change" }) };
    }
  }

  return { status: 200, body: JSON.stringify({ ok: true, ignored: true }) };
}
