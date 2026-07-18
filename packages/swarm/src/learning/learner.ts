import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { directoryHasFiles, resolvePrimaryCodeRoot } from "../utils/workspace-layout.js";
import { KnowledgeBaseStore } from "./knowledge-base.js";
import { getAgentRuns } from "../db/store.js";
import { logLearning, logSystem, logError } from "../utils/logger.js";
import { ARTIFACT_BASE } from "../utils/artifacts.js";
import type { SwarmState, Learning, ProjectSummary, AgentRunLog, AgentRole } from "../types.js";

// The machine-readable QA gate report the qa-engineer emits (_artifacts/qa/qa-report.json).
interface QaReport {
  appBooted?: boolean;
  browserAvailable?: boolean;
  criteria?: Array<{ id: string; status: "pass" | "fail" | "blocked"; evidence?: string }>;
  bugs?: Array<{ severity: "P0" | "P1" | "P2" | "P3"; summary: string; file?: string }>;
  summary?: string;
}

// A concrete miss detected by the retrospective, optionally carrying a directive
// routed back to a specific agent role for the next run.
interface RetroMiss {
  area: string;
  detail: string;
  role?: AgentRole;
  directive?: string;
}

export class Learner {
  private kb: KnowledgeBaseStore;
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    this.kb = new KnowledgeBaseStore();
    this.workspaceDir = workspaceDir;
  }

  /** Load the knowledge base from Postgres before use. */
  async init(): Promise<void> {
    await this.kb.init();
  }

  getKnowledgeBase(): KnowledgeBaseStore {
    return this.kb;
  }

  async extractLearnings(state: SwarmState): Promise<void> {
    logSystem("Auto-learning: Extracting insights from this project...");

    // 1. Record project summary
    const summary: ProjectSummary = {
      projectName: state.projectName,
      idea: state.idea,
      techStack: this.extractTechStack(),
      completedAt: new Date().toISOString(),
      success: state.status === "completed" || state.status === "completed_with_issues",
      totalDurationMs: state.metrics.totalDurationMs,
      phases: state.completedPhases.length,
      artifacts: state.artifacts.length,
      doubts: state.doubts.length,
      errors: state.metrics.totalErrors,
      learningsExtracted: 0,
    };

    // 2. Load this project's agent runs from the database
    let agentRuns: AgentRunLog[] = [];
    try {
      agentRuns = await getAgentRuns(state.projectName);
    } catch { /* empty */ }

    // 3. Use Claude to analyze and extract learnings
    const learnings = await this.analyzeWithClaude(state, agentRuns);
    let count = 0;
    for (const learning of learnings) {
      this.kb.addLearning(learning);
      logLearning(`[${learning.category}] ${learning.insight}`);
      count++;
    }

    // 4. Extract pattern-based learnings (no LLM needed)
    const patternLearnings = this.extractPatternLearnings(state, agentRuns);
    for (const learning of patternLearnings) {
      this.kb.addLearning(learning);
      logLearning(`[${learning.category}] ${learning.insight}`);
      count++;
    }

    // 5. Retrospective: identify concrete misses from this run and turn them into
    //    role-targeted improvement directives that get injected into the right
    //    agent's prompt next run.
    count += this.retrospect(state, agentRuns);

    summary.learningsExtracted = count;
    this.kb.addProjectSummary(summary);
    await this.kb.flush();

    logSystem(`Auto-learning complete: ${count} insights extracted`);
    logSystem(`Knowledge base now has ${this.kb.getStats().totalLearnings} total learnings across ${this.kb.getStats().totalProjects} projects`);
  }

  private async analyzeWithClaude(state: SwarmState, agentRuns: AgentRunLog[]): Promise<Learning[]> {
    // Build a digest of the project for Claude to analyze
    const digest = this.buildProjectDigest(state, agentRuns);

    const prompt = `You are analyzing a completed software project to extract reusable learnings for future projects.

PROJECT DIGEST:
${digest}

EXISTING KNOWLEDGE BASE:
${JSON.stringify(this.kb.getStats(), null, 2)}

Extract 5-15 specific, actionable learnings from this project. For each learning, output a JSON object.

Categories: tech-stack, architecture, design-pattern, bug-pattern, user-preference, process, performance, best-practice, anti-pattern

Output ONLY a JSON array of objects with these fields:
- category: one of the categories above
- insight: a specific, actionable insight (1-2 sentences)
- context: why this matters or when to apply it
- confidence: 0.0-1.0 (how confident you are this is a genuine pattern vs project-specific)
- source: which agent role primarily produced this insight

Example:
[
  {
    "category": "tech-stack",
    "insight": "Next.js App Router with server components is ideal for content-heavy apps with SEO needs",
    "context": "Chose Next.js for SSR/SEO benefits, worked well for the product landing pages",
    "confidence": 0.7,
    "source": "principal-engineer"
  }
]

Output ONLY the JSON array, nothing else.`;

    try {
      const output = await this.runClaudeAnalysis(prompt);
      const parsed = JSON.parse(this.extractJson(output));

      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: Record<string, unknown>) => ({
        id: crypto.randomUUID(),
        projectName: state.projectName,
        timestamp: new Date().toISOString(),
        category: String(item.category || "best-practice"),
        insight: String(item.insight || ""),
        context: String(item.context || ""),
        confidence: Number(item.confidence) || 0.5,
        appliedCount: 0,
        source: String(item.source || "orchestrator") as AgentRole,
      })) as Learning[];
    } catch (err) {
      logError(`Learning extraction via Claude failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  private extractPatternLearnings(state: SwarmState, agentRuns: AgentRunLog[]): Learning[] {
    const learnings: Learning[] = [];

    // Pattern: Agent retries indicate fragile prompts
    for (const [role, retries] of Object.entries(state.metrics.agentRetries)) {
      if (retries > 0) {
        learnings.push({
          id: crypto.randomUUID(),
          projectName: state.projectName,
          timestamp: new Date().toISOString(),
          category: "process",
          insight: `Agent "${role}" required ${retries} retry(ies) - may need clearer prompt or better context`,
          context: `During ${state.projectName}, the ${role} agent failed and had to retry`,
          confidence: 0.6,
          appliedCount: 0,
          source: role as AgentRole,
        });
      }
    }

    // Pattern: Very long agent runs indicate complex phases
    for (const run of agentRuns) {
      if (run.durationMs > 300000) { // > 5 minutes
        learnings.push({
          id: crypto.randomUUID(),
          projectName: state.projectName,
          timestamp: new Date().toISOString(),
          category: "process",
          insight: `${run.role} in ${run.phase} phase took ${(run.durationMs / 60000).toFixed(1)}min - consider breaking into sub-tasks`,
          context: "Long-running agents may benefit from task decomposition",
          confidence: 0.5,
          appliedCount: 0,
          source: run.role,
        });
      }
    }

    // Pattern: Doubts indicate areas needing better specification
    if (state.doubts.length > 0) {
      const doubtsByAgent = state.doubts.reduce<Record<string, number>>((acc, d) => {
        acc[d.agent] = (acc[d.agent] || 0) + 1;
        return acc;
      }, {});

      for (const [agent, count] of Object.entries(doubtsByAgent)) {
        if (count >= 2) {
          learnings.push({
            id: crypto.randomUUID(),
            projectName: state.projectName,
            timestamp: new Date().toISOString(),
            category: "process",
            insight: `${agent} raised ${count} doubts - previous phases may need to provide more specific guidance for this role`,
            context: `Doubts: ${state.doubts.filter(d => d.agent === agent).map(d => d.question).join("; ")}`,
            confidence: 0.7,
            appliedCount: 0,
            source: agent as AgentRole,
          });
        }
      }
    }

    return learnings;
  }

  // ── Retrospective: identify misses → role-targeted improvement directives ──

  private retrospect(state: SwarmState, agentRuns: AgentRunLog[]): number {
    const report = this.readQaReport();
    const misses = this.computeMisses(state, agentRuns, report);
    const wins = this.computeWins(state, agentRuns, report);

    this.writeRetroArtifacts(state, misses, wins);

    // Persist each directive as a process-improvement learning. `source` carries
    // the TARGET role so getLearningsContext can route it back to that agent.
    let count = 0;
    const seen = new Set<string>();
    for (const m of misses) {
      if (!m.role || !m.directive) continue;
      const key = `${m.role}|${m.directive}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.kb.addLearning({
        id: crypto.randomUUID(),
        projectName: state.projectName,
        timestamp: new Date().toISOString(),
        category: "process-improvement",
        insight: m.directive,
        context: m.detail,
        confidence: 0.8,
        appliedCount: 0,
        source: m.role,
      });
      logLearning(`[retro → ${m.role}] ${m.directive}`);
      count++;
    }
    logSystem(`Retrospective: ${misses.length} miss(es), ${wins.length} win(s), ${count} improvement directive(s) recorded`);
    return count;
  }

  private computeMisses(state: SwarmState, agentRuns: AgentRunLog[], report: QaReport | null): RetroMiss[] {
    const misses: RetroMiss[] = [];
    const devRoles: AgentRole[] = ["frontend-dev", "backend-dev"];
    const ranQa = state.completedPhases.includes("qa");

    // QA produced no machine-readable evidence, yet the phase ran.
    if (ranQa && !report) {
      misses.push({
        area: "qa-evidence",
        detail: "The qa phase ran but _artifacts/qa/qa-report.json was missing — the lead had no real evidence to gate on.",
        role: "qa-engineer",
        directive: "Always emit _artifacts/qa/qa-report.json with real per-acceptance-criterion pass/fail/blocked results — never a prose-only test plan.",
      });
    }

    if (report) {
      // The app never booted in QA.
      if (report.appBooted === false) {
        for (const role of devRoles) {
          misses.push({
            area: "app-boot",
            detail: `QA could not boot the app (${report.summary || "see qa-report"}).`,
            role,
            directive: "Leave the app actually runnable and keep app/PROJECT-MANIFEST.md accurate (install, start command, port, env, health URL); verify a clean boot before handoff.",
          });
        }
      }

      // Acceptance criteria that did not pass.
      const failed = (report.criteria || []).filter((c) => c.status && c.status !== "pass");
      if (failed.length) {
        const ids = failed.map((c) => c.id).filter(Boolean).slice(0, 8).join(", ");
        for (const role of devRoles) {
          misses.push({
            area: "acceptance-criteria",
            detail: `QA found ${failed.length} acceptance criterion(s) failing/blocked${ids ? ` (${ids})` : ""}.`,
            role,
            directive: "Verify EVERY acceptance criterion (AC-*) actually works end-to-end before handing off to QA — do not ship criteria you have not exercised yourself.",
          });
        }
      }

      // Serious bugs that slipped through to QA.
      const serious = (report.bugs || []).filter((b) => b.severity === "P0" || b.severity === "P1");
      if (serious.length) {
        const summary = serious.map((b) => b.summary).filter(Boolean).slice(0, 5).join("; ");
        for (const role of devRoles) {
          misses.push({
            area: "bugs",
            detail: `QA caught ${serious.length} P0/P1 bug(s)${summary ? `: ${summary}` : ""}.`,
            role,
            directive: "Self-test critical happy-path and error-path flows before handoff so P0/P1 bugs are not first discovered in QA.",
          });
        }
      }
    }

    // The dev→QA runbook was never written, so QA had to guess.
    const appDir = resolvePrimaryCodeRoot(this.workspaceDir);
    const manifest = path.join(appDir, "PROJECT-MANIFEST.md");
    const rel = path.relative(this.workspaceDir, appDir).replace(/\\/g, "/") || ".";
    const manifestLabel = rel === "." ? "./" : `${rel}/`;
    if (directoryHasFiles(appDir) && !fs.existsSync(manifest)) {
      for (const role of devRoles) {
        misses.push({
          area: "manifest",
          detail: `${manifestLabel}PROJECT-MANIFEST.md was missing; QA had no documented way to install, run, or test the app.`,
          role,
          directive: `Always write ${manifestLabel}PROJECT-MANIFEST.md (install/start/port/env/health/test) so QA can boot the app without guessing.`,
        });
      }
    }

    // Agents that failed outright this run.
    for (const run of agentRuns) {
      if (!run.success && run.error) {
        misses.push({
          area: "agent-failure",
          detail: `${run.role} failed during ${run.phase}: ${run.error.slice(0, 200)}`,
          role: run.role,
          directive: `Your previous run failed in the ${run.phase} phase — work more defensively and verify your output before finishing.`,
        });
      }
    }

    return misses;
  }

  private computeWins(state: SwarmState, agentRuns: AgentRunLog[], report: QaReport | null): string[] {
    const wins: string[] = [];
    if (report?.appBooted) wins.push("App booted successfully under QA.");
    if (report && (report.criteria || []).length && (report.criteria || []).every((c) => c.status === "pass")) {
      wins.push(`All ${report.criteria!.length} acceptance criteria passed QA.`);
    }
    if (state.status === "completed") wins.push("Run completed all planned phases.");
    if (state.status === "completed_with_issues") wins.push("Run shipped with known non-blocking issues (see KNOWN-ISSUES.md).");
    if (state.metrics.totalErrors === 0) wins.push("No agent errors during the run.");
    return wins;
  }

  private writeRetroArtifacts(state: SwarmState, misses: RetroMiss[], wins: string[]): void {
    try {
      const retroDir = path.join(this.workspaceDir, ARTIFACT_BASE, "retro");
      if (!fs.existsSync(retroDir)) fs.mkdirSync(retroDir, { recursive: true });

      const md: string[] = [
        `# Retrospective — ${state.projectName}`,
        "",
        `_${new Date().toISOString()} · status: ${state.status}_`,
        "",
        "## What went well",
        ...(wins.length ? wins.map((w) => `- ${w}`) : ["- (nothing notable recorded)"]),
        "",
        "## Misses & root causes",
      ];
      if (misses.length) {
        for (const m of misses) {
          md.push(`- **[${m.area}]** ${m.detail}`);
          if (m.role && m.directive) md.push(`  - → directive for \`${m.role}\`: ${m.directive}`);
        }
      } else {
        md.push("- No misses detected this run. 🎉");
      }
      md.push("");

      fs.writeFileSync(path.join(retroDir, "retrospective.md"), md.join("\n"), "utf-8");
      fs.writeFileSync(
        path.join(retroDir, "retro.json"),
        JSON.stringify({ projectName: state.projectName, generatedAt: new Date().toISOString(), status: state.status, wins, misses }, null, 2),
        "utf-8",
      );
    } catch (err) {
      logError(`Failed to write retrospective artifacts: ${err instanceof Error ? err.message : err}`);
    }
  }

  private readQaReport(): QaReport | null {
    const file = path.join(this.workspaceDir, ARTIFACT_BASE, "qa", "qa-report.json");
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as QaReport;
    } catch {
      return null;
    }
  }

  private buildProjectDigest(state: SwarmState, agentRuns: AgentRunLog[]): string {
    const sections: string[] = [];

    sections.push(`Project: ${state.projectName}`);
    sections.push(`Idea: ${state.idea}`);
    sections.push(`Status: ${state.status}`);
    sections.push(`Phases completed: ${state.completedPhases.join(", ")}`);
    sections.push(`Total duration: ${(state.metrics.totalDurationMs / 60000).toFixed(1)} minutes`);
    sections.push(`Artifacts: ${state.artifacts.length}`);
    sections.push(`Errors: ${state.metrics.totalErrors}`);

    // Agent summaries
    sections.push("\nAGENT SUMMARIES:");
    for (const run of agentRuns) {
      sections.push(`\n--- ${run.role} (${run.phase}) ---`);
      sections.push(`Duration: ${(run.durationMs / 1000).toFixed(1)}s`);
      sections.push(`Success: ${run.success}`);
      if (run.summary) sections.push(`Summary: ${run.summary.slice(0, 500)}`);
      if (run.error) sections.push(`Error: ${run.error.slice(0, 300)}`);
      sections.push(`Artifacts: ${run.artifactsCreated.join(", ")}`);
    }

    // Doubts
    if (state.doubts.length > 0) {
      sections.push("\nDOUBTS RAISED:");
      for (const d of state.doubts) {
        sections.push(`- [${d.agent}] ${d.question} -> Resolution: ${d.resolution || "auto"}`);
      }
    }

    // Read key artifacts for context
    const keyFiles = [`${ARTIFACT_BASE}/architecture/tech-stack.md`, `${ARTIFACT_BASE}/product/prd.md`];
    for (const file of keyFiles) {
      const fullPath = path.join(this.workspaceDir, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8").slice(0, 2000);
        sections.push(`\n--- ${file} (excerpt) ---\n${content}`);
      }
    }

    return sections.join("\n");
  }

  private async runClaudeAnalysis(prompt: string): Promise<string> {
    let output = "";

    const session = query({
      prompt,
      options: {
        cwd: this.workspaceDir,
        maxTurns: 3,
        permissionMode: "bypassPermissions",
      },
    });

    for await (const message of session) {
      if (message.type === "assistant") {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              output += block.text;
            }
          }
        }
      }
    }

    return output;
  }

  private extractJson(text: string): string {
    // Find JSON array in the output
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return match[0];
    return "[]";
  }

  private extractTechStack(): string[] {
    const techStackFile = path.join(this.workspaceDir, ARTIFACT_BASE, "architecture", "tech-stack.md");
    if (!fs.existsSync(techStackFile)) return [];
    const content = fs.readFileSync(techStackFile, "utf-8");
    // Extract tech names from markdown (rough heuristic)
    const techs: string[] = [];
    const patterns = [
      /(?:Next\.js|React|Vue|Angular|Svelte|Remix)/gi,
      /(?:Node\.js|Express|Fastify|Hono|Bun|Deno)/gi,
      /(?:PostgreSQL|MySQL|MongoDB|SQLite|Supabase|Firebase|Redis)/gi,
      /(?:Tailwind|CSS Modules|Styled Components|Chakra|Shadcn)/gi,
      /(?:TypeScript|JavaScript|Python|Go|Rust)/gi,
      /(?:Docker|Kubernetes|Vercel|Netlify|AWS|GCP|Railway)/gi,
    ];
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) techs.push(...matches.map(m => m.trim()));
    }
    return [...new Set(techs)];
  }
}
