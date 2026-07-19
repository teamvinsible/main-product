import { MarkdownDoc } from "./MarkdownDoc";

interface Props {
  content: string;
  contentType?: string | null;
  path?: string | null;
  className?: string;
}

type ArtifactKind = "markdown" | "html" | "json" | "code";

function extOf(path?: string | null): string {
  if (!path) return "";
  const base = path.split("/").pop() || path;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 256).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body");
}

function looksLikeJson(text: string): boolean {
  const head = text.trimStart();
  return (head.startsWith("{") || head.startsWith("[")) && (() => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  })();
}

function detectKind(path?: string | null, contentType?: string | null, content?: string): ArtifactKind {
  const ext = extOf(path);
  const mime = (contentType || "").toLowerCase();

  // File extension wins — R2/metadata MIME is often wrong (e.g. text/html on a .md).
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "json") return "json";
  if (
    ["ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "less", "py", "rs", "go", "java", "kt", "sql", "sh", "yml", "yaml", "toml", "xml", "svg"].includes(ext)
  ) {
    return "code";
  }
  if (ext === "txt") return "markdown";

  if (mime.includes("text/html")) return "html";
  if (mime.includes("application/json") || mime.includes("text/json")) return "json";
  if (mime.includes("text/markdown") || mime.includes("text/x-markdown") || mime.includes("text/plain")) {
    return "markdown";
  }

  const text = (content || "").trim();
  if (text && looksLikeHtml(text)) return "html";
  if (text && looksLikeJson(text)) return "json";
  return "markdown";
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/** Renders an artifact body by content type / file extension (markdown, HTML, JSON, code). */
export function ArtifactDoc({ content, contentType, path, className = "" }: Props) {
  const text = content.trim();
  if (!text) return <p className="muted">No content yet.</p>;

  const kind = detectKind(path, contentType, text);
  const rootClass = `artifact-doc ${className}`.trim();

  if (kind === "html") {
    return (
      <div className={rootClass}>
        <iframe
          className="artifact-html-frame"
          title={path ? `Preview ${path}` : "HTML preview"}
          sandbox=""
          srcDoc={text}
        />
      </div>
    );
  }

  if (kind === "json") {
    return (
      <div className={rootClass}>
        <pre className="artifact-code-block">
          <code>{prettyJson(text)}</code>
        </pre>
      </div>
    );
  }

  if (kind === "code") {
    return (
      <div className={rootClass}>
        <pre className="artifact-code-block">
          <code>{text}</code>
        </pre>
      </div>
    );
  }

  return <MarkdownDoc content={text} className={className} />;
}
