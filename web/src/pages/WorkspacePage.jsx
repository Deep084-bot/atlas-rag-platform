import { useEffect, useMemo, useRef, useState } from 'react';

import { ChatTranscript } from '../components/ChatTranscript.jsx';
import { ConversationList } from '../components/ConversationList.jsx';
import { SearchView } from '../components/SearchView.jsx';
import { SourcesList } from '../components/SourcesList.jsx';
import { Sidebar } from '../components/Sidebar.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { requestJson } from '../api/client.js';
import { useDocuments } from '../hooks/useDocuments.js';
import { useChat } from '../hooks/useChat.js';
import { useUpload } from '../hooks/useUpload.js';
import { DocumentAttachModal } from '../components/DocumentAttachModal.jsx';

function StatusPill({ status, children }) {
  const styles =
    status === 'success'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
      : status === 'error'
        ? 'bg-rose-500/15 text-rose-200 border-rose-500/20'
        : status === 'loading'
          ? 'bg-amber-500/15 text-amber-200 border-amber-500/20'
          : status === 'streaming'
            ? 'bg-atlas-teal/15 text-atlas-teal border-atlas-teal/20'
            : status === 'aborted'
              ? 'bg-slate-500/15 text-slate-400 border-slate-500/20'
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

  if (status === 'ocr') {
    return 'Reading scanned text...';
  }

  return 'Processing';
}

function formatDocumentTimestamp(timestamp) {
  if (!timestamp) {
    return '—';
  }

  return new Date(timestamp).toLocaleString();
}

function formatFileType(fileType) {
  return (fileType ?? 'unknown').toUpperCase();
}

