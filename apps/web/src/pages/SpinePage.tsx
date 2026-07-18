import { Button, Select } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  DecisionItem,
  SpecCard,
  SpecStatus,
  SpineSnapshot,
  SpineStage,
} from "@teamvinsible/shared";
import { fetchSpine } from "../api";
import { DetailModal } from "../components/DetailModal";
import { OrchestratorHub } from "../components/OrchestratorHub";
import { SegmentedTabs, TabExpandButton } from "../components/SegmentedTabs";
import {
  IconCheck,
  IconChevron,
  IconDoc,
  IconEye,
  IconLoop,
  IconPlus,
  IconQuestion,
  IconScales,
  SPEC_ICONS,
} from "../components/icons";

const STAGES: { key: SpineStage; label: string; num: number }[] = [
  { key: "drafting", label: "Drafting", num: 1 },
  { key: "cross-review", label: "Cross-review", num: 2 },
  { key: "consolidating", label: "Consolidating", num: 3 },
  { key: "ready", label: "Ready", num: 4 },
];

type SideTab = "specs" | "decisions" | "health";
type BottomTab = "activity" | "next" | "flows";

type ModalKind =
  | { type: "brief" }
  | { type: "orchestrator" }
  | { type: "specs" }
  | { type: "spec"; id: string }
  | { type: "activity" }
  | { type: "health" }
  | { type: "next" }
  | { type: "decisions" }
  | { type: "decision"; id: string };

function formatStatus(status: string) {
  return status.replace(/-/g, " ");
}

function specBadge(status: SpecStatus) {
  if (status === "ready") return { label: "Approved", cls: "approved" };
  if (status === "needs-attention") return { label: "Attention", cls: "attention" };
  if (status === "cross-review") return { label: "Review", cls: "review" };
  return { label: "Editing", cls: "editing" };
}

function decisionIcon(kind: DecisionItem["kind"]) {
  if (kind === "policy") return IconScales;
  if (kind === "review") return IconEye;
  return IconQuestion;
}

function decisionStatusLabel(status: DecisionItem["status"]) {
  if (status === "accepted") return "Accepted";
  if (status === "reviewed") return "Reviewed";
  if (status === "blocked") return "Blocked";
  return "Open";
}

