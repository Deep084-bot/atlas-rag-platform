import { SourcesList } from './SourcesList.jsx';

export function ChatTranscript({ messages = [] }) {
  if (!messages.length) {
    return <p className="text-sm text-slate-400">No messages yet. Send a question to start the conversation.</p>;
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <article
          key={message.id}
          className={`rounded-2xl border p-4 ${message.role === 'user' ? 'border-atlas-sky/20 bg-slate-900/70' : 'border-atlas-teal/20 bg-white/5'}`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{message.role}</p>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">{message.content}</p>
          {message.role === 'assistant' && Array.isArray(message.sources) && message.sources.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Sources</p>
              <SourcesList sources={message.sources} emptyLabel="No sources attached." />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}