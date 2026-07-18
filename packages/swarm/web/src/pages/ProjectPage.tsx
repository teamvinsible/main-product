import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { api } from "../api";
import { usePoll } from "../hooks";
import { useConfig } from "../config";
import { fmtDuration, fmtTokens, Field, useToast } from "../ui";
import type {
  Activity, AgentRun, ArtifactMeta, ChatMessage, Commit, Deployment, DeployProfileStatus, EnvVar, EvalResult, LogEntry,
  PendingQuestion, ProjectState, RunningRun,
} from "../types";
import { StatusBadge } from "./ProjectsPage";
import { FlowTab } from "./FlowTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SECTIONS = ["overview", "chat", "attempts", "flow", "logs", "runs", "evals", "artifacts", "deploy", "env"] as const;
type Section = (typeof SECTIONS)[number];
const LABELS: Record<Section, string> = {
  overview: "Overview", chat: "Chat", attempts: "Attempts", flow: "Flow", logs: "Logs", runs: "Agent Runs",
  evals: "Evals", artifacts: "Artifacts", deploy: "Deploy", env: "Environment",
};
const STALE_RUNNING_MS = 10 * 60 * 1000;

export function ProjectPage() {
  const { name = "", section } = useParams();
  const navigate = useNavigate();
  const active: Section = (SECTIONS as readonly string[]).includes(section ?? "")
    ? (section as Section) : "overview";

  const { data: state } = usePoll<ProjectState>(() => api.state(name), 1000, [name]);
  const { data: openQs } = usePoll<PendingQuestion[]>(() => api.questions(name), 3000, [name]);
  const { data: running } = usePoll<RunningRun[]>(api.running, 2000, []);
  const openCount = openQs?.length ?? 0;
  const toast = useToast();
  const [resuming, setResuming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const staleRunning = isStaleRunning(state);
  const dashboardRun = (running ?? []).some((r) => r.name === name && r.pid > 0);
  const canStop = state?.status === "running" || dashboardRun;

  const resume = async () => {
    if (!name || resuming) return;
    setResuming(true);
    const res = await api.resumeRun({ project: name });
    setResuming(false);
    if (res.ok) toast.show(`Resuming ${res.data.name || name}.`, true);
    else toast.show(res.data.error || "Failed to resume run.", false);
  };

  const stop = async () => {
    if (!name || stopping) return;
    setStopping(true);
    const res = await api.stopRun({ name, force: !dashboardRun });
    setStopping(false);
    if (res.ok) toast.show(dashboardRun ? `Stopped ${res.data.name || name}.` : `Cleared running status for ${res.data.name || name}.`, true);
    else toast.show(res.data.error || "Failed to stop run.", false);
  };

  const go = (s: string) => navigate(`/project/${encodeURIComponent(name)}${s === "overview" ? "" : "/" + s}`);
  const chatLayout = active === "chat";

  return (
    <div className={cn("p-7 lg:p-8", chatLayout && "flex h-full min-h-0 flex-col overflow-hidden")}>
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All projects
      </Link>

      <div className="mb-5 flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 className="text-[26px] font-bold leading-tight tracking-[-0.03em]">{state?.projectName || name}</h2>
          <p
            className="mt-1 max-w-3xl overflow-hidden break-words text-sm leading-relaxed text-muted-foreground"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: chatLayout ? 2 : 3,
            }}
            title={state?.request || state?.idea || ""}
          >
            {state?.request || state?.idea || ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {(state?.status === "failed" || staleRunning) && (
            <Button size="sm" onClick={resume} disabled={resuming}>
              {resuming ? "Resuming..." : staleRunning ? "Resume stale run" : "Resume failed run"}
            </Button>
          )}
          {state?.status && <StatusBadge status={state.status} />}
          {canStop && (
            <Button size="sm" variant="secondary" onClick={stop} disabled={stopping}>
              {stopping ? (dashboardRun ? "Stopping..." : "Clearing...") : dashboardRun ? "Stop" : "Clear running"}
            </Button>
          )}
        </div>
      </div>
      {staleRunning && (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          This run has not updated recently and is not tracked as active by the dashboard.
        </p>
      )}

      <PendingQuestions name={name} />

      {active !== "flow" && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          <Tile label="Request type" value={state?.kind || "new-build"} />
          <Tile label="Project type" value={state?.projectType || "-"} />
          <Tile label="Current phase" value={state?.currentPhase || "-"} />
          <Tile label="Duration" value={fmtDuration(state?.metrics?.totalDurationMs)} />
          <Tile label="Artifacts" value={String(state?.artifacts?.length ?? 0)} />
          <Tile label="Agent runs" value={String(state?.metrics?.totalAgentRuns ?? 0)} />
          <Tile label="Tokens saved" value={fmtTokens(state?.metrics?.totalTokensSaved)} />
          <Tile label="Errors" value={String(state?.metrics?.totalErrors ?? 0)} />
        </div>
      )}

      <Tabs value={active} onValueChange={go} className="mb-5">
        <TabsList className="flex w-full overflow-x-auto">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s} value={s} className="gap-1.5">
              {LABELS[s]}
              {s === "chat" && openCount > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground">
                  {openCount}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className={cn(chatLayout && "min-h-0 flex-1 overflow-hidden")}>
        {active === "overview" && <Overview name={name} state={state} />}
        {active === "chat" && <ChatTab name={name} />}
        {active === "attempts" && <Attempts name={name} />}
        {active === "flow" && <FlowTab name={name} />}
        {active === "logs" && <Logs name={name} />}
        {active === "runs" && <Runs name={name} />}
        {active === "evals" && <Evals name={name} />}
        {active === "artifacts" && <Artifacts name={name} />}
        {active === "deploy" && <Deploy name={name} state={state} />}
        {active === "env" && <Environment name={name} projectName={state?.projectName} />}
      </div>
    </div>
  );
}

