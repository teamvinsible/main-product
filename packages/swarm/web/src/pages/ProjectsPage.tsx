import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, List } from "lucide-react";
import { api } from "../api";
import { usePoll } from "../hooks";
import { useConfig } from "../config";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectEntry, ProjectState } from "../types";

type View = "cards" | "list";

function initialView(): View {
  return localStorage.getItem("projectsView") === "list" ? "list" : "cards";
}

export function ProjectsPage() {
  const { data: projects } = usePoll<ProjectEntry[]>(api.projects, 1000, []);
  const { allPhases } = useConfig();
  const [view, setView] = useState<View>(initialView);
  const navigate = useNavigate();

  const setAndStore = (v: View) => { setView(v); localStorage.setItem("projectsView", v); };
  const open = (name: string) => navigate(`/project/${encodeURIComponent(name)}`);

  const items = (projects ?? []).filter((p) => p.state);
  const states = items.map((p) => p.state!);
  const completed = states.filter((s) => s.status === "completed" || s.status === "completed_with_issues").length;
  const failed = states.filter((s) => s.status === "failed").length;
  const running = states.filter((s) => s.status === "running").length;
  const agents = states.reduce((sum, s) => sum + (s.metrics?.totalAgentRuns ?? 0), 0);
  const artifacts = states.reduce((sum, s) => sum + (s.artifacts?.length ?? 0), 0);
  const successRate = completed + failed ? Math.round((completed / (completed + failed)) * 100) : 0;
  const phaseCount = allPhases.length;

  return (
    <div className="p-7 lg:p-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold leading-tight tracking-[-0.03em]">Projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">{items.length} workspaces · click any card to open flow, agents, logs and artifacts</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant={view === "cards" ? "secondary" : "ghost"} size="sm" onClick={() => setAndStore("cards")}>
            <LayoutGrid /> Cards
          </Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setAndStore("list")}>
            <List /> List
          </Button>
        </div>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-2.5 md:grid-cols-4 2xl:grid-cols-7">
        <StatTile label="Projects" value={items.length} sub="in workspace" />
        <StatTile label="Active" value={running} sub="runs in progress" tone={running ? "primary" : "muted"} />
        <StatTile label="Completed" value={completed} sub="successful builds" tone={completed ? "success" : "muted"} />
        <StatTile label="Failed" value={failed} sub="need attention" tone={failed ? "destructive" : "muted"} />
        <StatTile label="Success rate" value={`${successRate}%`} sub="completed vs failed" tone={successRate >= 80 ? "success" : successRate >= 50 ? "warning" : "destructive"} />
        <StatTile label="Agent runs" value={agents} sub="total across all" tone="accent" />
        <StatTile label="Artifacts" value={artifacts} sub="files generated" tone="primary" />
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No projects found. Start one with <code>swarm run "your idea"</code>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-3.5">
          {items.map((p) => <ProjectCard key={p.name} entry={p} onOpen={open} phaseCount={phaseCount} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="hidden items-center gap-3 border-b border-border bg-secondary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground md:flex">
            <span className="min-w-40">Name</span>
            <span className="min-w-24">Status</span>
            <span className="min-w-32">Type</span>
            <span className="flex-1">Idea</span>
            <span className="min-w-40 text-right">Metrics</span>
          </div>
          {items.map((p) => <ProjectRow key={p.name} entry={p} onOpen={open} />)}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, tone = "default" }: { label: string; value: number | string; sub: string; tone?: "default" | "primary" | "success" | "warning" | "destructive" | "accent" | "muted" }) {
  const toneClass = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    accent: "text-accent",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="mb-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-2xl font-bold leading-none tracking-[-0.03em]", toneClass)}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function meta(s: ProjectState) {
  const dur = s.metrics?.totalDurationMs
    ? (s.metrics.totalDurationMs / 60000).toFixed(1) + "min"
    : s.status === "running" ? "running..." : "-";
  return {
    name: s.projectName || "",
    dur,
    agents: s.metrics?.totalAgentRuns || 0,
    artifacts: s.artifacts?.length || 0,
    errors: s.metrics?.totalErrors || 0,
    kind: (s.kind || "new-build") + (s.projectType ? ` · ${s.projectType}` : ""),
    status: s.status || "waiting",
  };
}

function ProjectCard({ entry, onOpen, phaseCount }: { entry: ProjectEntry; onOpen: (n: string) => void; phaseCount: number }) {
  const s = entry.state!;
  const m = meta(s);
  const name = m.name || entry.name;
  const pct = phaseCount ? Math.round(((s.completedPhases?.length ?? 0) / phaseCount) * 100) : s.status === "completed" ? 100 : 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(name)}
      className={cn(
        "flex w-full flex-col rounded-xl border border-border bg-card p-[18px] text-left transition-colors hover:border-primary hover:shadow-[0_0_0_1px_hsl(var(--primary))_inset] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        s.status === "running" && "animate-glow-run border-primary/40",
        s.status === "failed" && "border-destructive/30",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="truncate text-base font-bold tracking-[-0.02em]">{name}</span>
        <StatusBadge status={m.status} />
      </div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{m.kind}</div>
      <div className="mb-2.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{s.idea}</div>
      <div className="mb-2.5 h-[3px] overflow-hidden rounded-full bg-border">
        <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-gradient-to-r from-primary to-accent")} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
        <span>{m.dur}</span>
        <span>{m.agents} agents</span>
        <span>{m.artifacts} files</span>
        {m.errors > 0 && <span className="text-destructive">{m.errors} errors</span>}
      </div>
    </button>
  );
}

function ProjectRow({ entry, onOpen }: { entry: ProjectEntry; onOpen: (n: string) => void }) {
  const s = entry.state!;
  const m = meta(s);
  const name = m.name || entry.name;
  return (
    <button
      type="button"
      onClick={() => onOpen(name)}
      className={cn(
        "flex w-full flex-col gap-2 border-b border-border/60 bg-card px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:flex-row md:items-center md:gap-3",
        s.status === "running" && "bg-primary/5",
      )}
    >
      <span className="min-w-40 font-semibold">{name}</span>
      <StatusBadge status={m.status} />
      <span className="min-w-32 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{m.kind}</span>
      <span className="flex-1 truncate text-[13px] text-muted-foreground">{s.idea}</span>
      <span className="font-mono text-xs text-muted-foreground md:min-w-40 md:text-right">{m.dur} · {m.agents}a · {m.artifacts}f{m.errors > 0 ? ` · ${m.errors}e` : ""}</span>
    </button>
  );
}

export function statusVariant(status: string): BadgeProps["variant"] {
  const s = (status || "").toLowerCase();
  if (["completed", "success", "passed", "ok"].includes(s)) return "success";
  if (["failed", "error"].includes(s)) return "destructive";
  if (s === "running") return "default";
  if (s === "completed_with_issues" || s === "paused" || s === "waiting" || s === "stopped" || s === "awaiting_input") return "warning";
  return "secondary";
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const label = s === "awaiting_input" ? "NEEDS INPUT"
    : s === "completed_with_issues" ? "DONE · ISSUES"
    : status.toUpperCase();
  return <Badge variant={statusVariant(status)}>{label}</Badge>;
}
