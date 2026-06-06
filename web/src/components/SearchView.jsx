import { useSearch } from '../hooks/useSearch.js';
import { SourcesList } from './SourcesList.jsx';

export function SearchView() {
  const search = useSearch();

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      search.search().catch(() => {});
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-200">Search query</span>
          <input
            type="text"
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search your documents..."
            className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => search.search().catch(() => {})}
            disabled={search.isLoading}
            className="rounded-full bg-atlas-sky px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-atlas-sky/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {search.isLoading ? 'Searching&hellip;' : 'Search'}
          </button>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              search.status === 'success'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                : search.status === 'error'
                  ? 'bg-rose-500/15 text-rose-200 border-rose-500/20'
                  : search.status === 'loading'
                    ? 'bg-amber-500/15 text-amber-200 border-amber-500/20'
                    : 'bg-white/5 text-slate-300 border-white/10'
            }`}
          >
            {search.status === 'idle' ? 'Ready' : search.status}
          </span>
        </div>

        {search.error && <p className="text-sm text-rose-200">{search.error}</p>}
      </div>

      <div>
        <SourcesList sources={search.matches} emptyLabel="No results yet. Enter a query and click Search." />
      </div>
    </div>
  );
}
