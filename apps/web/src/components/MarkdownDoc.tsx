import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeMarkdownSource } from "../lib/markdown";

interface Props {
  content: string;
  className?: string;
}

/** Renders markdown artifact bodies as readable prose (not raw source). */
export function MarkdownDoc({ content, className = "" }: Props) {
  const text = normalizeMarkdownSource(content);
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
