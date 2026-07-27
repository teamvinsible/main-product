import { Button, Modal, Select } from "antd";
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
  WorkspaceFileCard,
} from "@teamvinsible/shared";
import { disconnectGitHub, fetchArtifact, fetchGitHubStatus, fetchHealth, fetchSpine, improviseProject, isMockMode, publishProject, pushToGitHub, restartRun, skipAgent, startGitHubConnect, startPreview, stopRun, subscribeSpine, type GitHubStatus } from "../api";
import { BrandLoader } from "../components/BrandLoader";
import { useBrief } from "../components/BriefProvider";
import { FlowCanvas } from "../components/FlowCanvas";
import { HealthCard } from "../components/HealthCard";
import { ArtifactDoc } from "../components/ArtifactDoc";
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
import { formatClockTime, formatRelativeTime } from "../lib/time";
import { celebrateShip } from "../lib/celebrate";

const STAGES: { key: SpineStage; label: string; num: number }[] = [
  { key: "drafting", label: "Strategy & design", num: 1 },
  { key: "cross-review", label: "Architecture & build", num: 2 },
  { key: "consolidating", label: "Quality & DevOps", num: 3 },
  { key: "ready", label: "Launch & growth", num: 4 },
];

type SideTab = "specs" | "files" | "decisions";
type BottomTab = "activity" | "next";
type BentoCardId = "orchestrator" | "artifacts" | "health" | "preview" | "focus" | "activity";

const DEFAULT_BENTO_ORDER: BentoCardId[] = [
  "activity",
  "focus",
  "preview",
  "artifacts",
  "health",
  "orchestrator",
];
/** Pre-rearrange product default — auto-saved copies of this are not user customizations. */
const LEGACY_DEFAULT_BENTO_ORDER: BentoCardId[] = [
  "orchestrator",
  "artifacts",
  "health",
  "preview",
  "focus",
  "activity",
];
const BENTO_ORDER_STORAGE_KEYS = [
  "teamvinsible.dashboard.bento-order.v1",
  "teamvinsible.dashboard.bento-order.v2",
] as const;
const BENTO_ORDER_STORAGE_KEY = BENTO_ORDER_STORAGE_KEYS[0];

const BENTO_CARD_LABELS: Record<BentoCardId, string> = {
  orchestrator: "Orchestrator",
  artifacts: "Artifacts",
  health: "Coordination health",
  preview: "Live app",
  focus: "Focus queue",
  activity: "Activity",
};

