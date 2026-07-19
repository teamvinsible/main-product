import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DataFlowEdge, DomainAgentNode, RevisionLoop, SignalState } from "@teamvinsible/shared";
import {
  IconBox,
  IconChat,
  IconCheck,
  IconCode,
  IconLoop,
  IconMail,
  IconPalette,
  IconSearch,
  IconStar,
} from "./icons";

type Pt = { x: number; y: number };

/** Measured bubble in SVG-local pixel space (1:1 with getBoundingClientRect). */
type BubbleGeom = { cx: number; cy: number; r: number };

const ICONS: Record<string, typeof IconSearch> = {
  research: IconSearch,
  product: IconBox,
  brand: IconPalette,
  design: IconPalette,
  social: IconChat,
  email: IconMail,
  engineering: IconCode,
  eng: IconCode,
  review: IconCheck,
};

const LABELS: Record<string, string> = {
  mediator: "Mediator",
  research: "Research",
  product: "Product",
  brand: "Brand",
  design: "Design",
  social: "Social",
  email: "Email",
  engineering: "Engineering",
  eng: "Engineering",
  review: "Review",
};

/** Prefer a stable ring order when several domains are present */
const RING_ORDER = [
  "research",
  "product",
  "brand",
  "design",
  "social",
  "email",
  "engineering",
  "eng",
  "review",
];

function isEngaged(signal: SignalState) {
  return signal === "active" || signal === "revision" || signal === "done";
}

function shortArtifact(name: string, canvas = false) {
  const base = name.replace(/\.[^.]+$/, "");
  const max = canvas ? 28 : 16;
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
}

function dedupeFlows(flows: DataFlowEdge[]): DataFlowEdge[] {
  const best = new Map<string, DataFlowEdge>();
  for (const f of flows) {
    const key = `${f.kind || "handoff"}:${f.from}->${f.to}`;
    const prev = best.get(key);
    if (!prev || Number(f.active) > Number(prev.active) || f.at >= prev.at) {
      best.set(key, f);
    }
  }
  return [...best.values()];
}

