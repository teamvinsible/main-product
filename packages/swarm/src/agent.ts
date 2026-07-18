import { query, type HookInput, type HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import nodeCrypto from "node:crypto";
import OpenAI from "openai";
import type { AgentRole, Phase, AgentResult, Doubt, AgentRunLog, ModelConfig } from "./types.js";
import { logAgent, logError, logArtifact, SwarmLogger } from "./utils/logger.js";
import { filterCommandOutput, approxTokens, htmlToText, type FilterResult } from "./utils/output-filter.js";
import { PromptStore, DEFAULT_PROMPT_STORE } from "./prompts/prompt-store.js";
import { TEMPLATE_KEYS } from "./prompts/templates.js";
import { buildDockerExecArgs, isDockerInfrastructureFailure, sandboxConfigFromEnv, shouldSandboxExec } from "./sandbox.js";
import { loadMcpServers } from "./mcp-config.js";
import { createMcpToolRegistry, type McpToolRegistry } from "./mcp/client.js";
import { isArtifactPathAllowed, shouldSkipArtifactEntry } from "./utils/artifacts.js";
import { scrubSecretsFromEnv, isSensitiveFile, redactEnvFileContent, redactSecrets } from "./utils/env-scope.js";
import { ToolRegistry, fromOpenAiTools } from "./agent/tool-registry.js";
import { OpenAiCompatibleProvider } from "./agent/providers/openai-compatible.js";
import { AnthropicProvider } from "./agent/providers/anthropic.js";
import type { LlmMessage, LlmProvider } from "./agent/llm-provider.js";
import { isTransientError, isQuotaOrAuthError, isFatalError } from "./agent/error-classify.js";
import { getCachedCommandOutput, putCachedCommandOutput } from "./utils/command-cache.js";
import { buildProjectIndex, formatProjectIndex } from "./utils/project-index.js";
import { isWebFetchAllowed } from "./harness/policy.js";
import { discoverSkills, loadSkillBody, type SkillEntry } from "./skills/registry.js";
import { buildCapabilityBriefing } from "./capabilities/briefing.js";
import { writeProposal } from "./routing/proposals.js";

export class Agent {
  readonly role: AgentRole;
  readonly phase: Phase;
  private workspaceDir: string;
  private systemPrompt: string;
  private logger: SwarmLogger | null;
  private modelConfig: ModelConfig;
  private promptStore: PromptStore;

  // Token-optimization state, per agent run.
  private readCache = new Map<string, string>(); // path -> sha256 of last-returned content
  private savedChars = 0;                          // cumulative chars kept out of model context
  private writtenArtifacts = new Set<string>();     // files written/edited by this agent run
  private commandTimeouts = 0;
  private stallCount = 0;
  private toolMode: "full" | "readonly" = "full";
  private skillsCatalog: SkillEntry[] = [];
  private loadedSkillNames: string[] = [];
  private mcpServerNames: string[] = [];

  constructor(
    role: AgentRole,
    phase: Phase,
    workspaceDir: string,
    systemPrompt: string,
    modelConfig: ModelConfig,
    logger?: SwarmLogger,
    promptStore?: PromptStore,
  ) {
    this.role = role;
    this.phase = phase;
    this.workspaceDir = this.canonicalPath(workspaceDir);
    this.systemPrompt = systemPrompt;
    this.modelConfig = modelConfig;
    this.logger = logger || null;
    this.promptStore = promptStore ?? DEFAULT_PROMPT_STORE;
  }

  private canonicalPath(dir: string): string {
    try {
      return fs.realpathSync.native(dir);
    } catch {
      return path.resolve(dir);
    }
  }

  async run(taskPrompt: string): Promise<AgentResult> {
    logAgent(this.role, `Starting task...`, this.phase);
    const startTime = Date.now();
    this.skillsCatalog = discoverSkills({
      repoRoot: this.resolveRepoRoot(),
      workspaceDir: this.workspaceDir,
    });

    const doubtsFile = this.agentScratchPath(`doubts-${this.role}.json`);
    const summaryFile = this.agentScratchPath(`summary-${this.role}.md`);

    // Clean up previous run files
    for (const f of [doubtsFile, summaryFile]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    this.writtenArtifacts.clear();
    this.commandTimeouts = 0;
    this.stallCount = 0;
    const beforeFiles = this.snapshotWorkspaceFiles();

    const fullPrompt = this.buildPrompt(taskPrompt, doubtsFile, summaryFile);

    this.logger?.log("debug", "agent", `Prompt sent (${fullPrompt.length} chars)`, {
      agent: this.role,
      phase: this.phase,
      metadata: { promptLength: fullPrompt.length },
    });

    try {
      const output = await this.runProvider(fullPrompt);
      const durationMs = Date.now() - startTime;

      logAgent(this.role, `Completed in ${(durationMs / 1000).toFixed(1)}s`, this.phase);

      const doubts = this.parseDoubts(doubtsFile);
      const summary = fs.existsSync(summaryFile)
        ? fs.readFileSync(summaryFile, "utf-8")
        : this.extractSummary(output);

      const artifacts = this.findCreatedArtifacts(beforeFiles);

      for (const artifact of artifacts) {
        logArtifact(artifact, this.role);
      }

      const tokensSaved = approxTokens(this.savedChars);

      const runLog: AgentRunLog = {
        id: crypto.randomUUID(),
        role: this.role,
        phase: this.phase,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        promptSent: fullPrompt,
        fullOutput: output,
        success: true,
        artifactsCreated: artifacts,
        doubtsRaised: doubts,
        summary,
        tokensSaved,
      };
      this.logger?.recordAgentRun(runLog);

      return {
        role: this.role,
        phase: this.phase,
        success: true,
        artifacts,
        doubts,
        summary,
        tokensSaved,
        commandTimeouts: this.commandTimeouts,
        stallCount: this.stallCount,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);
      logError(`Agent ${this.role} failed: ${errMsg}`);

      const runLog: AgentRunLog = {
        id: crypto.randomUUID(),
        role: this.role,
        phase: this.phase,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        promptSent: fullPrompt,
        fullOutput: "",
        success: false,
        error: errMsg,
        artifactsCreated: [],
        doubtsRaised: [],
        summary: "",
      };
      this.logger?.recordAgentRun(runLog);

      return {
        role: this.role,
        phase: this.phase,
        success: false,
        artifacts: [],
        doubts: [],
        summary: "",
        error: errMsg,
        tokensSaved: approxTokens(this.savedChars),
        commandTimeouts: this.commandTimeouts,
        stallCount: this.stallCount,
      };
    }
  }

  /** Tool-enabled single-turn review (read-only tools + skills). Used by tech-lead. */
  async runReadOnly(taskPrompt: string): Promise<string> {
    this.toolMode = "readonly";
    this.skillsCatalog = discoverSkills({
      repoRoot: this.resolveRepoRoot(),
      workspaceDir: this.workspaceDir,
    });
    try {
      return await this.runProvider(taskPrompt);
    } finally {
      this.toolMode = "full";
    }
  }

  private resolveRepoRoot(): string {
    const parent = path.basename(path.dirname(path.dirname(this.workspaceDir)));
    if (parent === ".swarm") {
      return path.dirname(path.dirname(path.dirname(this.workspaceDir)));
    }
    return process.cwd();
  }

  private isReadOnlyTools(): boolean {
    return this.toolMode === "readonly";
  }

  private buildPrompt(taskPrompt: string, doubtsFile: string, summaryFile: string): string {
    const skillsHint = this.skillsCatalog.length
      ? `\n\n## Skills catalog (${this.skillsCatalog.length} available — use load_skill to read any)\n${this.skillsCatalog.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`
      : "";
    return this.promptStore.render(TEMPLATE_KEYS.agentWrapper, {
      systemPrompt: this.systemPrompt + skillsHint,
      workspaceDir: this.workspaceDir,
      role: this.role,
      hostShell: process.platform === "win32" ? "Windows PowerShell/cmd" : "POSIX shell",
      doubtsFile,
      summaryFile,
      taskPrompt,
      capabilityBriefing: "",
    });
  }

  private async runProvider(prompt: string): Promise<string> {
    const { provider, model } = this.modelConfig;
    logAgent(this.role, `Invoking [${provider}/${model}]...`, this.phase);

    const callPrimary = (): Promise<string> => {
      switch (provider) {
        case "claude":    return this.runClaudeSDK(prompt);
        case "anthropic": return this.runAnthropic(prompt);
        case "codex":     return this.runCodex(prompt);
        case "deepseek":  return this.runDeepSeek(prompt);
        case "openrouter": return this.runOpenRouter(prompt);
        case "custom":    return this.runCustomProvider(prompt);
        default:          return Promise.reject(new Error(`Unknown provider: ${provider}`));
      }
    };

    try {
      // Retry the configured provider on transient errors before giving up.
      return await this.attemptOnProvider(`${provider}/${model}`, callPrimary);
    } catch (err) {
      // DeepSeek is the catch-all safety net; if it's already the primary,
      // there's nothing below it to fall back to.
      if (provider === "deepseek") throw err;

      // A fatal (request-inherent) error will fail on DeepSeek too — and worse,
      // since DeepSeek's context is smaller. Surface it instead of cascading.
      if (this.isFatalError(err)) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger?.log("error", "agent",
          `${provider} hit a fatal request error (not retrying or falling back — shrink the input). ${reason.slice(0, 300)}`, {
          agent: this.role, phase: this.phase,
          metadata: { failedProvider: provider, failedModel: model, fatal: true, reason },
        });
        throw err;
      }

      const reason = err instanceof Error ? err.message : String(err);
      this.logger?.log("warn", "agent",
        `${provider} exhausted (down or out of credits); falling back to DeepSeek. Reason: ${reason.slice(0, 300)}`, {
        agent: this.role,
        phase: this.phase,
        metadata: { failedProvider: provider, failedModel: model, fallbackProvider: "deepseek", reason },
      });
      logAgent(this.role, `Fallback [deepseek/${this.deepSeekFallbackModel()}]...`, this.phase);
      // The fallback gets its own retry budget so a transient DeepSeek blip
      // doesn't sink the whole run after the primary already failed.
      return this.attemptOnProvider(`deepseek/${this.deepSeekFallbackModel()}`,
        () => this.runDeepSeek(prompt, this.deepSeekFallbackModel()));
    }
  }

  // Defense-in-depth for the Agent SDK path (which uses the SDK's own Read/Bash
  // tools, not our guarded read_file). A PreToolUse hook denies reading a real
  // `.env`/credential file — and PreToolUse denies apply even under
  // bypassPermissions. The log-redaction layer is the backstop.
  private sensitiveReadGuardHooks() {
    const guard = async (input: HookInput): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const toolInput = (input.tool_input || {}) as Record<string, unknown>;
      const target = this.sensitiveReadTarget(input.tool_name, toolInput);
      if (!target) return {};
      this.logger?.log("warn", "agent", `Blocked ${input.tool_name} of sensitive file (${target}); secrets stay out of context.`, {
        agent: this.role, phase: this.phase,
      });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `Reading '${target}' is blocked because it holds secrets. Read '.env.example' for the expected keys, or raise a doubt to request a real value — never inline secrets.`,
        },
      };
    };
    return { PreToolUse: [{ hooks: [guard] }] };
  }

  // The sensitive path a tool call would read, or null if it's safe.
  private sensitiveReadTarget(toolName: string, input: Record<string, unknown>): string | null {
    if (toolName === "Read" || toolName === "NotebookRead") {
      const fp = (input.file_path || input.notebook_path || input.path) as string | undefined;
      if (fp && isSensitiveFile(fp)) return fp;
      return null;
    }
    if (toolName === "Bash") {
      const cmd = String(input.command || "");
      // Only guard read verbs — writing/creating a .env is legitimate.
      if (/\b(cat|type|less|more|head|tail|nl|xxd|od|strings|bat|gc|Get-Content)\b/i.test(cmd)) {
        const token = (cmd.match(/[^\s"'|&;<>]+/g) || []).find((t) => isSensitiveFile(t));
        if (token) return token;
      }
    }
    return null;
  }

  private sensitiveCommandTarget(command: string): string | null {
    if (!/\b(cat|type|less|more|head|tail|nl|xxd|od|strings|bat|gc|Get-Content)\b/i.test(command)) {
      return null;
    }
    const tokens = command.match(/(?:"[^"]+"|'[^']+'|[^\s|&;<>]+)/g) ?? [];
    for (const raw of tokens) {
      const token = raw.replace(/^['"]|['"]$/g, "");
      if (!/[\\/]/.test(token) && !token.startsWith(".")) continue;
      const resolved = path.isAbsolute(token) ? token : path.resolve(this.workspaceDir, token);
      if (isSensitiveFile(resolved)) return token;
    }
    return null;
  }

  private async runClaudeSDK(prompt: string): Promise<string> {
    let fullOutput = "";
    let turnCount = 0;
    let emptyToolResults = 0;
    let sdkInitLogged = false;
    const toolCallCounts = new Map<string, number>();
    const mcpServers = this.loadMcpServersForClaude();

    const session = query({
      prompt,
      options: {
        systemPrompt: this.systemPrompt,
        model: this.modelConfig.model,
        cwd: this.workspaceDir,
        permissionMode: "bypassPermissions",
        maxTurns: 50,
        hooks: this.sensitiveReadGuardHooks(),
        ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      },
    });

    for await (const message of session) {
      const msg = message as Record<string, unknown>;
      const type = msg.type as string;

      switch (type) {
        case "assistant": {
          turnCount++;
          const content = (msg.message as Record<string, unknown>)?.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<Record<string, unknown>>) {
              if (block.type === "text" && block.text) {
                const text = block.text as string;
                fullOutput += text + "\n";
                // Stream text in chunks for real-time visibility
                const lines = text.split("\n").filter((l: string) => l.trim());
                for (const line of lines) {
                  this.logger?.log("debug", "agent", line.slice(0, 200), {
                    agent: this.role, phase: this.phase,
                  });
                }
              } else if (block.type === "tool_use") {
                const toolName = block.name as string;
                const toolInput = block.input as Record<string, unknown>;
                const callKey = `${toolName}:${JSON.stringify(toolInput ?? {})}`;
                const callCount = (toolCallCounts.get(callKey) ?? 0) + 1;
                toolCallCounts.set(callKey, callCount);
                if (callCount >= this.repeatedToolCallLimit()) {
                  this.stallCount++;
                  throw new Error(
                    `Claude Code stalled: repeated the same tool call ${callCount} times (${toolName}). ` +
                    `Stop rediscovering and change strategy or ask for input.`,
                  );
                }
                // Log tool invocations with details
                const inputPreview = this.formatToolInput(toolName, toolInput);
                this.logger?.log("info", "agent", `Tool: ${toolName} ${inputPreview}`, {
                  agent: this.role, phase: this.phase,
                  metadata: { tool: toolName, input: toolInput },
                });
              }
            }
          }
          // Check for errors (rate limit, auth, etc.)
          const error = (msg as Record<string, unknown>).error;
          if (error) {
            throw new Error(`Claude Code returned an error result: ${error}`);
          }
          break;
        }

        case "user": {
          // Tool results coming back
          const content = (msg.message as Record<string, unknown>)?.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<Record<string, unknown>>) {
              if (block.type === "tool_result") {
                const toolId = block.tool_use_id as string;
                const resultContent = block.content;
                let preview = "";
                if (typeof resultContent === "string") {
                  preview = resultContent.slice(0, 100);
                } else if (Array.isArray(resultContent)) {
                  const textBlock = resultContent.find((b: Record<string, unknown>) => b.type === "text");
                  if (textBlock) preview = (textBlock.text as string || "").slice(0, 100);
                }
                const resultText = typeof resultContent === "string"
                  ? resultContent
                  : Array.isArray(resultContent)
                    ? resultContent.map((b: Record<string, unknown>) => String(b.text ?? "")).join("\n")
                    : "";
                if (/Command timed out/i.test(resultText)) this.commandTimeouts++;
                if (resultText.trim() === "" || resultText.trim() === "(no output)") {
                  emptyToolResults++;
                  if (emptyToolResults >= this.emptyToolResultLimit()) {
                    this.stallCount++;
                    throw new Error(
                      `Claude Code stalled: received ${emptyToolResults} empty tool results. ` +
                      `Use a different inspection method or report the blocker.`,
                    );
                  }
                } else {
                  emptyToolResults = 0;
                }
                if (preview) {
                  this.logger?.log("debug", "agent", `Result: ${preview}`, {
                    agent: this.role, phase: this.phase,
                    metadata: { toolId },
                  });
                }
              }
            }
          }
          break;
        }

        case "result": {
          const cost = msg.total_cost_usd as number | undefined;
          const subtype = msg.subtype as string;
          const numTurns = msg.num_turns as number;
          const durationMs = msg.duration_ms as number;
          const usage = msg.usage as Record<string, unknown>;
          const modelUsage = msg.modelUsage as Record<string, unknown>;

          if (subtype !== "success") {
            const errors = msg.errors as string[] | undefined;
            const errorMsg = errors?.join("; ") || msg.result as string || subtype;
            throw new Error(`Claude Code returned an error result: ${errorMsg}`);
          }

          this.logger?.log("info", "agent",
            `Completed: ${numTurns} turns, ${(durationMs / 1000).toFixed(1)}s, $${(cost ?? 0).toFixed(4)}`, {
            agent: this.role, phase: this.phase,
            metadata: { cost, numTurns, durationMs, usage, modelUsage, model: this.modelConfig.model },
          });
          break;
        }

        // Real-time progress events
        case "system": {
          const subtype = String(msg.subtype || msg.status || "system");
          if (!sdkInitLogged && /init|started|session/i.test(subtype)) {
            sdkInitLogged = true;
            this.logger?.log("debug", "system", `SDK init: session started`, {
              agent: this.role, phase: this.phase,
              metadata: { subtype },
            });
          } else if (!/init|started|session/i.test(subtype)) {
            this.logger?.log("debug", "system", `SDK system: ${subtype}`, {
              agent: this.role, phase: this.phase,
            });
          }
          break;
        }

        default: {
          // Log other message types for visibility
          if (["status", "tool_progress", "task_progress", "notification", "rate_limit"].includes(type)) {
            const detail = msg.message || msg.status || msg.subtype || "";
            this.logger?.log("debug", "agent", `[${type}] ${String(detail).slice(0, 150)}`, {
              agent: this.role, phase: this.phase,
            });
          }
          break;
        }
      }
    }

    if (!fullOutput.trim()) {
      throw new Error("Agent produced no output");
    }

    return fullOutput;
  }

  private formatToolInput(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case "Write":
      case "Edit":
        return `-> ${input.file_path || input.filePath || ""}`;
      case "Read":
        return `<- ${input.file_path || input.filePath || ""}`;
      case "Bash":
        return `$ ${String(input.command || "").slice(0, 80)}`;
      case "Glob":
        return `? ${input.pattern || ""}`;
      case "Grep":
        return `/ ${input.pattern || ""} in ${input.path || "."}`;
      case "WebSearch":
        return `@ "${input.query || ""}"`;
      case "WebFetch":
        return `@ ${input.url || ""}`;
      default:
        return JSON.stringify(input).slice(0, 80);
    }
  }

  private loadMcpServersForClaude() {
    const loaded = loadMcpServers(this.workspaceDir);
    for (const warning of loaded.warnings) {
      this.logger?.log("warn", "agent", `MCP config ignored: ${warning}`, {
        agent: this.role,
        phase: this.phase,
      });
    }
    if (loaded.paths.length && Object.keys(loaded.servers).length) {
      this.logger?.log("info", "agent", `Loaded MCP servers from ${loaded.paths.map((p) => path.basename(p)).join(", ")}`, {
        agent: this.role,
        phase: this.phase,
        metadata: { paths: loaded.paths, servers: Object.keys(loaded.servers) },
      });
    }
    return loaded.servers;
  }

  // ── DeepSeek provider (multi-turn tool-use via OpenAI-compatible API) ──

  // Build the provider-agnostic tool set (schema + handler defined together,
  // once). Any provider adapter renders these specs into its own wire format,
  // so every model — not just DeepSeek — gets the same capabilities. Handlers
  // close over `this` for workspace, cache, logger, and exec helpers.
  private buildTools(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.register({
      name: "project_index",
      description: "Return a deterministic local map of the project: key files, package scripts, package managers, likely commands, and referenced env vars. Use this before broad file scanning or exploratory shell commands.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Maximum key files to include (default 160)" } },
        required: [],
      },
      handler: (args) => {
        const limit = Number.isFinite(args.limit as number) ? Math.max(20, Math.min(Number(args.limit), 300)) : 160;
        return formatProjectIndex(buildProjectIndex(this.workspaceDir), limit);
      },
    });

    registry.register({
      name: "read_file",
      description: "Read the contents of a file. Returns the full text content.",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string", description: "Path relative to the workspace root" } },
        required: ["file_path"],
      },
      handler: (args) => {
        const filePath = this.resolveWorkspacePath(args.file_path as string);
        if (!fs.existsSync(filePath)) return `Error: File not found: ${args.file_path}`;
        const stat = fs.statSync(filePath);
        if (stat.size > 500_000) return `Error: File too large (${(stat.size / 1024).toFixed(0)}KB). Read a smaller file or use search_files.`;
        const content = fs.readFileSync(filePath, "utf-8");
        // Secrets stay out of the model's context: for a real `.env` or a
        // credential file, return keys with values masked (`.env.example` and
        // friends are exempt — they hold placeholders the agent needs).
        if (isSensitiveFile(args.file_path as string) || isSensitiveFile(filePath)) {
          return `[sensitive file — values redacted so secrets don't enter context; set real values in ${args.file_path}]\n${redactEnvFileContent(content)}`;
        }
        // re-read dedup: if this exact content was already returned this
        // session, don't resend it — it's still in context.
        const hash = nodeCrypto.createHash("sha256").update(content).digest("hex");
        if (this.readCache.get(filePath) === hash) {
          this.savedChars += content.length;
          return `[unchanged — '${args.file_path}' is identical to a previous read this session (${content.length} bytes already in context); not resent]`;
        }
        this.readCache.set(filePath, hash);
        return content;
      },
    });

    if (!this.isReadOnlyTools()) {
      registry.register({
        name: "write_file",
        description: "Create or overwrite a file with the given content.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path relative to the workspace root" },
            content: { type: "string", description: "Full file content to write" },
          },
          required: ["file_path", "content"],
        },
        handler: (args) => {
          const filePath = this.resolveWorkspacePath(args.file_path as string);
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, args.content as string, "utf-8");
          this.trackWrittenArtifact(args.file_path as string);
          return `OK: Wrote ${(args.content as string).length} bytes to ${args.file_path}`;
        },
      });

      registry.register({
        name: "edit_file",
        description: "Replace an exact substring in a file with new content. The old_string must appear exactly once in the file.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path relative to the workspace root" },
            old_string: { type: "string", description: "Exact text to find (must be unique in the file)" },
            new_string: { type: "string", description: "Replacement text" },
          },
          required: ["file_path", "old_string", "new_string"],
        },
        handler: (args) => {
          const filePath = this.resolveWorkspacePath(args.file_path as string);
          if (!fs.existsSync(filePath)) return `Error: File not found: ${args.file_path}`;
          const content = fs.readFileSync(filePath, "utf-8");
          const oldStr = args.old_string as string;
          const newStr = args.new_string as string;
          const count = content.split(oldStr).length - 1;
          if (count === 0) return `Error: old_string not found in ${args.file_path}. Make sure it matches exactly (including whitespace).`;
          if (count > 1) return `Error: old_string found ${count} times in ${args.file_path}. Provide more surrounding context to make it unique.`;
          fs.writeFileSync(filePath, content.replace(oldStr, newStr), "utf-8");
          this.trackWrittenArtifact(args.file_path as string);
          return `OK: Replaced in ${args.file_path}`;
        },
      });
    }

    registry.register({
      name: "list_files",
      description: "List files in a directory. Returns file/directory names, one per line. Use a glob pattern to filter.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Directory relative to workspace root (default: '.')" },
          recursive: { type: "boolean", description: "List recursively (default: false)" },
        },
        required: [],
      },
      handler: (args) => {
        const dir = this.resolveWorkspacePath((args.directory as string) || ".");
        if (!fs.existsSync(dir)) return `Error: Directory not found: ${args.directory || "."}`;
        const recursive = args.recursive as boolean;
        const entries: string[] = [];
        const walk = (d: string, prefix: string) => {
          const items = fs.readdirSync(d, { withFileTypes: true });
          for (const item of items) {
            if (item.name.startsWith(".") || shouldSkipArtifactEntry(item.name)) continue;
            const rel = prefix ? `${prefix}/${item.name}` : item.name;
            entries.push(item.isDirectory() ? `${rel}/` : rel);
            if (recursive && item.isDirectory() && entries.length < 500) {
              walk(path.join(d, item.name), rel);
            }
          }
        };
        walk(dir, "");
        if (entries.length === 0) return "(empty directory)";
        return entries.join("\n");
      },
    });

    registry.register({
      name: "search_files",
      description: "Search for a text pattern across files. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern:   { type: "string", description: "Text or regex pattern to search for" },
          directory: { type: "string", description: "Directory to search in (default: '.')" },
          file_glob: { type: "string", description: "Glob to filter files, e.g. '*.ts' (default: all files)" },
        },
        required: ["pattern"],
      },
      handler: (args) => {
        const pattern = args.pattern as string;
        const dir = this.resolveWorkspacePath((args.directory as string) || ".");
        const fileGlob = args.file_glob as string | undefined;
        const regex = new RegExp(pattern, "i");
        const results: string[] = [];
        const walk = (d: string) => {
          if (!fs.existsSync(d)) return;
          const items = fs.readdirSync(d, { withFileTypes: true });
          for (const item of items) {
            if (item.name.startsWith(".") || shouldSkipArtifactEntry(item.name)) continue;
            const full = path.join(d, item.name);
            if (item.isDirectory()) { walk(full); continue; }
            if (fileGlob) {
              const ext = fileGlob.replace("*", "");
              if (!item.name.endsWith(ext)) continue;
            }
            try {
              const content = fs.readFileSync(full, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  const rel = path.relative(this.workspaceDir, full).replace(/\\/g, "/");
                  results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                  if (results.length >= 100) return;
                }
              }
            } catch { /* skip binary files */ }
          }
        };
        walk(dir);
        if (results.length === 0) return `No matches found for "${pattern}"`;
        return results.join("\n");
      },
    });

    if (!this.isReadOnlyTools()) {
    registry.register({
      name: "run_command",
      description: "Execute a shell command in the workspace directory. Prefer project_index, search_files, read_file, and package scripts before exploratory commands. Safe repeated status/build/test commands may return cached output when files are unchanged. On Windows, use PowerShell/cmd-compatible commands.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to execute" } },
        required: ["command"],
      },
      handler: async (args) => {
        const originalCommand = args.command as string;
        const command = this.normalizeLocalCommand(originalCommand);
        // Block dangerous commands
        const blocked = ["rm -rf /", "rm -rf ~", "mkfs", "dd if=", ":(){", "fork bomb"];
        if (blocked.some((b) => originalCommand.includes(b) || command.includes(b))) {
          return "Error: Command blocked for safety.";
        }
        const sensitiveTarget = this.sensitiveCommandTarget(originalCommand) || this.sensitiveCommandTarget(command);
        if (sensitiveTarget) {
          return `Error: Command blocked because it targets sensitive file ${sensitiveTarget}. Use read_file for safe redacted inspection when appropriate.`;
        }
        const raw = await this.execCommand(command);
        // Compression: shrink verbose CLI output before it re-enters the model
        // context (it is resent on every subsequent turn).
        const failed = raw.startsWith("Exit code") || raw.startsWith("Error:");
        const { output, originalChars, filteredChars } = filterCommandOutput(command, raw, failed);
        const saved = originalChars - filteredChars;
        if (saved > 0) {
          this.savedChars += saved;
          this.logger?.log("debug", "agent",
            `Compressed '${command.slice(0, 40)}' output: ${originalChars}→${filteredChars} chars (−${approxTokens(saved)} tok)`, {
            agent: this.role, phase: this.phase,
          });
        }
        return redactSecrets(output);
      },
    });
    }

    registry.register({
      name: "web_fetch",
      description: "Fetch a web page or API over HTTP(S) and return its text content (HTML is stripped to readable text). Use this for market/competitor/technology research instead of shelling out to curl — it works cross-platform and returns clean, compressed text.",
      parameters: {
        type: "object",
        properties: {
          url:       { type: "string", description: "Absolute http:// or https:// URL to fetch" },
          max_chars: { type: "number", description: "Maximum characters of body text to return (default 8000)" },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const url = String(args.url ?? "").trim();
        const maxChars = Number.isFinite(args.max_chars as number) && (args.max_chars as number) > 0
          ? Math.min(Number(args.max_chars), 50_000)
          : 8000;
        const { output, originalChars, filteredChars } = await this.fetchWebPage(url, maxChars);
        const saved = originalChars - filteredChars;
        if (saved > 0) {
          this.savedChars += saved;
          this.logger?.log("debug", "agent",
            `web_fetch '${url.slice(0, 60)}' body: ${originalChars}→${filteredChars} chars (−${approxTokens(saved)} tok)`, {
            agent: this.role, phase: this.phase,
          });
        }
        return output;
      },
    });

    this.registerMetaTools(registry);
    return registry;
  }

  private registerMetaTools(registry: ToolRegistry): void {
    registry.register({
      name: "list_skills",
      description: "List all available skills (name, description, tags). Use load_skill to read the full SKILL.md body.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional filter substring" },
        },
        required: [],
      },
      handler: (args) => {
        const q = String(args.query || "").trim().toLowerCase();
        const items = q
          ? this.skillsCatalog.filter((s) =>
            s.name.toLowerCase().includes(q)
            || s.description.toLowerCase().includes(q)
            || s.tags.some((t) => t.toLowerCase().includes(q)),
          )
          : this.skillsCatalog;
        if (!items.length) return q ? `No skills match "${q}".` : "No skills installed.";
        return items.map((s) => `${s.name}${s.tags.length ? ` [${s.tags.join(", ")}]` : ""}: ${s.description}`).join("\n");
      },
    });

    registry.register({
      name: "load_skill",
      description: "Load a skill's full SKILL.md instructions into context. No approval required.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Skill name from list_skills" } },
        required: ["name"],
      },
      handler: (args) => {
        const name = String(args.name || "").trim();
        const entry = this.skillsCatalog.find((s) => s.name === name);
        if (!entry) return `Error: Unknown skill "${name}". Call list_skills first.`;
        if (!this.loadedSkillNames.includes(name)) this.loadedSkillNames.push(name);
        this.logger?.log("info", "agent", `Loaded skill: ${name}`, {
          agent: this.role, phase: this.phase, metadata: { skill: name },
        });
        return `# Skill: ${name}\n\n${loadSkillBody(entry)}`;
      },
    });

    registry.register({
      name: "list_tools",
      description: "List all built-in and MCP tools currently available in this run.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: () => {
        const builtins = registry.specs().map((t) => t.name).join(", ");
        const mcp = this.mcpToolNamesCache.length ? this.mcpToolNamesCache.join(", ") : "(connecting MCP…)";
        return `Built-in: ${builtins}\nMCP: ${mcp}\nMCP servers: ${this.mcpServerNames.join(", ") || "(none)"}`;
      },
    });

    if (!this.isReadOnlyTools()) {
      registry.register({
        name: "propose_step",
        description: "Propose a route change (insert/skip/reorder/add_agent). Auto-applied when valid.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", description: "insert | skip | reorder | add_agent" },
            phase: { type: "string", description: "Pipeline phase name" },
            agents: { type: "array", items: { type: "string" }, description: "Agent roles (for insert/add_agent)" },
            reason: { type: "string", description: "Why this step is needed" },
          },
          required: ["action", "phase", "reason"],
        },
        handler: (args) => {
          const action = String(args.action || "") as "insert" | "skip" | "reorder" | "add_agent";
          const phase = String(args.phase || "") as Phase;
          const reason = String(args.reason || "").trim();
          if (!reason) return "Error: reason is required.";
          const agents = Array.isArray(args.agents) ? args.agents.map(String) : undefined;
          const proposal = writeProposal(this.workspaceDir, {
            action, phase, agents: agents as AgentRole[] | undefined, reason, proposedBy: this.role,
          });
          return `OK: Proposal ${proposal.id} queued (${action} ${phase}). The orchestrator will apply it if valid.`;
        },
      });
    }
  }

  private mcpToolNamesCache: string[] = [];

  private async runDeepSeek(prompt: string, modelOverride?: string): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DEEPSEEK_API_KEY environment variable is required for deepseek provider. " +
        "Get one at https://platform.deepseek.com/"
      );
    }
    const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    const model = modelOverride || this.modelConfig.model;
    const provider = new OpenAiCompatibleProvider({
      name: "deepseek", model, apiKey, baseURL, timeout: this.deepSeekTimeoutMs(),
    });
    return this.runAgenticLoop(prompt, provider);
  }

  // Any model via OpenRouter — one gateway + one key fronting many providers
  // (Anthropic, OpenAI, DeepSeek, Google, Meta, …) behind the OpenAI-compatible
  // wire format. Same generic loop + tool registry as every other provider.
  // Models are OpenRouter slugs, e.g. "anthropic/claude-sonnet-4.6".
  private async runOpenRouter(prompt: string, modelOverride?: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY environment variable is required for the 'openrouter' provider. " +
        "Get one at https://openrouter.ai/keys"
      );
    }
    const baseURL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    const model = modelOverride || this.modelConfig.model;
    const provider = new OpenAiCompatibleProvider({
      name: "openrouter", model, apiKey, baseURL, timeout: this.openRouterTimeoutMs(),
    });
    return this.runAgenticLoop(prompt, provider);
  }

  // Claude via the raw Anthropic Messages API (pay-as-you-go / prompt caching),
  // running the SAME generic loop + tool registry as every other provider — so
  // web_fetch and the file/shell tools reach Claude too. Distinct from the
  // "claude" provider, which drives the subscription-billed Agent SDK.
  private async runAnthropic(prompt: string, modelOverride?: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for the 'anthropic' provider. " +
        "Add it in Settings, or use the 'claude' provider (Agent SDK / subscription auth) instead."
      );
    }
    const model = modelOverride || this.modelConfig.model;
    const provider = new AnthropicProvider({
      name: "anthropic", model, apiKey, timeout: this.anthropicTimeoutMs(),
    });
    return this.runAgenticLoop(prompt, provider);
  }

  // Provider-agnostic agentic loop: turns of provider.chat() + tool execution
  // through the registry (MCP-first), with compression accounting and logging.
  // Any LlmProvider plugs in unchanged — this is the LLM-agnostic core.
  private async runAgenticLoop(prompt: string, provider: LlmProvider): Promise<string> {
    const model = provider.model;
    const maxTurns = 50;
    const mcpLoaded = loadMcpServers(this.workspaceDir);
    this.mcpServerNames = Object.keys(mcpLoaded.servers);
    const mcpRegistry = await createMcpToolRegistry(this.workspaceDir);
    this.mcpToolNamesCache = mcpRegistry.tools.map((t) => (t.type === "function" ? t.function.name : "custom"));
    for (const warning of mcpRegistry.warnings) {
      this.logger?.log("warn", "agent", `MCP bridge warning: ${warning}`, {
        agent: this.role,
        phase: this.phase,
      });
    }
    if (mcpRegistry.tools.length) {
      this.logger?.log("info", "agent", `${provider.name} MCP bridge loaded ${mcpRegistry.tools.length} tool(s)`, {
        agent: this.role,
        phase: this.phase,
        metadata: { tools: mcpRegistry.tools.map((t) => t.type === "function" ? t.function.name : "custom") },
      });
    }
    const toolRegistry = this.buildTools();
    // Built-in tools + MCP tools (normalized to neutral specs) travel through
    // the provider together; dispatch stays MCP-first in executeDeepSeekTool.
    const toolSpecs = [...toolRegistry.specs(), ...fromOpenAiTools(mcpRegistry.tools)];

    const briefing = buildCapabilityBriefing({
      skills: this.skillsCatalog,
      builtinTools: toolRegistry.specs(),
      mcpToolNames: this.mcpToolNamesCache,
      mcpServers: this.mcpServerNames,
    });
    const userContent = `${briefing}\n\n---\n\n${prompt}`;

    const messages: LlmMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: userContent },
    ];

    this.logger?.log("info", "agent", `${provider.name} agentic loop: model=${model}, maxTurns=${maxTurns}`, {
      agent: this.role, phase: this.phase,
    });

    const startTime = Date.now();
    let fullOutput = "";
    let totalTokens = { prompt: 0, completion: 0, total: 0, cacheRead: 0, cacheWrite: 0 };
    let completed = false;
    const toolCallCounts = new Map<string, number>();
    let emptyToolResults = 0;

    // Reset per-run token-optimization state.
    this.readCache.clear();
    this.savedChars = 0;

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        const response = await provider.chat({
          messages, tools: toolSpecs, maxTokens: 16384, temperature: 0.1,
        });

        // Accumulate token usage
        if (response.usage) {
          totalTokens.cacheRead += response.usage.cacheRead ?? 0;
          totalTokens.cacheWrite += response.usage.cacheWrite ?? 0;
          totalTokens.prompt += response.usage.prompt;
          totalTokens.completion += response.usage.completion;
          totalTokens.total += response.usage.total;
        }

        // Collect any text content
        if (response.text) {
          fullOutput += response.text + "\n";
          const preview = response.text.slice(0, 200).replace(/\n/g, " ");
          this.logger?.log("debug", "agent", `[turn ${turn + 1}] ${preview}`, {
            agent: this.role, phase: this.phase,
          });
        }

        // If no tool calls, the model is done
        if (response.toolCalls.length === 0) {
          this.logger?.log("info", "agent", `${provider.name} finished after ${turn + 1} turns`, {
            agent: this.role, phase: this.phase,
          });
          completed = true;
          break;
        }

        // Append the assistant turn (with tool calls) to history.
        messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });

        // Execute each tool call and append results.
        for (const call of response.toolCalls) {
          const callKey = `${call.name}:${JSON.stringify(call.arguments ?? {})}`;
          const callCount = (toolCallCounts.get(callKey) ?? 0) + 1;
          toolCallCounts.set(callKey, callCount);
          if (callCount >= this.repeatedToolCallLimit()) {
            this.stallCount++;
            throw new Error(
              `Agent stalled: repeated the same tool call ${callCount} times (${call.name}). ` +
              `Stop rediscovering and change strategy or ask for input.`,
            );
          }

          const toolPreview = this.formatToolInput(
            call.name.charAt(0).toUpperCase() + call.name.slice(1),
            call.arguments,
          );
          this.logger?.log("info", "agent", `Tool: ${call.name} ${toolPreview}`, {
            agent: this.role, phase: this.phase,
            metadata: { tool: call.name, input: call.arguments },
          });

          const result = await this.executeTool(call.name, call.arguments, toolRegistry, mcpRegistry);
          if (result.trim() === "" || result.trim() === "(no output)") {
            emptyToolResults++;
            if (emptyToolResults >= this.emptyToolResultLimit()) {
              this.stallCount++;
              throw new Error(
                `Agent stalled: received ${emptyToolResults} empty tool results. ` +
                `Use a different inspection method or report the blocker.`,
              );
            }
          } else {
            emptyToolResults = 0;
          }

          const resultPreview = result.slice(0, 150).replace(/\n/g, " ");
          this.logger?.log("debug", "agent", `Result: ${resultPreview}`, {
            agent: this.role, phase: this.phase,
          });

          messages.push({ role: "tool", toolCallId: call.id, content: result });
        }
      }
    } finally {
      await mcpRegistry.close();
    }

    if (!completed) {
      this.stallCount++;
      throw new Error(`${provider.name} reached maxTurns=${maxTurns} while still using tools; treating as a stalled agent.`);
    }

    const durationMs = Date.now() - startTime;
    const savedTokens = approxTokens(this.savedChars);
    this.logger?.log("info", "agent",
      `${provider.name} completed: ${(durationMs / 1000).toFixed(1)}s, ${totalTokens.total} tokens (${totalTokens.prompt}in+${totalTokens.completion}out)` +
      (totalTokens.cacheRead > 0 ? `, ${totalTokens.cacheRead} cache-read (~0.1x)` : "") +
      (savedTokens > 0 ? `, ~${savedTokens} tokens saved by compression` : ""), {
      agent: this.role, phase: this.phase,
      metadata: { model, durationMs, usage: totalTokens, optimizedCharsSaved: this.savedChars, optimizedTokensSaved: savedTokens },
    });

    if (!fullOutput.trim()) {
      throw new Error(`${provider.name} agent produced no output`);
    }

    return fullOutput;
  }

  private repeatedToolCallLimit(): number {
    const raw = Number(process.env.SWARM_REPEATED_TOOL_LIMIT || "");
    return Number.isFinite(raw) && raw >= 2 ? Math.floor(raw) : 4;
  }

  private emptyToolResultLimit(): number {
    const raw = Number(process.env.SWARM_EMPTY_TOOL_RESULT_LIMIT || "");
    return Number.isFinite(raw) && raw >= 2 ? Math.floor(raw) : 5;
  }

  // Execute a single tool call: MCP bridge first (so project MCP servers can
  // override a name), then the provider-agnostic tool registry.
  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    toolRegistry: ToolRegistry,
    mcpRegistry?: McpToolRegistry,
  ): Promise<string> {
    try {
      const mcpResult = await mcpRegistry?.call(name, args);
      if (mcpResult !== null && mcpResult !== undefined) return mcpResult;

      const result = await toolRegistry.call(name, args);
      if (result !== null) return result;
      return `Error: Unknown tool: ${name}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Resolve a relative path to an absolute path within the workspace, preventing path traversal
  private resolveWorkspacePath(relativePath: string): string {
    const resolved = path.resolve(this.workspaceDir, relativePath);
    if (!resolved.startsWith(path.resolve(this.workspaceDir))) {
      throw new Error(`Path traversal blocked: ${relativePath}`);
    }
    return resolved;
  }

  // Fetch a URL over HTTP(S) and return readable text. Cross-platform (uses the
  // Node global fetch), so agents no longer need to shell out to curl/IWR for
  // web research. HTML is stripped to text and the body is capped so it doesn't
  // blow up the model context when it re-enters `messages` each turn.
  private async fetchWebPage(url: string, maxChars: number): Promise<FilterResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { output: `Error: invalid URL: ${url}`, originalChars: 0, filteredChars: 0 };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { output: `Error: only http and https URLs are supported (got ${parsed.protocol}).`, originalChars: 0, filteredChars: 0 };
    }
    const allowed = isWebFetchAllowed(url);
    if (!allowed.ok) {
      return { output: `Error: ${allowed.reason}`, originalChars: 0, filteredChars: 0 };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.webFetchTimeoutMs());
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          // A real UA — many sites return 403/empty to the default fetch agent.
          "User-Agent": "Mozilla/5.0 (compatible; AgentSwarmResearcher/1.0)",
          "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
      });
      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text();
      const body = /html/i.test(contentType) ? htmlToText(raw) : raw.trim();
      const originalChars = raw.length;
      const capped = body.length > maxChars
        ? body.slice(0, maxChars) + `\n… [${body.length - maxChars} chars truncated]`
        : body;
      // A non-2xx status is still returned (with its body) so the model can see
      // the error page and decide what to do, rather than getting a bare failure.
      const header = `HTTP ${res.status} ${res.statusText} · ${contentType || "unknown type"} · ${url}\n\n`;
      return { output: header + (capped || "(empty body)"), originalChars, filteredChars: capped.length };
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError"
        ? `timed out after ${this.webFetchTimeoutMs()}ms`
        : err instanceof Error ? err.message : String(err);
      return { output: `Error: fetch failed for ${url} — ${reason}`, originalChars: 0, filteredChars: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  private webFetchTimeoutMs(): number {
    const raw = Number(process.env.SWARM_WEB_FETCH_TIMEOUT_MS || "");
    return Number.isFinite(raw) && raw > 0 ? raw : 25_000;
  }

  // Execute a shell command in the workspace with a timeout
  private async execCommand(command: string): Promise<string> {
    const cached = getCachedCommandOutput(this.workspaceDir, command);
    if (cached !== null) {
      this.logger?.log("debug", "agent", `Command cache hit: ${command.slice(0, 80)}`, {
        agent: this.role,
        phase: this.phase,
      });
      return `[cached]\n${cached}`;
    }
    const sandbox = sandboxConfigFromEnv();
    const output = shouldSandboxExec(sandbox)
      ? await this.execDockerCommand(command, sandbox)
      : await this.execLocalCommand(command);
    if (!output.startsWith("Exit code") && !output.startsWith("Error:")) {
      putCachedCommandOutput(this.workspaceDir, command, output);
    }
    return output;
  }

  private async execDockerCommand(command: string, sandbox: ReturnType<typeof sandboxConfigFromEnv>): Promise<string> {
    const args = buildDockerExecArgs(this.workspaceDir, command, sandbox);
    const result = await this.spawnCommand("docker", args, false);
    if (result.infrastructureFailure) {
      this.logger?.log("warn", "agent",
        `Docker sandbox unavailable; falling back to direct execution. ${result.stderr.slice(0, 300)}`, {
        agent: this.role,
        phase: this.phase,
      });
      return this.execLocalCommand(command);
    }
    if (result.output.startsWith("Error: Command timed out")) this.commandTimeouts++;
    return result.output;
  }

  private execLocalCommand(command: string): Promise<string> {
    return this.spawnCommand(command, [], true).then((result) => {
      if (result.output.startsWith("Error: Command timed out")) this.commandTimeouts++;
      return result.output;
    });
  }

  private spawnCommand(command: string, args: string[], shell: boolean): Promise<{ output: string; stderr: string; infrastructureFailure: boolean }> {
    return new Promise((resolve) => {
      // Hand LLM-driven commands a credential-scrubbed environment: the model
      // must never be able to read the swarm's API keys / GitHub PAT / deploy
      // secrets via `env` and (with web_fetch) exfiltrate them. System vars and
      // project runtime config are preserved so builds/tests still work.
      const proc = spawn(command, args, {
        cwd: this.workspaceDir,
        shell,
        env: scrubSecretsFromEnv(process.env),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const maxOutput = 50_000;
      let settled = false;

      proc.stdout.on("data", (data: Buffer) => {
        if (stdout.length < maxOutput) stdout += data.toString();
      });
      proc.stderr.on("data", (data: Buffer) => {
        if (stderr.length < maxOutput) stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        this.killProcessTree(proc);
        settled = true;
        resolve({
          output: `Error: Command timed out after 120s.\nstdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 2000)}`,
          stderr,
          infrastructureFailure: command === "docker",
        });
      }, 120_000);

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const output = stdout + (stderr ? `\nstderr: ${stderr}` : "");
        const infrastructureFailure = command === "docker" && isDockerInfrastructureFailure(code, stderr);
        if (code !== 0) {
          resolve({ output: `Exit code ${code}\n${output.slice(0, 10000)}`, stderr, infrastructureFailure });
        } else {
          resolve({ output: output.slice(0, 10000) || "(no output)", stderr, infrastructureFailure: false });
        }
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          output: `Error spawning command: ${err.message}`,
          stderr: err.message,
          infrastructureFailure: command === "docker",
        });
      });
    });
  }

  private killProcessTree(proc: ChildProcess): void {
    if (!proc.pid) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" }).on("error", () => {
        proc.kill("SIGKILL");
      });
      return;
    }
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 5_000).unref();
  }

  // OpenAI Codex CLI provider (codex --full-auto)
  private async runCodex(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const promptFile = this.agentScratchPath(`prompt-${this.role}.txt`);
      fs.writeFileSync(promptFile, prompt, "utf-8");

      const proc = spawn("codex", [
        "--full-auto",
        "--model", this.modelConfig.model,
        prompt,
      ], {
        cwd: this.workspaceDir,
        shell: true,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.trim()) logAgent(this.role, dim(line.trim().slice(0, 150)), this.phase);
        }
      });

      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        try { fs.unlinkSync(promptFile); } catch { /* ignore */ }
        if (code === 0) resolve(stdout);
        else reject(new Error(`Codex exited with code ${code}: ${stderr}`));
      });

      proc.on("error", (err) => reject(new Error(`Failed to spawn codex: ${err.message}`)));
    });
  }

  private agentScratchPath(fileName: string): string {
    const dir = path.join(this.workspaceDir, ".swarm", "agents");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, fileName);
  }

  // Custom provider — extend this for other CLI agents
  private async runCustomProvider(prompt: string): Promise<string> {
    // Fallback: write prompt to file, expect a CLI tool that reads it
    throw new Error(
      `Custom provider not yet configured for model "${this.modelConfig.model}". ` +
      `Add your provider logic in agent.ts runCustomProvider().`
    );
  }

  // Single-turn reasoning call (no tool loop, no artifact scaffolding). Used by
  // the tech-lead to review work and answer teammates' questions.
  async oneShot(userPrompt: string, maxTokens = 4096): Promise<string> {
    if (this.modelConfig.provider === "deepseek") {
      // DeepSeek is the catch-all; just retry it on transient errors.
      return this.attemptOnProvider("deepseek one-shot", () => this.deepseekOneShot(userPrompt, maxTokens));
    }
    if (this.modelConfig.provider === "anthropic") {
      try {
        return await this.attemptOnProvider("anthropic one-shot", () => this.anthropicOneShot(userPrompt, maxTokens));
      } catch (err) {
        if (this.isFatalError(err)) throw err; // request-inherent — DeepSeek won't help.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger?.log("warn", "agent",
          `anthropic one-shot exhausted; falling back to DeepSeek. Reason: ${reason.slice(0, 300)}`, {
          agent: this.role, phase: this.phase,
          metadata: { failedProvider: "anthropic", fallbackProvider: "deepseek", reason },
        });
        return this.attemptOnProvider("deepseek one-shot",
          () => this.deepseekOneShot(userPrompt, maxTokens, this.deepSeekFallbackModel()));
      }
    }
    return this.claudeOneShot(userPrompt, maxTokens); // claude/codex/custom → reasoning via SDK, falls back to DeepSeek
  }

  private async anthropicOneShot(userPrompt: string, maxTokens: number): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for the 'anthropic' provider.");
    const provider = new AnthropicProvider({
      name: "anthropic", model: this.modelConfig.model, apiKey,
      timeout: this.anthropicTimeoutMs(), maxTokens,
    });
    const resp = await provider.chat({
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [],
      maxTokens,
    });
    return resp.text;
  }

  private async deepseekOneShot(userPrompt: string, maxTokens: number, modelOverride?: string): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY required for deepseek provider.");
    const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    const client = new OpenAI({ apiKey, baseURL, timeout: this.deepSeekTimeoutMs() });
    const res = await client.chat.completions.create({
      model: modelOverride || this.modelConfig.model,
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    });
    return res.choices[0]?.message?.content || "";
  }

  private deepSeekFallbackModel(): string {
    return process.env.DEEPSEEK_FALLBACK_MODEL
      || process.env.DEEPSEEK_MODEL
      || "deepseek-coder";
  }

  private deepSeekTimeoutMs(): number {
    const raw = Number(process.env.DEEPSEEK_TIMEOUT_MS || "");
    return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
  }

  private anthropicTimeoutMs(): number {
    const raw = Number(process.env.SWARM_ANTHROPIC_TIMEOUT_MS || "");
    // Agentic turns can be long; default generous (10 min).
    return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
  }

  private openRouterTimeoutMs(): number {
    const raw = Number(process.env.OPENROUTER_TIMEOUT_MS || "");
    // Agentic turns can be long; default generous (10 min).
    return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
  }

  // ── Provider resilience: retry-then-fall-back ──
  //
  // Attempts on a single provider before we give up on it and fall back to
  // DeepSeek. Tunable via SWARM_PROVIDER_ATTEMPTS (default 3).
  private providerAttempts(): number {
    const raw = Number(process.env.SWARM_PROVIDER_ATTEMPTS || "");
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
  }

  private backoffMs(attempt: number): number {
    return Math.min(2000 * Math.pow(2, attempt - 1), 30_000); // 2s, 4s, 8s … cap 30s
  }

  // Error classification (transient / quota-auth / fatal) lives in a pure,
  // unit-tested module; these thin wrappers keep the call sites readable.
  private isTransientError(err: unknown): boolean { return isTransientError(err); }
  private isQuotaOrAuthError(err: unknown): boolean { return isQuotaOrAuthError(err); }
  private isFatalError(err: unknown): boolean { return isFatalError(err); }

  // Run one provider call, retrying transient failures with exponential backoff.
  // Hard failures (quota/auth) throw immediately so the caller can fall back
  // without burning the backoff budget.
  private async attemptOnProvider(label: string, fn: () => Promise<string>): Promise<string> {
    const attempts = this.providerAttempts();
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const retryable = !this.isFatalError(err) && this.isTransientError(err) && !this.isQuotaOrAuthError(err);
        if (!retryable || attempt === attempts) throw err;
        const delay = this.backoffMs(attempt);
        const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        this.logger?.log("warn", "agent",
          `${label} attempt ${attempt}/${attempts} hit a transient error; retrying in ${Math.round(delay / 1000)}s. ${reason}`, {
          agent: this.role, phase: this.phase,
        });
        logAgent(this.role, `${label} transient error; retry ${attempt}/${attempts} in ${Math.round(delay / 1000)}s`, this.phase);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  private async claudeOneShot(userPrompt: string, maxTokens = 4096): Promise<string> {
    const runOnce = async (): Promise<string> => {
      let out = "";
      const mcpServers = this.loadMcpServersForClaude();
      const session = query({
        prompt: userPrompt,
        options: {
          systemPrompt: this.systemPrompt,
          model: this.modelConfig.model,
          cwd: this.workspaceDir,
          permissionMode: "bypassPermissions",
          maxTurns: 1,
          hooks: this.sensitiveReadGuardHooks(),
          ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
        },
      });
      for await (const message of session) {
        const msg = message as Record<string, unknown>;
        if (msg.type === "assistant") {
          const content = (msg.message as Record<string, unknown>)?.content;
          if (Array.isArray(content)) {
            for (const b of content as Array<Record<string, unknown>>) {
              if (b.type === "text" && b.text) out += b.text as string;
            }
          }
        }
      }
      return out;
    };

    try {
      // Retry the primary on transient errors before falling back.
      return await this.attemptOnProvider(`${this.modelConfig.provider} one-shot`, runOnce);
    } catch (err) {
      if (this.isFatalError(err)) throw err; // request-inherent — DeepSeek won't help.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger?.log("warn", "agent",
        `${this.modelConfig.provider} one-shot exhausted; falling back to DeepSeek. Reason: ${reason.slice(0, 300)}`, {
        agent: this.role,
        phase: this.phase,
        metadata: {
          failedProvider: this.modelConfig.provider,
          failedModel: this.modelConfig.model,
          fallbackProvider: "deepseek",
          reason,
        },
      });
      // DeepSeek fallback also gets a retry budget.
      return this.attemptOnProvider("deepseek one-shot",
        () => this.deepseekOneShot(userPrompt, maxTokens, this.deepSeekFallbackModel()));
    }
  }

  private parseDoubts(doubtsFile: string): Doubt[] {
    if (!fs.existsSync(doubtsFile)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(doubtsFile, "utf-8"));
      return (raw as Array<{ question: string; context: string }>).map((d) => ({
        agent: this.role,
        phase: this.phase,
        question: d.question,
        context: d.context,
        timestamp: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  private extractSummary(output: string): string {
    const lines = output.trim().split("\n").filter((l) => l.trim());
    return lines.slice(-5).join("\n");
  }

  private findCreatedArtifacts(beforeFiles: Map<string, string>): string[] {
    const artifacts = new Set<string>(this.writtenArtifacts);
    const afterFiles = this.snapshotWorkspaceFiles();
    for (const [relative, signature] of afterFiles) {
      if (beforeFiles.get(relative) !== signature) this.trackArtifactPath(relative, artifacts);
    }
    return Array.from(artifacts).sort();
  }

  private snapshotWorkspaceFiles(): Map<string, string> {
    const files = new Map<string, string>();
    const scan = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || shouldSkipArtifactEntry(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const relative = path.relative(this.workspaceDir, fullPath).replace(/\\/g, "/");
        if (!this.isReportableArtifact(relative)) continue;
        const stat = fs.statSync(fullPath);
        files.set(relative, `${stat.size}:${Math.round(stat.mtimeMs)}`);
      }
    };
    scan(this.workspaceDir);
    return files;
  }

  private trackWrittenArtifact(relativePath: string) {
    this.trackArtifactPath(relativePath, this.writtenArtifacts);
  }

  private trackArtifactPath(relativePath: string, target: Set<string>) {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (this.isReportableArtifact(normalized)) target.add(normalized);
  }

  private isReportableArtifact(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!normalized || normalized.startsWith(".") || normalized.split("/").some((part) => part.startsWith("."))) return false;
    if (!isArtifactPathAllowed(normalized)) return false;
    return true;
  }

  private normalizeLocalCommand(command: string): string {
    if (process.platform !== "win32") return command;
    const trimmed = command.trim();
    const quotePs = (value: string) => `'${value.replace(/'/g, "''")}'`;

    const mkdir = trimmed.match(/^mkdir\s+-p\s+(.+)$/i);
    if (mkdir) {
      return `powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path ${quotePs(mkdir[1].trim())} | Out-Null"`;
    }

    const ls = trimmed.match(/^ls(?:\s+-la|\s+-al|\s+-l)?\s+(.+)$/i);
    if (ls && !/[|&;]/.test(ls[1])) {
      return `powershell -NoProfile -Command "Get-ChildItem -Force -LiteralPath ${quotePs(ls[1].trim())}"`;
    }

    const cat = trimmed.match(/^cat\s+(.+)$/i);
    if (cat && !/[|&;]/.test(cat[1])) {
      return `powershell -NoProfile -Command "Get-Content -Raw -LiteralPath ${quotePs(cat[1].trim())}"`;
    }

    const which = trimmed.match(/^which\s+([A-Za-z0-9_.-]+)(?:\s+2>\/dev\/null)?$/i);
    if (which) {
      return `powershell -NoProfile -Command "$cmd = Get-Command ${quotePs(which[1])} -ErrorAction SilentlyContinue; if ($cmd) { $cmd.Source }"`;
    }

    return command;
  }
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}
