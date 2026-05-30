import { useEffect, useMemo, useState } from 'react';

import { ChatTranscript } from './components/ChatTranscript.jsx';
import { Panel } from './components/Panel.jsx';
import { SourcesList } from './components/SourcesList.jsx';
import { useDocuments } from './hooks/useDocuments.js';
import { useChat } from './hooks/useChat.js';
import { useGenerate } from './hooks/useGenerate.js';
import { useSearch } from './hooks/useSearch.js';
import { useUpload } from './hooks/useUpload.js';

function StatusPill({ status, children }) {
  const styles =
    status === 'success'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
      : status === 'error'
        ? 'bg-rose-500/15 text-rose-200 border-rose-500/20'
        : status === 'loading'
          ? 'bg-amber-500/15 text-amber-200 border-amber-500/20'
          : 'bg-white/5 text-slate-300 border-white/10';

  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}>{children}</span>;
}

function getDocumentStatusTone(status) {
  if (status === 'ready') {
    return 'success';
  }

  if (status === 'failed') {
    return 'error';
  }

  return 'loading';
}

function getDocumentStatusLabel(status) {
  if (status === 'ready') {
    return 'Ready';
  }

  if (status === 'failed') {
    return 'Failed';
  }

  return 'Processing';
}

function formatDocumentTimestamp(timestamp) {
  if (!timestamp) {
    return '—';
  }

  return new Date(timestamp).toLocaleString();
}

