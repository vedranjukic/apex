import { useState } from 'react';
import { FileText, ChevronDown, ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownBlockProps {
  title: string;
  content: string;
}

export function MarkdownBlock({ title, content }: MarkdownBlockProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs hover:bg-surface-secondary/80 transition-colors"
      >
        <FileText className="w-3.5 h-3.5 text-accent" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto">
          {expanded
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-black/20 overflow-x-auto">
          <article className="plan-markdown">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {content}
            </Markdown>
          </article>
        </div>
      )}

      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-3 py-1.5 bg-surface-secondary border-t border-border text-xs text-text-secondary flex items-center justify-center gap-1 hover:text-text-primary transition-colors"
        >
          <ChevronRight className="w-3 h-3" /> Expand
        </button>
      )}
    </div>
  );
}
