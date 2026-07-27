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
  return (
    <section className="card github-card" aria-label="GitHub">
      <header className="preview-card-head">
        <div>
          <p className="orch-kicker">Code</p>
          <h3 className="preview-card-title">
            <IconGitHub size={14} aria-hidden style={{ marginRight: 6, verticalAlign: "middle" }} />
            GitHub
          </h3>
        </div>
        {status?.repoUrl ? (
          <a className="preview-card-open" href={status.repoUrl} target="_blank" rel="noopener noreferrer">
            View repo
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
          <div className="github-card-account">
            {status.avatarUrl ? (
              <img className="github-card-avatar" src={status.avatarUrl} alt={status.login ?? ""} width={24} height={24} />
            ) : (
              <IconGitHub size={18} aria-hidden />
            )}
            <span className="github-card-login">{status.login}</span>
          </div>
          {status.repoUrl ? (
            <a className="preview-card-url" href={status.repoUrl} target="_blank" rel="noopener noreferrer" title={status.repoUrl}>
              {status.repoUrl.replace("https://github.com/", "")}
            </a>
          ) : (
            <div className="preview-card-empty">
              <p className="muted">{canPush ? "Ready to push your code to a private repo." : "Finish the crew run to push your code."}</p>
            </div>
          )}
          <div className="preview-card-actions">
            {canPush ? (
              <Button type="primary" size="small" loading={pushBusy} onClick={onPush}>
                {status.repoUrl ? "Re-push to GitHub" : "Push to GitHub"}
              </Button>
            ) : null}
            <Button type="text" size="small" onClick={onDisconnect} className="github-card-disconnect">
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="preview-card-empty">
            <p className="muted">Connect GitHub to get a private repo with your generated code.</p>
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
