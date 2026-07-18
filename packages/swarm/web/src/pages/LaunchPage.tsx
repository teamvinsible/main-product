import { useEffect, useRef, useState } from "react";
import { api, parseEnvLines, presetToProviders } from "../api";
import { usePoll } from "../hooks";
import { useConfig } from "../config";
import { Field, useToast } from "../ui";
import type { ProjectEntry, RunningRun } from "../types";
import { GitBranch, Paperclip, SendHorizontal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PRESET_HINTS: Record<string, string> = {
  hybrid: "Planning agents use Claude (Opus/Sonnet); coding agents (frontend, backend, QA, devops) use DeepSeek. Requires a DeepSeek key.",
  deepseek: "Every agent uses DeepSeek. Lowest cost. Requires a DeepSeek key.",
  claude: "Every agent uses Claude via the Agent SDK (your Claude Code login / subscription).",
  anthropic: "Every agent uses Claude via the raw Anthropic API (pay-as-you-go). Requires an ANTHROPIC_API_KEY; enables web_fetch and the shared tool set for Claude.",
  openrouter: "Every agent goes through OpenRouter (one key fronts many models). Defaults to Claude Opus for planning and DeepSeek for coding; override slugs with high/low model. Requires an OPENROUTER_API_KEY.",
};
const PRESET_LABEL: Record<string, string> = {
  hybrid: "Claude plans · DeepSeek codes",
  deepseek: "All DeepSeek (cheapest)",
  claude: "All Claude (SDK · subscription)",
  anthropic: "All Claude (API · pay-as-you-go)",
  openrouter: "All OpenRouter (one gateway)",
};

type ChatMsg = { id: number; role: "assistant" | "user"; text: string };

type Draft =
  | { mode: "new"; idea: string; name: string; type: string; preset: string; repo: string; repoProfile: string; env: string }
  | { mode: "change"; project: string; request: string; intent: string; preset: string; repo: string; repoProfile: string; defaultBranch: string; localOnly: boolean };

const NEW_TARGET = "__new__";

let MSG_ID = 0;
const msg = (role: ChatMsg["role"], text: string): ChatMsg => ({ id: ++MSG_ID, role, text });

export function LaunchPage() {
  const [classic, setClassic] = useState(false);
  return (
    <div className="p-7 lg:p-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[26px] font-bold leading-tight tracking-[-0.03em]">New Run</h2>
          <p className="mt-1 text-sm text-muted-foreground">Describe what to build. I will classify it, name it, and spin up the swarm.</p>
        </div>
        <Button variant="link" size="sm" onClick={() => setClassic((c) => !c)}>
          {classic ? "← Back to chat" : "Use classic form"}
        </Button>
      </div>
      {classic ? <ClassicForm /> : <ChatIntake />}
    </div>
  );
}

// ── Chat-driven, infer-and-confirm intake ──────────────────────────────────

function ChatIntake() {
  const { projectTypes } = useConfig();
  const { data: running } = usePoll<RunningRun[]>(api.running, 2000, []);
  const { data: projects } = usePoll<ProjectEntry[]>(api.projects, 5000, []);
  const names = (projects ?? []).map((p) => p.name);

  const [messages, setMessages] = useState<ChatMsg[]>([
    msg("assistant", "What do you want to build? Describe the app in a sentence or two — or describe a change to an existing project and I'll route it there."),
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [repoEditing, setRepoEditing] = useState(false);
  const { show } = useToast();

  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, draft]);

  const push = (m: ChatMsg) => setMessages((prev) => [...prev, m]);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    push(msg("user", text));
    setInput("");
    setThinking(true);
    try {
      const res = await api.intake({ idea: text, projects: names });
      const r = res.data;
      if (!res.ok || r.error) {
        push(msg("assistant", r.error || "I couldn't read that — mind rephrasing?"));
        return;
      }
      if (r.mode === "change") {
        const projectState = (projects ?? []).find((p) => p.name === r.project)?.state;
        setDraft({
          mode: "change",
          project: r.project,
          request: text,
          intent: r.intent || "auto",
          preset: "hybrid",
          repo: projectState?.repoUrl || "",
          repoProfile: projectState?.credentialProfile || "default",
          defaultBranch: projectState?.defaultBranch || "main",
          localOnly: false,
        });
        push(msg("assistant", `Got it — that's a change to **${r.project}**. ${r.summary || ""} Confirm the details below and start it.`));
      } else {
        // Carry any repo/env the user already set via the composer pills.
        setDraft((prev) => {
          const carry = prev?.mode === "new" ? prev : null;
          return {
            mode: "new", idea: r.idea || text, name: r.suggestedName, type: r.projectType || "auto",
            preset: carry?.preset ?? "hybrid", repo: r.repo || carry?.repo || "",
            repoProfile: carry?.repoProfile ?? "default", env: carry?.env ?? "",
          };
        });
        const typed = r.projectTypeLabel ? `a **${r.projectTypeLabel}**` : "a new project";
        push(msg("assistant", `Sounds like ${typed}. ${r.summary || ""} I'll call it **${r.suggestedName}** and plan with Claude + code with DeepSeek. Tweak anything below, then start.`));
      }
    } catch (e) {
      push(msg("assistant", "Request failed: " + e));
    } finally {
      setThinking(false);
    }
  };

  const startNew = async (d: Extract<Draft, { mode: "new" }>) => {
    setBusy(true);
    try {
      const res = await api.startRun({
        idea: d.idea, name: d.name, type: d.type, repo: d.repo.trim(), repoProfile: d.repoProfile.trim() || "default",
        env: parseEnvLines(d.env), ...presetToProviders(d.preset),
      });
      if (res.ok) {
        push(msg("assistant", `▶ Started **${res.data.name}**. Follow it on the Projects tab — I'll only interrupt if an agent raises a blocking doubt. What's next?`));
        setDraft(null);
      } else show(res.data.error || "Failed to start run.", false);
    } catch (e) { show("Request failed: " + e, false); }
    finally { setBusy(false); }
  };

  // Point the run at a specific project (or a fresh build) regardless of what
  // the intake inferred — and even before anything has been sent, so the pills
  // above the composer double as project pickers. Carries any described text.
  const selectTarget = (value: string) => {
    if (value === NEW_TARGET) {
      if (!draft || draft.mode === "new") return;
      setDraft({ mode: "new", idea: draft.request, name: "", type: "auto", preset: draft.preset, repo: "", repoProfile: "default", env: "" });
      return;
    }
    if (draft?.mode === "change" && draft.project === value) return;
    const projectState = (projects ?? []).find((p) => p.name === value)?.state;
    setDraft({
      mode: "change",
      project: value,
      request: draft ? (draft.mode === "new" ? draft.idea : draft.request) : "",
      intent: draft?.mode === "change" ? draft.intent : "auto",
      preset: draft?.preset ?? "hybrid",
      repo: projectState?.repoUrl || "",
      repoProfile: projectState?.credentialProfile || "default",
      defaultBranch: projectState?.defaultBranch || "main",
      localOnly: draft?.mode === "change" ? draft.localOnly : false,
    });
  };

  // Set/link the git repo straight from the composer pill. With no draft yet a
  // repo implies a new build, so seed one carrying just the repo.
  const setRepo = (value: string) => {
    if (!draft) {
      setDraft({ mode: "new", idea: "", name: "", type: "auto", preset: "hybrid", repo: value, repoProfile: "default", env: "" });
    } else {
      setDraft({ ...draft, repo: value });
    }
  };

  const saveLinkedRepo = async (d: Extract<Draft, { mode: "change" }>) => {
    const res = await api.saveProjectGit({
      project: d.project,
      repoUrl: d.repo.trim(),
      credentialProfile: d.repoProfile.trim() || "default",
      defaultBranch: d.defaultBranch.trim() || "main",
    });
    if (res.ok) {
      show(d.repo.trim() ? "Repository linked to project." : "Repository unlinked from project.", true);
      push(msg("assistant", d.repo.trim()
        ? `Linked **${d.project}** to **${d.repo.trim()}**.`
        : `Removed the GitHub repo link from **${d.project}**.`));
    } else {
      show(res.data.error || "Failed to link repository.", false);
    }
  };

  const startChange = async (d: Extract<Draft, { mode: "change" }>) => {
    if (!d.request.trim()) return show("Describe the change you want.", false);
    setBusy(true);
    try {
      const res = await api.startRun({
        mode: "change", project: d.project, request: d.request.trim(), intent: d.intent,
        repo: d.repo.trim(), repoProfile: d.repoProfile.trim() || "default",
        localOnly: d.localOnly, ...presetToProviders(d.preset),
      });
      if (res.ok) {
        push(msg("assistant", `▶ Started a ${d.intent === "auto" ? "change" : d.intent} on **${res.data.name}** — it runs on its own branch and opens a PR if the project has a repo. What's next?`));
        setDraft(null);
      } else show(res.data.error || "Failed to start change.", false);
    } catch (e) { show("Request failed: " + e, false); }
    finally { setBusy(false); }
  };

  const targetOptions = [{ value: NEW_TARGET, label: "+ New project" }, ...names.map((n) => ({ value: n, label: n }))];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      <div ref={streamRef} className="flex min-h-[52vh] max-h-[62vh] flex-col gap-3 overflow-auto rounded-lg border border-border bg-card p-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
              m.role === "user"
                ? "rounded-br-md border border-primary/25 bg-primary text-primary-foreground"
                : "rounded-bl-md border border-border bg-secondary text-foreground",
            )}>{renderMd(m.text)}</div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-lg bg-secondary px-3 py-2.5">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}

        {draft && draft.mode === "new" && (
          <ConfirmCard title="Ready to start a new project" onStart={() => startNew(draft)} busy={busy} startLabel="Start build">
            <ChipSelect label="Target" value={NEW_TARGET} onChange={selectTarget} options={targetOptions} />
            <ChipSelect label="Project type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })}
              options={[{ value: "auto", label: "Auto-detect" }, ...projectTypes.map((t) => ({ value: t.key, label: t.label }))]} />
            <ChipText label="Name" value={draft.name} placeholder="auto" onChange={(v) => setDraft({ ...draft, name: v })} />
            <ChipSelect label="Models" value={draft.preset} title={PRESET_HINTS[draft.preset]} onChange={(v) => setDraft({ ...draft, preset: v })}
              options={Object.keys(PRESET_LABEL).map((k) => ({ value: k, label: PRESET_LABEL[k] }))} />
            <ChipText label="GitHub repo" value={draft.repo} placeholder="owner/repo (optional)" onChange={(v) => setDraft({ ...draft, repo: v })} />
            <ChipText label="Git profile" value={draft.repoProfile} placeholder="default" onChange={(v) => setDraft({ ...draft, repoProfile: v })} />
            <ChipText label="Env vars" value={draft.env} placeholder="KEY=value, … (optional)" onChange={(v) => setDraft({ ...draft, env: v })} wide />
          </ConfirmCard>
        )}

        {draft && draft.mode === "change" && (
          <ConfirmCard
            title="Linked to an existing project"
            onStart={() => startChange(draft)}
            busy={busy}
            startLabel="Start change"
            secondaryAction={<Button variant="secondary" size="sm" disabled={busy} onClick={() => saveLinkedRepo(draft)}><GitBranch className="mr-1.5 h-3.5 w-3.5" /> Save repo link</Button>}
          >
            <ChipSelect label="Target" value={draft.project} onChange={selectTarget} options={targetOptions} />
            <ChipSelect label="Intent" value={draft.intent} onChange={(v) => setDraft({ ...draft, intent: v })}
              options={[
                { value: "auto", label: "Auto-detect" }, { value: "feature", label: "Feature" },
                { value: "bugfix", label: "Bug fix" }, { value: "refactor", label: "Refactor" },
                { value: "seo", label: "SEO/AEO/GEO" }, { value: "marketing", label: "Marketing/Social" },
              ]} />
            <ChipSelect label="Models" value={draft.preset} title={PRESET_HINTS[draft.preset]} onChange={(v) => setDraft({ ...draft, preset: v })}
              options={Object.keys(PRESET_LABEL).map((k) => ({ value: k, label: PRESET_LABEL[k] }))} />
            <ChipText label="Change" value={draft.request} placeholder="describe the change" onChange={(v) => setDraft({ ...draft, request: v })} wide />
            <ChipText label="GitHub repo" value={draft.repo} placeholder="owner/repo or URL" onChange={(v) => setDraft({ ...draft, repo: v })} />
            <ChipText label="Git profile" value={draft.repoProfile} placeholder="default" onChange={(v) => setDraft({ ...draft, repoProfile: v })} />
            <ChipText label="Default branch" value={draft.defaultBranch} placeholder="main" onChange={(v) => setDraft({ ...draft, defaultBranch: v })} />
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" className="accent-primary" checked={draft.localOnly} onChange={(e) => setDraft({ ...draft, localOnly: e.target.checked })} /> Local-only run
            </label>
          </ConfirmCard>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-2 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          <Select value={draft?.mode === "change" ? draft.project : NEW_TARGET} onValueChange={selectTarget}>
            <SelectTrigger className="h-7 w-auto gap-1.5 rounded-full border-border bg-secondary px-2.5 text-[11px] text-muted-foreground shadow-none">
              <Paperclip className="h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targetOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {repoEditing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px]">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                className="w-44 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="owner/repo or URL"
                defaultValue={draft?.repo ?? ""}
                onBlur={(e) => { setRepo(e.target.value.trim()); setRepoEditing(false); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); setRepo((e.target as HTMLInputElement).value.trim()); setRepoEditing(false); }
                  if (e.key === "Escape") setRepoEditing(false);
                }}
              />
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setRepoEditing(true)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span className="truncate">{draft?.mode === "change" ? (draft.repo || "No repo linked") : draft?.repo || "Repo optional"}</span>
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Textarea
            rows={2}
            className="min-h-[52px] resize-none"
            value={input}
            placeholder={draft ? "Revise the request, or adjust the linked project/repo above..." : "Message the swarm. Describe a new app, a change, or paste owner/repo..."}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button className="h-[52px] self-end" disabled={!input.trim() || thinking} onClick={send}>
            <SendHorizontal className="mr-1.5 h-4 w-4" /> {draft ? "Update" : "Send"}
          </Button>
        </div>
      </div>

      {running && running.length > 0 && (
        <InProgress running={running} />
      )}
    </div>
  );
}