function formatUploadDate(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp));
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

  const [mode, setMode] = useState('chat');
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [documentSearch, setDocumentSearch] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [showAttachModal, setShowAttachModal] = useState(false);

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

  const filteredDocuments = useMemo(() => {
    if (chat.activeConversationId) {
      return chat.conversationDocuments.filter((d) =>
        d.fileName.toLowerCase().includes(documentSearch.toLowerCase())
      );
    }
    return documents.documents.filter((d) =>
      d.fileName.toLowerCase().includes(documentSearch.toLowerCase())
    );
  }, [documents.documents, documentSearch, chat.conversationDocuments, chat.activeConversationId]);

  const displayDocuments = chat.activeConversationId ? chat.conversationDocuments : documents.documents;
  const documentCount = displayDocuments.length;

  function handleUploadFileChange(event) {
    const nextFile = event.target.files?.[0] ?? null;
    upload.setFile(nextFile);
  }

  async function handleUpload() {
    const file = upload.file;

    if (!file) {
      upload.setError('Please select a file.');
      return;
    }

    if (file.size === 0) {
      upload.setError('Empty files cannot be uploaded.');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      upload.setError('File exceeds the 25 MB upload limit.');
      return;
    }

    try {
      await upload.upload(chat.activeConversationId || undefined);
      await documents.reload();
      if (chat.activeConversationId) {
        await chat.fetchConversationDocuments(chat.activeConversationId);
      }
    } catch {
      // handled in hook state
    }
  }

  function handleStartRename(document) {
    setRenamingId(document.id);
    setRenameValue(document.fileName);
  }

  function handleCancelRename() {
    setRenamingId(null);
    setRenameValue('');
  }

  function handleSaveRename() {
    const trimmed = renameValue.trim();

    if (trimmed && renamingId) {
      documents.renameDocument(renamingId, trimmed).catch(() => {});
    }

    setRenamingId(null);
    setRenameValue('');
  }

  function handleRenameKeyDown(event) {
    if (event.key === 'Enter') {
      handleSaveRename();
    } else if (event.key === 'Escape') {
      handleCancelRename();
    }
  }

  function handleMobileSelectConversation(id) {
    chat.selectConversation(id);
    setMobileDrawerOpen(false);
  }

  function handleMobileNewConversation() {
    chat.resetConversation();
    setMobileDrawerOpen(false);
  }

  const showEmptyState = !chat.activeConversationId && chat.messages.length === 0;
  const showMessages = chat.messages.length > 0;

  return (
    <main className="flex h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(72,215,200,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(124,199,255,0.14),_transparent_28%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] text-slate-100">
      <Navbar />

      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="relative flex h-full w-72 flex-col border-r border-white/10 bg-slate-950 shadow-2xl">
            <div className="border-b border-white/10 p-4">
              <button
                type="button"
                onClick={handleMobileNewConversation}
                className="w-full rounded-full bg-atlas-teal px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
              >
                + New conversation
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
              <ConversationList
                conversations={chat.conversations}
                activeConversationId={chat.activeConversationId}
                isLoading={chat.conversationsLoading}
                onSelect={handleMobileSelectConversation}
                onRename={chat.renameConversation}
                onDelete={chat.deleteConversation}
              />
            </div>
          </aside>
        </div>
      )}

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

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-6 border-b border-white/10 px-4 py-2 lg:px-6">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden text-slate-400 hover:text-white transition"
              aria-label="Open conversations"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setMode('chat')}
              className={`text-sm font-semibold transition ${
                mode === 'chat' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`text-sm font-semibold transition ${
                mode === 'search' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Search
            </button>
          </div>

          {mode === 'chat' ? (
            <>
              <div className="flex-1 overflow-y-auto">
                {chat.messagesLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-sm text-slate-400">Loading messages...</p>
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
                        <StatusPill status={chat.status}>
                          {chat.status === 'idle' ? 'Ready' : chat.status === 'streaming' ? 'Streaming' : chat.status === 'loading' ? 'Thinking...' : chat.status === 'aborted' ? 'Cancelled' : chat.status}
                        </StatusPill>
                      </div>
                    )}

                    {showMessages && <ChatTranscript messages={chat.messages} isStreaming={chat.isLoading} />}
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
                    Send
                  </button>
                  {chat.isLoading && (
                    <button
                      type="button"
                      onClick={chat.abortStream}
                      className="rounded-full border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20"
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <SearchView />
            </div>
          )}

          <div className="border-t border-white/10 bg-slate-950/20 overflow-x-hidden">
            <CollapsibleSection title="Sources">
              <SourcesList sources={currentSources} emptyLabel="No citations returned yet." />
            </CollapsibleSection>

            <CollapsibleSection title="Status">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Database</span>
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    Connected
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Embedding Provider</span>
                  <span className={`flex items-center gap-1.5 ${health && health.status ? 'text-emerald-400' : 'text-slate-500'}`}>
                    <span className={`h-2 w-2 rounded-full ${health && health.status ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                    {health && health.status ? 'Connected' : healthError ?? 'Unknown'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Documents Indexed</span>
                  <span className="text-slate-200">{documents.documents.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Conversation Count</span>
                  <span className="text-slate-200">{chat.conversations.length}</span>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title={chat.activeConversationId ? `Documents (${documentCount})` : 'Document library'}>
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
                    {upload.isLoading ? 'Uploading...' : 'Upload'}
                  </button>
                  <StatusPill status={upload.status}>{upload.status === 'idle' ? 'Ready' : upload.status}</StatusPill>
                  {upload.file && <span className="text-sm text-slate-300">Selected file: {upload.file.name}</span>}
                </div>

                {upload.error && <p className="text-sm text-rose-200">{upload.error}</p>}
              </div>

              <div className="space-y-4">
                {chat.activeConversationId && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-300">
                      {documentCount} document{documentCount === 1 ? '' : 's'}
                      {chat.conversationDocumentsLoading && ' (loading...)'}
                    </p>
                    <div className="flex items-center gap-2">
                      {documents.documents.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAttachModal(true)}
                          className="rounded-full bg-atlas-teal/15 px-4 py-2 text-xs font-semibold text-atlas-teal transition hover:bg-atlas-teal/25"
                        >
                          Attach Documents
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          documents.reload().catch(() => {});
                          if (chat.activeConversationId) {
                            chat.fetchConversationDocuments(chat.activeConversationId);
                          }
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )}

                {!chat.activeConversationId && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-300">{documentCount} document{documentCount === 1 ? '' : 's'}</p>
                    <button
                      type="button"
                      onClick={() => documents.reload().catch(() => {})}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      Refresh
                    </button>
                  </div>
                )}

                {(chat.activeConversationId ? chat.conversationDocumentsError : documents.error) && (
                  <p className="text-sm text-rose-200">{chat.activeConversationId ? chat.conversationDocumentsError : documents.error}</p>
                )}

                {chat.activeConversationId && documentCount === 0 && (
                  <div className="flex items-center justify-center py-10">
                    <div className="text-center">
                      <p className="text-sm text-slate-400">No documents attached to this conversation.</p>
                      <p className="mt-1 text-xs text-slate-500">Attach documents from your library to enable document-aware answers.</p>
                      {documents.documents.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAttachModal(true)}
                          className="mt-4 rounded-full bg-atlas-teal/15 px-5 py-2 text-sm font-semibold text-atlas-teal transition hover:bg-atlas-teal/25"
                        >
                          Attach Documents
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {documentCount > 0 && (
                  <input
                    type="text"
                    value={documentSearch}
                    onChange={(e) => setDocumentSearch(e.target.value)}
                    placeholder="Search documents..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
                  />
                )}

                <div className="space-y-3">
                  {documentCount > 0 ? (
                    filteredDocuments.length > 0 ? (
                    filteredDocuments.map((document) => {
                      const visibleStatus = getDocumentStatusLabel(document.status);
                      const statusTone = getDocumentStatusTone(document.status);
                      const isPendingDelete = pendingDeleteId === document.id;

                      return (
                        <article key={document.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              {renamingId === document.id ? (
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={handleSaveRename}
                                  onKeyDown={handleRenameKeyDown}
                                  autoFocus
                                  className="w-full rounded-xl border border-atlas-teal/30 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                                />
                              ) : (
                                <h3 className="text-sm font-semibold text-white">{document.fileName}</h3>
                              )}
                              <p className="mt-1 text-xs text-slate-400">{formatFileType(document.fileType)} • {visibleStatus}</p>
                              {document.createdAt && <p className="text-xs text-slate-500">Uploaded {formatUploadDate(document.createdAt)}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={statusTone}>{visibleStatus}</StatusPill>
                              {chat.activeConversationId ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    chat.detachDocument(chat.activeConversationId, document.id).catch(() => {});
                                  }}
                                  className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20"
                                >
                                  Remove
                                </button>
                              ) : renamingId === document.id ? null : isPendingDelete ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-400">Delete {document.fileName}?</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      documents.removeDocument(document.id).catch(() => {});
                                      setPendingDeleteId(null);
                                    }}
                                    className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/30"
                                  >
                                    Delete
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteId(null)}
                                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleStartRename(document)}
                                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteId(document.id)}
                                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-400 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
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
                    <div className="flex items-center justify-center py-12">
                      <div className="text-center">
                        <p className="text-sm text-slate-400">No matching documents found.</p>
                      </div>
                    </div>
                  )
                ) : !chat.activeConversationId && documents.documents.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <p className="text-sm text-slate-400">No documents uploaded yet.</p>
                      <p className="mt-1 text-xs text-slate-500">Upload a PDF to start building your knowledge base.</p>
                    </div>
                  </div>
                ) : null}
                </div>
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
      <DocumentAttachModal
        open={showAttachModal}
        onClose={() => setShowAttachModal(false)}
        allDocuments={documents.documents}
        attachedDocuments={chat.conversationDocuments}
        onAttach={async (documentId) => {
          if (chat.activeConversationId) {
            await chat.attachDocument(chat.activeConversationId, documentId);
          }
        }}
      />
    </main>
  );
}
