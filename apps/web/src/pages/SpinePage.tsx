import { Button, Select } from "antd";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  ActivityItem,
  DecisionItem,
  DomainAgentNode,
  SpecCard,
  SpineSnapshot,
  SpineStage,
} from "@teamvinsible/shared";
import { fetchSpine, isMockMode, publishProject, skipAgent, startPreview } from "../api";
import { BrandLoader } from "../components/BrandLoader";
import { useBrief } from "../components/BriefProvider";
import { HealthCard } from "../components/HealthCard";
import { OrchestratorHub } from "../components/OrchestratorHub";
import { PreviewCard } from "../components/PreviewCard";
import { PushSidebar } from "../components/PushSidebar";
import { SegmentedTabs, TabExpandButton } from "../components/SegmentedTabs";
import {
  IconChevron,
  IconDoc,
  IconEye,
  IconQuestion,
  IconScales,
  SPEC_ICONS,
} from "../components/icons";
import { formatStatusLabel, specStatusMeta } from "../lib/status";

const STAGES: { key: SpineStage; label: string; num: number }[] = [
  { key: "drafting", label: "Drafting", num: 1 },
  { key: "cross-review", label: "Cross-review", num: 2 },
  { key: "consolidating", label: "Consolidating", num: 3 },
  { key: "ready", label: "Ready", num: 4 },
];

type SideTab = "specs" | "decisions";
type BottomTab = "activity" | "next";
type BentoCardId = "orchestrator" | "artifacts" | "health" | "preview" | "focus" | "activity";

const DEFAULT_BENTO_ORDER: BentoCardId[] = [
  "orchestrator",
  "artifacts",
  "health",
  "preview",
  "focus",
  "activity",
];
const BENTO_ORDER_STORAGE_KEY = "teamvinsible.dashboard.bento-order.v1";

const BENTO_CARD_LABELS: Record<BentoCardId, string> = {
  orchestrator: "Orchestrator",
  artifacts: "Artifacts",
  health: "Coordination health",
  preview: "Sandbox preview",
  focus: "Focus queue",
  activity: "Activity",
};

function readSavedBentoOrder(): BentoCardId[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(BENTO_ORDER_STORAGE_KEY) || "null");
    if (
      Array.isArray(saved) &&
      saved.length === DEFAULT_BENTO_ORDER.length &&
      DEFAULT_BENTO_ORDER.every((id) => saved.includes(id))
    ) {
      return saved as BentoCardId[];
    }
  } catch {
    // Ignore unavailable or stale browser storage and use the product default.
  }
  return DEFAULT_BENTO_ORDER;
}

function swapBentoCards(
  order: BentoCardId[],
  source: BentoCardId,
  target: BentoCardId,
): BentoCardId[] {
  if (source === target) return order;
  const sourceIndex = order.indexOf(source);
  const targetIndex = order.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return order;
  const next = [...order];
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}

function sameBentoOrder(left: BentoCardId[], right: BentoCardId[]) {
  return left.every((id, index) => id === right[index]);
}

interface BentoItemProps {
  id: BentoCardId;
  index: number;
  editing: boolean;
  dragging: boolean;
  dropTarget: boolean;
  children: ReactNode;
  onDragStart: (event: DragEvent<HTMLButtonElement>, id: BentoCardId) => void;
  onDragEnd: () => void;
  onDragEnter: (id: BentoCardId) => void;
  onDrop: (id: BentoCardId) => void;
  onMove: (id: BentoCardId, direction: -1 | 1) => void;
}