// Input-request gate. When a run pauses waiting on a secret/external value it
// cannot invent, it shows here — the user can Answer (the value is fed back to
// the paused agent) or Skip (the team's safe fallback is applied, recorded for
// review). Polls quickly so the prompt appears/clears in near real time.
function PendingQuestions({ name }: { name: string }) {
  const { data } = usePoll<PendingQuestion[]>(() => api.questions(name), 2000, [name]);
  const open = data ?? [];
  if (open.length === 0) return null;
  return (
    <div className="mb-5 space-y-3">
      {open.map((q) => <QuestionCard key={q.id} q={q} />)}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  secret: "Secret / credential", config: "External config",
  external: "External account", input: "Input needed",
};

// Shared Answer / Skip controls for an open question, used by both the Overview
// card and the Chat thread. Posting resolves the question via the same endpoint
// the run's poll loop watches.
function CopyBtn({ text }: { text: string }) {
  const toast = useToast();
  return (
    <button
      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
      onClick={() => { navigator.clipboard?.writeText(text); toast.show("Copied.", true); }}
    >
      Copy
    </button>
  );
}

function AnswerBar({ q }: { q: PendingQuestion }) {
  const toast = useToast();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowBuild, setAllowBuild] = useState(true);

  const resolve = async (kind: "answer" | "confirm" | "skip") => {
    if (busy) return;
    if (kind === "answer" && !answer.trim()) return;
    setBusy(true);
    const body = kind === "skip" ? { id: q.id, skip: true }
      : kind === "confirm" ? { id: q.id, confirm: true, allowBuild }
      : { id: q.id, answer: answer.trim() };
    const res = await api.answerQuestion(body);
    setBusy(false);
    if (res.ok) toast.show(
      kind === "skip" ? "Skipped — the team's fallback will be used."
      : kind === "confirm" ? "Confirmed — the run will read it from the environment."
      : "Answer sent to the run.", true);
    else { toast.show(res.data.error || "Could not resolve the question.", false); return; }
    setAnswer("");
  };

  // SECRET: never take the value. Direct the operator to the env file, they set
  // it themselves, then confirm. The value never touches the chat/DB/prompt.
  if (q.kind === "secret") {
    const envPath = q.envPath || "the project's .env file";
    return (
      <div className="space-y-2.5">
        <div className="rounded-md border border-border bg-background/60 p-3">
          <p className="mb-2 text-xs font-medium">
            🔒 Add this to your env file yourself — <span className="text-muted-foreground">the value never leaves your machine or enters this chat.</span>
          </p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Key:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{q.envKey || "YOUR_KEY"}=…</code>
            <CopyBtn text={q.envKey || ""} />
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">File:</span>
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{envPath}</code>
            <CopyBtn text={q.envPath || ""} />
          </div>
          {q.globalEnvPath && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Reusable across projects? Put it in the shared file instead: <code className="font-mono">{q.globalEnvPath}</code>
            </p>
          )}
        </div>
        <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={allowBuild}
            onChange={(e) => setAllowBuild(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span>
            Let build/test commands read this key (adds it to <code className="font-mono">SWARM_SHELL_ENV_ALLOW</code>).
            Keep on for build-time secrets; turn off for runtime-only keys the app reads on its own.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => resolve("confirm")} disabled={busy}>
            {busy ? "…" : "I've added it"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => resolve("skip")} disabled={busy}>
            Skip for now
          </Button>
          <span className="text-[11px] font-medium text-destructive/80">Never paste the secret here.</span>
        </div>
      </div>
    );
  }

  // Non-secret answer (domain, id, choice…). A secret-shaped value is rejected by the server.
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") resolve("answer"); }}
        placeholder="Type your answer…"
        className="flex-1"
        autoComplete="off"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => resolve("answer")} disabled={busy || !answer.trim()}>
          {busy ? "Sending…" : "Answer"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => resolve("skip")} disabled={busy}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function QuestionCard({ q }: { q: PendingQuestion }) {
  const navigate = useNavigate();
  return (
    <Card className="border-warning/50 bg-warning/[0.06]">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-warning/50 text-warning">{KIND_LABEL[q.kind] || "Input needed"}</Badge>
          <CardTitle className="text-[15px]">The run is waiting on you</CardTitle>
          <button
            className="ml-auto text-[11px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => navigate(`/project/${encodeURIComponent(q.project)}/chat`)}
          >
            Open in Chat →
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium leading-relaxed">{q.question}</p>
        {q.context && <p className="text-xs leading-relaxed text-muted-foreground">{q.context}</p>}
        <p className="text-[11px] text-muted-foreground">
          Raised by <span className="font-mono">{q.agent}</span> during <span className="font-mono">{q.phase}</span>.
          {q.suggestion && <> If you skip, the team will use: <span className="italic">{q.suggestion}</span></>}
        </p>
        <AnswerBar q={q} />
      </CardContent>
    </Card>
  );
}