function App() {
  const upload = useUpload();
  const documents = useDocuments();
  const search = useSearch();
  const generation = useGenerate();
  const chat = useChat();

  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        setHealth(data);
      } catch (error_) {
        if (error_ instanceof DOMException && error_.name === 'AbortError') {
          return;
        }

        setHealthError(error_ instanceof Error ? error_.message : 'Unable to reach API');
      }
    }

    void loadHealth();

    return () => controller.abort();
  }, []);

  const currentSources = useMemo(() => {
    if (chat.messages.length) {
      const assistantMessage = [...chat.messages].reverse().find((message) => message.role === 'assistant' && Array.isArray(message.sources));
      if (assistantMessage?.sources?.length) {
        return assistantMessage.sources;
      }
    }

    return generation.sources ?? [];
  }, [chat.messages, generation.sources]);

  function handleUploadFileChange(event) {
    const nextFile = event.target.files?.[0] ?? null;
    upload.setFile(nextFile);
  }

  async function handleUpload() {
    try {
      await upload.upload();
      await documents.reload();
    } catch {
      // handled in hook state
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(72,215,200,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(124,199,255,0.14),_transparent_28%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-10">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-atlas-sky/80">Atlas</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Functional MVP workspace for document RAG.
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 shadow-glow backdrop-blur">
              Free stack · Groq · Neon · pgvector
            </div>
            <StatusPill status={healthError ? 'error' : health ? 'success' : 'loading'}>
              {healthError ? 'API error' : health ? 'API connected' : 'Checking API'}
            </StatusPill>
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-8 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-6">
            <Panel
              eyebrow="Ingestion"
              title="Document library"
              description="Upload a PDF or TXT file and watch Atlas process it automatically. Ready documents are searchable and chat-ready."
            >
              <div className="space-y-6">
                <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <label className="block rounded-2xl border border-dashed border-white/15 bg-slate-950/30 p-4">
                    <span className="mb-2 block text-sm font-medium text-slate-200">File picker</span>
                    <input
                      type="file"
                      accept=".pdf,.txt,application/pdf,text/plain"
                      onChange={handleUploadFileChange}
                      className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-full file:border-0 file:bg-atlas-teal/15 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-atlas-teal hover:file:bg-atlas-teal/20"
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleUpload}
                      disabled={upload.isLoading || documents.isLoading}
                      className="rounded-full bg-atlas-teal px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {upload.isLoading ? 'Uploading…' : 'Upload'}
                    </button>
                    <StatusPill status={upload.status}>{upload.status === 'idle' ? 'Ready' : upload.status}</StatusPill>
                    {upload.file && <span className="text-sm text-slate-300">Selected file: {upload.file.name}</span>}
                  </div>

                  {upload.error && <p className="text-sm text-rose-200">{upload.error}</p>}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-300">{documents.documents.length} document{documents.documents.length === 1 ? '' : 's'}</p>
                    <button
                      type="button"
                      onClick={() => documents.reload().catch(() => {})}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      Refresh
                    </button>
                  </div>

                  {documents.error && <p className="text-sm text-rose-200">{documents.error}</p>}

                  <div className="space-y-3">
                    {documents.documents.length > 0 ? (
                      documents.documents.map((document) => {
                        const visibleStatus = getDocumentStatusLabel(document.status);
                        const statusTone = getDocumentStatusTone(document.status);

                        return (
                          <article key={document.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="text-sm font-semibold text-white">{document.fileName}</h3>
                                <p className="mt-1 text-xs text-slate-400">Created {formatDocumentTimestamp(document.createdAt)}</p>
                              </div>
                              <StatusPill status={statusTone}>{visibleStatus}</StatusPill>
                            </div>

                            <div className="mt-4 space-y-2">
                              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    document.status === 'ready'
                                      ? 'bg-emerald-400'
                                      : document.status === 'failed'
                                        ? 'bg-rose-400'
                                        : 'bg-atlas-teal'
                                  }`}
                                  style={{ width: `${Math.max(0, Math.min(100, Number(document.progress) || 0))}%` }}
                                />
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.22em] text-slate-400">
                                <span>Progress {Number(document.progress) || 0}%</span>
                                <span className="text-white/20">·</span>
                                <span>Ready {formatDocumentTimestamp(document.readyAt)}</span>
                              </div>
                              {document.failureReason && <p className="text-sm text-rose-200">{document.failureReason}</p>}
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <p className="text-sm text-slate-400">No documents uploaded yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel
              eyebrow="Search"
              title="Semantic search"
              description="Ask a query and review the best matching chunks with similarity scores."
            >
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Query</span>
                  <input
                    type="text"
                    value={search.query}
                    onChange={(event) => search.setQuery(event.target.value)}
                    placeholder="What is Atlas?"
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
                    {search.isLoading ? 'Searching…' : 'Search'}
                  </button>
                  <StatusPill status={search.status}>{search.status === 'idle' ? 'Ready' : search.status}</StatusPill>
                </div>

                {search.error && <p className="text-sm text-rose-200">{search.error}</p>}

                <div className="space-y-3">
                  {search.matches.length > 0 ? (
                    search.matches.map((match, index) => (
                      <article key={`${match.chunkId ?? index}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
                          <span>Chunk {match.chunkIndex}</span>
                          <span className="text-white/20">·</span>
                          <span>Doc {match.documentId}</span>
                          <span className="text-white/20">·</span>
                          <span>Similarity {(Number(match.similarity) || 0).toFixed(2)}</span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-200">{match.chunkText}</p>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">No search results yet.</p>
                  )}
                </div>
              </div>
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel
              eyebrow="Generation"
              title="Generate answer"
              description="Call the answer endpoint directly and inspect the preserved sources returned with the response."
            >
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Question</span>
                  <textarea
                    value={generation.question}
                    onChange={(event) => generation.setQuestion(event.target.value)}
                    placeholder="What is Atlas?"
                    rows={4}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => generation.ask().catch(() => {})}
                    disabled={generation.isLoading}
                    className="rounded-full bg-atlas-teal px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {generation.isLoading ? 'Thinking…' : 'Ask'}
                  </button>
                  <StatusPill status={generation.status}>{generation.status === 'idle' ? 'Ready' : generation.status}</StatusPill>
                </div>

                {generation.error && <p className="text-sm text-rose-200">{generation.error}</p>}

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Answer</p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                    {generation.answer || 'No answer yet.'}
                  </p>
                </div>
              </div>
            </Panel>

            <Panel
              eyebrow="Chat"
              title="Conversation"
              description="Persistent conversationId, local message history, and backend chat turns in one thread."
              action={
                <button
                  type="button"
                  onClick={chat.resetConversation}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  New conversation
                </button>
              }
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill status={chat.status}>{chat.status === 'idle' ? 'Ready' : chat.status}</StatusPill>
                  {chat.conversationId ? (
                    <span className="font-mono text-xs text-slate-300">conversationId: {chat.conversationId}</span>
                  ) : (
                    <span className="text-xs text-slate-400">A conversation will be created on first send.</span>
                  )}
                </div>

                <ChatTranscript messages={chat.messages} />

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Message</span>
                  <textarea
                    value={chat.message}
                    onChange={(event) => chat.setMessage(event.target.value)}
                    placeholder="Ask a follow-up question"
                    rows={3}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => chat.send().catch(() => {})}
                    disabled={chat.isLoading}
                    className="rounded-full bg-atlas-sky px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-atlas-sky/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {chat.isLoading ? 'Sending…' : 'Send'}
                  </button>
                </div>

                {chat.error && <p className="text-sm text-rose-200">{chat.error}</p>}
              </div>
            </Panel>

            <Panel
              eyebrow="Sources"
              title="Latest citations"
              description="Displays the citations returned by the most recent generate or chat response."
            >
              <SourcesList sources={currentSources} emptyLabel="No citations returned yet." />
            </Panel>

            <div className="rounded-[2rem] border border-white/10 bg-slate-950/60 p-5 text-sm text-slate-300 shadow-glow backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <span className="uppercase tracking-[0.24em] text-slate-500">Status</span>
                <span className="font-mono text-xs text-slate-400">{health?.service ?? 'atlas-api'}</span>
              </div>
              <p className="mt-3 leading-6">
                {health?.status ?? healthError ?? 'Waiting for a backend response.'}
              </p>
              {health?.timestamp && (
                <p className="mt-3 font-mono text-xs text-slate-500">
                  {new Date(health.timestamp).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