function BentoItem({
  id,
  index,
  editing,
  dragging,
  dropTarget,
  children,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
  onMove,
}: BentoItemProps) {
  const label = BENTO_CARD_LABELS[id];
  return (
    <div
      className={`bento-item bento-item-${id}${editing ? " is-editing" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}`}
      style={{ order: index }}
      data-layout-slot={`Position ${index + 1}`}
      onDragEnter={() => editing && onDragEnter(id)}
      onDragOver={(event) => {
        if (editing) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (editing) onDrop(id);
      }}
    >
      {editing ? (
        <div className="bento-card-controls" aria-label={`${label} layout controls`}>
          <button
            type="button"
            className="bento-drag-handle"
            draggable
            onDragStart={(event) => onDragStart(event, id)}
            onDragEnd={onDragEnd}
            aria-label={`Drag ${label} to rearrange`}
            title={`Drag ${label}`}
          >
            <span aria-hidden>⠿</span>
          </button>
          <button
            type="button"
            onClick={() => onMove(id, -1)}
            disabled={index === 0}
            aria-label={`Move ${label} earlier`}
            title="Move earlier"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(id, 1)}
            disabled={index === DEFAULT_BENTO_ORDER.length - 1}
            aria-label={`Move ${label} later`}
            title="Move later"
          >
            ↓
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

type ModalKind =
  | { type: "orchestrator" }
  | { type: "agent"; id: string }
  | { type: "specs" }
  | { type: "spec"; id: string }
  | { type: "activity" }
  | { type: "health" }
  | { type: "next" }
  | { type: "decisions" }
  | { type: "decision"; id: string };

function signalText(signal: DomainAgentNode["signal"]) {
  if (signal === "active") return "Active";
  if (signal === "revision") return "In revision";
  if (signal === "done") return "Done";
  return "Standby";
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

const ACTIVITY_STAGES = [
  { key: "drafting", label: "Drafting" },
  { key: "cross-review", label: "Cross-review" },
  { key: "consolidating", label: "Consolidating" },
  { key: "ready", label: "Ready" },
  { key: "other", label: "Other" },
] as const;

function activityStage(item: ActivityItem): (typeof ACTIVITY_STAGES)[number]["key"] {
  const phase = (item.phase || "").toLowerCase();
  if (phase === "drafting" || /research|product|intake|brief/.test(phase)) return "drafting";
  if (phase === "cross-review" || /design|eng|review|qa/.test(phase)) return "cross-review";
  if (phase === "consolidating" || /lead|mediator|consolidat/.test(phase)) return "consolidating";
  if (phase === "ready" || /preview|publish|deploy|complete/.test(phase)) return "ready";
  return "other";
}

function ActivityTerminal({ items, compact = false }: { items: ActivityItem[]; compact?: boolean }) {
  return (
    <div
      className={`activity-terminal ${compact ? "is-compact" : ""}`}
      role="log"
      aria-label="Agent activity log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="activity-terminal-bar">
        <span className="activity-terminal-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="activity-terminal-title">crew-run.log</span>
        <span className="activity-terminal-live">live</span>
      </div>
      <ol className="activity-terminal-body">
        {items.map((item) => (
          <li key={item.id}>
            <time>{item.at}</time>
            <span className="activity-terminal-prompt">›</span>
            <span className={`activity-terminal-stage stage-${activityStage(item)}`}>
              {activityStage(item)}
            </span>
            <span className="activity-terminal-agent">{(item.agent || "system").toLowerCase()}</span>
            <span className="activity-terminal-message">{item.message}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SpinePage() {
  const { project } = useParams();
  const navigate = useNavigate();
  const { openBrief } = useBrief();
  const [spine, setSpine] = useState<SpineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("specs");
  const [bottomTab, setBottomTab] = useState<BottomTab>("activity");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [bentoOrder, setBentoOrder] = useState<BentoCardId[]>(readSavedBentoOrder);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [draggedCard, setDraggedCard] = useState<BentoCardId | null>(null);
  const [dropTarget, setDropTarget] = useState<BentoCardId | null>(null);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState("");
  const bentoGridRef = useRef<HTMLDivElement>(null);
  const previousBentoRectsRef = useRef<Map<BentoCardId, DOMRect>>(new Map());
  const previousBentoOrderRef = useRef("");
  const closeModal = useCallback(() => setModal(null), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BENTO_ORDER_STORAGE_KEY, JSON.stringify(bentoOrder));
    } catch {
      // The layout still works for this session when browser storage is unavailable.
    }
  }, [bentoOrder]);

  useLayoutEffect(() => {
    const items = bentoGridRef.current?.querySelectorAll<HTMLElement>(".bento-item");
    if (!items) return;

    const orderKey = bentoOrder.join("|");
    const animateCommit =
      Boolean(previousBentoOrderRef.current) && previousBentoOrderRef.current !== orderKey;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextRects = new Map<BentoCardId, DOMRect>();

    items.forEach((item) => {
      const id = DEFAULT_BENTO_ORDER.find((cardId) => item.classList.contains(`bento-item-${cardId}`));
      if (!id) return;
      const nextRect = item.getBoundingClientRect();
      nextRects.set(id, nextRect);
      const previousRect = previousBentoRectsRef.current.get(id);
      if (!animateCommit || reduceMotion || !previousRect) return;
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      item.getAnimations().forEach((animation) => animation.cancel());
      item.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });

    previousBentoRectsRef.current = nextRects;
    previousBentoOrderRef.current = orderKey;
  });

  const moveBentoCard = useCallback((id: BentoCardId, direction: -1 | 1) => {
    setLayoutAnnouncement(
      `${BENTO_CARD_LABELS[id]} moved ${direction < 0 ? "earlier" : "later"}.`,
    );
    setBentoOrder((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, []);

  const startCardDrag = useCallback(
    (event: DragEvent<HTMLButtonElement>, id: BentoCardId) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      setDraggedCard(id);
      setDropTarget(id);
    },
    [],
  );

  const previewCardDrop = useCallback((target: BentoCardId) => {
    setDropTarget(target);
  }, []);

  const finishCardDrag = useCallback(() => {
    setDraggedCard(null);
    setDropTarget(null);
  }, []);

  const dropCard = useCallback(
    (target: BentoCardId) => {
      if (draggedCard) {
        const nextOrder = swapBentoCards(bentoOrder, draggedCard, target);
        if (!sameBentoOrder(nextOrder, bentoOrder)) {
          setBentoOrder(nextOrder);
          setLayoutAnnouncement(
            `${BENTO_CARD_LABELS[draggedCard]} placed in the ${BENTO_CARD_LABELS[target]} position.`,
          );
        } else {
          setLayoutAnnouncement("Layout unchanged.");
        }
      }
      finishCardDrag();
    },
    [bentoOrder, draggedCard, finishCardDrag],
  );

  const resetBentoOrder = useCallback(() => {
    setBentoOrder(DEFAULT_BENTO_ORDER);
    setLayoutAnnouncement("Dashboard cards reset to the default layout.");
  }, []);

  const onOpenPreview = useCallback(async () => {
    if (!spine?.project) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const result = await startPreview(spine.project.id);
      if (!result.ok || !result.previewUrl) {
        setPreviewError(result.message || "Preview unavailable");
      } else {
        setSpine((prev) =>
          prev
            ? {
                ...prev,
                previewUrl: result.previewUrl,
                sandboxId: result.sandboxId,
              }
            : prev,
        );
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewBusy(false);
    }
  }, [spine?.project]);

  const onPublish = useCallback(async () => {
    if (!spine?.project) return;
    setPublishBusy(true);
    setPublishError(null);
    try {
      const result = await publishProject(spine.project.id);
      if (!result.ok) {
        setPublishError(result.message || "Publish failed");
      } else {
        setPublishUrl(result.url);
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishBusy(false);
    }
  }, [spine?.project]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSpine(project)
        .then((data) => {
          if (!alive) return;
          setSpine(data);
          setError(null);
          if (!project && data.project?.id) {
            navigate(`/dashboard/${encodeURIComponent(data.project.id)}`, { replace: true });
          }
        })
        .catch((err: Error) => {
          if (alive) setError(err.message);
        });

    load();
    if (isMockMode()) {
      return () => {
        alive = false;
      };
    }
    const id = window.setInterval(load, 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [project, navigate]);

  if (error && !spine) {
    return (
      <div className="page-state card">
        <h2 className="page-state-title">Could not reach the API</h2>
        <p className="muted">{error}</p>
      </div>
    );
  }

  if (!spine) {
    return (
      <div className="page-state card">
        <BrandLoader label="Connecting to your crew…" />
      </div>
    );
  }

  if (spine.empty || !spine.project) {
    return (
      <div className="fade-in page-state">
        <div className="card page-state-card">
          <h2 className="page-state-title">No live coordination yet</h2>
          <p className="muted">{spine.message}</p>
          <div className="page-state-actions">
            <Button type="primary" onClick={openBrief}>
              New brief
            </Button>
            {!spine.swarmOnline && (
              <span className="muted page-state-hint">
                Start swarm: <code>npm run dev:swarm</code>
              </span>
            )}
          </div>
          {spine.projects.length > 0 && (
            <div className="page-state-list">
              <h3 className="section-label">Existing projects</h3>
              <ul>
                {spine.projects.map((p) => (
                  <li key={p.id || p.name}>
                    <Link to={`/dashboard/${encodeURIComponent(p.id || p.name)}`}>{p.name}</Link>
                    <span className="muted">
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
  const attentionSpecs = spine.specs.filter((spec) => spec.status === "needs-attention");
  const attentionAgents = spine.agents.filter((agent) => agent.signal === "revision");
  const previewDecisions = (spine.decisions || []).slice(0, 4);

  const modalSpec: SpecCard | null =
    modal?.type === "spec" ? spine.specs.find((s) => s.id === modal.id) || null : null;
  const modalDecision: DecisionItem | null =
    modal?.type === "decision"
      ? spine.decisions?.find((d) => d.id === modal.id) || null
      : null;
  const modalAgent: DomainAgentNode | null =
    modal?.type === "agent" ? spine.agents.find((a) => a.id === modal.id) || null : null;
  const bentoItemProps = (id: BentoCardId): Omit<BentoItemProps, "children"> => ({
    id,
    index: bentoOrder.indexOf(id),
    editing: layoutEditing,
    dragging: draggedCard === id,
    dropTarget: Boolean(draggedCard && dropTarget === id && draggedCard !== id),
    onDragStart: startCardDrag,
    onDragEnd: finishCardDrag,
    onDragEnter: previewCardDrop,
    onDrop: dropCard,
    onMove: moveBentoCard,
  });

  return (
    <div className={`spine-shell fade-in ${modal ? "has-sidebar" : ""}`}>
    <div className={`spine-bento${draggedCard ? " is-card-dragging" : ""}`} ref={bentoGridRef}>
      <div className="bento-topline">
      <div className={`card brief-row ${briefOpen ? "is-open" : ""}`}>
        <div className="brief-top">
          <button
            type="button"
            className={`brief-toggle ${briefOpen ? "is-open" : ""}`}
            aria-expanded={briefOpen}
            onClick={() => setBriefOpen((open) => !open)}
          >
            <span className="brief-label">Brief</span>
            {!briefOpen ? (
              <span className="brief-text is-clamped">{spine.project.brief}</span>
            ) : null}
            <IconChevron
              size={14}
              className={`brief-chevron ${briefOpen ? "is-open" : ""}`}
              aria-hidden
            />
          </button>
          <div className="brief-actions">
            {spine.projects.length > 1 && (
              <Select
                className="project-select-antd"
                size="small"
                value={spine.project.id}
                onChange={(id) => navigate(`/dashboard/${encodeURIComponent(id)}`)}
                aria-label="Select project"
                options={spine.projects.map((p) => ({
                  value: p.id || p.name,
                  label: `${p.name} (${p.status})`,
                }))}
                popupMatchSelectWidth={false}
                getPopupContainer={(node) => node.parentElement || document.body}
              />
            )}
            <div className="stage-steps" role="list" aria-label="Project stages">
              {STAGES.map((s, i) => {
                const cls = i < stageIndex ? "done" : i === stageIndex ? "active" : "";
                const short =
                  s.key === "cross-review"
                    ? "Review"
                    : s.key === "consolidating"
                      ? "Merge"
                      : s.label;
                const isReadyDone = s.key === "ready" && (cls === "done" || cls === "active");
                const previewHref = isReadyDone && spine.previewUrl ? spine.previewUrl : undefined;
                return (
                  <div
                    key={s.key}
                    className={`stage-step ${cls}${previewHref ? " is-linked" : ""}`}
                    role="listitem"
                  >
                    <span className="n">{i < stageIndex ? "✓" : s.num}</span>
                    {previewHref ? (
                      <a
                        href={previewHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="stage-label-full stage-open-link"
                      >
                        {s.label} ↗
                      </a>
                    ) : (
                      <span className="stage-label-full">{s.label}</span>
                    )}
                    <span className="stage-label-short">{short}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <span className="sr-only" aria-live="polite">{layoutAnnouncement}</span>

        {briefOpen ? (
          <div className="brief-expanded">
            <p className="brief-text">{spine.project.brief}</p>
            <dl className="brief-meta">
              <div>
                <dt>Status</dt>
                <dd>{formatStatusLabel(spine.project.status)}</dd>
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
          </div>
        ) : null}
      </div>

      <div className="layout-actions">
        <Button
          type={layoutEditing ? "primary" : "default"}
          size="small"
          className="layout-edit-button"
          onClick={() => {
            setLayoutEditing((editing) => !editing);
            finishCardDrag();
          }}
          aria-pressed={layoutEditing}
        >
          {layoutEditing ? "Done" : "Arrange cards"}
        </Button>
        {layoutEditing &&
        bentoOrder.some((id, index) => id !== DEFAULT_BENTO_ORDER[index]) ? (
          <Button type="text" size="small" className="layout-reset-button" onClick={resetBentoOrder}>
            Reset
          </Button>
        ) : null}
      </div>
      </div>

      <BentoItem {...bentoItemProps("orchestrator")}>
        <section className="card orch">
          <div className="orch-head">
            <div>
              <p className="orch-kicker">Orchestrator</p>
              <h2 className="orch-title">
                Mediator coordinating{" "}
                {spine.agents.filter((a) => a.id !== "mediator").length} domain agents
              </h2>
            </div>
            <div className="orch-head-actions">
              <div className="orch-active">
                {spine.live ? (
                  <>
                    <span className="live-dot" />
                    Live · {formatStatusLabel(spine.project.status)}
                  </>
                ) : (
                  <span className="muted">{formatStatusLabel(spine.project.status)}</span>
                )}
              </div>
              <Button type="default" size="small" onClick={() => setModal({ type: "orchestrator" })}>
                Details
              </Button>
            </div>
          </div>

          <OrchestratorHub
            agents={spine.agents}
            revisionLoop={spine.revisionLoop}
            dataFlows={spine.dataFlows}
          />

          <div className="orch-legend">
            <span>
              <i className="leg-line" /> Engaged agents
            </span>
          </div>
        </section>
      </BentoItem>

      <BentoItem {...bentoItemProps("health")}>
            <HealthCard health={spine.health} onOpen={() => setModal({ type: "health" })} />
      </BentoItem>

      <BentoItem {...bentoItemProps("preview")}>
            <PreviewCard
              previewUrl={spine.previewUrl}
              previewError={previewError}
              previewBusy={previewBusy}
              onStartPreview={onOpenPreview}
              publishUrl={publishUrl}
              publishBusy={publishBusy}
              publishError={publishError}
              onPublish={onPublish}
            />
      </BentoItem>

      <BentoItem {...bentoItemProps("artifacts")}>
          <aside className="card specs-panel">
            <SegmentedTabs
              value={sideTab}
              onChange={setSideTab}
              tabs={[
                { id: "specs", label: "Artifacts", count: spine.specs.length || undefined },
                {
                  id: "decisions",
                  label: "Decisions",
                  count: (spine.decisions?.length || 0) || undefined,
                },
              ]}
              trailing={
                <TabExpandButton
                  onClick={() =>
                    setModal({
                      type: sideTab === "specs" ? "specs" : "decisions",
                    })
                  }
                />
              }
            />

            <div className="tab-pane">
              {sideTab === "specs" &&
                (spine.specs.length === 0 ? (
                  <p className="muted empty-pane">Artifacts appear here as agents complete work.</p>
                ) : (
                  <ul className="specs-rail specs-rail-full">
                    {spine.specs.map((spec) => {
                      const Icon = SPEC_ICONS[spec.id] || IconDoc;
                      const b = specStatusMeta(spec.status);
                      return (
                        <li key={spec.id}>
                          <button
                            type="button"
                            className={`spec-rail-item is-button ${
                              modal?.type === "spec" && modal.id === spec.id ? "is-selected" : ""
                            }`}
                            onClick={() => setModal({ type: "spec", id: spec.id })}
                          >
                            <span className="spec-icon">
                              <Icon size={14} />
                            </span>
                            <span className="spec-rail-copy">
                              <span className="spec-rail-title">{spec.title}</span>
                              <span className="spec-rail-meta">
                                <span className={`spec-badge ${b.cls}`}>{b.label}</span>
                                <span className="muted">
                                  {spec.owner}
                                  {spec.updatedAt ? ` · ${spec.updatedAt}` : ""}
                                </span>
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ))}

              {sideTab === "decisions" &&
                (previewDecisions.length === 0 ? (
                  <p className="muted empty-pane">No open decisions yet.</p>
                ) : (
                  <ul className="decision-list">
                    {previewDecisions.map((d) => {
                      const Icon = decisionIcon(d.kind);
                      return (
                        <li key={d.id}>
                          <button
                            type="button"
                            className={`decision-card status-${d.status} is-button ${
                              modal?.type === "decision" && modal.id === d.id ? "is-selected" : ""
                            }`}
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
                ))}
            </div>
          </aside>
      </BentoItem>

      <BentoItem {...bentoItemProps("activity")}>
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
          ]}
          trailing={
            <TabExpandButton
              label="View all"
              onClick={() => {
                setModal({
                  type: bottomTab === "activity" ? "activity" : "next",
                });
              }}
            />
          }
        />

        <div className="tab-pane">
          {bottomTab === "activity" && (
            spine.activity.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Waiting for agent activity…</p>
            ) : (
              <ActivityTerminal items={spine.activity.slice(0, 10)} compact />
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

        </div>
      </section>
      </BentoItem>

      <BentoItem {...bentoItemProps("focus")}>
      <aside className="card panel-block focus-panel" aria-label="Focus queue">
        <div className="focus-panel-head">
          <div>
            <p className="orch-kicker">Focus</p>
            <h3>Needs your attention</h3>
          </div>
          <span className="focus-panel-count">{attentionSpecs.length + attentionAgents.length}</span>
        </div>

        {attentionSpecs.length === 0 && attentionAgents.length === 0 ? (
          <div className="focus-panel-empty">
            <span className="status-dot aligned" />
            No blockers or revision loops.
          </div>
        ) : (
          <ul className="focus-list">
            {attentionSpecs.slice(0, 2).map((spec) => (
              <li key={spec.id}>
                <button type="button" onClick={() => setModal({ type: "spec", id: spec.id })}>
                  <span className="status-dot attention" />
                  <span className="focus-list-copy">
                    <strong>{spec.title}</strong>
                    <span>{spec.owner} · {spec.updatedAt}</span>
                  </span>
                  <span className="focus-list-action">Review</span>
                </button>
              </li>
            ))}
            {attentionAgents.slice(0, 2).map((agent) => (
              <li key={agent.id}>
                <button type="button" onClick={() => setModal({ type: "agent", id: agent.id })}>
                  <span className="status-dot in-progress" />
                  <span className="focus-list-copy">
                    <strong>{agent.label}</strong>
                    <span>{agent.detail}</span>
                  </span>
                  <span className="focus-list-action">Resolve</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button type="link" size="small" className="focus-panel-link" onClick={() => setModal({ type: "health" })}>
          View coordination health
        </Button>
      </aside>
      </BentoItem>
    </div>


      <PushSidebar
        open={Boolean(modal)}
        title={
          modal?.type === "orchestrator"
            ? "Orchestrator details"
            : modal?.type === "agent" && modalAgent
              ? modalAgent.label
              : modal?.type === "spec" && modalSpec
                ? modalSpec.title
                : modal?.type === "specs"
                  ? "Artifacts"
                  : modal?.type === "activity"
                    ? "Activity log"
                    : modal?.type === "health"
                      ? "Coordination health"
                      : modal?.type === "next"
                        ? "Next up"
                        : modal?.type === "decision" && modalDecision
                          ? `Decision ${modalDecision.number}`
                          : modal?.type === "decisions"
                            ? "Decisions"
                            : "Detail"
        }
        subtitle={
          modal?.type === "orchestrator"
            ? `${spine.agents.length} agents`
            : modal?.type === "agent" && modalAgent
              ? `${modalAgent.label} · ${signalText(modalAgent.signal)}`
              : modal?.type === "spec" && modalSpec
                ? `${modalSpec.owner} · ${specStatusMeta(modalSpec.status).label}`
                : modal?.type === "specs"
                  ? `${spine.specs.length} files`
                  : modal?.type === "activity"
                    ? spine.live ? "Live stream" : "Recent events"
                    : modal?.type === "health"
                      ? `${spine.health.alignedPct}% aligned`
                      : modal?.type === "next"
                        ? "Pending phases"
                        : modal?.type === "decision" && modalDecision
                          ? modalDecision.title
                          : modal?.type === "decisions"
                            ? "All coordination decisions"
                            : undefined
        }
        onClose={closeModal}
      >
        {modal?.type === "agent" && modalAgent ? (
          <div className="modal-spec-detail">
            <div className="modal-agent-header">
              <span className={`signal-pill ${modalAgent.signal}`}>{signalText(modalAgent.signal)}</span>
              {spine.live && modalAgent.signal !== "done" ? (
                <Button
                  size="small"
                  danger
                  loading={skipBusy}
                  onClick={async () => {
                    if (!spine.project?.id) return;
                    setSkipBusy(true);
                    try {
                      await skipAgent(spine.project.id, modalAgent.id);
                      closeModal();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setSkipBusy(false);
                    }
                  }}
                >
                  Skip this agent
                </Button>
              ) : null}
            </div>
            <p className="modal-prose">{modalAgent.detail}</p>
            <h3 className="modal-section-title">Responsibilities</h3>
            <ul className="modal-role-list">
              {modalAgent.swarmRoles.map((role) => <li key={role}>{role}</li>)}
            </ul>
          </div>
        ) : null}

        {modal?.type === "orchestrator" ? (
          <>
            <h3 className="modal-section-title">Domain agents</h3>
            <ul className="modal-agent-list">
              {spine.agents.map((agent) => (
                <li key={agent.id}>
                  <button type="button" className="modal-agent-open" onClick={() => setModal({ type: "agent", id: agent.id })}>
                    <span><strong>{agent.label}</strong><small>{agent.detail}</small></span>
                    <span className={`signal-pill ${agent.signal}`}>{signalText(agent.signal)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {spine.revisionLoop ? (
              <>
                <h3 className="modal-section-title">Revision loop</h3>
                <p className="modal-prose">{spine.revisionLoop.outboundLabel} · {spine.revisionLoop.inboundLabel}</p>
              </>
            ) : null}
          </>
        ) : null}

        {(modal?.type === "specs" || modal?.type === "spec") ? (
          modalSpec ? (
            <div className="modal-spec-detail">
              <span className={`spec-badge ${specStatusMeta(modalSpec.status).cls}`}>
                {specStatusMeta(modalSpec.status).label}
              </span>
              <p className="modal-prose">{modalSpec.summary}</p>
              {modalSpec.path ? <p className="spec-preview-path">{modalSpec.path}</p> : null}
              <p className="muted">Updated {modalSpec.updatedAt}</p>
              <Button size="small" onClick={() => setModal({ type: "specs" })}>All artifacts</Button>
            </div>
          ) : (
            <ul className="modal-spec-list">
              {spine.specs.map((spec) => (
                <li key={spec.id}>
                  <button type="button" className="modal-spec-row" onClick={() => setModal({ type: "spec", id: spec.id })}>
                    <span><strong>{spec.title}</strong><small>{spec.owner} · {spec.updatedAt}</small></span>
                    <span className={`spec-badge ${specStatusMeta(spec.status).cls}`}>{specStatusMeta(spec.status).label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {modal?.type === "activity" ? (
          spine.activity.length ? <ActivityTerminal items={spine.activity} /> : <p className="muted">No activity yet.</p>
        ) : null}

        {modal?.type === "health" ? (
          <div className="modal-health-detail">
            <div className="health-body modal-health">
              <strong>{spine.health.alignedPct}% aligned</strong>
              <p className="muted">
                {spine.health.aligned} aligned · {spine.health.inProgress} in progress · {spine.health.needsAttention} need attention
              </p>
            </div>
          </div>
        ) : null}

        {modal?.type === "next" ? (
          spine.nextUp.length ? (
            <ul className="modal-flow-list">
              {spine.nextUp.map((item) => (
                <li key={item.id}><strong>{item.label}</strong><span>{item.owner} · {item.eta}</span></li>
              ))}
            </ul>
          ) : <p className="muted">No pending phases.</p>
        ) : null}

        {(modal?.type === "decisions" || modal?.type === "decision") ? (
          modalDecision ? (
            <div className="modal-spec-detail">
              <span className={`decision-status status-${modalDecision.status}`}>
                {decisionStatusLabel(modalDecision.status)}
              </span>
              <p className="modal-prose">{modalDecision.summary}</p>
              <p className="muted">{modalDecision.at} · {modalDecision.author}</p>
              <Button size="small" onClick={() => setModal({ type: "decisions" })}>All decisions</Button>
            </div>
          ) : (
            <ul className="decision-list modal-decision-list">
              {spine.decisions.map((decision) => (
                <li key={decision.id}>
                  <button type="button" className={`decision-card status-${decision.status} is-button`} onClick={() => setModal({ type: "decision", id: decision.id })}>
                    <span className="decision-body">
                      <strong className="decision-title">Decision {decision.number} · {decision.title}</strong>
                      <span className="decision-meta">{decision.at} · {decision.author}</span>
                    </span>
                    <span className={`decision-status status-${decision.status}`}>{decisionStatusLabel(decision.status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </PushSidebar>
    </div>
  );
}
