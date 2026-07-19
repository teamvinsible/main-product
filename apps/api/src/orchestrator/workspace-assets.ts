/**
 * Keep generated static apps publishable: LLMs often write
 * `home/user/styles.css` while HTML links `styles.css` at the root.
 */

const ROOT_ASSET_NAMES = new Set([
  "index.html",
  "styles.css",
  "style.css",
  "app.js",
  "main.js",
  "script.js",
  "package.json",
]);

/** Normalize a model-supplied path to a workspace-relative key. */
export function safePath(path: string): string | null {
  let cleaned = path.trim().replace(/\\/g, "/");
  // Strip drive letters / absolute roots the model invents.
  cleaned = cleaned.replace(/^[a-zA-Z]:\//, "");
  cleaned = cleaned.replace(/^\/+/, "");
  // Common hallucinated Unix homes / tool roots.
  cleaned = cleaned
    .replace(/^(home\/[^/]+\/)+/i, "")
    .replace(/^(Users\/[^/]+\/)+/i, "")
    .replace(/^(root\/)+/i, "")
    .replace(/^(\.\/)+/, "");

  if (!cleaned || cleaned.includes("..") || cleaned.startsWith(".git/")) return null;
  if (cleaned.length > 200) return null;

  const base = cleaned.split("/").pop() || cleaned;
  // Force well-known entry assets to the workspace root so HTML relative links work.
  if (ROOT_ASSET_NAMES.has(base.toLowerCase()) && cleaned.includes("/")) {
    return base;
  }
  return cleaned;
}

/** Relative asset refs from HTML (href/src), excluding absolute/hash/data URLs. */
export function htmlRelativeAssets(html: string): string[] {
  const found = new Set<string>();
  const re = /\b(?:href|src)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = match[1]!.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("data:") || raw.startsWith("mailto:")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // http(s), etc.
    const cleaned = safePath(raw.replace(/^\.\//, "")) || raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (cleaned && !cleaned.includes("..")) found.add(cleaned);
  }
  return [...found];
}

export type WorkspaceIO = {
  list: (prefix?: string) => Promise<string[]>;
  get: (path: string) => Promise<string | null>;
  put: (path: string, content: string) => Promise<void>;
};

/**
 * Ensure HTML-referenced relative assets exist at the linked paths.
 * Copies misplaced basename matches (e.g. home/user/styles.css → styles.css).
 */
export async function normalizeWorkspaceAssets(io: WorkspaceIO): Promise<{
  fixed: string[];
  missing: string[];
}> {
  const fixed: string[] = [];
  const missing: string[] = [];
  const index = await io.get("index.html");
  if (!index) return { fixed, missing: ["index.html"] };

  const files = await io.list();
  const byBase = new Map<string, string[]>();
  for (const file of files) {
    const base = file.split("/").pop() || file;
    const list = byBase.get(base) || [];
    list.push(file);
    byBase.set(base, list);
  }

  for (const asset of htmlRelativeAssets(index)) {
    const direct = await io.get(asset);
    if (direct != null) continue;

    const base = asset.split("/").pop() || asset;
    const candidates = (byBase.get(base) || []).filter((p) => p !== asset);
    // Prefer the largest non-empty misplaced file (skip tiny stubs).
    let best: { path: string; content: string } | null = null;
    for (const candidate of candidates) {
      const content = await io.get(candidate);
      if (content == null) continue;
      if (!best || content.length > best.content.length) {
        best = { path: candidate, content };
      }
    }

    if (best && best.content.trim().length > 0) {
      await io.put(asset, best.content);
      fixed.push(`${best.path} → ${asset}`);
      continue;
    }

    // Last resort stubs so the page does not 404 hard.
    if (base.endsWith(".css")) {
      await io.put(asset, `/* auto-generated stub for missing ${asset} */\nbody{font-family:system-ui,sans-serif}\n`);
      fixed.push(`stub:${asset}`);
    } else if (base.endsWith(".js") || base.endsWith(".mjs")) {
      await io.put(asset, `/* auto-generated stub for missing ${asset} */\nconsole.info("Teamvinsible: ${asset} was missing at publish time");\n`);
      fixed.push(`stub:${asset}`);
    } else {
      missing.push(asset);
    }
  }

  return { fixed, missing };
}
