import { useMemo } from "react";
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

const POS: Record<string, { x: number; y: number }> = {
  mediator: { x: 50, y: 50 },
  research: { x: 18, y: 28 },
  product: { x: 50, y: 14 },
  brand: { x: 82, y: 28 },
  social: { x: 86, y: 58 },
  email: { x: 68, y: 84 },
  engineering: { x: 32, y: 84 },
  review: { x: 14, y: 58 },
};

const ICONS: Record<string, typeof IconSearch> = {
  research: IconSearch,
  product: IconBox,
  brand: IconPalette,
  social: IconChat,
  email: IconMail,
  engineering: IconCode,
  review: IconCheck,
};

const LABELS: Record<string, string> = {
  mediator: "Mediator",
  research: "Research",
  product: "Product",
  brand: "Brand",
  social: "Social",
  email: "Email",
  engineering: "Engineering",
  review: "Review",
};

function lineStyle(signal: SignalState) {
  if (signal === "active") return { stroke: "var(--blue)", width: 2.4, dash: undefined as string | undefined };
  if (signal === "revision") return { stroke: "var(--purple)", width: 2.1, dash: "5 4" };
  if (signal === "done") return { stroke: "var(--green)", width: 1.8, dash: undefined as string | undefined };
  return { stroke: "var(--standby)", width: 1.5, dash: "3.5 4" };
}

