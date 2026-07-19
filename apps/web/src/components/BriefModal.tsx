import { Alert, Button, Input, Modal, Segmented, Upload } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSpine, startRun, submitIntake } from "../api";
import {
  IconBox,
  IconChat,
  IconCheck,
  IconCode,
  IconDoc,
  IconMail,
  IconPalette,
  IconSearch,
  IconStar,
} from "./icons";
import {
  BRIEF_ACCEPT,
  type BriefAttachment,
  composeBriefIdea,
  formatBytes,
  MAX_FILES,
  mergeAttachments,
  readBriefAttachment,
} from "../lib/briefAttachments";

type Tab = "text" | "url" | "image";

const MAX_PROJECTS = 2;

const AGENTS = [
  {
    id: "research",
    icon: IconSearch,
    name: "Research",
    role: "Finds facts, competitors & trends so you don't have to",
  },
  {
    id: "product",
    icon: IconBox,
    name: "Product",
    role: "Writes specs, requirements & user stories from your brief",
  },
  {
    id: "brand",
    icon: IconPalette,
    name: "Brand",
    role: "Visual identity, tone of voice, naming & positioning",
  },
  {
    id: "engineering",
    icon: IconCode,
    name: "Engineering",
    role: "Architecture decisions, implementation plans & technical docs",
  },
  {
    id: "review",
    icon: IconCheck,
    name: "Review",
    role: "Cross-checks every output & gates quality before handoff",
  },
  {
    id: "social",
    icon: IconChat,
    name: "Social",
    role: "Content strategy, copy & channel scheduling",
  },
  {
    id: "email",
    icon: IconMail,
    name: "Email",
    role: "Campaigns, drip sequences & subject lines that get opened",
  },
];

const TYPEWRITER_STRINGS = [
  "Coordinate a full launch for a new AI analytics feature targeting PMs",
  "Build a go-to-market plan for a mobile fitness app entering a crowded market",
  "Create a social + email campaign for our company rebrand",
  "Plan the engineering handoff and docs for our v2.0 release",
  "Design a content strategy for a B2B SaaS product launch",
];

function useTypewriter(strings: string[], active: boolean) {
  const [display, setDisplay] = useState("");
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"typing" | "pause" | "deleting">("typing");

  useEffect(() => {
    if (!active) return;
    const target = strings[idx];

    if (phase === "typing") {
      if (display.length < target.length) {
        const t = setTimeout(() => setDisplay(target.slice(0, display.length + 1)), 38);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("pause"), 2600);
      return () => clearTimeout(t);
    }

    if (phase === "pause") {
      const t = setTimeout(() => setPhase("deleting"), 400);
      return () => clearTimeout(t);
    }

    if (phase === "deleting") {
      if (display.length > 0) {
        const t = setTimeout(() => setDisplay(display.slice(0, -1)), 18);
        return () => clearTimeout(t);
      }
      setIdx((i) => (i + 1) % strings.length);
      setPhase("typing");
    }
  }, [active, display, idx, phase, strings]);

  return display;
}

type BriefModalProps = {
  open: boolean;
  onClose: () => void;
};

