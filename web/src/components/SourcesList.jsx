import { useState } from 'react';

function getFileIcon(fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z';
  if (['txt', 'md'].includes(ext)) return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
  if (['doc', 'docx'].includes(ext)) return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
  return 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z';
}

function getConfidenceColor(score) {
  if (score >= 0.85) return 'text-emerald-400';
  if (score >= 0.7) return 'text-amber-400';
  return 'text-rose-400';
}

export function SourcesList({ sources = [], emptyLabel = 'No sources yet.' }) {
  const [expandedIndex, setExpandedIndex] = useState(null);

  if (!sources.length) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-slate-400">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sources.map((source, index) => {
        const similarity = Math.round((Number(source.similarity) || 0) * 100);
        const confidence = similarity / 100;
        const isExpanded = expandedIndex === index;
        const fileName = source.fileName ?? 'Unknown document';
        const shouldTruncate = (source.chunkText ?? '').length > 200;

        return (
          <div
            key={`${source.chunkId ?? index}-${index}`}
            className="group rounded-xl border border-white/[0.06] bg-white/[0.03] transition-all hover:border-white/[0.12] hover:bg-white/[0.06]"
          >
            <button
              type="button"
              onClick={() => setExpandedIndex(isExpanded ? null : index)}
              className="flex w-full items-start gap-3 p-3 text-left"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04]">
                <svg className="h-4 w-4 text-atlas-teal/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={getFileIcon(fileName)} />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-slate-200">{fileName}</p>
                  {source.pageNumber && (
                    <span className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                      p.{source.pageNumber}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`text-xs font-semibold ${getConfidenceColor(confidence)}`}>
                    {similarity}% confidence
                  </span>
                  <span className="text-[10px] text-slate-600">·</span>
                  <span className="text-xs text-slate-500">
                    {isExpanded ? 'Show less' : shouldTruncate ? 'Show more' : ''}
                  </span>
                </div>
                <div className={`mt-2 text-xs leading-relaxed text-slate-400 transition-all ${
                  isExpanded ? '' : 'line-clamp-2'
                }`}>
                  {source.chunkText ?? ''}
                </div>
              </div>
              <svg className={`mt-1.5 h-3.5 w-3.5 shrink-0 text-slate-500 transition ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