function flowPath(fromId: string, toId: string, index = 0): string | null {
  const a = POS[fromId];
  const b = POS[toId];
  if (!a || !b) return null;
  const bend = (index % 2 === 0 ? 1 : -1) * (4 + (index % 3));
  const mx = (a.x + b.x) / 2 + bend;
  const my = (a.y + b.y) / 2 - 6 + bend * 0.4;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

function shortArtifact(name: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return base.length > 16 ? `${base.slice(0, 14)}…` : base;
}

interface Props {
  agents: DomainAgentNode[];
  revisionLoop?: RevisionLoop;
  dataFlows?: DataFlowEdge[];
}

export function OrchestratorHub({ agents, revisionLoop, dataFlows = [] }: Props) {
  const cx = 50;
  const cy = 50;

  const { activeFlows, quietFlows, exchangeLines } = useMemo(() => {
    const active = dataFlows.filter((f) => f.active);
    const quiet = dataFlows.filter((f) => !f.active).slice(0, 6);
    const lines = active.slice(0, 4).map((f) => {
      const art = f.artifacts[0] ? shortArtifact(f.artifacts[0]) : "signal";
      const from = LABELS[f.from] || f.from;
      const to = LABELS[f.to] || f.to;
      return `${from} → ${to}: ${art}`;
    });
    return { activeFlows: active, quietFlows: quiet, exchangeLines: lines };
  }, [dataFlows]);

  return (
    <>
      <div className="hub hub-desktop" aria-label="Live orchestrator data flow">
        <svg className="hub-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="rev-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--purple)" />
            </marker>
            <marker id="flow-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--blue)" />
            </marker>
            <marker id="flow-arrow-green" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--green)" />
            </marker>
            <filter id="packet-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.35" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Mediator ↔ agent spokes */}
          {agents.map((agent) => {
            const pos = POS[agent.id];
            if (!pos) return null;
            const s = lineStyle(agent.signal);
            const hot = agent.signal === "active" || agent.signal === "revision";
            return (
              <g key={`spoke-${agent.id}`}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={pos.x}
                  y2={pos.y}
                  stroke={s.stroke}
                  strokeWidth={s.width * 0.12}
                  strokeDasharray={s.dash}
                  strokeLinecap="round"
                  opacity={agent.signal === "standby" ? 0.4 : 0.95}
                />
                {hot && (
                  <circle r="0.55" fill={agent.signal === "revision" ? "var(--purple)" : "var(--blue)"} filter="url(#packet-glow)">
                    <animateMotion
                      dur={agent.signal === "revision" ? "2s" : "1.5s"}
                      repeatCount="indefinite"
                      path={`M ${cx} ${cy} L ${pos.x} ${pos.y}`}
                    />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Quiet historical handoffs */}
          {quietFlows.map((f, i) => {
            const d = flowPath(f.from, f.to, i);
            if (!d) return null;
            return (
              <path
                key={`quiet-${f.id}`}
                d={d}
                fill="none"
                stroke="var(--hub-quiet)"
                strokeWidth={0.22}
                strokeDasharray="2 2"
                opacity={0.5}
              />
            );
          })}

          {/* Active data exchanges */}
          {activeFlows.map((f, i) => {
            const d = flowPath(f.from, f.to, i);
            if (!d) return null;
            const isRev = f.kind === "revision";
            const isUp = f.kind === "to-mediator";
            const stroke = isRev ? "var(--purple)" : isUp ? "var(--green)" : "var(--blue)";
            const marker = isRev ? "url(#rev-arrow)" : isUp ? "url(#flow-arrow-green)" : "url(#flow-arrow)";
            const label = f.artifacts[0] ? shortArtifact(f.artifacts[0]) : "";
            const a = POS[f.from];
            const b = POS[f.to];
            const midX = a && b ? (a.x + b.x) / 2 : 50;
            const midY = a && b ? (a.y + b.y) / 2 - 5 : 40;
            const dur = 1.8 + (i % 3) * 0.35;

            return (
              <g key={`active-${f.id}`} className="flow-exchange">
                <path
                  id={`flow-path-${f.id}`}
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={0.42}
                  strokeDasharray="3.2 2.2"
                  markerEnd={marker}
                  opacity={0.9}
                >
                  <animate attributeName="stroke-dashoffset" from="0" to="-18" dur={`${dur}s`} repeatCount="indefinite" />
                </path>

                {/* Traveling packet */}
                <circle r="0.85" fill={stroke} filter="url(#packet-glow)">
                  <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={d} />
                </circle>
                <circle r="0.4" fill="var(--surface)">
                  <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={d} />
                </circle>

                {/* Second staggered packet for busy handoffs */}
                {f.artifacts.length > 1 && (
                  <circle r="0.65" fill={stroke} opacity={0.75}>
                    <animateMotion dur={`${dur}s`} begin="0.7s" repeatCount="indefinite" path={d} />
                  </circle>
                )}

                {label && (
                  <g>
                    <rect
                      x={midX - Math.min(label.length * 0.7, 10)}
                      y={midY - 2.2}
                      width={Math.min(label.length * 1.4, 20)}
                      height={3.2}
                      rx="0.8"
                      fill="var(--surface)"
                      stroke={stroke}
                      strokeWidth="0.15"
                      opacity="0.95"
                    />
                    <text
                      x={midX}
                      y={midY + 0.15}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="2.1"
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

          {revisionLoop && POS[revisionLoop.from] && POS[revisionLoop.to] && (
            <g>
              <path
                d={`M ${POS[revisionLoop.from].x} ${POS[revisionLoop.from].y}
                    Q 72 42 ${POS[revisionLoop.to].x} ${POS[revisionLoop.to].y}`}
                fill="none"
                stroke="var(--purple)"
                strokeWidth={0.38}
                strokeDasharray="2.2 1.6"
                markerEnd="url(#rev-arrow)"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.8s" repeatCount="indefinite" />
              </path>
              <circle r="0.75" fill="var(--purple)" filter="url(#packet-glow)">
                <animateMotion
                  dur="2.2s"
                  repeatCount="indefinite"
                  path={`M ${POS[revisionLoop.from].x} ${POS[revisionLoop.from].y} Q 72 42 ${POS[revisionLoop.to].x} ${POS[revisionLoop.to].y}`}
                />
              </circle>
            </g>
          )}

          {agents
            .filter((a) => a.signal === "active")
            .map((a) => {
              const pos = POS[a.id];
              if (!pos) return null;
              return (
                <circle
                  key={`pulse-${a.id}`}
                  cx={pos.x}
                  cy={pos.y}
                  r="3.2"
                  fill="none"
                  stroke="var(--blue)"
                  strokeWidth="0.35"
                  opacity="0.7"
                >
                  <animate attributeName="r" values="3;6.5" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0" dur="1.6s" repeatCount="indefinite" />
                </circle>
              );
            })}
        </svg>

        <div className="hub-node mediator" style={{ left: "50%", top: "50%" }}>
          <div className="bubble">
            <IconStar size={22} />
          </div>
          <div className="name">Mediator</div>
          <div className="detail">
            {activeFlows.length
              ? `${activeFlows.length} live exchange${activeFlows.length === 1 ? "" : "s"}`
              : agents.some((a) => a.signal === "active")
                ? "Coordinating live"
                : agents.some((a) => a.signal === "revision")
                  ? "Resolving doubts"
                  : "Aligning specs"}
          </div>
        </div>

        {agents.map((agent) => {
          const pos = POS[agent.id];
          if (!pos) return null;
          const Icon = ICONS[agent.id] || IconBox;
          return (
            <div
              key={agent.id}
              className={`hub-node ${agent.signal}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              title={agent.swarmRoles?.join(", ")}
            >
              <div className="bubble">
                <Icon size={18} />
              </div>
              <div className="name">{agent.label}</div>
              <div className="detail">{agent.detail}</div>
            </div>
          );
        })}

        {revisionLoop && (
          <div className="revision-callout" style={{ left: "68%", top: "38%" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconLoop size={12} /> Revision loop
            </span>
            <span className="sub">{revisionLoop.outboundLabel}</span>
            <span className="sub">{revisionLoop.inboundLabel}</span>
          </div>
        )}

        {exchangeLines.length > 0 && (
          <div className="exchange-ticker" aria-live="polite">
            {exchangeLines.map((line) => (
              <span key={line} className="exchange-chip">
                {line}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="hub-mobile" aria-label="Domain agents">
        <div className="hub-mobile-mediator">
          <div className="bubble">
            <IconStar size={22} />
          </div>
          <div>
            <div className="name">Mediator</div>
            <div className="detail">
              {activeFlows.length
                ? `${activeFlows.length} live handoff${activeFlows.length === 1 ? "" : "s"}`
                : "Aligning specs"}
            </div>
          </div>
        </div>

        {revisionLoop && (
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

        {agents.map((agent) => {
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
        })}
      </div>
    </>
  );
}
