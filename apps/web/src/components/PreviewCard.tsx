import { Button } from "antd";
import { IconExternal, IconGitHub, IconWand } from "./icons";
import type { GitHubStatus } from "../api";

interface Props {
  liveUrl?: string | null;
  sandboxUrl?: string | null;
  sandboxAvailable?: boolean;
  previewError?: string | null;
  previewBusy?: boolean;
  onStartSandbox?: () => void;
  publishBusy?: boolean;
  publishError?: string | null;
  onPublish?: () => void;
  canPublish?: boolean;
  highlight?: boolean;
  onImprovise?: () => void;
  improvBusy?: boolean;
  improvError?: string | null;
  // GitHub
  githubStatus?: GitHubStatus | null;
  githubConnectBusy?: boolean;
  githubPushBusy?: boolean;
  githubPushError?: string | null;
  onGithubConnect?: () => void;
  onGithubPush?: () => void;
  onGithubDisconnect?: () => void;
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
  highlight = false,
  onImprovise,
  improvBusy,
  improvError,
  githubStatus,
  githubConnectBusy,
  githubPushBusy,
  githubPushError,
  onGithubConnect,
  onGithubPush,
  onGithubDisconnect,
}: Props) {
  const primaryUrl = liveUrl || sandboxUrl || null;
  const canImprovise = Boolean(onImprovise && (liveUrl || canPublish));
  const showGithub = Boolean(liveUrl && onGithubConnect);
  const repoShort = githubStatus?.repoUrl
    ? githubStatus.repoUrl.replace("https://github.com/", "")
    : null;

  return (
    <section
      className={`card preview-card${primaryUrl ? " has-url" : ""}${highlight ? " is-shipped" : ""}`}
      aria-label="Live app"
    >
      <header className="preview-card-head">
        <div>
          <p className="orch-kicker">{highlight ? "Just shipped" : "Deploy"}</p>
          <h3 className="preview-card-title">Live app</h3>
        </div>
        {primaryUrl ? (
          <a className="preview-card-open" href={primaryUrl} target="_blank" rel="noopener noreferrer">
            Open
            <IconExternal size={13} aria-hidden />
          </a>
        ) : null}
      </header>

      {previewError ? <p className="preview-card-error">{previewError}</p> : null}
      {publishError ? <p className="preview-card-error">{publishError}</p> : null}
      {improvError ? <p className="preview-card-error">{improvError}</p> : null}

      {primaryUrl ? (
        <a className="preview-card-url" href={primaryUrl} target="_blank" rel="noopener noreferrer" title={primaryUrl}>
          {liveUrl ? `Live · ${displayHost(primaryUrl)}` : displayHost(primaryUrl)}
        </a>
      ) : (
        <div className="preview-card-empty">
          <p className="muted">
            {canPublish ? "Ready to publish a shareable URL." : "The live URL appears here when the crew finishes shipping."}
          </p>
        </div>
      )}

      {liveUrl && sandboxUrl && sandboxUrl !== liveUrl ? (
        <a className="preview-card-url preview-card-publish-url" href={sandboxUrl} target="_blank" rel="noopener noreferrer" title={sandboxUrl}>
          Sandbox · {displayHost(sandboxUrl)}
        </a>
      ) : null}

      {canImprovise && improvBusy ? (
        <div className="preview-card-improvise-status">
          <span className="preview-card-improvise-pulse" aria-hidden />
          Diagnosing &amp; rewriting…
        </div>
      ) : null}

      <div className="preview-card-actions">
        {onPublish && liveUrl ? (
          <Button type="primary" size="small" loading={publishBusy} onClick={onPublish}>Republish</Button>
        ) : null}
        {onPublish && !liveUrl && canPublish ? (
          <Button type="primary" size="small" loading={publishBusy} onClick={onPublish}>Publish</Button>
        ) : null}
        {sandboxAvailable && onStartSandbox ? (
          <Button type="default" size="small" loading={previewBusy} onClick={onStartSandbox}>
            {sandboxUrl ? "Refresh sandbox" : "Sandbox preview"}
          </Button>
        ) : null}
        {canImprovise ? (
          <Button size="small" loading={improvBusy} disabled={improvBusy} onClick={onImprovise}
            icon={<IconWand size={13} aria-hidden />} className="preview-card-improvise-btn">
            Improvise
          </Button>
        ) : null}
      </div>

      {showGithub ? (
        <div className="preview-card-github">
          <div className="preview-card-github-row">
            <span className="preview-card-github-label">
              <IconGitHub size={12} aria-hidden />
              Code
            </span>
            {githubStatus?.repoUrl ? (
              <a className="preview-card-open" href={githubStatus.repoUrl} target="_blank" rel="noopener noreferrer">
                Repo <IconExternal size={12} aria-hidden />
              </a>
            ) : null}
          </div>
          {githubPushError ? <p className="preview-card-error">{githubPushError}</p> : null}
          {githubStatus?.connected ? (
            <>
              {repoShort ? (
                <a className="preview-card-url" href={githubStatus.repoUrl!} target="_blank" rel="noopener noreferrer" title={githubStatus.repoUrl!}>
                  {repoShort}
                </a>
              ) : null}
              <div className="preview-card-actions">
                <Button type="default" size="small" loading={githubPushBusy} onClick={onGithubPush}>
                  {repoShort ? "Re-push" : "Push to GitHub"}
                </Button>
                <Button type="text" size="small" className="github-card-disconnect" onClick={onGithubDisconnect}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <div className="preview-card-actions">
              <Button size="small" loading={githubConnectBusy} onClick={onGithubConnect}
                icon={<IconGitHub size={13} aria-hidden />}>
                Connect GitHub
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
