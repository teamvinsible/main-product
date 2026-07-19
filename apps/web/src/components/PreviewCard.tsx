import { Button } from "antd";
import { IconExternal } from "./icons";

interface Props {
  previewUrl?: string | null;
  previewError?: string | null;
  previewBusy?: boolean;
  onStartPreview?: () => void;
  publishUrl?: string | null;
  publishBusy?: boolean;
  publishError?: string | null;
  onPublish?: () => void;
}

function displayHost(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export function PreviewCard({
  previewUrl,
  previewError,
  previewBusy,
  onStartPreview,
  publishUrl,
  publishBusy,
  publishError,
  onPublish,
}: Props) {
  const canPublish = Boolean(previewUrl || publishUrl);

  return (
    <section className="card preview-card" aria-label="Sandbox preview">
      <header className="preview-card-head">
        <div>
          <p className="orch-kicker">Sandbox</p>
          <h3 className="preview-card-title">Preview</h3>
        </div>
        {previewUrl ? (
          <a
            className="preview-card-open"
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open
            <IconExternal size={13} aria-hidden />
          </a>
        ) : null}
      </header>

      {previewError ? <p className="preview-card-error">{previewError}</p> : null}
      {publishError ? <p className="preview-card-error">{publishError}</p> : null}

      {previewUrl ? (
        <a
          className="preview-card-url"
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={previewUrl}
        >
          {displayHost(previewUrl)}
        </a>
      ) : (
        <div className="preview-card-empty">
          <p className="muted">No live preview yet.</p>
          {onStartPreview ? (
            <Button type="default" size="small" loading={previewBusy} onClick={onStartPreview}>
              Start preview
            </Button>
          ) : null}
          <p id="preview-publish-requirement" className="preview-card-hint">
            Review a preview before publishing.
          </p>
        </div>
      )}

      {publishUrl ? (
        <a
          className="preview-card-url preview-card-publish-url"
          href={publishUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={publishUrl}
        >
          Live · {displayHost(publishUrl)}
        </a>
      ) : null}

      <div className="preview-card-actions">
        {previewUrl && onStartPreview ? (
          <Button type="default" size="small" loading={previewBusy} onClick={onStartPreview}>
            Refresh preview
          </Button>
        ) : null}
        {onPublish ? (
          <Button
            type="primary"
            size="small"
            loading={publishBusy}
            disabled={!canPublish}
            aria-describedby={!canPublish ? "preview-publish-requirement" : undefined}
            onClick={onPublish}
          >
            {publishUrl ? "Republish" : "Publish"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