function sameBentoOrder(left: BentoCardId[], right: BentoCardId[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function isValidBentoOrder(saved: unknown): saved is BentoCardId[] {
  return (
    Array.isArray(saved) &&
    saved.length === DEFAULT_BENTO_ORDER.length &&
    DEFAULT_BENTO_ORDER.every((id) => saved.includes(id))
  );
}

function isProductDefaultOrder(order: BentoCardId[]) {
  return sameBentoOrder(order, DEFAULT_BENTO_ORDER) || sameBentoOrder(order, LEGACY_DEFAULT_BENTO_ORDER);
}

/** Prefer an explicit user arrangement; otherwise use the current product default. */
function readSavedBentoOrder(): BentoCardId[] {
  try {
    for (const key of BENTO_ORDER_STORAGE_KEYS) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const saved = JSON.parse(raw) as unknown;
      if (!isValidBentoOrder(saved)) continue;
      // Ignore auto-saved copies of a product default so new defaults can roll out.
      if (isProductDefaultOrder(saved)) continue;
      return saved;
    }
  } catch {
    // Ignore unavailable or stale browser storage and use the product default.
  }
  return DEFAULT_BENTO_ORDER;
}

function persistBentoOrder(order: BentoCardId[]) {
  try {
    if (sameBentoOrder(order, DEFAULT_BENTO_ORDER)) {
      for (const key of BENTO_ORDER_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
      return;
    }
    window.localStorage.setItem(BENTO_ORDER_STORAGE_KEY, JSON.stringify(order));
    window.localStorage.removeItem("teamvinsible.dashboard.bento-order.v2");
  } catch {
    // Layout still works for this session when browser storage is unavailable.
  }
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
  | { type: "files" }
  | { type: "file"; id: string }
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

function ActivityFeed({ items, compact = false }: { items: ActivityItem[]; compact?: boolean }) {
  const bodyRef = useRef<HTMLOListElement>(null);
  const typedIdRef = useRef<string | null>(null);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [typedLen, setTypedLen] = useState(0);
  const reduceMotionRef = useRef(false);

  // API stores newest-first; chat-style feed wants oldest → newest (latest at bottom).
  const chronological = [...items].reverse();
  const latest = chronological[chronological.length - 1] ?? null;

  useEffect(() => {
    reduceMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!latest) return;
    if (typedIdRef.current === latest.id) return;
    typedIdRef.current = latest.id;
    if (reduceMotionRef.current) {
      setTypingId(null);
      setTypedLen(latest.message.length);
      return;
    }
    setTypingId(latest.id);
    setTypedLen(0);
  }, [latest?.id, latest?.message]);

  useEffect(() => {
    if (!latest || typingId !== latest.id) return;
    if (typedLen >= latest.message.length) {
      setTypingId(null);
      return;
    }
    const delay = latest.message[typedLen] === " " ? 12 : 16;
    const timer = window.setTimeout(() => setTypedLen((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [typingId, typedLen, latest]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: reduceMotionRef.current ? "auto" : "smooth",
    });
  }, [chronological.length, typedLen, typingId]);

  return (
    <div
      className={`activity-feed ${compact ? "is-compact" : ""}`}
      role="log"
      aria-label="Crew activity"
      aria-live="polite"
      aria-relevant="additions"
    >
      <ol className="activity-feed-body" ref={bodyRef}>
        {chronological.map((item) => {
          const isTyping = typingId === item.id;
          const text = isTyping ? item.message.slice(0, typedLen) : item.message;
          return (
            <li key={item.id} className={isTyping ? "is-typing" : undefined}>
              <time dateTime={item.at} title={formatRelativeTime(item.at)}>
                {formatClockTime(item.at)}
              </time>
              <p className="activity-feed-message">
                {text}
                {isTyping ? <span className="activity-feed-caret" aria-hidden /> : null}
              </p>
            </li>
          );
        })}
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
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("specs");
  const [bottomTab, setBottomTab] = useState<BottomTab>("activity");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [shipHighlight, setShipHighlight] = useState(false);
  const shippedSeenRef = useRef<boolean | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [improvBusy, setImprovBusy] = useState(false);
  const [improvError, setImprovError] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubConnectBusy, setGithubConnectBusy] = useState(false);
  const [githubPushBusy, setGithubPushBusy] = useState(false);
  const [githubPushError, setGithubPushError] = useState<string | null>(null);
  const [artifactBody, setArtifactBody] = useState<string | null>(null);
  const [artifactContentType, setArtifactContentType] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [bentoOrder, setBentoOrder] = useState<BentoCardId[]>(readSavedBentoOrder);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [draggedCard, setDraggedCard] = useState<BentoCardId | null>(null);
  const [dropTarget, setDropTarget] = useState<BentoCardId | null>(null);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState("");
  const bentoGridRef = useRef<HTMLDivElement>(null);
  const previousBentoRectsRef = useRef<Map<BentoCardId, DOMRect>>(new Map());
  const previousBentoOrderRef = useRef("");
  const spineRef = useRef(spine);
  spineRef.current = spine;
  const closeModal = useCallback(() => setModal(null), []);

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
      persistBentoOrder(next);
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
          persistBentoOrder(nextOrder);
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
    persistBentoOrder(DEFAULT_BENTO_ORDER);
    setLayoutAnnouncement("Dashboard cards reset to the default layout.");
  }, []);

  const onOpenPreview = useCallback(async () => {
    if (!spine?.project) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const result = await startPreview(spine.project.id);
      if (!result.ok || !result.previewUrl) {
        setPreviewError(result.message || "Sandbox preview unavailable");
      } else {
        setSpine((prev) =>
          prev
            ? {
                ...prev,
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
        setSpine((prev) =>
          prev
            ? {
                ...prev,
                previewUrl: result.url,
              }
            : prev,
        );
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishBusy(false);
    }
  }, [spine?.project]);

  const onStopRun = useCallback(() => {
    if (!spine?.project?.id || stopBusy || restartBusy) return;
    const projectId = spine.project.id;
    const title = spine.project.title;
    Modal.confirm({
      title: "Stop this run?",
      content: `Nexus will halt the crew for “${title}”. Nothing else will run until you restart.`,
      okText: "Stop run",
      okButtonProps: { danger: true },
      cancelText: "Keep going",
      centered: true,
      onOk: async () => {
        setStopBusy(true);
        setError(null);
        try {
          await stopRun(projectId);
          const next = await fetchSpine(projectId, { force: true });
          setSpine(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          throw err;
        } finally {
          setStopBusy(false);
        }
      },
    });
  }, [spine?.project?.id, spine?.project?.title, stopBusy, restartBusy]);

  const onRestartRun = useCallback(() => {
    if (!spine?.project?.id || restartBusy || stopBusy) return;
    const projectId = spine.project.id;
    const title = spine.project.title;
    Modal.confirm({
      title: "Restart this run?",
      content: `Nexus will start “${title}” again from your brief. Any in-progress crew work will be stopped first.`,
      okText: "Restart run",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      centered: true,
      onOk: async () => {
        setRestartBusy(true);
        setError(null);
        try {
          await restartRun(projectId);
          const next = await fetchSpine(projectId, { force: true });
          setSpine(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          throw err;
        } finally {
          setRestartBusy(false);
        }
      },
    });
  }, [spine?.project?.id, spine?.project?.title, restartBusy, stopBusy]);

  const onImprovise = useCallback(async () => {
    if (!spine?.project) return;
    setImprovBusy(true);
    setImprovError(null);
    try {
      const result = await improviseProject(spine.project.id);
      if (!result.ok) {
        setImprovError(result.error || "Improvise failed");
      } else {
        if (result.publishUrl) setPublishUrl(result.publishUrl);
      }
    } catch (err) {
      setImprovError(err instanceof Error ? err.message : String(err));
    } finally {
      setImprovBusy(false);
    }
  }, [spine?.project]);

  // Fetch GitHub status and watch for ?github=connected callback param
  const loadGithubStatus = useCallback(async (pid: string) => {
    try {
      const s = await fetchGitHubStatus(pid);
      setGithubStatus(s);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    const pid = spine?.project?.id;
    if (!pid) return;
    void loadGithubStatus(pid);
    // Handle redirect back from GitHub OAuth
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("github")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [spine?.project?.id, loadGithubStatus]);

  const onGithubConnect = useCallback(async () => {
    const pid = spine?.project?.id;
    if (!pid) return;
    setGithubConnectBusy(true);
    try {
      const { url } = await startGitHubConnect(pid);
      window.location.href = url;
    } catch {
      setGithubConnectBusy(false);
    }
  }, [spine?.project?.id]);

  const onGithubPush = useCallback(async () => {
    const pid = spine?.project?.id;
    if (!pid) return;
    setGithubPushBusy(true);
    setGithubPushError(null);
    try {
      const result = await pushToGitHub(pid);
      if (!result.ok) {
        setGithubPushError(result.error || "Push failed");
      } else {
        await loadGithubStatus(pid);
      }
    } catch (err) {
      setGithubPushError(err instanceof Error ? err.message : String(err));
    } finally {
      setGithubPushBusy(false);
    }
  }, [spine?.project?.id, loadGithubStatus]);

  const onGithubDisconnect = useCallback(async () => {
    await disconnectGitHub().catch(() => {});
    setGithubStatus(null);
  }, []);

  useEffect(() => {
    if (isMockMode()) {
      setSandboxAvailable(false);
      return;
    }
    let alive = true;
    fetchHealth()
      .then((h) => {
        if (alive) setSandboxAvailable(Boolean(h.sandbox));
      })
      .catch(() => {
        if (alive) setSandboxAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (spine?.previewUrl) setPublishUrl(spine.previewUrl);
  }, [spine?.previewUrl]);

  useEffect(() => {
    const live = publishUrl || spine?.previewUrl || null;
    const status = (spine?.project?.status || "").toLowerCase();
    const stage = (spine?.project?.stage || "").toLowerCase();
    const shipped =
      Boolean(live) &&
      (stage === "ready" ||
        status === "completed" ||
        status === "ready" ||
        status === "published" ||
        status === "preview");

    if (shippedSeenRef.current === null) {
      if (spine?.project) shippedSeenRef.current = shipped;
      return;
    }

    if (shipped && !shippedSeenRef.current) {
      shippedSeenRef.current = true;
      setShipHighlight(true);
      celebrateShip();
      const clear = window.setTimeout(() => setShipHighlight(false), 8000);
      return () => window.clearTimeout(clear);
    }

    if (!shipped) shippedSeenRef.current = false;
  }, [spine?.project, spine?.previewUrl, publishUrl]);

  useEffect(() => {
    shippedSeenRef.current = null;
    setShipHighlight(false);
  }, [project]);

  useEffect(() => {
    let alive = true;
    let streamAbort: AbortController | undefined;
    let reconnectTimer: number | undefined;
    let stallTimer: number | undefined;
    let pollTimer: number | undefined;
    let latest: SpineSnapshot | null = null;
    let lastActivityAt = Date.now();
    /** SSE can go quiet when the Durable Object hibernates mid-run. */
    const STALL_MS = 45_000;
    const POLL_MS = 25_000;
    const RECONNECT_MS = 2_500;

    const isActiveRun = (data: SpineSnapshot | null) => {
      const status = (data?.project?.status || "").toLowerCase();
      const stage = (data?.project?.stage || "").toLowerCase();
      if (!data?.project) return false;
      if (status === "running" || status === "queued" || status === "drafting") return true;
      if (
        status === "completed" ||
        status === "ready" ||
        status === "failed" ||
        status === "published"
      ) {
        return false;
      }
      if (stage === "ready" || stage === "idle") return false;
      if (stage && stage !== "ready") return true;
      return (data.agents || []).some((a) => a.signal === "active" || a.signal === "revision");
    };

    const stopStream = () => {
      streamAbort?.abort();
      streamAbort = undefined;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (stallTimer) {
        window.clearInterval(stallTimer);
        stallTimer = undefined;
      }
    };

    const stopPoll = () => {
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    const markActivity = () => {
      lastActivityAt = Date.now();
    };

    const applySpine = (data: SpineSnapshot) => {
      latest = data;
      markActivity();
      setSpine((prev) => (prev === data ? prev : data));
      setError(null);
      if (!project && data.project?.id) {
        navigate(`/dashboard/${encodeURIComponent(data.project.id)}`, { replace: true });
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimer || !alive || document.hidden) return;
      if (!isActiveRun(latest)) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        if (alive && latest?.project?.id && isActiveRun(latest) && !document.hidden) {
          startStream(latest.project.id);
        }
      }, RECONNECT_MS);
    };

    const startStream = (projectId: string) => {
      if (!alive || isMockMode() || document.hidden) return;
      stopStream();
      const ac = new AbortController();
      streamAbort = ac;
      markActivity();

      stallTimer = window.setInterval(() => {
        if (!alive || ac.signal.aborted || document.hidden) return;
        if (!isActiveRun(latest)) {
          stopStream();
          return;
        }
        if (Date.now() - lastActivityAt < STALL_MS) return;
        // Half-open SSE: abort and reconnect; polling keeps the UI honest meanwhile.
        ac.abort();
        scheduleReconnect();
      }, 10_000);

      void subscribeSpine(
        projectId,
        {
          onActivity: markActivity,
          onSpine: (data) => {
            if (!alive) return;
            applySpine(data);
            if (!isActiveRun(data)) {
              stopStream();
              stopPoll();
            }
          },
          onEnd: () => {
            if (!alive) return;
            stopStream();
            if (isActiveRun(latest)) scheduleReconnect();
            else stopPoll();
          },
          onError: (err) => {
            if (!alive || ac.signal.aborted) return;
            setError(err.message);
          },
        },
        { signal: ac.signal },
      )
        .then(() => {
          if (!alive || ac.signal.aborted || document.hidden) return;
          if (!isActiveRun(latest)) return;
          scheduleReconnect();
        })
        .catch(() => {
          if (!alive || ac.signal.aborted || document.hidden) return;
          if (!isActiveRun(latest)) return;
          scheduleReconnect();
        });
    };

    const startPoll = () => {
      if (isMockMode() || pollTimer) return;
      pollTimer = window.setInterval(() => {
        if (!alive || document.hidden) return;
        if (!isActiveRun(latest)) {
          stopPoll();
          return;
        }
        void fetchSpine(project, { force: true })
          .then((data) => {
            if (!alive) return;
            applySpine(data);
            if (!isActiveRun(data)) {
              stopStream();
              stopPoll();
              return;
            }
            // If SSE looks stalled, force a reconnect after a successful poll.
            if (!streamAbort || Date.now() - lastActivityAt >= STALL_MS) {
              const id = data.project?.id || project;
              if (id) startStream(id);
            }
          })
          .catch(() => {
            /* keep polling; next tick retries */
          });
      }, POLL_MS);
    };

    const load = (opts?: { force?: boolean }) => {
      return fetchSpine(project, opts)
        .then((data) => {
          if (!alive) return;
          applySpine(data);
          const projectId = data.project?.id || project;
          if (projectId && isActiveRun(data)) {
            startStream(projectId);
            startPoll();
          } else {
            stopStream();
            stopPoll();
          }
        })
        .catch((err: Error) => {
          if (alive) setError(err.message);
        });
    };

    const onVisibility = () => {
      if (!alive || isMockMode()) return;
      if (document.hidden) {
        stopStream();
        return;
      }
      void load({ force: true });
    };

    void load();
    if (!isMockMode()) {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      alive = false;
      stopStream();
      stopPoll();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [project, navigate]);

  // Load artifact/file once per open path — do not re-fetch when spine updates.
  const openDocId =
    modal?.type === "spec" || modal?.type === "file" ? modal.id : null;
  const openDocPath =
    openDocId && spine
      ? modal?.type === "file"
        ? spine.files?.find((f) => f.id === openDocId)?.path ?? null
        : spine.specs.find((s) => s.id === openDocId)?.path ?? null
      : null;
  const artifactProjectId = spine?.project?.id || project || null;

  useEffect(() => {
    if (!openDocId) {
      setArtifactBody(null);
      setArtifactContentType(null);
      setArtifactError(null);
      setArtifactLoading(false);
      return;
    }

    let alive = true;
    const projectId = artifactProjectId;
    const path = openDocPath;
    const summaryFallback =
      spineRef.current?.specs.find((s) => s.id === openDocId)?.summary ||
      spineRef.current?.files?.find((f) => f.id === openDocId)?.summary ||
      "";

    setArtifactBody(null);
    setArtifactContentType(null);
    setArtifactLoading(true);
    setArtifactError(null);

    const load = async () => {
      try {
        if (path && projectId) {
          const res = await fetchArtifact(projectId, path);
          if (!alive) return;
          setArtifactBody(res.content);
          setArtifactContentType(res.contentType || null);
        } else {
          setArtifactBody(summaryFallback);
          setArtifactContentType("text/markdown");
        }
      } catch (err) {
        if (!alive) return;
        setArtifactBody(summaryFallback);
        setArtifactContentType("text/markdown");
        setArtifactError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setArtifactLoading(false);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, [openDocId, openDocPath, artifactProjectId]);

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
  const workspaceFiles = spine.files || [];
  const runStatus = (spine.project.status || "").toLowerCase();
  const canStopRun = /^(running|queued|drafting|in-progress)$/.test(runStatus)
    || spine.agents.some((a) => a.signal === "active" || a.signal === "revision");
  const runActionBusy = stopBusy || restartBusy;

  const modalSpec: SpecCard | null =
    modal?.type === "spec" ? spine.specs.find((s) => s.id === modal.id) || null : null;
  const modalFile: WorkspaceFileCard | null =
    modal?.type === "file" ? workspaceFiles.find((f) => f.id === modal.id) || null : null;
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
                  s.key === "drafting"
                    ? "Strategy"
                    : s.key === "cross-review"
                      ? "Build"
                      : s.key === "consolidating"
                        ? "QA"
                        : "Launch";
                const isReadyDone = s.key === "ready" && (cls === "done" || cls === "active");
                const liveHref =
                  isReadyDone && (publishUrl || spine.previewUrl)
                    ? publishUrl || spine.previewUrl || undefined
                    : undefined;
                return (
                  <div
                    key={s.key}
                    className={`stage-step ${cls}${liveHref ? " is-linked" : ""}`}
                    role="listitem"
                  >
                    <span className="n">{i < stageIndex ? "✓" : s.num}</span>
                    {liveHref ? (
                      <a
                        href={liveHref}
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
            <div className="layout-actions">
              <Button
                size="small"
                danger
                loading={stopBusy}
                disabled={!spine.project?.id || !canStopRun || runActionBusy}
                onClick={onStopRun}
                className="brief-run-btn"
              >
                Stop
              </Button>
              <Button
                size="small"
                loading={restartBusy}
                disabled={!spine.project?.id || runActionBusy}
                onClick={onRestartRun}
                className="brief-run-btn"
              >
                Restart
              </Button>
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
                {layoutEditing ? "Done" : "Arrange"}
              </Button>
              {layoutEditing &&
              bentoOrder.some((id, index) => id !== DEFAULT_BENTO_ORDER[index]) ? (
                <Button
                  type="text"
                  size="small"
                  className="layout-reset-button"
                  onClick={resetBentoOrder}
                >
                  Reset
                </Button>
              ) : null}
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
                <dd>{formatStatusLabel(spine.project.stage)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatRelativeTime(spine.project.updatedAt)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
      </div>

      <BentoItem {...bentoItemProps("orchestrator")}>
        <section className="card orch">
          <div className="orch-head">
            <div>
              <p className="orch-kicker">Orchestrator</p>
              <h2 className="orch-title">
                Nexus coordinating{" "}
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
              <TabExpandButton label="Full view" onClick={() => setCanvasOpen(true)} />
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
              liveUrl={publishUrl || spine.previewUrl}
              sandboxAvailable={sandboxAvailable}
              previewError={previewError}
              previewBusy={previewBusy}
              onStartSandbox={sandboxAvailable ? onOpenPreview : undefined}
              publishBusy={publishBusy}
              publishError={publishError}
              onPublish={onPublish}
              highlight={shipHighlight}
              canPublish={
                Boolean(spine.project) &&
                (spine.project!.stage === "ready" ||
                  /completed|ready|published|preview/i.test(spine.project!.status))
              }
              onImprovise={onImprovise}
              improvBusy={improvBusy}
              improvError={improvError}
              githubStatus={githubStatus}
              githubConnectBusy={githubConnectBusy}
              githubPushBusy={githubPushBusy}
              githubPushError={githubPushError}
              onGithubConnect={onGithubConnect}
              onGithubPush={onGithubPush}
              onGithubDisconnect={onGithubDisconnect}
            />
      </BentoItem>

      <BentoItem {...bentoItemProps("artifacts")}>
          <aside className="card specs-panel">
            <SegmentedTabs
              value={sideTab}
              onChange={setSideTab}
              tabs={[
                { id: "specs", label: "Artifacts", count: spine.specs.length || undefined },
                { id: "files", label: "Files", count: workspaceFiles.length || undefined },
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
                      type:
                        sideTab === "specs"
                          ? "specs"
                          : sideTab === "files"
                            ? "files"
                            : "decisions",
                    })
                  }
                />
              }
            />

            <div className="tab-pane">
              {sideTab === "specs" &&
                (spine.specs.length === 0 ? (
                  <p className="muted empty-pane">Planning docs appear here as agents complete work.</p>
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
                                  {spec.updatedAt ? ` · ${formatRelativeTime(spec.updatedAt)}` : ""}
                                </span>
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ))}

              {sideTab === "files" &&
                (workspaceFiles.length === 0 ? (
                  <p className="muted empty-pane">App files appear here after engineering builds the workspace.</p>
                ) : (
                  <ul className="specs-rail specs-rail-full">
                    {workspaceFiles.map((file) => (
                      <li key={file.id}>
                        <button
                          type="button"
                          className={`spec-rail-item is-button ${
                            modal?.type === "file" && modal.id === file.id ? "is-selected" : ""
                          }`}
                          onClick={() => setModal({ type: "file", id: file.id })}
                        >
                          <span className="spec-icon">
                            <IconDoc size={14} />
                          </span>
                          <span className="spec-rail-copy">
                            <span className="spec-rail-title">{file.title}</span>
                            <span className="spec-rail-meta">
                              <span className="muted">
                                {file.path}
                                {file.updatedAt ? ` · ${formatRelativeTime(file.updatedAt)}` : ""}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
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
              <ActivityFeed items={spine.activity.slice(0, 10)} compact />
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
                    <span>{spec.owner} · {formatRelativeTime(spec.updatedAt)}</span>
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


      <FlowCanvas
        open={canvasOpen}
        onClose={() => setCanvasOpen(false)}
        title="Coordination flow"
        live={spine.live}
        agents={spine.agents}
        revisionLoop={spine.revisionLoop}
        dataFlows={spine.dataFlows}
      />

      <PushSidebar
        open={Boolean(modal)}
        title={
          modal?.type === "orchestrator"
            ? "Orchestrator details"
            : modal?.type === "agent" && modalAgent
              ? modalAgent.label
              : modal?.type === "spec" && modalSpec
                ? modalSpec.title
                : modal?.type === "file" && modalFile
                  ? modalFile.title
                : modal?.type === "specs"
                  ? "Artifacts"
                  : modal?.type === "files"
                    ? "Files"
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
                : modal?.type === "file" && modalFile
                  ? modalFile.path
                : modal?.type === "specs"
                  ? `${spine.specs.length} planning docs`
                  : modal?.type === "files"
                    ? `${workspaceFiles.length} workspace files`
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
              {modalSpec.path ? <p className="spec-preview-path">{modalSpec.path}</p> : null}
              <p className="muted">Updated {formatRelativeTime(modalSpec.updatedAt)} · {modalSpec.owner}</p>
              {artifactLoading && !artifactBody ? (
                <p className="muted">Loading artifact…</p>
              ) : (
                <ArtifactDoc
                  content={artifactBody || modalSpec.summary || ""}
                  contentType={artifactContentType}
                  path={modalSpec.path}
                />
              )}
              {artifactError ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  Showing summary — full file unavailable ({artifactError}).
                </p>
              ) : null}
              <Button size="small" onClick={() => setModal({ type: "specs" })}>All artifacts</Button>
            </div>
          ) : (
            <ul className="modal-spec-list">
              {spine.specs.map((spec) => (
                <li key={spec.id}>
                  <button type="button" className="modal-spec-row" onClick={() => setModal({ type: "spec", id: spec.id })}>
                    <span><strong>{spec.title}</strong><small>{spec.owner} · {formatRelativeTime(spec.updatedAt)}</small></span>
                    <span className={`spec-badge ${specStatusMeta(spec.status).cls}`}>{specStatusMeta(spec.status).label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {(modal?.type === "files" || modal?.type === "file") ? (
          modalFile ? (
            <div className="modal-spec-detail">
              <p className="spec-preview-path">{modalFile.path}</p>
              <p className="muted">Updated {formatRelativeTime(modalFile.updatedAt)} · {modalFile.owner}</p>
              {artifactLoading && !artifactBody ? (
                <p className="muted">Loading file…</p>
              ) : (
                <ArtifactDoc
                  content={artifactBody || modalFile.summary || ""}
                  contentType={artifactContentType}
                  path={modalFile.path}
                />
              )}
              {artifactError ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  Showing summary — full file unavailable ({artifactError}).
                </p>
              ) : null}
              <Button size="small" onClick={() => setModal({ type: "files" })}>All files</Button>
            </div>
          ) : (
            <ul className="modal-spec-list">
              {workspaceFiles.map((file) => (
                <li key={file.id}>
                  <button type="button" className="modal-spec-row" onClick={() => setModal({ type: "file", id: file.id })}>
                    <span><strong>{file.title}</strong><small>{file.path} · {formatRelativeTime(file.updatedAt)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {modal?.type === "activity" ? (
          spine.activity.length ? <ActivityFeed items={spine.activity} /> : <p className="muted">No activity yet.</p>
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
