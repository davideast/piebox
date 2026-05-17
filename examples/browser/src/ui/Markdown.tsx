// Minimal markdown renderer for assistant prose. Adapted from
// playground-next/src/components/Markdown.tsx — same element-level
// overrides, but without the typewriter or the CodeBlock chrome
// (fenced code renders as a styled <pre><code> inline so we don't have
// to vendor a second component).
//
// Typography cascades from the parent — wrap in font-display / text-
// [13px] / text-soft-white at the call site. No raw HTML (defaults).
// Streaming-friendly: partial markdown renders as literal text until
// the close arrives.
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  source: string;
}

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="font-bold text-[1.25em] mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-bold text-[1.15em] mt-4 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-bold text-[1.05em] mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="font-bold mt-3 mb-1.5 first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="font-semibold mt-2 mb-1 first:mt-0">{children}</h5>,
  h6: ({ children }) => (
    <h6 className="font-semibold mt-2 mb-1 first:mt-0 text-slate-gray">{children}</h6>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="line-through opacity-70">{children}</del>,
  hr: () => <hr className="my-4 border-0 border-t border-[#2a2a35]" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[#2a2a35] pl-3 my-3 italic text-slate-gray">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-slate-gray/40 underline-offset-2 text-[#8db4d4] hover:text-soft-white transition-colors"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto custom-scrollbar">
      <table className="border-collapse w-full text-[0.92em]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-[#2a2a35]/40 last:border-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1.5 font-semibold text-left text-slate-gray uppercase tracking-wider text-[0.85em]">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-2 py-1.5 align-top">{children}</td>,

  // Fenced code: language-* className signals a block; inline has none.
  // The outer <pre> renderer below sheds its default browser styling so
  // the <code>'s bordered chrome reads as the panel, not a doubled wrap.
  code: ({ className, children, ...rest }) => {
    const match = /^language-([\w-]+)/.exec(className ?? '');
    if (match) {
      const lang = match[1]!.toLowerCase();
      const text = String(children ?? '').replace(/\n$/, '');
      return (
        <code
          data-language={lang}
          className="block font-mono text-[12px] leading-[1.5] bg-[#0e0e12] text-soft-white/90 border border-[#2a2a35] rounded p-3 overflow-x-auto whitespace-pre"
          {...rest}
        >
          {text}
        </code>
      );
    }
    return (
      <code
        className="font-mono text-[0.9em] bg-[#2a2a35]/60 rounded px-1 py-0.5 text-[#e0b489] break-words"
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <div className="my-4">{children}</div>,
};

export function Markdown({ source }: MarkdownProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  );
}
