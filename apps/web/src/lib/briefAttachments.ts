export type BriefAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Extracted text for text-like files; null when binary / unreadable */
  text: string | null;
  status: "ready" | "error";
  error?: string;
};

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 8;
const TEXT_EXT =
  /\.(txt|md|markdown|mdx|csv|tsv|json|jsonc|ya?ml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|sql|sh|bash|zsh|env|ini|toml|graphql|gql|vue|svelte|log|rtf)$/i;

const TEXT_MIME =
  /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml|sql|graphql|x-sh))/i;

export function canExtractText(file: File): boolean {
  if (TEXT_MIME.test(file.type)) return true;
  if (TEXT_EXT.test(file.name)) return true;
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function readBriefAttachment(file: File): Promise<BriefAttachment> {
  const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
  if (file.size > MAX_BYTES) {
    return {
      id,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      text: null,
      status: "error",
      error: `Larger than ${formatBytes(MAX_BYTES)}`,
    };
  }

  if (!canExtractText(file)) {
    return {
      id,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      text: null,
      status: "ready",
    };
  }

  try {
    const text = await file.text();
    return {
      id,
      name: file.name,
      size: file.size,
      type: file.type || "text/plain",
      text,
      status: "ready",
    };
  } catch {
    return {
      id,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      text: null,
      status: "error",
      error: "Could not read file",
    };
  }
}

export function mergeAttachments(
  current: BriefAttachment[],
  incoming: BriefAttachment[],
): BriefAttachment[] {
  const byKey = new Map(current.map((a) => [`${a.name}:${a.size}`, a]));
  for (const next of incoming) {
    byKey.set(`${next.name}:${next.size}`, next);
  }
  return Array.from(byKey.values()).slice(0, MAX_FILES);
}

/** Compose brief + documents into one idea string for intake / run. */
export function composeBriefIdea(
  brief: string,
  attachments: BriefAttachment[],
  opts?: { url?: string },
): string {
  const parts: string[] = [];
  const body = brief.trim();
  if (opts?.url) {
    parts.push(`Build from reference URL: ${opts.url}.`);
    if (body) parts.push(body);
  } else if (body) {
    parts.push(body);
  }

  const usable = attachments.filter((a) => a.status === "ready");
  if (usable.length === 0) return parts.join("\n\n").trim();

  parts.push("Attached documents:");
  for (const file of usable) {
    if (file.text != null && file.text.trim()) {
      const clipped =
        file.text.length > 40_000
          ? `${file.text.slice(0, 40_000)}\n\n…[truncated ${formatBytes(file.size - 40_000)}]`
          : file.text;
      parts.push(`--- ${file.name} (${formatBytes(file.size)}) ---\n${clipped}`);
    } else {
      parts.push(
        `--- ${file.name} (${formatBytes(file.size)}, ${file.type || "binary"}) ---\n[Binary or non-text attachment — filename referenced only; paste text or use a .md/.txt export for full content.]`,
      );
    }
  }
  return parts.join("\n\n").trim();
}

export const BRIEF_ACCEPT =
  ".txt,.md,.markdown,.csv,.json,.yml,.yaml,.xml,.html,.css,.js,.ts,.tsx,.py,.sql,.log,text/plain,text/markdown,application/json,text/csv";

export { MAX_BYTES, MAX_FILES };
