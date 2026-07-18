import { Button, Input, Segmented } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { startRun, submitIntake } from "../api";

type Tab = "text" | "url" | "image";

export function IntakePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPlan() {
    setBusy(true);
    setError(null);
    try {
      const idea =
        tab === "url"
          ? `Build from reference URL: ${url}. ${text}`.trim()
          : tab === "image"
            ? `Build from uploaded reference image. ${text}`.trim()
            : text;
      const result = await submitIntake({ idea, text: idea, kind: tab, url: url || undefined });
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onLaunch() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const idea = String(plan.idea || text);
      const name = String(plan.suggestedName || "new-project");
      await startRun({
        idea,
        name,
        type: plan.projectType || "auto",
      });
      navigate(`/spine/${encodeURIComponent(name)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      navigate("/spine");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="intake-wrap fade-in">
      <h1>Start with a brief</h1>
      <p>
        Text, image, or URL — the Mediator plans the work, asks clarifying questions, then assigns
        the crew.
      </p>

      <div className="card intake-box">
        <Segmented
          className="intake-tabs"
          value={tab}
          onChange={(next) => setTab(next as Tab)}
          options={[
            { value: "text", label: "Text" },
            { value: "url", label: "URL" },
            { value: "image", label: "Image" },
          ]}
          style={{ marginBottom: 12 }}
        />

        {tab === "url" && (
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            style={{ marginBottom: 10 }}
          />
        )}

        {tab === "image" && (
          <div
            style={{
              marginBottom: 10,
              padding: 14,
              border: "1px dashed var(--line-2)",
              borderRadius: 8,
              color: "var(--ink-3)",
              fontSize: 13,
            }}
          >
            Image upload (R2) comes next — describe the reference for now.
          </div>
        )}

        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Coordinate a launch for Feature Insight — a weekly AI product analytics report for PMs."
          rows={6}
          autoSize={{ minRows: 5, maxRows: 12 }}
        />

        <div className="intake-actions">
          <Button type="primary" loading={busy} disabled={!text && !url} onClick={onPlan}>
            Prepare plan
          </Button>
          <Button type="text" onClick={() => navigate("/spine")}>
            Open Coordination Spine
          </Button>
        </div>

        {error && <p style={{ color: "var(--red)", marginTop: 10, fontSize: 13 }}>{error}</p>}
      </div>

      {plan && (
        <div className="card plan-card fade-in">
          <h3>Proposed plan</h3>
          <p className="muted">{String(plan.summary || plan.idea || "")}</p>
          <p>
            <strong>Category:</strong> {String(plan.projectTypeLabel || plan.projectType || "auto")}
            {" · "}
            <strong>Name:</strong> {String(plan.suggestedName || "—")}
          </p>
          {Array.isArray(plan.clarifyingQuestions) && (plan.clarifyingQuestions as string[]).length > 0 && (
            <>
              <h4 style={{ margin: "12px 0 4px" }}>Clarifying questions</h4>
              <ul>
                {(plan.clarifyingQuestions as string[]).map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </>
          )}
          <div className="intake-actions">
            <Button type="primary" loading={busy} onClick={onLaunch}>
              Assign to Mediator
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
