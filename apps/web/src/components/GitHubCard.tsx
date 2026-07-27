import { Button } from "antd";
import { IconExternal, IconGitHub } from "./icons";
import type { GitHubStatus } from "../api";

interface Props {
  projectId: string;
  status: GitHubStatus | null;
  loading?: boolean;
  pushBusy?: boolean;
  pushError?: string | null;
  connectBusy?: boolean;
  canPush?: boolean;
  onConnect: () => void;
  onPush: () => void;
  onDisconnect: () => void;
}

export function GitHubCard({
  status,
  loading,
  pushBusy,
  pushError,
  connectBusy,
  canPush = false,
  onConnect,
  onPush,
  onDisconnect,
}: Props) {
  const repoShort = status?.repoUrl
    ? status.repoUrl.replace("https://github.com/", "")
    : null;

  return (
    <section className="card github-card" aria-label="GitHub">
      <header className="preview-card-head">
        <div>
          <p className="orch-kicker">Code</p>
          <h3 className="preview-card-title">
            <IconGitHub size={15} aria-hidden />
          </h3>
        </div>
        {status?.repoUrl ? (
          <a
            className="preview-card-open"
            href={status.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Repo
            <IconExternal size={13} aria-hidden />
          </a>
        ) : null}
      </header>

      {pushError ? <p className="preview-card-error">{pushError}</p> : null}

      {loading ? (
        <div className="preview-card-empty">
          <p className="muted">Checking…</p>
        </div>
      ) : status?.connected ? (
        <>
          {repoShort ? (
            <a
              className="preview-card-url"
              href={status.repoUrl!}
              target="_blank"
              rel="noopener noreferrer"
              title={status.repoUrl!}
            >
              {repoShort}
            </a>
          ) : (
            <div className="preview-card-empty">
              <p className="muted">Push your code to a private GitHub repo.</p>
            </div>
          )}
          <div className="preview-card-actions">
            {canPush ? (
              <Button type="primary" size="small" loading={pushBusy} onClick={onPush}>
                {repoShort ? "Re-push" : "Push to GitHub"}
              </Button>
            ) : null}
            <Button type="text" size="small" className="github-card-disconnect" onClick={onDisconnect}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="preview-card-empty">
            <p className="muted">Get a private repo with your generated code.</p>
          </div>
          <div className="preview-card-actions">
            <Button
              size="small"
              loading={connectBusy}
              onClick={onConnect}
              icon={<IconGitHub size={13} aria-hidden />}
            >
              Connect GitHub
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
