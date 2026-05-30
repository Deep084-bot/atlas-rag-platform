import { useEffect, useState } from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';

function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth() {
      try {
        const response = await fetch(`${apiBase}/api/health`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        setHealth(data);
      } catch (error_) {
        if (error_ instanceof DOMException && error_.name === 'AbortError') {
          return;
        }

        setError(error_ instanceof Error ? error_.message : 'Unable to reach API');
      }
    }

    void loadHealth();

    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(72,215,200,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(124,199,255,0.14),_transparent_28%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-atlas-sky/80">Atlas</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Personal knowledge, shaped for retrieval.
            </h1>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 shadow-glow backdrop-blur">
            Free stack · Groq · Neon · pgvector
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-start">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-atlas-panel p-8 shadow-glow backdrop-blur-xl md:p-10">
              <div className="inline-flex rounded-full border border-atlas-teal/30 bg-atlas-teal/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-atlas-teal">
                Approved architecture, first slice
              </div>
              <h2 className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                Upload your notes, index them locally, and ask Atlas with citations.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                This implementation starts the production spine: a React and Tailwind frontend, an Express API,
                a Neon-ready PostgreSQL schema with pgvector, and a Vercel-compatible deployment path.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                {['PDF upload', 'TXT upload', 'Semantic search', 'Citation-aware chat'].map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['Ingestion', 'PDF and TXT files flow into a document pipeline with chunking and metadata capture.'],
                ['Retrieval', 'pgvector stores embeddings for semantic search over personal knowledge.'],
                ['Generation', 'Groq handles responses while citations stay attached to the retrieved context.']
              ].map(([title, description]) => (
                <article key={title} className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                  <h3 className="text-lg font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="space-y-4 rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 shadow-glow backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">System status</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${health ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                {health ? 'Connected' : 'Checking'}
              </span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">API</p>
              <p className="mt-2 text-lg font-semibold text-white">{health?.service ?? 'atlas-api'}</p>
              <p className="mt-1 text-sm text-slate-300">{health?.status ?? 'Waiting for a response from the backend.'}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Last check</p>
              <p className="mt-2 font-mono text-sm text-slate-200">
                {health?.timestamp ? new Date(health.timestamp).toLocaleString() : 'Pending'}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Notes</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                This first slice is intentionally narrow: it proves the repo shape, deployment path, and backend
                handshake before the ingestion and retrieval logic lands.
              </p>
            </div>

            {(error ?? null) && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                {error}
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}

export default App;
