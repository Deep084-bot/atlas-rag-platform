import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { SourcesList } from './SourcesList.jsx';

const LOADING_MESSAGES = [
  'Searching your knowledge base...',
  'Retrieving relevant documents...',
  'Analyzing document context...',
  'Ranking results by relevance...',
  'Generating citation-backed answer...',
  'Fact-checking against sources...',
  'Polishing the response...',
];

function MarkdownContent({ content }) {
  return (
    <div className="markdown-body mt-3 text-sm leading-6 text-slate-100">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0 leading-6">{children}</p>,
          h1: ({ children }) => <h1 className="mb-3 mt-6 text-lg font-bold text-white first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-5 text-base font-bold text-white first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold text-white first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="text-slate-100">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-slate-100">{children}</em>,
          code: ({ children }) => (
            <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-sm text-atlas-teal">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-xl border border-white/10 bg-slate-900/80 p-4 font-mono text-sm last:mb-0">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-atlas-teal/40 pl-4 text-slate-300 last:mb-0">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-atlas-sky underline underline-offset-2 hover:text-atlas-sky/80">
              {children}
            </a>
          ),
          hr: () => <hr className="mb-3 border-white/10 last:mb-0" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function StreamingIndicator() {
  const [loadingIndex, setLoadingIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadingIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-500 italic transition-opacity duration-300">{LOADING_MESSAGES[loadingIndex]}</p>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-atlas-teal/60 [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-atlas-teal/60 [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-atlas-teal/60 [animation-delay:300ms]" />
      </span>
    </div>
  );
}

function AssistantMessage({ message, isStreaming }) {
  const [showSources, setShowSources] = useState(false);
  const hasSources = Array.isArray(message.sources) && message.sources.length > 0;
  const showEmptyIndicator = isStreaming && !message.content;

  return (
    <>
      {showEmptyIndicator ? (
        <StreamingIndicator />
      ) : (
        <MarkdownContent content={message.content} />
      )}
      {isStreaming && !showEmptyIndicator && message.content && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-atlas-teal align-text-bottom" />
      )}
      {hasSources && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          >
            {showSources ? 'Hide Sources' : `Sources (${message.sources.length})`}
          </button>
          {showSources && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Sources</p>
              <SourcesList sources={message.sources} emptyLabel="No sources attached." />
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function ChatTranscript({ messages = [], isStreaming = false }) {
  if (!messages.length) {
    return <p className="text-sm text-slate-400">No messages yet. Send a question to start the conversation.</p>;
  }

  const lastAssistantId = messages.reduceRight((found, m) => found || (m.role === 'assistant' ? m.id : null), null);

  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const isLastAssistant = isStreaming && message.id === lastAssistantId;

        return (
          <article
            key={message.id}
            className={`rounded-2xl border p-4 ${message.role === 'user' ? 'border-atlas-sky/20 bg-slate-900/70' : 'border-atlas-teal/20 bg-white/5'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{message.role}</p>
            </div>
            {message.role === 'assistant' ? (
              <AssistantMessage message={message} isStreaming={isLastAssistant} />
            ) : (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">{message.content}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}