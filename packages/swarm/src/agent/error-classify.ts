// ──────────────────────────────────────────────────────────────────────────
// Provider error classification for the retry / fallback machine.
//
// Three outcomes drive different behavior:
//   retryable — a transient outage (rate-limit, overload, timeout, 5xx). Worth
//               retrying the SAME provider after backoff.
//   fatal     — inherent to the request (oversized prompt, malformed request).
//               Fails identically on every model, so DON'T retry and DON'T fall
//               back — surface it so the caller can shrink the input.
//   failover  — the provider is down/exhausted/misbehaving (quota, auth, or an
//               unknown error). Don't retry here; fall back to the next provider.
// ──────────────────────────────────────────────────────────────────────────

export type ErrorClass = "retryable" | "fatal" | "failover";

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).toLowerCase();
}

/** Transient outage — retry the same provider after backoff. */
export function isTransientError(err: unknown): boolean {
  return /overload|rate.?limit|too many requests|\b429\b|timeout|timed out|econn|socket|network|fetch failed|\b50[234]\b|temporarily|unavailable|server error/.test(message(err));
}

/** Exhausted credits or bad/expired auth — fall through to the next provider. */
export function isQuotaOrAuthError(err: unknown): boolean {
  return /usage credits|insufficient|quota|billing|payment required|\b401\b|\b403\b|unauthorized|authentication|invalid api key|expired/.test(message(err));
}

/** Inherent to the request (oversized/malformed) — neither retry nor fall back. */
export function isFatalError(err: unknown): boolean {
  return /request_too_large|context.?window|context length|maximum context|prompt is too long|too many tokens|\b413\b|\b400\b|invalid_request|malformed/.test(message(err));
}

export function classifyProviderError(err: unknown): ErrorClass {
  if (isFatalError(err)) return "fatal";
  if (isTransientError(err) && !isQuotaOrAuthError(err)) return "retryable";
  return "failover";
}
