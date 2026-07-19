import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
  className?: string;
}

/** If every non-empty line shares leading spaces, strip them so GFM doesn't treat the file as a code block. */
function dedentCommonIndent(text: string): string {
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

/** Renders markdown artifact bodies as readable prose (not raw source). */
export function MarkdownDoc({ content, className = "" }: Props) {
  const text = dedentCommonIndent(content).trim();
  if (!text) return <p className="muted">No content yet.</p>;

  return (
    <div className={`markdown-doc ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
