/**
 * Models often wrap the whole artifact in a single ```markdown ... ``` fence.
 * That makes react-markdown render one giant code block (raw # / ** visible).
 */
export function unwrapOuterFence(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 3; i++) {
    const match = t.match(/^```(?:markdown|md|mdx|gfm|text|plain)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
    if (!match) break;
    t = match[1]!.trim();
  }
  return t;
}

/** If every non-empty line shares leading spaces, strip them so GFM doesn't treat the file as a code block. */
export function dedentCommonIndent(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^[ \t]*/);
    const n = match ? match[0].length : 0;
    if (n < minIndent) minIndent = n;
  }
  if (!Number.isFinite(minIndent) || minIndent <= 0) return text;
  return lines.map((line) => (line.trim() ? line.slice(minIndent) : line)).join("\n");
}

/** Normalize artifact markdown so headings/lists render as prose, not source. */
export function normalizeMarkdownSource(content: string): string {
  return dedentCommonIndent(unwrapOuterFence(content.replace(/^\uFEFF/, ""))).trim();
}
