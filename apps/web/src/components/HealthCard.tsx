import type { CoordinationHealth } from "@teamvinsible/shared";
import { IconPulse } from "./icons";

interface Props {
  health: CoordinationHealth;
  onOpen?: () => void;
}

export function HealthCard({ health, onOpen }: Props) {
  const pct = Math.max(0, Math.min(100, health.alignedPct || 0));
  const attentionCount = health.needsAttention + health.blocked;
  const footerCopy =
    attentionCount > 0
      ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need eyes`
      : "Crew is tracking clean";
  const tone =
    pct >= 75 ? "is-good" : pct >= 45 ? "is-mid" : health.blocked > 0 ? "is-bad" : "is-mid";

  const rows = [
    { key: "aligned", label: "Phases done", count: health.aligned, cls: "aligned" },
    { key: "progress", label: "In progress", count: health.inProgress, cls: "in-progress" },
    { key: "attention", label: "Needs attention", count: health.needsAttention, cls: "attention" },
    { key: "blocked", label: "Blocked", count: health.blocked, cls: "queued" },
  ];

  return (
    <section className={`card health-card ${tone}`} aria-label="Coordination health">
      <header className="health-card-head">
        <div>
          <p className="orch-kicker">Health</p>
          <h3 className="health-card-title">Coordination</h3>
        </div>
        {onOpen ? (
          <button type="button" className="health-card-more" onClick={onOpen}>
            Details
          </button>
        ) : null}
      </header>

      <div className="health-card-body">
        <div className="health-ring-wrap">
          <div
            className="health-ring"
            style={{ ["--pct" as string]: `${pct}%` }}
            role="img"
            aria-label={`${pct}% aligned`}
          >
            <div className="health-ring-hole">
              <strong className="health-ring-value">{pct}%</strong>
              <span className="health-ring-label">Aligned</span>
            </div>
          </div>
          <span className="health-ring-glow" aria-hidden />
        </div>

        <ul className="health-meter-list">
          {rows.map((row, i) => (
            <li key={row.key} style={{ ["--i" as string]: i }}>
              <div className="health-meter-label">
                <span className={`status-dot ${row.cls}`} />
                <span>{row.label}</span>
                <strong>{row.count}</strong>
              </div>
              <div className="health-meter-track" aria-hidden>
                <span
                  className={`health-meter-fill ${row.cls}`}
                  style={{
                    width: `${Math.min(100, row.count * 18 + (row.count > 0 ? 12 : 0))}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {onOpen ? (
        <button
          type="button"
          className="health-card-foot health-card-foot-button"
          onClick={onOpen}
          aria-label={`${footerCopy}. Open coordination health details`}
        >
          <IconPulse size={14} />
          <span>{footerCopy}</span>
          <span className="health-card-foot-action">View</span>
        </button>
      ) : (
        <footer className="health-card-foot">
          <IconPulse size={14} />
          <span>{footerCopy}</span>
        </footer>
      )}
    </section>
  );
}
