/**
 * Format an ISO timestamp (or legacy display string) for the dashboard.
 * Legacy Mediator rows used the literal "Just now" — those stay as-is unless we have no better signal.
 */
export function formatRelativeTime(value?: string | null, nowMs = Date.now()): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Already a human phrase from older payloads / mocks.
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed) && Number.isNaN(Date.parse(trimmed))) {
    return trimmed;
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return trimmed;

  const deltaSec = Math.round((nowMs - ms) / 1000);
  if (deltaSec < 45) return "Just now";
  if (deltaSec < 90) return "1m ago";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 48 * 3600) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 14 * 24 * 3600) return `${Math.floor(deltaSec / 86400)}d ago`;

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(ms));
  } catch {
    return trimmed.slice(0, 10);
  }
}

/** Clock time for activity rows (e.g. "2:04 PM"). Falls back for legacy "14:02" mocks. */
export function formatClockTime(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(trimmed)) return trimmed;

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return trimmed;

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return trimmed;
  }
}
