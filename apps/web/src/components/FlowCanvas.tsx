import { useEffect, useId, useMemo, useState } from "react";
import type { DataFlowEdge, DomainAgentNode, RevisionLoop } from "@teamvinsible/shared";
import { Button, Tag } from "antd";
import { OrchestratorHub } from "./OrchestratorHub";
import { IconClose } from "./icons";

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

function kindLabel(kind?: DataFlowEdge["kind"]) {
  if (kind === "revision") return "Revision";
  if (kind === "to-mediator") return "To mediator";
  if (kind === "from-mediator") return "From mediator";
  return "Handoff";
}

function kindColor(kind?: DataFlowEdge["kind"]) {
  if (kind === "revision") return "purple";
  if (kind === "to-mediator") return "success";
  if (kind === "from-mediator") return "processing";
  return "default";
}

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  live?: boolean;
  agents: DomainAgentNode[];
  revisionLoop?: RevisionLoop;
  dataFlows?: DataFlowEdge[];
}

export function FlowCanvas({
  open,
  onClose,
  title = "Coordination flow",
  live,
  agents,
  revisionLoop,
  dataFlows = [],
}: Props) {
  const titleId = useId();
  const [focusFlowId, setFocusFlowId] = useState<string | null>(null);

  const sortedFlows = useMemo(() => {
    return [...dataFlows].sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at);
  }, [dataFlows]);

  const activeCount = dataFlows.filter((f) => f.active).length;

  useEffect(() => {
    if (!open) {
      setFocusFlowId(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="flow-canvas-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="flow-canvas-bar">
        <div className="flow-canvas-bar-copy">
          <p className="flow-canvas-kicker">Canvas</p>
          <h2 id={titleId}>{title}</h2>
          <p className="muted">
            {activeCount > 0
              ? `${activeCount} live exchange${activeCount === 1 ? "" : "s"} · click a handoff to focus`
              : "Agent signals and artifact handoffs"}
          </p>
        </div>
        <div className="flow-canvas-bar-actions">
          {live && (
            <span className="orch-active">
              <span className="live-dot" /> Live
            </span>
          )}
          <Button type="default" onClick={onClose} icon={<IconClose size={14} />}>
            Close
          </Button>
        </div>
      </header>

      <div className="flow-canvas-body">
        <div className="flow-canvas-stage card">
          <OrchestratorHub
            variant="canvas"
            agents={agents}
            revisionLoop={revisionLoop}
            dataFlows={dataFlows}
            focusFlowId={focusFlowId}
          />
          <div className="flow-canvas-legend">
            <span>
              <i className="leg-line" /> Active / done
            </span>
            <span className="leg-swatch is-blue" /> Handoff
            <span className="leg-swatch is-green" /> To mediator
            <span className="leg-swatch is-purple" /> Revision
          </div>
        </div>

        <aside className="flow-canvas-rail card">
          <div className="flow-canvas-rail-head">
            <h3>Data movement</h3>
            <span className="muted">{sortedFlows.length} exchanges</span>
          </div>

          {sortedFlows.length === 0 ? (
            <p className="muted empty-pane">No artifact exchanges yet.</p>
          ) : (
            <ul className="flow-canvas-list">
              {sortedFlows.map((f) => {
                const from = LABELS[f.from] || f.from;
                const to = LABELS[f.to] || f.to;
                const active = focusFlowId === f.id;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      className={`flow-canvas-item ${f.active ? "is-live" : ""} ${active ? "is-focused" : ""}`}
                      onClick={() => setFocusFlowId((cur) => (cur === f.id ? null : f.id))}
                    >
                      <div className="flow-canvas-item-top">
                        <span className="flow-route" title={`${from} → ${to}`}>
                          {from} → {to}
                        </span>
                        <div className="flow-canvas-item-meta">
                          {f.active && <span className="live-badge">Live</span>}
                          <Tag color={kindColor(f.kind)}>{kindLabel(f.kind)}</Tag>
                        </div>
                      </div>
                      <div className="flow-canvas-item-arts">
                        {(f.artifacts.length ? f.artifacts : ["signal"]).map((a) => (
                          <span key={a} className="flow-art-chip" title={a}>
                            {a}
                          </span>
                        ))}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {revisionLoop && (
            <div className="flow-canvas-revision">
              <h4 className="section-label">Revision loop</h4>
              <p>
                {(LABELS[revisionLoop.from] || revisionLoop.from)} ↔{" "}
                {(LABELS[revisionLoop.to] || revisionLoop.to)}
              </p>
              <p className="muted">{revisionLoop.outboundLabel}</p>
              <p className="muted">{revisionLoop.inboundLabel}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