/** Place mediator in the center; arrange engaged satellites evenly on a ring (% of hub). */
function layoutPositions(nodeIds: string[], canvas: boolean): Record<string, Pt> {
  const cx = 50;
  const cy = canvas ? 50 : 48;
  const pos: Record<string, Pt> = { mediator: { x: cx, y: cy } };
  if (!nodeIds.length) return pos;

  const radius = canvas
    ? nodeIds.length <= 3
      ? 34
      : 38
    : nodeIds.length <= 3
      ? 30
      : 33;

  const sorted = [...nodeIds].sort((a, b) => {
    const ia = RING_ORDER.indexOf(a);
    const ib = RING_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  sorted.forEach((id, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / sorted.length;
    pos[id] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
  return pos;
}

/**
 * Industry pattern (React Flow / CurvedArrow / SO):
 * Map a DOM bubble into SVG-local pixels via getBoundingClientRect deltas.
 * No viewBox guessing — SVG coords === CSS pixels of the overlay.
 */
function measureBubble(el: HTMLElement | null, svgEl: SVGSVGElement | null): BubbleGeom | null {
  if (!el || !svgEl) return null;
  const br = el.getBoundingClientRect();
  const sr = svgEl.getBoundingClientRect();
  if (br.width < 1 || br.height < 1 || sr.width < 1) return null;
  return {
    cx: br.left - sr.left + br.width / 2,
    cy: br.top - sr.top + br.height / 2,
    r: Math.min(br.width, br.height) / 2,
  };
}

function rimPoint(from: BubbleGeom, to: BubbleGeom, inset = 0.5): Pt {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const len = Math.hypot(dx, dy) || 1;
  const reach = Math.max(from.r - inset, 0);
  return {
    x: from.cx + (dx / len) * reach,
    y: from.cy + (dy / len) * reach,
  };
}

function flowPathPx(
  geoms: Record<string, BubbleGeom>,
  fromId: string,
  toId: string,
  lane: number,
): { d: string; labelAt: Pt } | null {
  const a0 = geoms[fromId];
  const b0 = geoms[toId];
  if (!a0 || !b0) return null;

  const a = rimPoint(a0, b0);
  const b = rimPoint(b0, a0);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  // Fan lanes left/right so parallel hub edges don't stack
  const side = lane % 2 === 0 ? 1 : -1;
  const magnitude = 16 + Math.floor(lane / 2) * 18;
  const bend = side * magnitude;

  const mx = (a.x + b.x) / 2 + nx * bend;
  const my = (a.y + b.y) / 2 + ny * bend;

  return {
    d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
    labelAt: { x: mx, y: my },
  };
}

interface Props {
  agents: DomainAgentNode[];
  revisionLoop?: RevisionLoop;
  dataFlows?: DataFlowEdge[];
  variant?: "compact" | "canvas";
  /** Highlight a single exchange path in canvas mode */
  focusFlowId?: string | null;
}

export function OrchestratorHub({
  agents,
  revisionLoop,
  dataFlows = [],
  variant = "compact",
  focusFlowId = null,
}: Props) {
  const canvas = variant === "canvas";
  const uid = canvas ? "canvas" : "compact";
  const hubRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const bubbleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [geoms, setGeoms] = useState<Record<string, BubbleGeom>>({});

  const { visibleAgents, pos, activeFlows, quietFlows, exchangeLines, showRevision } = useMemo(() => {
    const flows = dedupeFlows(dataFlows);
    const touched = new Set<string>();
    for (const f of flows) {
      if (f.from !== "mediator") touched.add(f.from);
      if (f.to !== "mediator") touched.add(f.to);
    }
    if (revisionLoop) {
      touched.add(revisionLoop.from);
      touched.add(revisionLoop.to);
    }

    // Mediator is always the hub center — keep it out of the satellite ring.
    const visible = agents.filter(
      (a) => a.id !== "mediator" && (isEngaged(a.signal) || touched.has(a.id)),
    );
    const positions = layoutPositions(
      visible.map((a) => a.id),
      canvas,
    );

    const active = flows
      .filter((f) => f.active)
      .filter((f) => positions[f.from] && positions[f.to])
      .sort((a, b) => b.at - a.at);

    const quiet = flows
      .filter((f) => !f.active)
      .filter((f) => positions[f.from] && positions[f.to])
      .sort((a, b) => b.at - a.at)
      .slice(0, canvas ? 4 : 2);

    const lines = active.slice(0, canvas ? 3 : 2).map((f) => {
      const art = f.artifacts[0] ? shortArtifact(f.artifacts[0], canvas) : "signal";
      const from = LABELS[f.from] || f.from;
      const to = LABELS[f.to] || f.to;
      return `${from} → ${to}: ${art}`;
    });

    const revCovered = Boolean(
      revisionLoop &&
        active.some(
          (f) =>
            f.kind === "revision" &&
            ((f.from === revisionLoop.from && f.to === revisionLoop.to) ||
              (f.from === revisionLoop.to && f.to === revisionLoop.from)),
        ),
    );

    return {
      visibleAgents: visible,
      pos: positions,
      activeFlows: active,
      quietFlows: quiet,
      exchangeLines: lines,
      showRevision: Boolean(
        revisionLoop && !revCovered && positions[revisionLoop.from] && positions[revisionLoop.to],
      ),
    };
  }, [agents, dataFlows, revisionLoop, canvas]);

  const nodeIds = useMemo(
    () => ["mediator", ...visibleAgents.map((a) => a.id)],
    [visibleAgents],
  );

  const measure = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const next: Record<string, BubbleGeom> = {};
    for (const id of nodeIds) {
      const g = measureBubble(bubbleRefs.current[id], svg);
      if (g) next[id] = g;
    }
    setGeoms((prev) => {
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => {
          const a = prev[k];
          const b = next[k];
          return a && b && Math.abs(a.cx - b.cx) < 0.5 && Math.abs(a.cy - b.cy) < 0.5 && Math.abs(a.r - b.r) < 0.5;
        })
      ) {
        return prev;
      }
      return next;
    });
  }, [nodeIds]);

  useLayoutEffect(() => {
    measure();
    const id = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(id);
  }, [measure, pos, visibleAgents, canvas]);

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });
    ro.observe(hub);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const setBubbleRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      bubbleRefs.current[id] = el;
    },
    [],
  );

  const showFlows = focusFlowId
    ? activeFlows
        .filter((f) => f.id === focusFlowId)
        .concat(dataFlows.filter((f) => f.id === focusFlowId && !activeFlows.some((a) => a.id === f.id)))
    : activeFlows.slice(0, canvas ? 5 : 2);

  const showQuiet = focusFlowId ? [] : quietFlows.slice(0, canvas ? 4 : 1);
  const empty = visibleAgents.length === 0 && showFlows.length === 0;
  const ready = Object.keys(geoms).length > 0;

  return (
    <>
      <section className="sr-only" aria-labelledby={`orchestrator-summary-${uid}`}>
        <h3 id={`orchestrator-summary-${uid}`}>Orchestrator status</h3>
        <p>
          Mediator coordinating {visibleAgents.length} domain agents with {activeFlows.length} active
          handoff{activeFlows.length === 1 ? "" : "s"}.
        </p>
        <ul>
          {visibleAgents.map((agent) => (
            <li key={agent.id}>
              {agent.label}: {agent.signal}. {agent.detail}
            </li>
          ))}
        </ul>
      </section>
      <div
        ref={hubRef}
        className={`hub hub-desktop ${canvas ? "is-canvas" : ""}`}
        aria-hidden="true"
      >
        {empty ? (
          <div className="hub-empty">
            <p className="hub-empty-title">No exchanges yet</p>
            <p className="hub-empty-copy">Agents appear when they send or receive work in this run.</p>
          </div>
        ) : (
          <>
            {/* Pixel-space SVG overlay — no viewBox, coords match getBoundingClientRect */}
            <svg ref={svgRef} className="hub-svg" width="100%" height="100%" aria-hidden>
              <defs>
                <marker id={`${uid}-rev-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="var(--purple)" />
                </marker>
                <marker id={`${uid}-flow-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="var(--blue)" />
                </marker>
                <marker id={`${uid}-flow-arrow-green`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="var(--green)" />
                </marker>
                <filter id={`${uid}-packet-glow`} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="1.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {ready &&
                showQuiet.map((f, i) => {
                  const route = flowPathPx(geoms, f.from, f.to, i + showFlows.length);
                  if (!route) return null;
                  return (
                    <path
                      key={`quiet-${f.id}`}
                      d={route.d}
                      fill="none"
                      stroke="var(--hub-quiet)"
                      strokeWidth={1.5}
                      strokeDasharray="4 5"
                      opacity={0.35}
                    />
                  );
                })}

              {ready &&
                showFlows.map((f, i) => {
                  const route = flowPathPx(geoms, f.from, f.to, i);
                  if (!route) return null;
                  const isRev = f.kind === "revision";
                  const isUp = f.kind === "to-mediator";
                  const stroke = isRev ? "var(--purple)" : isUp ? "var(--green)" : "var(--blue)";
                  const marker = isRev
                    ? `url(#${uid}-rev-arrow)`
                    : isUp
                      ? `url(#${uid}-flow-arrow-green)`
                      : `url(#${uid}-flow-arrow)`;
                  // Compact card: no on-path labels (chips live outside the diagram)
                  const label =
                    canvas && i === 0 && f.artifacts[0] ? shortArtifact(f.artifacts[0], true) : "";
                  const dur = 2 + (i % 2) * 0.4;
                  const focused = !focusFlowId || focusFlowId === f.id;
                  const labelW = Math.min(label.length * 7.2 + 12, 160);

                  return (
                    <g key={`active-${f.id}`} className="flow-exchange" opacity={focused ? 1 : 0.12}>
                      <path
                        d={route.d}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={2.25}
                        strokeDasharray="8 5"
                        markerEnd={marker}
                        opacity={0.95}
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="0"
                          to="-26"
                          dur={`${dur}s`}
                          repeatCount="indefinite"
                        />
                      </path>

                      <circle r={4.5} fill={stroke} filter={`url(#${uid}-packet-glow)`}>
                        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={route.d} />
                      </circle>

                      {label && (
                        <g>
                          <rect
                            x={route.labelAt.x - labelW / 2}
                            y={route.labelAt.y - 11}
                            width={labelW}
                            height={18}
                            rx="6"
                            fill="var(--surface)"
                            stroke={stroke}
                            strokeWidth="1"
                            opacity="0.96"
                          />
                          <text
                            x={route.labelAt.x}
                            y={route.labelAt.y + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={11}
                            fill={stroke}
                            fontWeight="700"
                          >
                            {label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {ready &&
                showRevision &&
                revisionLoop &&
                (() => {
                  const route = flowPathPx(geoms, revisionLoop.from, revisionLoop.to, 1);
                  if (!route) return null;
                  return (
                    <g key="revision-arc">
                      <path
                        d={route.d}
                        fill="none"
                        stroke="var(--purple)"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        markerEnd={`url(#${uid}-rev-arrow)`}
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="0"
                          to="-18"
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                      </path>
                      <circle r={4} fill="var(--purple)" filter={`url(#${uid}-packet-glow)`}>
                        <animateMotion dur="2.2s" repeatCount="indefinite" path={route.d} />
                      </circle>
                    </g>
                  );
                })()}

              {ready &&
                visibleAgents
                  .filter((a) => a.signal === "active")
                  .map((a) => {
                    const g = geoms[a.id];
                    if (!g) return null;
                    return (
                      <circle
                        key={`pulse-${a.id}`}
                        cx={g.cx}
                        cy={g.cy}
                        r={g.r + 4}
                        fill="none"
                        stroke="var(--blue)"
                        strokeWidth="1.5"
                        opacity="0.55"
                      >
                        <animate
                          attributeName="r"
                          values={`${g.r + 2};${g.r + 14}`}
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                        <animate attributeName="opacity" values="0.5;0" dur="1.8s" repeatCount="indefinite" />
                      </circle>
                    );
                  })}
            </svg>

            <div
              className="hub-node mediator"
              style={{ left: `${pos.mediator.x}%`, top: `${pos.mediator.y}%` }}
            >
              <div className="bubble" ref={setBubbleRef("mediator")}>
                <IconStar size={canvas ? 26 : 22} />
              </div>
              <div className="name">Mediator</div>
              <div className="detail">
                {activeFlows.length
                  ? `${activeFlows.length} live exchange${activeFlows.length === 1 ? "" : "s"}`
                  : visibleAgents.some((a) => a.signal === "active")
                    ? "Coordinating live"
                    : visibleAgents.some((a) => a.signal === "revision")
                      ? "Resolving doubts"
                      : "Aligning specs"}
              </div>
            </div>

            {visibleAgents.map((agent) => {
              const p = pos[agent.id];
              if (!p) return null;
              const Icon = ICONS[agent.id] || IconBox;
              return (
                <div
                  key={agent.id}
                  className={`hub-node ${agent.signal}`}
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  title={agent.swarmRoles?.join(", ")}
                >
                  <div className="bubble" ref={setBubbleRef(agent.id)}>
                    <Icon size={canvas ? 20 : 18} />
                  </div>
                  <div className="name">{agent.label}</div>
                  <div className="detail">{agent.detail}</div>
                </div>
              );
            })}

          </>
        )}
      </div>

      {revisionLoop && !canvas && showRevision && (
        <div className="revision-summary">
          <span className="revision-summary-label">
            <IconLoop size={13} /> Revision loop
          </span>
          <span>{revisionLoop.outboundLabel}</span>
          <span>{revisionLoop.inboundLabel}</span>
        </div>
      )}

      {!canvas && exchangeLines.length > 0 && (
        <div className="exchange-ticker" aria-live="polite">
          {exchangeLines.map((line) => (
            <span key={line} className="exchange-chip">
              {line}
            </span>
          ))}
        </div>
      )}

      {!canvas && (
        <div className="hub-mobile" aria-hidden="true">
          <div className="hub-mobile-mediator">
            <div className="bubble">
              <IconStar size={22} />
            </div>
            <div>
              <div className="name">Mediator</div>
              <div className="detail">
                {activeFlows.length
                  ? `${activeFlows.length} live handoff${activeFlows.length === 1 ? "" : "s"}`
                  : visibleAgents.length
                    ? "Coordinating"
                    : "Waiting for exchanges"}
              </div>
            </div>
          </div>

          {revisionLoop && showRevision && (
            <div className="revision-banner" style={{ gridColumn: "1 / -1" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <IconLoop size={14} /> Revision · {revisionLoop.from} ↔ {revisionLoop.to}
              </span>
              <span className="sub">{revisionLoop.outboundLabel}</span>
              <span className="sub">{revisionLoop.inboundLabel}</span>
            </div>
          )}

          {activeFlows.length > 0 && (
            <div className="revision-banner exchange-mobile" style={{ gridColumn: "1 / -1" }}>
              {activeFlows.slice(0, 4).map((f) => (
                <span key={f.id} className="sub">
                  {LABELS[f.from] || f.from} → {LABELS[f.to] || f.to}
                  {f.artifacts[0] ? `: ${shortArtifact(f.artifacts[0])}` : ""}
                </span>
              ))}
            </div>
          )}

          {visibleAgents.length === 0 ? (
            <div className="hub-mobile-empty" style={{ gridColumn: "1 / -1" }}>
              Agents appear when they exchange work in this run.
            </div>
          ) : (
            visibleAgents.map((agent) => {
              const Icon = ICONS[agent.id] || IconBox;
              return (
                <div key={agent.id} className={`hub-mobile-agent ${agent.signal}`}>
                  <div className="bubble">
                    <Icon size={16} />
                  </div>
                  <div>
                    <div className="name">{agent.label}</div>
                    <div className="detail">{agent.detail}</div>
                    <div className="signal">{agent.signal}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
