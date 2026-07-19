import { Button } from "antd";
import { IconExternal } from "./icons";

interface Props {
  /** Live shareable URL (published app). Preferred over sandbox preview. */
  liveUrl?: string | null;
  /** Optional ephemeral sandbox URL when Containers are enabled. */
  sandboxUrl?: string | null;
  sandboxAvailable?: boolean;
  previewError?: string | null;
  previewBusy?: boolean;
  onStartSandbox?: () => void;
  publishBusy?: boolean;
  publishError?: string | null;
  onPublish?: () => void;
  /** True once the crew finished and a publishable workspace exists. */
  canPublish?: boolean;
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
  liveUrl,
  sandboxUrl,
  sandboxAvailable,
  previewError,
  previewBusy,
  onStartSandbox,
  publishBusy,
  publishError,
  onPublish,
  canPublish = false,
}: Props) {
  const primaryUrl = liveUrl || sandboxUrl || null;

  return (
    <section className="card preview-card" aria-label="Live app">
      <header className="preview-card-head">
        <div>
          <p className="orch-kicker">Deploy</p>
          <h3 className="preview-card-title">Live app</h3>
        </div>
        {primaryUrl ? (
          <a
            className="preview-card-open"
            href={primaryUrl}
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

      {primaryUrl ? (
        <a
          className="preview-card-url"
          href={primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={primaryUrl}
        >
          {liveUrl ? `Live · ${displayHost(primaryUrl)}` : displayHost(primaryUrl)}
        </a>
      ) : (
        <div className="preview-card-empty">
          <p className="muted">
            {canPublish
              ? "Ready to publish a shareable URL."
              : "The live URL appears here when the crew finishes shipping."}
          </p>
        </div>
      )}

      {liveUrl && sandboxUrl && sandboxUrl !== liveUrl ? (
        <a
          className="preview-card-url preview-card-publish-url"
          href={sandboxUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={sandboxUrl}
        >
          Sandbox · {displayHost(sandboxUrl)}
        </a>
      ) : null}

      <div className="preview-card-actions">
        {onPublish ? (
          <Button
            type="primary"
            size="small"
            loading={publishBusy}
            disabled={!canPublish && !liveUrl}
            onClick={onPublish}
          >
            {liveUrl ? "Republish" : "Publish"}
          </Button>
        ) : null}
        {sandboxAvailable && onStartSandbox ? (
          <Button type="default" size="small" loading={previewBusy} onClick={onStartSandbox}>
            {sandboxUrl ? "Refresh sandbox" : "Sandbox preview"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
