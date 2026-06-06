import { useEffect, useMemo, useState } from 'react';

import { ChatTranscript } from '../components/ChatTranscript.jsx';
import { SourcesList } from '../components/SourcesList.jsx';
import { Sidebar } from '../components/Sidebar.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { requestJson } from '../api/client.js';
import { useDocuments } from '../hooks/useDocuments.js';
import { useChat } from '../hooks/useChat.js';
import { useUpload } from '../hooks/useUpload.js';

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

function CollapsibleSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-white/10">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-slate-300 transition hover:text-white"
      >
        {title}
        <svg
          className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="space-y-4 px-4 pb-4">{children}</div>}
    </div>
  );
}

export function WorkspacePage() {
  const upload = useUpload();
  const documents = useDocuments();
  const chat = useChat();

  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth() {
      try {
        const data = await requestJson('/api/health', { signal: controller.signal });
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

    return [];
  }, [chat.messages]);

  const activeConversation = useMemo(() => {
    if (!chat.activeConversationId) return null;
    return chat.conversations.find((c) => c.id === chat.activeConversationId) ?? null;
  }, [chat.activeConversationId, chat.conversations]);

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

  const showEmptyState = !chat.activeConversationId && chat.messages.length === 0;
  const showMessages = chat.messages.length > 0;

  return (
    <main className="flex h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(72,215,200,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(124,199,255,0.14),_transparent_28%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] text-slate-100">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          conversations={chat.conversations}
          activeConversationId={chat.activeConversationId}
          isLoading={chat.conversationsLoading}
          onSelect={chat.selectConversation}
          onNew={chat.resetConversation}
          onRename={chat.renameConversation}
          onDelete={chat.deleteConversation}
        />

        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            {chat.messagesLoading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-slate-400">Loading messages&hellip;</p>
              </div>
            ) : chat.messagesError ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-rose-200">{chat.messagesError}</p>
              </div>
            ) : showEmptyState ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-lg text-slate-300">Select a conversation or start a new chat.</p>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
                {activeConversation && (
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">{activeConversation.title}</h2>
                    <StatusPill status={chat.status}>{chat.status === 'idle' ? 'Ready' : chat.status}</StatusPill>
                  </div>
                )}

                {showMessages && <ChatTranscript messages={chat.messages} />}
              </div>
            )}
          </div>

          <div className="border-t border-white/10 bg-slate-950/30 px-6 py-4">
            {chat.error && <p className="mb-3 text-sm text-rose-200">{chat.error}</p>}
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Message</span>
              <textarea
                value={chat.message}
                onChange={(event) => chat.setMessage(event.target.value)}
                placeholder={
                  chat.activeConversationId
                    ? 'Ask a follow-up question'
                    : 'Start a new conversation'
                }
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => chat.send().catch(() => {})}
                disabled={chat.isLoading}
                className="rounded-full bg-atlas-sky px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-atlas-sky/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {chat.isLoading ? 'Sending&hellip;' : 'Send'}
              </button>
            </div>
          </div>

          <div className="border-t border-white/10 bg-slate-950/20">
            <CollapsibleSection title="Sources">
              <SourcesList sources={currentSources} emptyLabel="No citations returned yet." />
            </CollapsibleSection>

            <CollapsibleSection title="Status">
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
            </CollapsibleSection>

            <CollapsibleSection title="Document library">
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
                    {upload.isLoading ? 'Uploading&hellip;' : 'Upload'}
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
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </main>
  );
}
