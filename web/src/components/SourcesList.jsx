export function SourcesList({ sources = [], emptyLabel = 'No sources yet.' }) {
  if (!sources.length) {
    return <p className="text-sm text-slate-400">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {sources.map((source, index) => (
        <article key={`${source.chunkId ?? index}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
            <span>{source.fileName ?? 'Unknown document'}</span>
            <span className="text-white/20">·</span>
            <span>Chunk {source.chunkIndex ?? index + 1}</span>
            <span className="text-white/20">·</span>
            <span>Similarity {(Number(source.similarity) || 0).toFixed(2)}</span>
          </div>
          <p className="mt-2 break-words text-sm text-slate-200">{source.chunkText ?? ''}</p>
        </article>
      ))}
    </div>
  );
}