// Per-project conversation: the swarm's input-requests and your answers/skips,
// oldest first, with inline Answer / Skip on anything still open.
// A merged timeline item: either a swarm→human input-gate question or a chat
// message (user request / swarm answer / change ack).
type TimelineItem =
  | { at: string; kind: "question"; q: PendingQuestion }
  | { at: string; kind: "chat"; m: ChatMessage };

function ChatTab({ name }: { name: string }) {
  const { data: questions } = usePoll<PendingQuestion[]>(() => api.questionThread(name), 2000, [name]);
  const { data: messages } = usePoll<ChatMessage[]>(() => api.chatThread(name), 2000, [name]);
  const { data: state } = usePoll<ProjectState>(() => api.state(name), 2000, [name]);
  const { data: running } = usePoll<RunningRun[]>(api.running, 2000, []);
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...(questions ?? []).map((q) => ({ at: q.createdAt, kind: "question" as const, q })),
      ...(messages ?? []).map((m) => ({ at: m.createdAt, kind: "chat" as const, m })),
    ];
    return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [questions, messages]);

  const openCount = (questions ?? []).filter((q) => q.status === "open").length;
  // Gate on a genuinely LIVE run process (server's running list), not the DB
  // status — which can linger on "awaiting_input" after a skip if the process
  // already exited, otherwise stranding the chat. Only a live process holds the
  // lock. Live+running → busy; live+paused → answer the question above; no live
  // process → chat is available regardless of a stale status.
  const liveRun = (running ?? []).some((r) => r.name === name && r.pid > 0);
  const runActive = liveRun && state?.status === "running";
  const awaitingInput = liveRun && state?.status === "awaiting_input";
  // The last turn is a user message with no swarm reply yet → show a thinking hint.
  const awaitingReply = useMemo(() => {
    const chat = messages ?? [];
    const last = chat[chat.length - 1];
    return Boolean(last && last.role === "user" && !last.meta?.duringRun);
  }, [messages]);
  const chatPlaceholder = awaitingInput
    ? "Paused for your input - answer the question above to continue."
    : runActive
      ? "Add a comment or correction for the active run... (Ctrl/Enter to send)"
      : "Ask a question or request a change... (Ctrl/Enter to send)";
  const sendLabel = sending ? "Sending..." : runActive ? "Comment" : "Send";

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.scrollTo({ top: stream.scrollHeight });
  }, [timeline.length, awaitingInput, awaitingReply]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    const res = await api.sendChat({ project: name, message });
    setSending(false);
    if (res.ok) { setDraft(""); }
    else toast.show(res.data.error || "Couldn't send. Is a run in progress?", false);
  };

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle>Conversation</CardTitle>
          {openCount > 0
            ? <Badge variant="warning">{openCount} waiting on you</Badge>
            : <Badge variant="secondary">up to date</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Ask about this project (answered read-only from its docs &amp; code) or request a change
          (kicks off a change run). The swarm also pauses here when it hits a secret it can't invent.
          Every request is recorded to the project's <code>_artifacts/chat</code> log.
        </p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div ref={streamRef} className="min-h-0 flex-1 overflow-y-auto pr-2">
        {timeline.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No messages yet. Ask a question or request a change below.
          </p>
        ) : (
          <div className="space-y-4">
            {timeline.map((item) =>
              item.kind === "question"
                ? <QuestionBubble key={`q-${item.q.id}`} q={item.q} />
                : <ChatBubble key={`m-${item.m.id}`} m={item.m} />,
            )}
            {awaitingReply && (
              <p className="text-xs text-muted-foreground">Swarm is thinking…</p>
            )}
          </div>
        )}

        {awaitingInput && (
          <p className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            This run is <strong>paused waiting on your input</strong>.
            {openCount > 0 ? " Answer the question above to continue." : " It will resume once you respond."}
          </p>
        )}

        </div>

        <div className="mt-4 flex shrink-0 items-end gap-2 border-t border-border pt-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
            rows={2}
            placeholder={chatPlaceholder}
            disabled={sending}
            className="min-h-[44px] flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <Button onClick={send} disabled={sending || !draft.trim()}>
            {sendLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// A chat turn: user request (right), or swarm answer / change ack (left).
function ChatBubble({ m }: { m: ChatMessage }) {
  const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : "";
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary/15 px-4 py-2.5 text-sm leading-relaxed">
          {m.text}
        </div>
        <span className="mt-1 text-[11px] text-muted-foreground">you{when ? ` · ${when}` : ""}</span>
      </div>
    );
  }
  const isChange = m.kind === "change" || m.kind === "note";
  return (
    <div className="flex flex-col items-start">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono font-medium text-foreground">swarm</span>
        {isChange && <Badge variant="outline" className="border-primary/50 text-primary">change</Badge>}
        {m.kind === "error" && <Badge variant="outline" className="border-destructive/50 text-destructive">error</Badge>}
        {when && <span>· {when}</span>}
      </div>
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm leading-relaxed">
        {m.text}
      </div>
    </div>
  );
}