export function BriefModal({ open, onClose }: BriefModalProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [attachments, setAttachments] = useState<BriefAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [limitChecked, setLimitChecked] = useState(false);

  const atLimit = limitChecked && projectCount >= MAX_PROJECTS;
  const animatedPlaceholder = useTypewriter(TYPEWRITER_STRINGS, open && !text && !atLimit);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLimitChecked(false);
    fetchSpine()
      .then((spine) => {
        if (!alive) return;
        setProjectCount(spine.projects?.length ?? 0);
        setLimitChecked(true);
      })
      .catch(() => {
        if (!alive) return;
        setProjectCount(0);
        setLimitChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  function reset() {
    setTab("text");
    setText("");
    setUrl("");
    setAttachments([]);
    setBusy(false);
    setReading(false);
    setPlan(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    try {
      const read = await Promise.all(files.map(readBriefAttachment));
      setAttachments((prev) => mergeAttachments(prev, read));
      const failed = read.filter((f) => f.status === "error");
      if (failed.length > 0) {
        setError(failed.map((f) => `${f.name}: ${f.error}`).join(" · "));
      }
    } finally {
      setReading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function insertFilesAsText(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    try {
      const read = await Promise.all(files.map(readBriefAttachment));
      const chunks: string[] = [];
      for (const file of read) {
        if (file.text?.trim()) {
          chunks.push(`--- ${file.name} ---\n${file.text.trim()}`);
        } else {
          setAttachments((prev) => mergeAttachments(prev, [file]));
        }
      }
      if (chunks.length > 0) {
        setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${chunks.join("\n\n")}` : chunks.join("\n\n")));
      }
    } finally {
      setReading(false);
    }
  }

  async function onPlan() {
    if (atLimit) return;
    setBusy(true);
    setError(null);
    try {
      const idea = composeBriefIdea(text, attachments, tab === "url" ? { url } : undefined);
      if (!idea && tab !== "image") {
        setError("Add a brief description or attach a document.");
        return;
      }
      const composed =
        tab === "image"
          ? `Build from uploaded reference image. ${text || idea || ""}`.trim()
          : idea;
      if (!composed) {
        setError("Add a brief description or attach a document.");
        return;
      }
      const result = await submitIntake({
        idea: composed,
        text: composed,
        kind: tab,
        url: url || undefined,
        attachments: attachments.map((a) => ({
          name: a.name,
          size: a.size,
          type: a.type,
          hasText: a.text != null,
        })),
      });
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onLaunch() {
    if (!plan || atLimit) return;
    setBusy(true);
    setError(null);
    try {
      const idea = String(
        plan.idea || composeBriefIdea(text, attachments, tab === "url" ? { url } : undefined),
      );
      const name = String(plan.suggestedName || "new-project");
      const run = await startRun({
        idea,
        name,
        type: plan.projectType || plan.category || "auto",
        attachments: attachments.map((a) => ({
          name: a.name,
          size: a.size,
          type: a.type,
          hasText: a.text != null,
        })),
      });
      const routeKey = run.projectId || run.swarmName || run.name || name;
      handleClose();
      navigate(`/dashboard/${encodeURIComponent(routeKey)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const questions = Array.isArray(plan?.clarifyingQuestions)
    ? (plan!.clarifyingQuestions as string[])
    : [];

  const canSubmit = Boolean(
    text.trim() || url.trim() || attachments.some((a) => a.status === "ready"),
  );

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={null}
      width={720}
      destroyOnClose
      footer={null}
      className="brief-modal intake-modal"
    >
      <div className="intake-modal-body fade-in">
        <div className="intake-box-header">
          <div className="intake-nexus-badge">
            <IconStar size={13} />
            Nexus · 7 specialist agents
          </div>
          <h2 className="intake-headline">Brief them once.</h2>
          <p className="intake-sub">
            Describe what you need. Nexus will plan it and dispatch Research, Product, Brand,
            Engineering, Social, Email, and Review — all in parallel.
          </p>
        </div>

        {atLimit ? (
          <Alert
            type="warning"
            showIcon
            message={`Project limit reached (${MAX_PROJECTS})`}
            description="Finish or archive an existing project before starting another. Early access is capped at two live projects."
            style={{ marginBottom: 16 }}
          />
        ) : (
          <>
            <Segmented
              className="intake-tabs"
              value={tab}
              onChange={(next) => setTab(next as Tab)}
              options={[
                { value: "text", label: "Text" },
                { value: "url", label: "URL" },
                { value: "image", label: "Image" },
              ]}
            />

            {tab === "url" && (
              <Input
                className="intake-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
              />
            )}

            {tab === "image" && (
              <div className="intake-image-placeholder">
                Image upload coming soon — describe the reference below for now.
              </div>
            )}

            <Input.TextArea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                text === "" ? `${animatedPlaceholder || TYPEWRITER_STRINGS[0]}▍` : undefined
              }
              autoSize={{ minRows: 4, maxRows: 10 }}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
            />

            <div className="brief-attach">
              <Upload.Dragger
                multiple
                accept={BRIEF_ACCEPT}
                showUploadList={false}
                disabled={reading || busy || attachments.length >= MAX_FILES}
                beforeUpload={(file) => {
                  void addFiles([file]);
                  return false;
                }}
                className="brief-attach-drop"
              >
                <p className="brief-attach-title">
                  <IconDoc size={16} /> Attach documents
                </p>
                <p className="brief-attach-hint muted">
                  Drop files here, or click to browse. Text docs are included with the brief. Max{" "}
                  {MAX_FILES} files.
                </p>
              </Upload.Dragger>

              <div className="brief-attach-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={BRIEF_ACCEPT}
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void insertFilesAsText(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="link"
                  size="small"
                  disabled={reading || busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Insert file text into brief
                </Button>
              </div>

              {attachments.length > 0 && (
                <ul className="brief-attach-list">
                  {attachments.map((file) => (
                    <li key={file.id} className={file.status === "error" ? "is-error" : ""}>
                      <span className="brief-attach-icon">
                        <IconDoc size={14} />
                      </span>
                      <span className="brief-attach-meta">
                        <span className="brief-attach-name">{file.name}</span>
                        <span className="muted">
                          {formatBytes(file.size)}
                          {file.text != null
                            ? " · text included"
                            : file.status === "error"
                              ? ` · ${file.error}`
                              : " · name only"}
                        </span>
                      </span>
                      <Button type="text" size="small" onClick={() => removeAttachment(file.id)}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="intake-actions">
              <Button
                type="primary"
                size="large"
                loading={busy || reading}
                disabled={!canSubmit}
                onClick={onPlan}
              >
                Prepare plan →
              </Button>
              <Button type="text" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}

        {plan && !atLimit && (
          <div className="plan-card fade-in">
            <div className="plan-header">
              <span className="plan-type-badge">
                {String(plan.projectTypeLabel || plan.projectType || "Project")}
              </span>
              <h3 className="plan-title">{String(plan.suggestedName || "Proposed plan")}</h3>
            </div>
            <p className="plan-summary">{String(plan.summary || plan.idea || "")}</p>

            {questions.length > 0 && (
              <div className="plan-questions">
                <div className="plan-questions-label">Nexus wants to clarify</div>
                {questions.map((q, i) => (
                  <div key={q} className="plan-question-row">
                    <span className="plan-question-num">{i + 1}</span>
                    <span>{q}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="intake-actions" style={{ marginTop: 16 }}>
              <Button type="primary" size="large" loading={busy} onClick={onLaunch}>
                Assign to Nexus →
              </Button>
            </div>
          </div>
        )}

        <div className="intake-section-label">How it works</div>
        <div className="intake-steps">
          <div className="intake-step">
            <div className="intake-step-num">1</div>
            <div className="intake-step-body">
              <div className="intake-step-title">Write a brief</div>
              <div className="intake-step-desc">
                A sentence, a URL, or a rough idea. Nexus figures out the rest.
              </div>
            </div>
          </div>
          <div className="intake-step-connector" />
          <div className="intake-step">
            <div className="intake-step-num">2</div>
            <div className="intake-step-body">
              <div className="intake-step-title">Nexus plans</div>
              <div className="intake-step-desc">
                The orchestrator breaks the work into domain tasks and assigns each specialist.
              </div>
            </div>
          </div>
          <div className="intake-step-connector" />
          <div className="intake-step">
            <div className="intake-step-num">3</div>
            <div className="intake-step-body">
              <div className="intake-step-title">Agents execute</div>
              <div className="intake-step-desc">
                Seven specialists run in parallel, review each other&apos;s work, and converge on
                results.
              </div>
            </div>
          </div>
        </div>

        <div className="intake-section-label">Your invisible team</div>
        <div className="intake-agents">
          {AGENTS.map(({ id, icon: Icon, name, role }) => (
            <div className="intake-agent-chip" key={id}>
              <div className="intake-agent-icon">
                <Icon size={16} />
              </div>
              <div>
                <div className="intake-agent-name">{name}</div>
                <div className="intake-agent-role">{role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
