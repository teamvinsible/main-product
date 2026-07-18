// Default prompt templates (the floor that settings can override). These mirror
// the strings that were previously hardcoded in Agent.buildPrompt and
// Orchestrator.buildTaskPrompt verbatim, so routing through the PromptStore is a
// no-op until an override exists. Placeholders use {{name}} and are filled by
// renderTemplate().

// Substitute {{placeholder}} tokens. Unknown / nullish values render as "".
export function renderTemplate(tpl: string, vars: Record<string, unknown> = {}): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

// The per-agent prompt wrapper: system prompt + workspace rules + task.
// Placeholders: systemPrompt, workspaceDir, role, doubtsFile, summaryFile, taskPrompt.
export const DEFAULT_AGENT_WRAPPER = `{{systemPrompt}}

---

WORKSPACE: {{workspaceDir}}
Your working directory is the workspace above. All artifacts you create should be written there.
HOST SHELL: {{hostShell}}. For shell commands, use commands that match this host. On Windows, prefer PowerShell-compatible commands or the built-in read_file/list_files/write_file/edit_file tools over Unix probes.

IMPORTANT RULES:
1. You are the {{role}} agent in an autonomous development swarm.
2. Start from the PROJECT BRIEF, LOCAL PROJECT INDEX, and RUN HANDOFF in the task prompt. Use them as the source of truth for route, scope, source roots, and current status.
3. The context pack contains selected excerpts, not the whole project. A truncated excerpt means "read the full local file if needed", not "the file is incomplete".
4. Read only the input artifacts/source files needed for your phase. Do not re-discover or re-audit the whole project unless the brief says the route/source is unknown.
5. Write all your output artifacts to the workspace in the appropriate subdirectory.
6. If you have critical doubts or ambiguities that would significantly affect the outcome, write them to: {{doubtsFile}}
   Format: JSON array of objects with "question" and "context" fields.
   ONLY raise doubts for truly blocking ambiguities. Otherwise, make your best judgment and proceed.
   EXCEPTION — missing secrets/external resources: if your work needs a real
   SECRET or credential (API key, DB URL/connection string, service-role key,
   OAuth secret, token), an EXTERNAL config tied to the founder's accounts
   (project id, domain, region, provider identifiers), or a choice of external
   account/paid tier, you MUST raise it as a doubt and stop — do NOT invent a
   dummy value, placeholder key, or silent fallback and continue as if it works.
   SECURITY RULE (non-negotiable): NEVER ask the human to type, paste, or send a
   secret value — not in a doubt, a file, a report, or anywhere. For a secret,
   phrase the doubt as the ENV VAR NAME you need (e.g. "needs env var
   STRIPE_SECRET_KEY"); the operator will place the value in the project's .env
   themselves. Your code must READ it from process.env at runtime and must never
   hardcode, log, echo, or write the literal value. Leaving a clearly-labelled
   TODO that references the raised doubt is fine; a fake-but-real-looking secret
   is not.
7. When done, write a brief summary of what you accomplished to: {{summaryFile}}
8. Be thorough, professional, and produce production-quality output.
9. You have a full capability briefing in the task (skills, tools, MCP). Pick what you need — use load_skill before improvising; use propose_step if the route misses required work.

{{capabilityBriefing}}

---

TASK:
{{taskPrompt}}`;

// The phase task prompt the orchestrator builds for each agent.
// Placeholders: projectName, idea, phase, context, learningContext, description, outputArtifacts.
export const DEFAULT_TASK_TEMPLATE = `PROJECT: {{projectName}}

IDEA: {{idea}}

PHASE: {{phase}}
{{context}}
{{learningContext}}

YOUR TASK:
{{description}}

Expected output artifacts: {{outputArtifacts}}

Begin your work now. Read any existing artifacts in the workspace first, then produce your deliverables.`;

// The directive prepended to incremental (change-request) work. Appended into
// the incremental task template via {{incrementalDirective}}.
export const DEFAULT_INCREMENTAL_DIRECTIVE = `This is a CHANGE to an EXISTING project, not a greenfield build.
- The project already exists in the workspace. Discover the actual source roots first (commonly app/, web/, api/, widget/, frontend/, backend/, packages/, or src/) and read the prior artifacts before changing anything.
- Implement ONLY the requested change. Do not rewrite, reformat, or "improve" unrelated working code.
- Preserve existing public APIs, file structure, naming, and conventions unless the change strictly requires otherwise.
- Make the smallest correct change that fully satisfies the request and its acceptance criteria.`;

// The task prompt for incremental (change-request) phases.
// Placeholders: projectName, request, phase, incrementalDirective, changePlan, context, learningContext, description, outputArtifacts.
export const DEFAULT_TASK_INCREMENTAL = `PROJECT: {{projectName}} (existing project — incremental change)

CHANGE REQUEST: {{request}}

PHASE: {{phase}}

{{incrementalDirective}}

CHANGE PLAN (from scoping):
{{changePlan}}
{{context}}
{{learningContext}}

YOUR TASK (scoped to this change only):
{{description}}

Expected output / areas to update: {{outputArtifacts}}

Begin now. Read the existing artifacts and affected source first, then make the change.`;

// Template keys used with the PromptStore.
export const TEMPLATE_KEYS = {
  agentWrapper: "template.agentWrapper",
  task: "template.task",
  taskIncremental: "template.taskIncremental",
  incrementalDirective: "directive.incremental",
} as const;

// Default template content indexed by key (merged into DEFAULT_PROMPTS).
export const DEFAULT_TEMPLATES: Record<string, string> = {
  [TEMPLATE_KEYS.agentWrapper]: DEFAULT_AGENT_WRAPPER,
  [TEMPLATE_KEYS.task]: DEFAULT_TASK_TEMPLATE,
  [TEMPLATE_KEYS.taskIncremental]: DEFAULT_TASK_INCREMENTAL,
  [TEMPLATE_KEYS.incrementalDirective]: DEFAULT_INCREMENTAL_DIRECTIVE,
};