function QuestionBubble({ q }: { q: PendingQuestion }) {
  const when = q.createdAt ? new Date(q.createdAt).toLocaleString() : "";
  return (
    <div className="space-y-2">
      {/* Swarm side (left) */}
      <div className="flex flex-col items-start">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono font-medium text-foreground">{q.agent}</span>
          <span>· {q.phase}</span>
          <Badge variant="outline" className="border-warning/50 text-warning">{KIND_LABEL[q.kind] || "Input needed"}</Badge>
          {when && <span>· {when}</span>}
        </div>
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5">
          <p className="text-sm font-medium leading-relaxed">{q.question}</p>
          {q.context && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{q.context}</p>}
        </div>
      </div>

      {q.status === "open" ? (
        <div className="max-w-[85%] rounded-2xl border border-warning/40 bg-warning/[0.06] px-4 py-3">
          <AnswerBar q={q} />
        </div>
      ) : (
        // Human side (right)
        <div className="flex flex-col items-end">
          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/15 px-4 py-2.5">
            {q.status === "answered" ? (
              <p className="text-sm leading-relaxed">
                {q.kind === "secret"
                  ? <span className="text-muted-foreground">🔒 Set in env{q.envKey ? ` (${q.envKey})` : ""} — read at runtime</span>
                  : q.answer}
              </p>
            ) : (
              <p className="text-sm leading-relaxed">
                <span className="font-medium">Skipped.</span>{" "}
                <span className="text-muted-foreground">Team fallback: {q.suggestion || "best judgment"}</span>
              </p>
            )}
          </div>
          <span className="mt-1 text-[11px] text-muted-foreground">
            you · {q.status === "answered" ? "answered" : "skipped"}
            {q.resolvedAt ? ` · ${new Date(q.resolvedAt).toLocaleString()}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[9px] border border-border bg-card px-3.5 py-3">
      <div className="mb-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-lg font-bold leading-none">{value}</div>
    </div>
  );
}

function isStaleRunning(state?: ProjectState | null) {
  if (state?.status !== "running" || !state.updatedAt) return false;
  const updatedAt = new Date(state.updatedAt).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_RUNNING_MS;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="text-xs">{children}</CardContent>
    </Card>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <div className="text-xs text-muted-foreground">{children}</div>;

// ── Overview: phase flow + recent activity + repo ───────────────────────────
function Overview({ name, state }: { name: string; state: ProjectState | null }) {
  const { phaseAgents, allPhases, projectTypes } = useConfig();
  const navigate = useNavigate();
  const { data: activity } = usePoll<Activity[]>(() => api.activity(name), 2000, [name]);
  const { data: commits } = usePoll<Commit[]>(() => api.commits(name), 5000, [name]);
  const completed = new Set(state?.completedPhases ?? []);
  const completedAgents = state?.completedAgents ?? {};

  const typePhases = projectTypes.find((t) => t.key === state?.projectType)?.phases;
  const phases = (typePhases && typePhases.length ? typePhases
    : allPhases.length ? allPhases
    : Object.keys(phaseAgents)).filter((p) => phaseAgents[p]);

  const openFlow = () => navigate(`/project/${encodeURIComponent(name)}/flow`);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {phases.length === 0 && <Muted>No phase data.</Muted>}
        {phases.map((phase, i) => {
          const done = completed.has(phase);
          const running = state?.currentPhase === phase && state?.status === "running";
          const status = done ? "done" : running ? "running" : "pending";
          return (
            <button
              key={phase}
              type="button"
              onClick={openFlow}
              title={`Open the Flow view for ${phase}`}
              className={cn(
                "rounded-lg border border-l-[3px] border-border bg-card p-3 text-left transition-colors hover:border-primary",
                done && "border-l-success",
                running && "border-l-primary bg-primary/5",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn(
                  "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-secondary font-mono text-[10px] font-semibold text-foreground",
                  done && "border-success bg-success text-background",
                  running && "border-primary bg-primary text-background",
                )}>{i + 1}</span>
                <strong className="flex-1 capitalize text-foreground">{phase}</strong>
                <Badge variant={done ? "success" : running ? "default" : "secondary"}>{status}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(phaseAgents[phase] || []).map((role) => {
                  const adone = (completedAgents[phase] || []).includes(role);
                  return (
                    <span key={role} className={cn(
                      "rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground",
                      adone && "border-success/60 text-success",
                      !adone && running && "border-primary/60 text-primary",
                    )}>{role}</span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Recent activity">
          {activity && activity.length ? (
            <div className="flex flex-col">
              {[...activity].reverse().slice(0, 8).map((e, i) => (
                <div key={i} className="flex gap-2 py-0.5 text-[10px]">
                  <span className="text-foreground/70">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="min-w-[70px] text-primary">{e.agent || e.category || "system"}</span>
                  <span className="truncate text-foreground/90">{e.message}</span>
                </div>
              ))}
            </div>
          ) : <Muted>No activity recorded yet.</Muted>}
        </Panel>

        <Panel title="Repository">
          <RepoBinding project={name} state={state} />
          {commits && commits.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {commits.slice(0, 8).map((c) => (
                <div key={c.sha} className="text-[10px]">
                  {c.htmlUrl
                    ? <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-primary">{c.sha.slice(0, 7)}</a>
                    : <span className="font-mono">{c.sha.slice(0, 7)}</span>}
                  <span> {c.message}</span>
                  <span className="text-muted-foreground"> ({c.files} files)</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function RepoBinding({ project, state }: { project: string; state?: ProjectState | null }) {
  const [repoUrl, setRepoUrl] = useState(state?.repoUrl || "");
  const [profile, setProfile] = useState(state?.credentialProfile || "default");
  const [branch, setBranch] = useState(state?.defaultBranch || "main");
  const toast = useToast();

  useEffect(() => {
    setRepoUrl(state?.repoUrl || "");
    setProfile(state?.credentialProfile || "default");
    setBranch(state?.defaultBranch || "main");
  }, [state?.repoUrl, state?.credentialProfile, state?.defaultBranch]);

  const save = async () => {
    const res = await api.saveProjectGit({
      project, repoUrl: repoUrl.trim(),
      credentialProfile: profile.trim() || "default",
      defaultBranch: branch.trim() || "main",
    });
    if (res.ok) toast.show("Repository binding saved.", true);
    else toast.show(res.data.error || "Failed to save repository binding.", false);
  };

  return (
    <div className="flex flex-col gap-2">
      {state?.repoUrl
        ? <a href={state.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
            {state.repoUrl.replace("https://github.com/", "")} <ExternalLink className="h-3 w-3" />
          </a>
        : <Muted>No repository linked.</Muted>}
      <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo or owner/repo" />
      <Input value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="credential profile" />
      <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default branch" />
      <Button variant="secondary" size="sm" onClick={save} className="self-start">Save repo binding</Button>
      <div className="text-[11px] text-muted-foreground">Profile <code>default</code> uses <code>GITHUB_TOKEN</code>/<code>GH_TOKEN</code>; custom profiles use <code>GITHUB_TOKEN_PROFILE</code>.</div>
    </div>
  );
}

// ── Deploy ──────────────────────────────────────────────────────────────────
const DEPLOY_TARGET_FIELDS: Record<string, Array<{ key: string; label: string; placeholder: string }>> = {
  vercel: [],
  digitalocean: [
    { key: "region", label: "Region", placeholder: "nyc (optional)" },
    { key: "service", label: "App name", placeholder: "defaults to project" },
  ],
  gcp: [
    { key: "project", label: "GCP project id", placeholder: "my-gcp-project" },
    { key: "region", label: "Region", placeholder: "us-central1" },
    { key: "service", label: "Service name", placeholder: "defaults to project" },
  ],
  aws: [
    { key: "image", label: "Image URI", placeholder: "public.ecr.aws/…/img:tag" },
    { key: "region", label: "Region", placeholder: "us-east-1" },
    { key: "service", label: "Service name", placeholder: "defaults to project" },
  ],
};

function deployEnvName(base: string, profile: string): string {
  const normalized = (profile || "default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "default";
  if (normalized === "default") return base;
  return `${base}_${normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function Deploy({ name, state }: { name: string; state: ProjectState | null }) {
  const { deployProviders } = useConfig();
  const { data: deployProfiles } = usePoll<DeployProfileStatus[]>(() => api.deployProfiles(name), 5000, [name]);
  const { data: deployments } = usePoll<Deployment[]>(() => api.deployments(name), 3000, [name]);
  const toast = useToast();
  const providers = deployProviders ?? [];

  const [provider, setProvider] = useState(state?.deployProvider || "");
  const [profile, setProfile] = useState(state?.deployProfile || "default");
  const [target, setTarget] = useState<Record<string, string>>(() => toStringMap(state?.deployTarget));
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const savedTargetKey = JSON.stringify(state?.deployTarget || {});

  useEffect(() => {
    setProvider(state?.deployProvider || "");
    setProfile(state?.deployProfile || "default");
    setTarget(toStringMap(state?.deployTarget));
  }, [state?.deployProvider, state?.deployProfile, savedTargetKey]);

  const spec = providers.find((p) => p.key === provider);
  const secretBases = spec?.secrets || [];
  const configBases = spec?.config || [];
  const profilesForProvider = (deployProfiles || []).filter((p) => p.provider === provider);
  const profileNames = Array.from(new Set(["default", ...profilesForProvider.map((p) => p.name)]));
  const activeProfile = profilesForProvider.find((p) => p.name === profile);
  const configured = Boolean(activeProfile?.tokenSet);
  const fields = DEPLOY_TARGET_FIELDS[provider] || [];

  const saveBinding = async () => {
    const res = await api.saveProjectDeploy({ project: name, provider, profile, target });
    if (res.ok) toast.show("Deploy binding saved.", true);
    else toast.show(res.data.error || "Failed to save binding.", false);
  };

  const saveProjectCredentials = async () => {
    if (!provider) return toast.show("Pick a deploy provider first.", false);
    const set: Record<string, string> = {};
    for (const base of [...secretBases, ...configBases]) {
      const value = (credentialValues[base] || "").trim();
      if (value) set[deployEnvName(base, profile)] = value;
    }
    if (!Object.keys(set).length) return toast.show("Enter at least one credential value.", false);
    const res = await api.saveEnv({ project: name, set });
    if (res.ok) {
      setCredentialValues({});
      toast.show("Project deploy credentials saved.", true);
    } else {
      toast.show(res.data.error || "Failed to save project credentials.", false);
    }
  };

  const runDeploy = async (prod: boolean) => {
    if (!provider) return toast.show("Pick a deploy provider first.", false);
    if (!configured) return toast.show(`Add ${provider} credentials for profile "${profile}" on this Deploy tab or in Settings first.`, false);
    setBusy(true);
    const res = await api.deploy({ project: name, provider, profile, prod, target });
    setBusy(false);
    if (res.ok) toast.show(`Deploy started → ${provider}. Watch progress in Logs.`, true);
    else toast.show(res.data.error || "Failed to start deploy.", false);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Panel title="Deploy target">
        {providers.length === 0 ? <Muted>No deploy providers available.</Muted> : (
          <div className="flex flex-col gap-3">
            <Field label="Provider">
              <Select value={provider || undefined} onValueChange={setProvider}>
                <SelectTrigger><SelectValue placeholder="Select a provider…" /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {provider && (
              <Field label="Credential profile" hint="default uses bare env vars; named profiles append _<PROFILE>.">
                <Input value={profile} onChange={(e) => setProfile(e.target.value.trim() || "default")} placeholder="default or client-a" />
              </Field>
            )}
            {provider && profileNames.length > 0 && (
              <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                {profileNames.map((n) => {
                  const p = profilesForProvider.find((item) => item.name === n);
                  return <Badge key={n} variant={p?.tokenSet ? "success" : "secondary"}>{n}{p?.scope === "project" ? " project" : p?.tokenSet ? " global" : " missing"}</Badge>;
                })}
              </div>
            )}
            {fields.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input value={target[f.key] || ""} placeholder={f.placeholder}
                  onChange={(e) => setTarget({ ...target, [f.key]: e.target.value })} />
              </Field>
            ))}
            {provider && !configured && (
              <div className="text-[11px] text-warning">No token for <code>{provider}</code> profile <code>{profile}</code>. Add it below or in Settings.</div>
            )}
            {provider && (
              <div className="rounded-md border border-border bg-background p-3">
                <div className="mb-2 text-xs font-semibold">Project credential override</div>
                <div className="grid gap-2">
                  {secretBases.map((base) => (
                    <Field key={base} label={deployEnvName(base, profile)} hint="saved only to this project">
                      <Input type="password" value={credentialValues[base] || ""} placeholder={`${base} secret`}
                        onChange={(e) => setCredentialValues({ ...credentialValues, [base]: e.target.value })} />
                    </Field>
                  ))}
                  {configBases.map((base) => (
                    <Field key={base} label={deployEnvName(base, profile)} hint="optional project override">
                      <Input value={credentialValues[base] || ""} placeholder={base}
                        onChange={(e) => setCredentialValues({ ...credentialValues, [base]: e.target.value })} />
                    </Field>
                  ))}
                </div>
                <Button className="mt-2" variant="secondary" size="sm" onClick={saveProjectCredentials}>Save Project Credentials</Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={saveBinding} disabled={!provider}>Save binding</Button>
              <Button size="sm" onClick={() => runDeploy(false)} disabled={busy || !provider}>Deploy</Button>
              <Button size="sm" onClick={() => runDeploy(true)} disabled={busy || !provider}>Deploy to production</Button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Recent deployments">
        {deployments && deployments.length ? (
          <div className="flex flex-col gap-1.5">
            {deployments.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-[11px]">
                <StatusBadge status={d.status} />
                <span className="min-w-[84px] capitalize text-primary">{d.provider}</span>
                {d.url
                  ? <a href={d.url} target="_blank" rel="noreferrer" className="truncate text-primary">{d.url.replace(/^https?:\/\//, "")}</a>
                  : <span className="truncate text-muted-foreground">{d.detail || "no URL"}</span>}
                <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">{d.createdAt ? new Date(d.createdAt).toLocaleString() : ""}</span>
              </div>
            ))}
          </div>
        ) : <Muted>No deployments yet.</Muted>}
      </Panel>
    </div>
  );
}

function toStringMap(input?: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) if (v != null) out[k] = String(v);
  }
  return out;
}

function formatLogTimestamp(timestamp?: string) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Attempts (work orders) ──────────────────────────────────────────────────
function Attempts({ name }: { name: string }) {
  const { data } = usePoll<ProjectState[]>(() => api.runs(name), 2000, [name]);
  const attempts = data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const current = attempts.find((r) => r.runId === selected) || attempts[0];
  const runId = current?.runId;
  const { data: agentRuns } = usePoll<AgentRun[]>(() => api.agentRuns(name, runId), 2000, [name, runId]);
  const { data: evals } = usePoll<EvalResult[]>(() => api.evals(name, runId), 3000, [name, runId]);
  const { data: commits } = usePoll<Commit[]>(() => api.commits(name, runId), 5000, [name, runId]);
  const { data: logs } = usePoll<LogEntry[]>(() => api.logs(name, runId), 2000, [name, runId]);

  useEffect(() => {
    if (!selected && attempts[0]?.runId) setSelected(attempts[0].runId);
  }, [attempts, selected]);

  if (!attempts.length) return <Muted>No attempts recorded for this project yet.</Muted>;

  return (
    <div className="grid gap-3 md:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-1.5">
        {attempts.map((r) => (
          <ListItem key={r.runId || r.updatedAt} active={current?.runId === r.runId} onClick={() => setSelected(r.runId || null)}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">{r.kind || "run"}</span>
              <StatusBadge status={r.status || "unknown"} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
              <span className="font-mono">{r.runId?.slice(0, 8) || "no id"}</span>
              <span>{r.currentPhase || "-"}</span>
              <span>{new Date(r.updatedAt || r.startedAt || "").toLocaleString()}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{r.request || r.idea || ""}</div>
          </ListItem>
        ))}
      </div>
      <Card>
        <CardContent className="p-4">
          {current ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold capitalize">{current.kind || "run"} attempt</h3>
                <StatusBadge status={current.status || "unknown"} />
                <code className="text-[11px]">{current.runId}</code>
              </div>
              <Block title="Request">{current.request || current.idea || "(none)"}</Block>
              <Block title="Progress">{[
                `Current phase: ${current.currentPhase || "-"}`,
                `Completed phases: ${(current.completedPhases || []).join(", ") || "none"}`,
                `Agent runs: ${agentRuns?.length ?? 0}`,
                `Errors: ${current.metrics?.totalErrors ?? 0}`,
                current.branch ? `Branch: ${current.branch}` : "",
                current.prUrl ? `PR: ${current.prUrl}` : "",
              ].filter(Boolean).join("\n")}</Block>
              <Block title={`Agent runs (${agentRuns?.length ?? 0})`}>{(agentRuns || []).map((r) => `${r.role} / ${r.phase} / ${r.success ? "OK" : "FAIL"} / ${((r.durationMs || 0) / 1000).toFixed(1)}s`).join("\n") || "None"}</Block>
              <Block title={`Evals (${evals?.length ?? 0})`}>{(evals || []).map((e) => `${e.passed ? "PASS" : "FAIL"} ${(e.overallScore * 100).toFixed(0)}% ${new Date(e.createdAt).toLocaleString()}`).join("\n") || "None"}</Block>
              <Block title={`Commits (${commits?.length ?? 0})`}>{(commits || []).map((c) => `${c.sha.slice(0, 7)} ${c.message} (${c.files} files)`).join("\n") || "None"}</Block>
              <Block title={`Recent logs (${logs?.length ?? 0})`}>{(logs || []).slice(0, 60).map((l) => `${formatLogTimestamp(l.timestamp)} ${l.level || ""} ${l.agent || l.category || ""} ${l.message || ""}`).join("\n") || "None"}</Block>
            </>
          ) : <Muted>Select an attempt.</Muted>}
        </CardContent>
      </Card>
    </div>
  );
}

function ListItem({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active && "border-primary bg-primary/10",
      )}
    >
      {children}
    </button>
  );
}

const LOG_LEVEL_CLASS: Record<string, string> = {
  error: "text-destructive", warn: "text-warning", info: "text-foreground", debug: "text-foreground/60",
};

function Logs({ name }: { name: string }) {
  const { data } = usePoll<LogEntry[]>(() => api.logs(name), 1500, [name]);
  const [level, setLevel] = useState("all");
  const [search, setSearch] = useState("");
  const logs = (data ?? []).filter((l) =>
    (level === "all" || l.level === level) &&
    (!search || (l.message || "").toLowerCase().includes(search.toLowerCase()) || (l.agent || "").toLowerCase().includes(search.toLowerCase())));

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {["debug", "info", "warn", "error"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="max-w-xs" placeholder="Search logs…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {logs.length === 0 ? <Muted>No logs match.</Muted> : (
        <div className="overflow-hidden rounded-xl border border-border bg-card font-mono text-[11px]">
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2 border-b border-border/50 px-3 py-1.5 last:border-0">
              <span className="shrink-0 text-foreground/70" title={l.timestamp || ""}>{formatLogTimestamp(l.timestamp)}</span>
              <span className={cn("w-10 shrink-0 uppercase", LOG_LEVEL_CLASS[l.level || "info"])}>{l.level}</span>
              <span className="w-28 shrink-0 truncate text-primary">{l.agent || ""}</span>
              <span className="whitespace-pre-wrap break-words text-foreground/90">{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Agent runs (list + detail) ──────────────────────────────────────────────
function Runs({ name }: { name: string }) {
  const { data } = usePoll<AgentRun[]>(() => api.agentRuns(name), 1500, [name]);
  const runs = data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const run = runs.find((r) => r.id === selected) || runs[runs.length - 1];

  if (!runs.length) return <Muted>No agent runs recorded yet.</Muted>;
  return (
    <div className="grid gap-3 md:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-1.5">
        {runs.map((r) => (
          <ListItem key={r.id} active={!!run && r.id === run.id} onClick={() => setSelected(r.id)}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.role}</span>
              <Badge variant={r.success ? "success" : "destructive"}>{r.success ? "OK" : "FAIL"}</Badge>
            </div>
            <div className="mt-1 flex gap-x-3 text-[10px] text-muted-foreground">
              <span>{r.phase}</span><span>{((r.durationMs ?? 0) / 1000).toFixed(1)}s</span><span>{r.artifactsCreated.length} files</span>
            </div>
          </ListItem>
        ))}
      </div>
      <Card>
        <CardContent className="p-4">{run ? <RunDetail run={run} /> : <Muted>Select a run.</Muted>}</CardContent>
      </Card>
    </div>
  );
}

function RunDetail({ run }: { run: AgentRun }) {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{run.role} <span className="text-muted-foreground">({run.phase})</span></h3>
        <Badge variant={run.success ? "success" : "destructive"}>{run.success ? "SUCCESS" : "FAILED"}</Badge>
        <span className="text-xs text-muted-foreground">{((run.durationMs ?? 0) / 1000).toFixed(1)}s</span>
        {(run.tokensSaved ?? 0) > 0 && <span className="text-xs text-success">~{fmtTokens(run.tokensSaved)} tokens saved</span>}
      </div>
      {run.error && <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">{run.error}</div>}
      <Block title={`Artifacts created (${run.artifactsCreated.length})`}>{run.artifactsCreated.join("\n") || "None"}</Block>
      <Block title="Summary">{run.summary || "No summary"}</Block>
      <Block title={`Full output (${run.fullOutput.length} chars)`}>{run.fullOutput.slice(0, 10000) + (run.fullOutput.length > 10000 ? "\n... truncated ..." : "")}</Block>
      <Block title={`Prompt sent (${run.promptSent.length} chars)`}>{run.promptSent.slice(0, 5000) + (run.promptSent.length > 5000 ? "\n... truncated ..." : "")}</Block>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{children}</pre>
    </div>
  );
}

// ── Evals ───────────────────────────────────────────────────────────────────
function Evals({ name }: { name: string }) {
  const { data } = usePoll<EvalResult[]>(() => api.evals(name), 3000, [name]);
  const evals = data ?? [];
  if (!evals.length) return <Muted>No evals recorded for this project yet.</Muted>;
  return (
    <div className="flex flex-col gap-3">
      {evals.map((e, i) => {
        const pct = (e.overallScore * 100).toFixed(0);
        const scoreClass = e.overallScore >= 0.75 ? "text-success" : e.overallScore >= 0.4 ? "text-warning" : "text-destructive";
        return (
          <Card key={i}>
            <CardContent className="p-3">
              <div className="mb-2 flex items-center gap-3">
                <span className="font-medium">{e.project}</span>
                <span className={cn("text-sm font-semibold", scoreClass)}>{pct}%</span>
                <Badge variant={e.passed ? "success" : "destructive"}>{e.passed ? "PASS" : "FAIL"}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex flex-col gap-1">
                {(e.checks || []).map((c, j) => (
                  <div key={j} className="flex items-start gap-2 text-[11px]">
                    <span className={c.passed ? "text-success" : "text-destructive"}>{c.passed ? "✓" : "✗"}</span>
                    <span className="min-w-[140px] font-medium">{c.name}</span>
                    <span className="flex-1 text-muted-foreground">{(c.detail || "").slice(0, 300)}</span>
                    <span className="text-muted-foreground">{c.durationMs ? (c.durationMs / 1000).toFixed(1) + "s" : ""}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Artifacts (grid + viewer) ───────────────────────────────────────────────
function pickRepresentative(paths: string[]): string {
  const prefer = ["readme.md", "app/readme.md", "_artifacts/product/prd.md", "_artifacts/research/market-analysis.md"];
  const lower = paths.map((p) => p.toLowerCase());
  for (const want of prefer) { const i = lower.indexOf(want); if (i !== -1) return paths[i]; }
  return paths.find((p) => p.toLowerCase().endsWith(".md")) || paths[0];
}

function Artifacts({ name }: { name: string }) {
  const { data } = usePoll<ArtifactMeta[]>(() => api.artifacts(name), 3000, [name]);
  const artifacts = useMemo(() => data ?? [], [data]);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState("");

  useEffect(() => {
    const paths = artifacts.map((a) => a.path);
    if (paths.length && (!path || !paths.includes(path))) setPath(pickRepresentative(paths));
  }, [artifacts, path]);

  useEffect(() => {
    if (!path) { setContent(""); return; }
    let alive = true;
    api.artifactContent(path, name).then((t) => { if (alive) setContent(t); }).catch(() => {});
    return () => { alive = false; };
  }, [path, name]);

  if (!artifacts.length) return <Muted>No artifacts yet.</Muted>;
  return (
    <div className="grid gap-3 md:grid-cols-[300px_1fr]">
      <div className="flex max-h-[70vh] flex-col gap-1.5 overflow-auto">
        {artifacts.map((a) => {
          const fname = a.path.split("/").pop();
          const size = a.size > 1024 ? (a.size / 1024).toFixed(1) + " KB" : a.size + " B";
          return (
            <button
              key={a.path}
              type="button"
              onClick={() => setPath(a.path)}
              className={cn(
                "rounded-md border border-border bg-card p-2 text-left transition-colors hover:border-primary",
                a.path === path && "border-primary bg-primary/5",
              )}
            >
              <div className="truncate text-xs font-medium">{fname}</div>
              <div className="truncate text-[10px] text-muted-foreground">{a.path}</div>
              <div className="text-[10px] text-muted-foreground">{size}</div>
            </button>
          );
        })}
      </div>
      <Card>
        <CardContent className="p-4">
          {path ? (
            <>
              <div className="mb-2 font-mono text-[11px] text-muted-foreground">{path}</div>
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">{content}</pre>
            </>
          ) : <Muted>Select an artifact.</Muted>}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Per-project environment overrides ───────────────────────────────────────
function Environment({ name, projectName }: { name: string; projectName?: string }) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");
  const toast = useToast();
  const proj = projectName || name;

  const reload = () => api.env(proj).then(setVars).catch(() => {});
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [proj]);

  const add = async () => {
    if (!key.trim()) return toast.show("Enter a variable name.", false);
    const res = await api.saveEnv({ project: proj, set: { [key.trim()]: val } });
    if (res.ok) { toast.show("Saved " + key, true); setKey(""); setVal(""); setVars(res.data.vars); }
    else toast.show(res.data.error || "Failed to save.", false);
  };
  const remove = async (k: string) => {
    const res = await api.saveEnv({ project: proj, remove: [k] });
    if (res.ok) setVars(res.data.vars);
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 text-[11px] text-muted-foreground">Overrides the global variables for this project only.</div>
        <div className="mb-3 flex flex-col gap-1.5">
          {vars.length ? vars.map((v) => (
            <div key={v.key} className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
              <strong className="font-mono">{v.key}</strong>
              <span className="flex-1 truncate text-muted-foreground">{v.preview}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Remove" onClick={() => remove(v.key)}><X className="h-3.5 w-3.5" /></Button>
            </div>
          )) : <div className="text-xs text-muted-foreground">No overrides for this project.</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="w-40" value={key} onChange={(e) => setKey(e.target.value)} placeholder="KEY" />
          <Input className="w-56" value={val} onChange={(e) => setVal(e.target.value)} placeholder="value" />
          <Button variant="secondary" size="sm" onClick={add}>Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}
