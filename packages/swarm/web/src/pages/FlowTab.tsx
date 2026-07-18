import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { GraphEdge, GraphNode, RunGraph, WorkNode, WorkSpec } from "../types";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import "./flow.css";

const GUTTER = 140;
const PAD_R = 36;
const LANE_H = 52;
const NODE_H = 28;
const BAND_PAD = 16;

const PALETTE = ["#818cf8", "#3fb950", "#d29922", "#ec4899", "#39d0d8", "#f97316", "#a855f7", "#14b8a6", "#f85149", "#3b82f6"];
function roleColor(role: string): string {
  let h = 0;
  for (let i = 0; i < role.length; i++) h = (h * 31 + role.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function path(p0: P, p3: P): string {
  const dx = Math.max(36, Math.abs(p3.x - p0.x) / 2);
  return `M${p0.x},${p0.y} C${p0.x + dx},${p0.y} ${p3.x - dx},${p3.y} ${p3.x},${p3.y}`;
}
interface P { x: number; y: number }

const STATUS_CLASS: Record<string, string> = {
  pending: "border-border bg-muted/40 text-muted-foreground",
  running: "border-primary/50 bg-primary/10 text-primary",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  awaiting_input: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  skipped: "border-border bg-muted/20 text-muted-foreground",
};

const GATE_CLASS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  passed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};

export function FlowTab({ name }: { name: string }) {
  const { data: workSpec } = usePoll(() => api.workSpec(name), 2000, [name]);
  const [session, setSession] = useState<number | undefined>(undefined);
  const { data: graph } = usePoll(() => api.runGraph(name, session), 2000, [name, session]);
  const [width, setWidth] = useState(1200);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = () => { if (wrapRef.current) setWidth(wrapRef.current.clientWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const canvasWidth = useMemo(() => {
    const nodeBased = (graph?.nodes.length ?? 0) * 180;
    return Math.max(width, 1600, nodeBased);
  }, [graph?.nodes.length, width]);
  const layout = useMemo(() => computeLayout(graph, canvasWidth), [graph, canvasWidth]);

  const dur = graph?.durationMs ?? 0;
  const reverseEdges = layout.edges.filter((e) => e.reverse).length;

  return (
    <div className="flex flex-col gap-4" ref={wrapRef}>
      {workSpec && <HarnessRoute spec={workSpec} />}

      {!graph && <div className="text-xs text-muted-foreground">Loading agent timeline...</div>}
      {graph && !graph.nodes.length && (
        <div className="text-xs text-muted-foreground">No agent activity recorded for this run yet.</div>
      )}

      {graph && graph.nodes.length > 0 && (
        <>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.1em] text-primary">Agent timeline</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {graph.nodes.length} agent runs · {graph.edges.length} handoffs · {clock(dur)} total
          </div>
        </div>
        {graph.sessions.length > 1 && (
          <Select value={String(graph.selected)} onValueChange={(v) => setSession(Number(v))}>
            <SelectTrigger className="h-9 w-auto min-w-[280px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {graph.sessions.map((s) => (
                <SelectItem key={s.index} value={String(s.index)}>
                  Run {s.index + 1} - {new Date(s.startedAt).toLocaleString()} ({s.agents} agents)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flow-canvas max-h-[70vh] overflow-auto rounded-2xl border border-border bg-card p-4 shadow-[0_0_40px_hsl(var(--primary)/.06)]">
        <svg width={canvasWidth} height={Math.max(layout.height, 420)} className="block">
          {layout.bands.map((b) => (
            <g key={b.phase}>
              <rect x={0} y={b.y} width={canvasWidth} height={b.h} className="band" />
              <text x={14} y={b.y + b.h / 2} className="band-label" dominantBaseline="middle">{b.phase}</text>
              <line x1={GUTTER} y1={b.y} x2={canvasWidth - PAD_R} y2={b.y} className="band-line" />
            </g>
          ))}

          {layout.edges.map((e, i) => {
            const edgeClass = e.reverse ? "edge reverse" : "edge";
            const flowClass = e.reverse ? "edge-flow reverse" : "edge-flow";
            return (
              <g key={i}>
                <title>{`${e.reverse ? "Reverse" : "Forward"} handoff: ${e.edge.count} artifact${e.edge.count === 1 ? "" : "s"}`}</title>
                <path d={path(e.p0, e.p3)} className={edgeClass} />
                <path
                  d={path(e.p0, e.p3)}
                  className={flowClass}
                  style={{ animationDelay: `${(i % 8) * 180}ms` }}
                />
              </g>
            );
          })}

          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={GUTTER + (canvasWidth - GUTTER - PAD_R) * f} y1={0} x2={GUTTER + (canvasWidth - GUTTER - PAD_R) * f} y2={layout.height} className="flow-grid" />
          ))}

          {layout.nodes.map((ln) => {
            const n = ln.n;
            const color = roleColor(n.role);
            return (
              <g key={n.id} className="node done" transform={`translate(${ln.x},${ln.y})`}>
                <title>{`${n.role} @ ${n.phase}\n${clock(n.start)}-${clock(n.end)} (${(n.durationMs / 1000).toFixed(0)}s)\n${n.producedCount} artifacts${n.tokensSaved ? ` · ~${n.tokensSaved} tok saved` : ""}${n.success ? "" : " · FAILED"}`}</title>
                <rect width={ln.w} height={NODE_H} rx={7}
                  fill={color}
                  stroke={n.success ? color : "hsl(var(--destructive))"}
                  className={"node-rect" + (n.success ? "" : " failed")} />
                <text x={9} y={NODE_H / 2} dominantBaseline="middle" className="node-label">
                  {n.role}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex min-h-[34px] flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-xs">
        <span className="mr-1 font-medium text-muted-foreground">Flow map</span>
        {reverseEdges > 0 && <span className="text-muted-foreground">{reverseEdges} reverse</span>}
        <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="legend-line forward" /> forward handoff</span>
        <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="legend-line reverse" /> reverse handoff</span>
        <span className="text-muted-foreground">Connector lines animate to show artifact handoffs; nodes stay fixed for readability.</span>
      </div>
        </>
      )}
    </div>
  );
}

function HarnessRoute({ spec }: { spec: WorkSpec }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.1em] text-primary">Harness route</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {spec.mode === "change" ? `Change · ${spec.intent}` : "New build"} · run {spec.runId.slice(0, 8)}
          </div>
          {spec.rationale && <p className="mt-2 max-w-3xl text-xs text-muted-foreground">{spec.rationale}</p>}
        </div>
        <Badge variant="outline" className="w-fit capitalize">{spec.status.replace(/_/g, " ")}</Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {spec.route.map((node, i) => (
          <div key={node.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <RouteNode node={node} active={spec.currentPhase === node.phase} />
          </div>
        ))}
      </div>

      {spec.scope?.summary && (
        <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <div className="font-medium text-foreground">Scope</div>
          <p className="mt-1 text-muted-foreground">{spec.scope.summary}</p>
          {spec.scope.tags?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {spec.scope.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            </div>
          ) : null}
        </div>
      )}

      {spec.gates.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {spec.gates.map((g) => (
            <span
              key={g.id}
              title={g.detail}
              className={cn("rounded-md px-2 py-1 text-[11px] font-medium", GATE_CLASS[g.status] || GATE_CLASS.pending)}
            >
              {g.name}: {g.status}
            </span>
          ))}
        </div>
      )}

      {spec.delivery?.prUrl && (
        <div className="mt-3 text-xs">
          <span className="font-medium text-foreground">Delivery: </span>
          <a href={spec.delivery.prUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
            PR tracked (deploy skipped)
          </a>
        </div>
      )}
      {spec.delivery?.deployUrl && !spec.delivery.prUrl && (
        <div className="mt-3 text-xs">
          <span className="font-medium text-foreground">Delivery: </span>
          <a href={spec.delivery.deployUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
            {spec.delivery.deployUrl}
          </a>
        </div>
      )}
    </div>
  );
}

function RouteNode({ node, active }: { node: WorkNode; active: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        STATUS_CLASS[node.status] || STATUS_CLASS.pending,
        active && "ring-2 ring-primary/40",
      )}
    >
      <div className="font-semibold capitalize">{node.phase}</div>
      <div className="mt-0.5 text-[10px] opacity-80">{node.agents.join(" · ")}</div>
      {node.optional && <div className="mt-1 text-[10px] opacity-70">optional{node.requires ? ` · ${node.requires}` : ""}</div>}
    </div>
  );
}

interface LaidNode { n: GraphNode; x: number; y: number; w: number; cy: number; right: number }
function computeLayout(graph: RunGraph | null, width: number) {
  if (!graph || !graph.nodes.length) return { height: 420, bands: [], nodes: [], edges: [] };
  const xScale = (width - GUTTER - PAD_R) / Math.max(1, graph.durationMs);
  const x = (ms: number) => GUTTER + ms * xScale;

  const bands: Array<{ phase: string; y: number; h: number }> = [];
  const phaseY: Record<string, number> = {};
  let y = 0;
  for (const phase of graph.phases) {
    const lanes = graph.lanesPerPhase[phase] || 1;
    const h = lanes * LANE_H + BAND_PAD * 2;
    bands.push({ phase, y, h });
    phaseY[phase] = y + BAND_PAD;
    y += h;
  }
  const height = Math.max(y, 420);

  const nodes: LaidNode[] = graph.nodes.map((n) => {
    const nx = x(n.start);
    const labelWidth = n.role.length * 9 + 42;
    const durationWidth = n.durationMs * xScale;
    const w = Math.max(150, labelWidth, durationWidth);
    const ny = phaseY[n.phase] + n.lane * LANE_H + (LANE_H - NODE_H) / 2;
    return { n, x: nx, y: ny, w, cy: ny + NODE_H / 2, right: nx + w };
  });
  const byId = new Map(nodes.map((ln) => [ln.n.id, ln]));
  const phaseIndex = new Map(graph.phases.map((phase, index) => [phase, index]));

  const edges = graph.edges.map((edge: GraphEdge) => {
    const a = byId.get(edge.from), b = byId.get(edge.to);
    const reverse = !!(a && b && (
      (phaseIndex.get(b.n.phase) ?? 0) < (phaseIndex.get(a.n.phase) ?? 0) ||
      b.x < a.x
    ));
    const p0: P = a ? { x: reverse ? a.x : a.right, y: a.cy } : { x: 0, y: 0 };
    const p3: P = b ? { x: reverse ? b.right : b.x, y: b.cy } : { x: 0, y: 0 };
    return { edge, p0, p3, reverse };
  }).filter((e) => byId.has(e.edge.from) && byId.has(e.edge.to));

  return { height, bands, nodes, edges };
}
