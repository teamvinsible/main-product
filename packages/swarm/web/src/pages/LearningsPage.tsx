import { api } from "../api";
import { usePoll } from "../hooks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Learning, ProjectHistory } from "../types";

export function LearningsPage() {
  const { data } = usePoll(api.learnings, 3000, []);
  const learnings = data?.learnings ?? [];
  const history = data?.projectHistory ?? [];

  const cats = new Set(learnings.map((l) => l.category));
  const avgConf = learnings.length
    ? Math.round(learnings.reduce((s, l) => s + l.confidence, 0) / learnings.length * 100) : 0;

  const sorted = [...learnings].sort(
    (a, b) => b.confidence * (b.appliedCount + 1) - a.confidence * (a.appliedCount + 1));

  return (
    <div className="p-7 lg:p-8">
      <div className="mb-6">
        <h2 className="text-[26px] font-bold leading-tight tracking-[-0.03em]">Learnings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Insights extracted across all projects, injected into future agent prompts.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Total Learnings" value={learnings.length} />
        <Stat label="Projects" value={history.length} />
        <Stat label="Categories" value={cats.size} />
        <Stat label="Avg Confidence" value={avgConf + "%"} />
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No learnings yet. Complete a project to start building knowledge.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {sorted.map((l, i) => <LearningCard key={i} l={l} />)}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Project History</h3>
          <div className="flex flex-col gap-1">
            {history.map((p, i) => <HistoryRow key={i} p={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="font-mono text-3xl font-bold leading-none tracking-[-0.03em] text-primary">{value}</div>
        <div className="mt-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function LearningCard({ l }: { l: Learning }) {
  const pct = Math.round(l.confidence * 100);
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <Badge variant="secondary">{l.category}</Badge>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {pct}%
            <span className="inline-block h-1 w-[50px] overflow-hidden rounded-full bg-border">
              <span className="block h-full bg-primary" style={{ width: pct + "%" }} />
            </span>
          </span>
        </div>
        <div className="mb-1.5 text-sm font-medium leading-relaxed">{l.insight}</div>
        <div className="mb-2 text-[13px] leading-relaxed text-muted-foreground">{l.context}</div>
        <div className="flex flex-wrap gap-2.5 border-t border-border/60 pt-2 font-mono text-[10px] text-muted-foreground">
          <span>from: {l.source}</span><span>project: {l.projectName}</span><span>used: {l.appliedCount}x</span>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryRow({ p }: { p: ProjectHistory }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-1.5 text-[11px]">
      <span className="font-semibold">
        <span className={p.success ? "text-success" : "text-destructive"}>{p.success ? "✓" : "✗"}</span> {p.projectName}
      </span>
      <span className="text-muted-foreground">{p.phases} phases, {p.artifacts} artifacts, {p.learningsExtracted} learnings, {(p.totalDurationMs / 60000).toFixed(1)}min</span>
    </div>
  );
}
