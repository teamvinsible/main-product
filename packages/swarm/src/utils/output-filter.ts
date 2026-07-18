// ──────────────────────────────────────────────────────────────────────────
// Output compression — token optimization baked in at the code level (no
// external binary, no proxy).
//
// Why this lives here: in the DeepSeek agent loop the orchestrator executes
// tools itself and feeds the raw result back into the `messages` array. That
// array is re-sent to the model on EVERY subsequent turn, so a verbose
// `npm install` log or a duplicate file read is paid for once per remaining
// turn. Compressing tool output once therefore saves tokens multiplicatively.
//
// Guiding principle: compress hard on success, stay conservative on failure —
// never strip the signal an agent needs to diagnose an error.
// ──────────────────────────────────────────────────────────────────────────

export interface FilterResult {
  output: string;
  originalChars: number;
  filteredChars: number;
}

/** Approximate tokens from characters (~4 chars/token for English+code). */
export function approxTokens(chars: number): number {
  return Math.round(chars / 4);
}

/**
 * Reduce an HTML document to readable text: drop script/style/noscript blocks,
 * strip tags, decode the common named/numeric entities, and collapse the
 * whitespace runs that markup leaves behind. Good enough to feed a page's prose
 * to a model without shipping the full markup.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => {
      const code = Number(n);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Lines that are pure noise across most toolchains — safe to drop always. */
const NOISE_PATTERNS: RegExp[] = [
  /^\s*$/,                                   // blank (collapsed later, but trim runs)
  /^npm warn /i,
  /^npm notice/i,
  /^npm fund/i,
  /found \d+ vulnerabilities/i,
  /run `npm audit`/i,
  /^\s*[-\\|/]\s*$/,                          // lone spinner frames
  /Resolving deltas:/,
  /Receiving objects:/,
  /Counting objects:/,
  /Compressing objects:/,
  /^\s*\d{1,3}%\s*(\|[^|]*\|)?\s*$/,          // bare progress percentages / bars
  /\[=*>?\s*\]/,                              // [====>   ] style bars
  /webpack compiled/i,
  /^\s*$/,
];

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Carriage-return progress redraws (`\r10%\r20%\r...`) collapse to the final
 * state the terminal would have shown.
 */
function collapseCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const idx = line.lastIndexOf("\r");
      return idx === -1 ? line : line.slice(idx + 1);
    })
    .join("\n");
}

function dropNoiseLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !NOISE_PATTERNS.some((re) => re.test(line)))
    .join("\n");
}

/** Collapse runs of identical adjacent lines into `line  (×N)`. */
function dedupeConsecutive(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let prev: string | null = null;
  let count = 0;
  const flush = () => {
    if (prev === null) return;
    out.push(count > 1 ? `${prev}  (×${count})` : prev);
  };
  for (const line of lines) {
    if (line === prev) {
      count++;
    } else {
      flush();
      prev = line;
      count = 1;
    }
  }
  flush();
  return out.join("\n");
}

/** Keep the head and tail of an over-long block, noting how much was cut. */
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  const cut = text.length - max;
  return (
    text.slice(0, head) +
    `\n… [${cut} chars / ~${approxTokens(cut)} tokens trimmed] …\n` +
    text.slice(text.length - tail)
  );
}

type CommandKind = "install" | "test" | "lint" | "git" | "build" | "discovery" | "generic";

function detectCommand(command: string): CommandKind {
  const c = command.toLowerCase();
  if (/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b/.test(c) || /\bpip\s+install\b/.test(c)) return "install";
  if (/\b(jest|vitest|pytest|mocha|playwright|go\s+test|cargo\s+test)\b/.test(c) || /\b(npm|pnpm|yarn)\s+(run\s+)?test\b/.test(c)) return "test";
  if (/\b(eslint|tsc|ruff|flake8|golangci-lint|rubocop|prettier)\b/.test(c) || /\blint\b/.test(c)) return "lint";
  if (/^\s*git\b/.test(c)) return "git";
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?build\b/.test(c) || /\b(vite|webpack|tsc|next\s+build|cargo\s+build)\b/.test(c)) return "build";
  if (/\b(dir|ls|find|rg\s+--files|get-childitem|tree)\b/.test(c)) return "discovery";
  return "generic";
}

/** On a successful install, the only signal an agent needs is "it worked". */
function summarizeInstall(text: string): string {
  const addedMatch = text.match(/added (\d+) packages?/i);
  const upToDate = /up to date/i.test(text);
  if (addedMatch) return `✓ install ok — added ${addedMatch[1]} packages`;
  if (upToDate) return "✓ install ok — dependencies up to date";
  // Fall back to a few trailing lines.
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.slice(-3).join("\n") || "✓ install ok";
}

/** Success path: keep the test/build summary lines, drop the passing chatter. */
function summarizeTests(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((l) =>
    /\b(fail|failed|error|✕|✗|×|passed|passing|failing|tests?:|suites?:|assert|expect|Σ|total)\b/i.test(l) ||
    /\b\d+\s+(passed|failed|skipped|pending)\b/i.test(l) ||
    /\.(test|spec)\.[jt]sx?/.test(l),
  );
  const body = kept.length ? kept.join("\n") : text;
  return truncateMiddle(body, 1500);
}

/** Keep only lines that carry an error/warning location. */
function summarizeLint(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((l) =>
    /(error|warning)/i.test(l) ||
    /:\d+:\d+/.test(l) ||                      // file:line:col
    /\b\d+\s+problems?\b/i.test(l) ||
    /✖|✗/.test(l),
  );
  return kept.length ? kept.join("\n") : "✓ clean — no lint problems";
}

/**
 * Compress the output of a shell command before it re-enters the model context.
 * `failed` (non-zero exit) flips the filter into conservative mode so error
 * detail is preserved.
 */
export function filterCommandOutput(command: string, raw: string, failed: boolean): FilterResult {
  const originalChars = raw.length;

  let text = stripAnsi(raw);
  text = collapseCarriageReturns(text);
  text = dropNoiseLines(text);
  text = dedupeConsecutive(text);

  const kind = detectCommand(command);

  if (!failed) {
    // Success path: compress hard, the model rarely needs the detail.
    switch (kind) {
      case "install": text = summarizeInstall(text); break;
      case "test":    text = summarizeTests(text); break;
      case "lint":    text = summarizeLint(text); break;
      case "build":   text = summarizeTests(text); break; // reuse summary-keeping
      case "discovery": text = truncateMiddle(text || "(no output)", 5000); break;
      default:        text = truncateMiddle(text, 3000);
    }
  } else {
    // Failure path: preserve the signal. The lossless cleanup above (ANSI,
    // progress redraws, pure-noise lines, adjacent-duplicate collapse) is safe;
    // beyond that we keep everything so the agent can diagnose, capping only to
    // avoid pathological dumps.
    text = truncateMiddle(text, 8000);
    if (/^Exit code \d+\s*$/i.test(text.trim()) && raw.trim().length > text.trim().length) {
      text = truncateMiddle(stripAnsi(collapseCarriageReturns(raw)), 8000);
    }
  }

  text = text.trimEnd();
  return { output: text, originalChars, filteredChars: text.length };
}