export function SpinePage() {
  const { project } = useParams();
  const navigate = useNavigate();
  const [spine, setSpine] = useState<SpineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("specs");
  const [bottomTab, setBottomTab] = useState<BottomTab>("activity");
  const closeModal = useCallback(() => setModal(null), []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSpine(project)
        .then((data) => {
          if (!alive) return;
          setSpine(data);
          setError(null);
          if (!project && data.project?.id) {
            navigate(`/spine/${encodeURIComponent(data.project.id)}`, { replace: true });
          }
        })
        .catch((err: Error) => {
          if (alive) setError(err.message);
        });

    load();
    const id = window.setInterval(load, 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [project, navigate]);

  if (error && !spine) {
    return (
      <div className="card panel-block">
        <p>Could not reach the Coordination Spine API.</p>
        <p className="muted">{error}</p>
      </div>
    );
  }

  if (!spine) {
    return <div className="card panel-block muted">Connecting to swarm…</div>;
  }

  if (spine.empty || !spine.project) {
    return (
      <div className="fade-in empty-spine">
        <div className="card panel-block" style={{ maxWidth: 640, margin: "40px auto" }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>No live coordination yet</h2>
          <p className="muted">{spine.message}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <Link to="/intake">
              <Button type="primary">New brief</Button>
            </Link>
            {!spine.swarmOnline && (
              <span className="muted" style={{ alignSelf: "center", fontSize: 13 }}>
                Start swarm: <code>npm run dev:swarm</code>
              </span>
            )}
          </div>
          {spine.projects.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)" }}>
                Existing projects
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                {spine.projects.map((p) => (
                  <li key={p.name} style={{ marginBottom: 6 }}>
                    <Link to={`/spine/${encodeURIComponent(p.name)}`}>{p.name}</Link>
                    <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {p.status}
                      {p.phase ? ` · ${p.phase}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  const stageIndex = STAGES.findIndex((s) => s.key === spine.project!.stage);
  const activeFlows = spine.dataFlows?.filter((f) => f.active) || [];
  const activeSpec =
    spine.specs.find((s) => s.id === spine.activeSpecId) || spine.specs[0] || null;
  const otherSpecs = activeSpec ? spine.specs.filter((s) => s.id !== activeSpec.id).slice(0, 3) : [];
  const previewDecisions =
    (spine.decisions?.length || 0) > 0
      ? spine.decisions!.slice(0, 3)
      : spine.nextUp.slice(0, 3).map(
          (item, i) =>
            ({
              id: item.id,
              number: i + 1,
              title: item.label,
              summary: `${item.owner} · ${item.eta}`,
              status: "open" as const,
              at: item.eta,
              author: item.owner,
              kind: "open" as const,
            }) satisfies DecisionItem,
        );

  const modalSpec: SpecCard | null =
    modal?.type === "spec" ? spine.specs.find((s) => s.id === modal.id) || null : null;
  const modalDecision: DecisionItem | null =
    modal?.type === "decision"
      ? spine.decisions?.find((d) => d.id === modal.id) ||
        previewDecisions.find((d) => d.id === modal.id) ||
        null
      : null;

  return (
    <div className="fade-in spine-bento">
      <div className="card brief-row is-collapsed tile-clickable">
        <button type="button" className="brief-toggle" onClick={() => setModal({ type: "brief" })}>
          <span className="brief-label">Brief</span>
          <span className="brief-text is-clamped">{spine.project.brief}</span>
          <span className="tile-hint">Details</span>
          <IconChevron size={16} className="brief-chevron" aria-hidden />
        </button>
        <div className="brief-actions" onClick={(e) => e.stopPropagation()}>
          <Button type="default" size="small" icon={<IconPlus size={14} />}>
            <span className="stage-label-full">Add context</span>
            <span className="stage-label-short">Context</span>
          </Button>
          {spine.projects.length > 1 && (
            <Select
              className="project-select-antd"
              size="small"
              value={spine.project.id}
              onChange={(id) => navigate(`/spine/${encodeURIComponent(id)}`)}
              aria-label="Select project"
              options={spine.projects.map((p) => ({
                value: p.name,
                label: `${p.name} (${p.status})`,
              }))}
              popupMatchSelectWidth={false}
            />
          )}
          <div className="stage-steps" role="list" aria-label="Project stages">
            {STAGES.map((s, i) => {
              const cls = i < stageIndex ? "done" : i === stageIndex ? "active" : "";
              const short =
                s.key === "cross-review" ? "Review" : s.key === "consolidating" ? "Merge" : s.label;
              return (
                <div key={s.key} className={`stage-step ${cls}`} role="listitem">
                  <span className="n">{i < stageIndex ? "✓" : s.num}</span>
                  <span className="stage-label-full">{s.label}</span>
                  <span className="stage-label-short">{short}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="spine-layout">
        <section
          className="card orch tile-clickable"
          role="button"
          tabIndex={0}
          onClick={() => setModal({ type: "orchestrator" })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setModal({ type: "orchestrator" });
            }
          }}
        >
          <div className="orch-head">
            <div>
              <p className="orch-kicker">Orchestrator</p>
              <h2 className="orch-title">
                Mediator coordinating {spine.agents.length} domain agents
              </h2>
            </div>
            <div className="orch-active">
              {spine.live ? (
                <>
                  <span className="live-dot" />
                  Live · {spine.project.status}
                  {activeFlows.length > 0
                    ? ` · ${activeFlows.length} handoff${activeFlows.length === 1 ? "" : "s"}`
                    : ""}
                </>
              ) : (
                <span className="muted">{spine.project.status}</span>
              )}
            </div>
          </div>

          <OrchestratorHub
            agents={spine.agents}
            revisionLoop={spine.revisionLoop}
            dataFlows={spine.dataFlows}
          />

          <div className="orch-legend">
            <span>
              <i className="leg-line" /> Live agent signals
            </span>
            <span>
              <i className="leg-line dash" /> Standby
            </span>
            <span>
              <span className="leg-loop">
                <IconLoop size={14} />
              </span>
              Artifact exchange
            </span>
            <span className="tile-hint">Click for details</span>
          </div>
        </section>

        <aside className="card specs-panel side-panel">
          <SegmentedTabs
            value={sideTab}
            onChange={setSideTab}
            tabs={[
              { id: "specs", label: "Specs", count: spine.specs.length || undefined },
              {
                id: "decisions",
                label: "Decisions",
                count: (spine.decisions?.length || previewDecisions.length) || undefined,
              },
              { id: "health", label: "Health" },
            ]}
            trailing={
              <TabExpandButton
                onClick={() =>
                  setModal({
                    type: sideTab === "specs" ? "specs" : sideTab === "decisions" ? "decisions" : "health",
                  })
                }
              />
            }
          />

          <div className="tab-pane">
            {sideTab === "specs" && (
              !activeSpec ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  Specs appear here as agents write artifacts.
                </p>
              ) : (
                <div className="specs-display">
                  <article
                    className="spec-preview tile-clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => setModal({ type: "spec", id: activeSpec.id })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setModal({ type: "spec", id: activeSpec.id });
                      }
                    }}
                  >
                    <div className="spec-preview-toolbar">
                      <div className="spec-preview-toolbar-left">
                        <IconDoc size={14} />
                        <strong>{activeSpec.title}</strong>
                        <span className={`spec-badge ${specBadge(activeSpec.status).cls}`}>
                          {specBadge(activeSpec.status).label.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="spec-preview-meta">
                      <span>{activeSpec.owner}</span>
                      <span>{activeSpec.updatedAt}</span>
                    </div>
                    <div className="spec-preview-body">
                      <h4>{activeSpec.title}</h4>
                      <p className="spec-preview-lead">{activeSpec.summary}</p>
                    </div>
                  </article>
                  {otherSpecs.length > 0 && (
                    <div className="specs-rail">
                      {otherSpecs.map((spec) => {
                        const Icon = SPEC_ICONS[spec.id] || IconCheck;
                        const b = specBadge(spec.status);
                        return (
                          <button
                            key={spec.id}
                            type="button"
                            className="spec-rail-item is-button"
                            onClick={() => setModal({ type: "spec", id: spec.id })}
                          >
                            <span className="spec-icon">
                              <Icon size={14} />
                            </span>
                            <span className="spec-rail-copy">
                              <span className="spec-rail-title">{spec.title}</span>
                              <span className="spec-rail-meta">
                                <span className={`spec-badge ${b.cls}`}>{b.label}</span>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            )}

            {sideTab === "decisions" && (
              previewDecisions.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No open decisions yet.</p>
              ) : (
                <ul className="decision-list">
                  {previewDecisions.map((d) => {
                    const Icon = decisionIcon(d.kind);
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          className={`decision-card status-${d.status} is-button`}
                          onClick={() => setModal({ type: "decision", id: d.id })}
                        >
                          <span className="decision-icon">
                            <Icon size={15} />
                          </span>
                          <div className="decision-body">
                            <div className="decision-title">
                              Decision {d.number} · {d.title}
                            </div>
                            <div className="decision-meta">
                              {d.at} · {d.author}
                            </div>
                          </div>
                          <span className={`decision-status status-${d.status}`}>
                            {decisionStatusLabel(d.status)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}

            {sideTab === "health" && (
              <div
                className="health-body tab-health tile-clickable"
                role="button"
                tabIndex={0}
                onClick={() => setModal({ type: "health" })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setModal({ type: "health" });
                  }
                }}
              >
                <div className="donut" style={{ ["--pct" as string]: `${spine.health.alignedPct}%` }}>
                  <div className="donut-hole">
                    <div>
                      <strong>{spine.health.alignedPct}%</strong>
                      <span>Aligned</span>
                    </div>
                  </div>
                </div>
                <ul className="health-legend">
                  <li>
                    <span className="status-dot aligned" /> Done
                    <span className="count">{spine.health.aligned}</span>
                  </li>
                  <li>
                    <span className="status-dot in-progress" /> Active
                    <span className="count">{spine.health.inProgress}</span>
                  </li>
                  <li>
                    <span className="status-dot attention" /> Attention
                    <span className="count">{spine.health.needsAttention}</span>
                  </li>
                  <li>
                    <span className="status-dot queued" /> Blocked
                    <span className="count">{spine.health.blocked}</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="card panel-block bottom-panel">
        <SegmentedTabs
          value={bottomTab}
          onChange={setBottomTab}
          tabs={[
            {
              id: "activity",
              label: "Activity",
              count: spine.activity.length || undefined,
              badge: spine.live ? <span className="seg-live-dot" aria-label="Live" /> : undefined,
            },
            { id: "next", label: "Next up", count: spine.nextUp.length || undefined },
            {
              id: "flows",
              label: "Exchanges",
              count: spine.dataFlows?.length || undefined,
            },
          ]}
          trailing={
            <TabExpandButton
              onClick={() =>
                setModal({
                  type:
                    bottomTab === "activity"
                      ? "activity"
                      : bottomTab === "flows"
                        ? "orchestrator"
                        : "next",
                })
              }
            />
          }
        />

        <div className="tab-pane">
          {bottomTab === "activity" && (
            spine.activity.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Waiting for agent activity…</p>
            ) : (
              <ul className="activity-list is-dense">
                {spine.activity.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <time>{item.at}</time>
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            )
          )}

          {bottomTab === "next" && (
            spine.nextUp.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>No pending phases.</p>
            ) : (
              <ul className="next-compact">
                {spine.nextUp.map((item) => (
                  <li key={item.id}>
                    <span className="next-compact-label">{item.label}</span>
                    <span className="muted">
                      {item.owner} · {item.eta}
                    </span>
                  </li>
                ))}
              </ul>
            )
          )}

          {bottomTab === "flows" && (
            (spine.dataFlows?.length || 0) === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>No artifact exchanges yet.</p>
            ) : (
              <ul className="flow-compact">
                {spine.dataFlows.slice(0, 8).map((f) => (
                  <li key={f.id} className={f.active ? "is-active" : ""}>
                    <span className="flow-route">
                      {f.from} → {f.to}
                    </span>
                    <span className="muted">{f.artifacts[0] || "signal"}</span>
                    {f.active && <span className="live-badge">Live</span>}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </section>

      {/* ——— Detail modals ——— */}
      <DetailModal
        open={modal?.type === "brief"}
        title="Project brief"
        subtitle={spine.project.title}
        onClose={closeModal}
      >
        <p className="modal-prose">{spine.project.brief}</p>
        <dl className="modal-meta-grid">
          <div>
            <dt>Status</dt>
            <dd>{formatStatus(spine.project.status)}</dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>{spine.project.stage}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{spine.project.updatedAt}</dd>
          </div>
        </dl>
      </DetailModal>

      <DetailModal
        open={modal?.type === "orchestrator"}
        title="Orchestrator exchanges"
        subtitle={`${spine.agents.length} agents · ${activeFlows.length} live handoffs`}
        onClose={closeModal}
        wide
      >
        <h3 className="modal-section-title">Domain agents</h3>
        <ul className="modal-agent-list">
          {spine.agents.map((a) => (
            <li key={a.id}>
              <strong>{a.label}</strong>
              <span className={`signal-pill ${a.signal}`}>{a.signal}</span>
              <span className="muted">{a.detail}</span>
            </li>
          ))}
        </ul>
        <h3 className="modal-section-title">Data flows</h3>
        {(spine.dataFlows?.length || 0) === 0 ? (
          <p className="muted">No artifact exchanges recorded yet.</p>
        ) : (
          <ul className="modal-flow-list">
            {spine.dataFlows.map((f) => (
              <li key={f.id} className={f.active ? "is-active" : ""}>
                <span className="flow-route">
                  {f.from} → {f.to}
                </span>
                <span className="muted">{f.artifacts.join(", ") || "signal"}</span>
                {f.active && <span className="live-badge">Live</span>}
              </li>
            ))}
          </ul>
        )}
        {spine.revisionLoop && (
          <>
            <h3 className="modal-section-title">Revision loop</h3>
            <p className="modal-prose">
              {spine.revisionLoop.from} ↔ {spine.revisionLoop.to}
              <br />
              <span className="muted">{spine.revisionLoop.outboundLabel}</span>
              <br />
              <span className="muted">{spine.revisionLoop.inboundLabel}</span>
            </p>
          </>
        )}
      </DetailModal>

      <DetailModal
        open={modal?.type === "specs" || modal?.type === "spec"}
        title={modalSpec ? modalSpec.title : "Specification documents"}
        subtitle={
          modalSpec
            ? `${modalSpec.owner} · ${formatStatus(modalSpec.status)}`
            : `${spine.specs.length} artifacts`
        }
        onClose={closeModal}
        wide
      >
        {modalSpec ? (
          <div className="modal-spec-detail">
            <span className={`spec-badge ${specBadge(modalSpec.status).cls}`}>
              {specBadge(modalSpec.status).label}
            </span>
            <p className="modal-prose">{modalSpec.summary}</p>
            {modalSpec.path && <p className="spec-preview-path">{modalSpec.path}</p>}
            <p className="muted">Updated {modalSpec.updatedAt}</p>
            <div className="modal-actions">
              <Link to={`/files/${spine.project.id}?spec=${encodeURIComponent(modalSpec.id)}`} onClick={closeModal}>
                <Button type="primary">Open in Files</Button>
              </Link>
              <Button type="text" onClick={() => setModal({ type: "specs" })}>
                All specs
              </Button>
            </div>
          </div>
        ) : spine.specs.length === 0 ? (
          <p className="muted">No specs produced yet for this run.</p>
        ) : (
          <ul className="modal-spec-list">
            {spine.specs.map((spec) => {
              const b = specBadge(spec.status);
              return (
                <li key={spec.id}>
                  <button type="button" className="modal-spec-row" onClick={() => setModal({ type: "spec", id: spec.id })}>
                    <div>
                      <strong>{spec.title}</strong>
                      <div className="muted">{spec.summary}</div>
                    </div>
                    <span className={`spec-badge ${b.cls}`}>{b.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DetailModal>

      <DetailModal
        open={modal?.type === "activity"}
        title="Activity log"
        subtitle={spine.live ? "Live stream" : "Recent events"}
        onClose={closeModal}
        wide
      >
        {spine.activity.length === 0 ? (
          <p className="muted">Waiting for agent activity…</p>
        ) : (
          <ul className="modal-activity-list">
            {spine.activity.map((item) => (
              <li key={item.id}>
                <time>{item.at}</time>
                <div>
                  <div>{item.message}</div>
                  {(item.agent || item.phase) && (
                    <div className="muted">
                      {[item.agent, item.phase].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailModal>

      <DetailModal
        open={modal?.type === "health"}
        title="Coordination health"
        subtitle={`${spine.health.alignedPct}% aligned`}
        onClose={closeModal}
      >
        <div className="health-body modal-health">
          <div className="donut" style={{ ["--pct" as string]: `${spine.health.alignedPct}%` }}>
            <div className="donut-hole">
              <div>
                <strong>{spine.health.alignedPct}%</strong>
                <span>Aligned</span>
              </div>
            </div>
          </div>
          <ul className="health-legend">
            <li>
              <span className="status-dot aligned" /> Phases done
              <span className="count">{spine.health.aligned}</span>
            </li>
            <li>
              <span className="status-dot in-progress" /> In progress
              <span className="count">{spine.health.inProgress}</span>
            </li>
            <li>
              <span className="status-dot attention" /> Needs attention
              <span className="count">{spine.health.needsAttention}</span>
            </li>
            <li>
              <span className="status-dot queued" /> Blocked
              <span className="count">{spine.health.blocked}</span>
            </li>
          </ul>
        </div>
      </DetailModal>

      <DetailModal
        open={modal?.type === "next"}
        title="Next up"
        subtitle="Pending phases"
        onClose={closeModal}
      >
        {spine.nextUp.length === 0 ? (
          <p className="muted">No pending phases.</p>
        ) : (
          <ul className="modal-flow-list">
            {spine.nextUp.map((n) => (
              <li key={n.id}>
                <span className="flow-route">{n.label}</span>
                <span className="muted">
                  {n.owner} · {n.eta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailModal>

      <DetailModal
        open={modal?.type === "decisions" || modal?.type === "decision"}
        title={modalDecision ? `Decision ${modalDecision.number}` : "Decisions"}
        subtitle={modalDecision ? modalDecision.title : "All coordination decisions"}
        onClose={closeModal}
        wide
      >
        {modalDecision ? (
          <div>
            <span className={`decision-status status-${modalDecision.status}`}>
              {decisionStatusLabel(modalDecision.status)}
            </span>
            <p className="modal-prose" style={{ marginTop: 12 }}>
              {modalDecision.summary}
            </p>
            <p className="muted">
              {modalDecision.at} · {modalDecision.author}
            </p>
            <Button type="text" style={{ marginTop: 12, paddingInline: 0 }} onClick={() => setModal({ type: "decisions" })}>
              All decisions
            </Button>
          </div>
        ) : (spine.decisions?.length || 0) === 0 && spine.nextUp.length === 0 ? (
          <p className="muted">No decisions yet.</p>
        ) : (
          <ul className="decision-list modal-decision-list">
            {(spine.decisions?.length ? spine.decisions : previewDecisions).map((d) => {
              const Icon = decisionIcon(d.kind);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`decision-card status-${d.status} is-button`}
                    onClick={() => setModal({ type: "decision", id: d.id })}
                  >
                    <span className="decision-icon">
                      <Icon size={15} />
                    </span>
                    <div className="decision-body">
                      <div className="decision-title">
                        Decision {d.number} · {d.title}
                      </div>
                      <div className="decision-meta">
                        {d.at} · {d.author}
                      </div>
                    </div>
                    <span className={`decision-status status-${d.status}`}>
                      {decisionStatusLabel(d.status)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DetailModal>
    </div>
  );
}