function InProgress({ running }: { running: RunningRun[] }) {
  const toast = useToast();
  const [stopping, setStopping] = useState<string | null>(null);

  const stop = async (name: string) => {
    setStopping(name);
    try {
      const res = await api.stopRun({ name });
      if (res.ok) toast.show(`Stopped "${name}".`, true);
      else toast.show(res.data.error || "Failed to stop run.", false);
    } catch (e) {
      toast.show("Request failed: " + e, false);
    } finally {
      setStopping(null);
    }
  };

  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">In progress</div>
      <div className="flex flex-col gap-1.5">
        {running.map((r) => (
          <div key={r.name} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            <strong>{r.name}</strong><span className="min-w-0 flex-1 truncate text-muted-foreground">{r.idea}</span>
            {r.pid > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 px-2 text-[11px]"
                disabled={stopping === r.name}
                onClick={() => stop(r.name)}
              >
                <Square className="mr-1 h-3 w-3 fill-current" />
                {stopping === r.name ? "Stopping" : "Stop"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 px-2 text-[11px]"
                title="This process was not launched by the dashboard. Clear the stale running state."
                disabled={stopping === r.name}
                onClick={() => stop(r.name)}
              >
                {stopping === r.name ? "Clearing" : "Clear"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Small presentational pieces ─────────────────────────────────────────────

function ConfirmCard({ children, onStart, busy, startLabel, title, secondaryAction }: {
  children: React.ReactNode; onStart: () => void; busy: boolean; startLabel: string; title?: string; secondaryAction?: React.ReactNode;
}) {
  return (
    <Card className="mt-1 border-primary/20 bg-background/70">
      <CardContent className="p-3">
        {title && <div className="mb-2 text-xs font-semibold text-foreground">{title}</div>}
        <div className="mb-3 flex flex-wrap gap-2.5">{children}</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={onStart}>{startLabel}</Button>
          {secondaryAction}
        </div>
      </CardContent>
    </Card>
  );
}

function Ctrl({ label, title, wide, children }: { label: string; title?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label title={title} className={cn("flex min-w-[140px] flex-col gap-1", wide && "w-full flex-1 basis-full")}>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ChipSelect({ label, value, options, onChange, title }: {
  label: string; value: string; title?: string;
  options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <Ctrl label={label} title={title}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Ctrl>
  );
}

function ChipText({ label, value, placeholder, onChange, wide }: {
  label: string; value: string; placeholder?: string; onChange: (v: string) => void; wide?: boolean;
}) {
  return (
    <Ctrl label={label} wide={wide}>
      <Input className="h-8" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Ctrl>
  );
}

// Minimal markdown: **bold** only (enough for the assistant's phrasing).
function renderMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
  );
}

// ── Classic form (escape hatch for power users) ─────────────────────────────

function ClassicForm() {
  const { projectTypes } = useConfig();
  const { data: running } = usePoll<RunningRun[]>(api.running, 2000, []);
  const { data: projects } = usePoll<ProjectEntry[]>(api.projects, 5000, []);

  const [idea, setIdea] = useState("");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [repoProfile, setRepoProfile] = useState("default");
  const [env, setEnv] = useState("");
  const [type, setType] = useState("auto");
  const [preset, setPreset] = useState("hybrid");
  const [busy, setBusy] = useState(false);
  const run = useToast();

  const [project, setProject] = useState("");
  const [request, setRequest] = useState("");
  const [intent, setIntent] = useState("auto");
  const [localOnly, setLocalOnly] = useState(false);
  const [busyChange, setBusyChange] = useState(false);
  const change = useToast();

  const startRun = async () => {
    if (!idea.trim()) return run.show("Please enter an app idea.", false);
    setBusy(true);
    try {
      const res = await api.startRun({
        idea: idea.trim(), name: name.trim(), type, repo: repo.trim(), repoProfile: repoProfile.trim() || "default",
        env: parseEnvLines(env), ...presetToProviders(preset),
      });
      if (res.ok) { run.show(`Started run "${res.data.name}". Watch it on the Projects tab.`, true); setIdea(""); setName(""); }
      else run.show(res.data.error || "Failed to start run.", false);
    } catch (e) { run.show("Request failed: " + e, false); }
    finally { setBusy(false); }
  };

  const startChange = async () => {
    if (!project) return change.show("Pick a project to change.", false);
    if (!request.trim()) return change.show("Describe the change you want.", false);
    setBusyChange(true);
    try {
      const res = await api.startRun({
        mode: "change", project, request: request.trim(), intent,
        repoProfile: repoProfile.trim() || "default", localOnly, ...presetToProviders(preset),
      });
      if (res.ok) { change.show(`Started ${intent === "auto" ? "change" : intent} on "${res.data.name}".`, true); setRequest(""); }
      else change.show(res.data.error || "Failed to start change.", false);
    } catch (e) { change.show("Request failed: " + e, false); }
    finally { setBusyChange(false); }
  };

  const names = (projects ?? []).map((p) => p.name);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-xs text-muted-foreground">Describe the app you want the swarm to build. It runs autonomously and pauses only if an agent raises a blocking doubt.</p>

          <Field label="App idea">
            <Textarea rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A task management app with AI-powered prioritization" />
          </Field>
          <Field label="Project name (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="auto-generated from idea" />
          </Field>
          <Field label="GitHub repo (optional)" hint="If set, the swarm commits & pushes after each phase. Created (private) if it doesn't exist. Needs a GitHub token in Settings.">
            <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo, a URL, or a new repo name" />
          </Field>
          <Field label="GitHub credential profile" hint="default uses GITHUB_TOKEN/GH_TOKEN. Custom names use GITHUB_TOKEN_<PROFILE> from Settings.">
            <Input value={repoProfile} onChange={(e) => setRepoProfile(e.target.value)} placeholder="default" />
          </Field>
          <Field label="Project environment variables (optional)" hint="Per-project overrides, e.g. a different DATABASE_URL. Stored in this project's own .env.">
            <Textarea rows={3} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="KEY=value (one per line) — override global for this project" />
          </Field>
          <Field label="Project type" hint="Controls which phases run (a CLI tool skips branding/SEO/marketing, etc.). Auto-detect lets the lead classify it.">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect from idea (recommended)</SelectItem>
                {projectTypes.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Model strategy" hint={PRESET_HINTS[preset]}>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hybrid">Hybrid — Claude plans, DeepSeek codes (recommended)</SelectItem>
                <SelectItem value="deepseek">All DeepSeek — cheapest</SelectItem>
                <SelectItem value="claude">All Claude — SDK (subscription)</SelectItem>
                <SelectItem value="anthropic">All Claude — API (pay-as-you-go)</SelectItem>
                <SelectItem value="openrouter">All OpenRouter — one gateway</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button disabled={busy} onClick={startRun}>▶ Start Run</Button>

          <div className="mt-4">
            {running && running.length ? (
              <InProgress running={running} />
            ) : <div className="text-xs text-muted-foreground">No runs in progress.</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-1 text-base font-semibold">Change request</h2>
          <p className="mb-3 text-xs text-muted-foreground">Apply a feature, bug fix or refactor to an existing project. It runs as its own work order on a dedicated branch and opens a PR (if the project has a GitHub repo).</p>

          <Field label="Project">
            <Select value={project || undefined} onValueChange={setProject}>
              <SelectTrigger><SelectValue placeholder={names.length ? "Select a project…" : "No projects yet — build one first"} /></SelectTrigger>
              <SelectContent>
                {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Change request">
            <Textarea rows={4} value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Add a weekly leaderboard with friends" />
          </Field>
          <Field label="Intent" hint="Scoping triages the request first, then only the phases the change needs are run. Uses the model strategy selected above.">
            <Select value={intent} onValueChange={setIntent}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect from request (recommended)</SelectItem>
                <SelectItem value="feature">Feature addition</SelectItem>
                <SelectItem value="bugfix">Bug fix</SelectItem>
                <SelectItem value="refactor">Refactor / cleanup</SelectItem>
                <SelectItem value="seo">SEO / AEO / GEO</SelectItem>
                <SelectItem value="marketing">Marketing / social media</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Local-only change" hint="Only use this for throwaway/local projects. Repo-backed projects get branch, commit, PR and review context.">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="accent-primary" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} /> Allow change without linked repo
            </label>
          </Field>
          <Button disabled={busyChange} onClick={startChange}>▶ Start Change</Button>
        </CardContent>
      </Card>
    </div>
  );
}
