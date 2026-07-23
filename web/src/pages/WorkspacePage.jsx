import { useEffect, useMemo, useRef, useState } from 'react';

import { ChatComposer } from '../components/ChatComposer.jsx';
import { ChatTranscript } from '../components/ChatTranscript.jsx';
import { ConversationList } from '../components/ConversationList.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { SearchView } from '../components/SearchView.jsx';
import { SourcesList } from '../components/SourcesList.jsx';
import { Sidebar } from '../components/Sidebar.jsx';
import { AppNavbar } from '../components/AppNavbar.jsx';
import { requestJson } from '../api/client.js';
import { useDocuments } from '../hooks/useDocuments.js';
import { useChat } from '../hooks/useChat.js';
import { useCollections } from '../hooks/useCollections.js';
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
  const documents = useDocuments();
  const chat = useChat();
  const { collections, createCollection, renameCollection, deleteCollection, addDocumentsToCollection, removeDocumentFromCollection } = useCollections();

  const [workspaceMode, setWorkspaceMode] = useState('home');
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [documentSearch, setDocumentSearch] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [attachModalTab, setAttachModalTab] = useState('documents');
  const [fadingOut, setFadingOut] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showTip, setShowTip] = useState(() => !localStorage.getItem('atlas_tip_dismissed'));
  const [pulseTrigger, setPulseTrigger] = useState(0);
  const [pendingCollectionIds, setPendingCollectionIds] = useState([]);
  const [flushingCollections, setFlushingCollections] = useState(false);
  const konamiRef = useRef([]);
  const lastChatModeRef = useRef('home');
  const prevConvRef = useRef(chat.activeConversationId);
  const skipAutoTransition = useRef(false);
  const pendingRef = useRef([]);
  pendingRef.current = pendingCollectionIds;
  const manuallyFlushingRef = useRef(false);

  function resetWorkspace() {
    chat.resetConversation();
    setFadingOut(false);
    setComposerKey((k) => k + 1);
    setPulseTrigger((k) => k + 1);
    setDocumentSearch('');
    setShowCheatSheet(false);
    setShowDiagnostics(false);
    setPendingCollectionIds([]);
  }

  function startTransition() {
    setFadingOut(true);
    setTimeout(() => setFadingOut(false), 400);
  }

  function handleHomeClick() {
    skipAutoTransition.current = true;
    resetWorkspace();
    setWorkspaceMode('home');
    lastChatModeRef.current = 'home';
  }

  function handleNewConversation() {
    resetWorkspace();
    setFocusTrigger((k) => k + 1);
    setWorkspaceMode('empty-chat');
    lastChatModeRef.current = 'empty-chat';
  }

  function dismissTip() {
    setShowTip(false);
    localStorage.setItem('atlas_tip_dismissed', 'true');
  }

  async function handleSend() {
    const trimmed = chat.message.trim();
    if (trimmed === '/coffee') {
      chat.setMessage('');
      chat.addCoffeeMessage?.();
      return;
    }
    const needsFlush = !chat.activeConversationId && pendingCollectionIds.length > 0;
    if (needsFlush) {
      manuallyFlushingRef.current = true;
      const ids = [...pendingCollectionIds];
      setPendingCollectionIds([]);
      try {
        const conv = await chat.createConversation();
        if (conv) {
          for (const colId of ids) {
            const col = collections.find((c) => c.id === colId);
            if (!col || col.documentIds.length === 0) continue;
            for (const docId of col.documentIds) {
              try { await chat.attachDocument(conv.id, docId); } catch {}
            }
            chat.addAttachedCollectionId(colId);
          }
        }
      } finally {
        manuallyFlushingRef.current = false;
      }
    }
    chat.send().catch(() => {});
  }

  function handleSelectConversation(id) {
    chat.selectConversation(id);
    startTransition();
    setWorkspaceMode('conversation');
    lastChatModeRef.current = 'conversation';
    setPendingCollectionIds([]);
  }

  const handleNewConversationRef = useRef(handleNewConversation);
  handleNewConversationRef.current = handleNewConversation;

  useEffect(() => {
    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

    function handleGlobalKeyDown(e) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 'k') {
        e.preventDefault();
        setFocusTrigger((k) => k + 1);
      }
      if (isMod && e.key === 'n') {
        e.preventDefault();
        handleNewConversationRef.current();
      }
      if (e.key === '?' && !isMod) {
        e.preventDefault();
        setShowCheatSheet((v) => !v);
      }
      if (e.key === 'Escape') {
        setShowCheatSheet(false);
        setShowDiagnostics(false);
      }

      konamiRef.current.push(e.key);
      konamiRef.current = konamiRef.current.slice(-KONAMI.length);
      if (konamiRef.current.length === KONAMI.length && konamiRef.current.every((k, i) => k === KONAMI[i])) {
        setShowDiagnostics(true);
        konamiRef.current = [];
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

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

  useEffect(() => {
    if (skipAutoTransition.current) {
      skipAutoTransition.current = false;
      prevConvRef.current = chat.activeConversationId;
      return;
    }
    if (!prevConvRef.current && chat.activeConversationId) {
      setWorkspaceMode('conversation');
      lastChatModeRef.current = 'conversation';
    } else if (prevConvRef.current && !chat.activeConversationId) {
      setWorkspaceMode('empty-chat');
      lastChatModeRef.current = 'empty-chat';
    }
    prevConvRef.current = chat.activeConversationId;
  }, [chat.activeConversationId]);

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
    return documents.documents.filter((d) =>
      d.fileName.toLowerCase().includes(documentSearch.toLowerCase())
    );
  }, [documents.documents, documentSearch]);

  const documentIdsSet = useMemo(() => new Set(chat.conversationDocuments.map((d) => d.id)), [chat.conversationDocuments]);
  const relevantCollections = useMemo(() => {
    return collections.filter((c) => chat.attachedCollectionIds.includes(c.id));
  }, [collections, chat.attachedCollectionIds]);

  const { groupedCollections, looseConversationDocs } = useMemo(() => {
    const groups = [];
    const coveredIds = new Set();
    for (const col of relevantCollections) {
      const colConvDocs = chat.conversationDocuments.filter((d) => col.documentIds.includes(d.id));
      if (colConvDocs.length > 0) {
        groups.push({ collection: col, documents: colConvDocs });
        colConvDocs.forEach((d) => coveredIds.add(d.id));
      }
    }
    const loose = chat.conversationDocuments.filter((d) => !coveredIds.has(d.id));
    return { groupedCollections: groups, looseConversationDocs: loose };
  }, [relevantCollections, chat.conversationDocuments]);

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

  async function handleAttachCollection(collectionId) {
    if (chat.activeConversationId) {
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const toAttach = col.documentIds.filter((id) => !chat.conversationDocuments.some((d) => d.id === id));
      for (const docId of toAttach) {
        await chat.attachDocument(chat.activeConversationId, docId).catch(() => {});
      }
      chat.addAttachedCollectionId(collectionId);
    } else {
      setPendingCollectionIds((prev) =>
        prev.includes(collectionId) ? prev : [...prev, collectionId]
      );
    }
  }

  async function handleDetachCollection(collectionId) {
    if (chat.activeConversationId) {
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      for (const docId of col.documentIds) {
        await chat.detachDocument(chat.activeConversationId, docId).catch(() => {});
      }
      chat.removeAttachedCollectionId(collectionId);
    } else {
      setPendingCollectionIds((prev) => prev.filter((id) => id !== collectionId));
    }
  }

  useEffect(() => {
    const convId = chat.activeConversationId;
    const pending = pendingRef.current;
    if (!convId || pending.length === 0 || flushingCollections || manuallyFlushingRef.current) return;
    setFlushingCollections(true);
    const currentPending = [...pending];
    setPendingCollectionIds([]);
    (async () => {
      for (const colId of currentPending) {
        const col = collections.find((c) => c.id === colId);
        if (!col || col.documentIds.length === 0) continue;
        for (const docId of col.documentIds) {
          try { await chat.attachDocument(convId, docId); } catch {}
        }
        chat.addAttachedCollectionId(colId);
      }
      setFlushingCollections(false);
    })();
  }, [chat.activeConversationId]);

  function handleMobileSelectConversation(id) {
    handleSelectConversation(id);
    setMobileDrawerOpen(false);
  }

  function handleMobileNewConversation() {
    handleNewConversation();
    setMobileDrawerOpen(false);
  }

  return (
    <main className="flex h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(72,215,200,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(124,199,255,0.14),_transparent_28%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] text-slate-100">
      <AppNavbar onHomeClick={handleHomeClick} />

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
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
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
              onClick={() => {
                if (workspaceMode === 'search') {
                  setWorkspaceMode(lastChatModeRef.current);
                }
              }}
              className={`text-sm font-semibold transition ${
                workspaceMode !== 'search' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => {
                if (workspaceMode !== 'search') {
                  lastChatModeRef.current = workspaceMode;
                  setWorkspaceMode('search');
                }
              }}
              className={`text-sm font-semibold transition ${
                workspaceMode === 'search' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Search
            </button>
          </div>

          {workspaceMode === 'search' ? (
            <div className="flex-1 overflow-y-auto">
              <SearchView />
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                {workspaceMode === 'conversation' ? (
                  chat.messagesLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-slate-400">Loading messages...</p>
                    </div>
                  ) : chat.messagesError ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-rose-200">{chat.messagesError}</p>
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
                      {chat.messages.length > 0 && <ChatTranscript messages={chat.messages} isStreaming={chat.isLoading} />}
                    </div>
                  )
                ) : (
                  <EmptyState
                    onNewConversation={handleNewConversation}
                    onUpload={() => { setAttachModalTab('upload'); setShowAttachModal(true); }}
                    fadingOut={fadingOut}
                    pulseTrigger={pulseTrigger}
                  />
                )}
              </div>

              <div className="border-t border-white/10 bg-slate-950/30 px-6 py-4">
                <div className="relative">
                  {showTip && (
                    <div className="absolute bottom-full left-1/2 z-10 mb-3 -translate-x-1/2 animate-[fadeInUp_0.4s_ease-out]">
                      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-2.5 shadow-lg">
                        <span className="text-sm">💡</span>
                        <p className="text-xs text-slate-300">Press <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[11px]">/</kbd> to use Atlas commands</p>
                        <button
                          type="button"
                          onClick={dismissTip}
                          className="rounded-lg p-1 text-slate-500 transition hover:text-white"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                  <ChatComposer
                    key={composerKey}
                    message={chat.message}
                    setMessage={chat.setMessage}
                    onSend={handleSend}
                    onStop={chat.abortStream}
                    isLoading={chat.isLoading}
                    error={chat.error}
                    isCreatingConversation={chat.isCreatingConversation}
                    onAttach={() => { setAttachModalTab('documents'); setShowAttachModal(true); }}
                    onCollections={() => { setAttachModalTab('collections'); setShowAttachModal(true); }}
                    focusTrigger={focusTrigger}
                  />
                </div>
              </div>

              <div className="border-t border-white/10 bg-slate-950/20 overflow-x-hidden">
                {workspaceMode === 'home' ? (
                  <CollapsibleSection title={`Document Library (${documents.documents.length})`}>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-slate-300">{documents.documents.length} document{documents.documents.length !== 1 ? 's' : ''}</p>
                        <button
                          type="button"
                          onClick={() => documents.reload().catch(() => {})}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                        >
                          Refresh
                        </button>
                      </div>

                      {documents.error && <p className="text-sm text-rose-200">{documents.error}</p>}

                      {documents.documents.length > 0 && (
                        <input
                          type="text"
                          value={documentSearch}
                          onChange={(e) => setDocumentSearch(e.target.value)}
                          placeholder="Search documents..."
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
                        />
                      )}

                      <div className="space-y-3">
                        {documents.documents.length > 0 ? (
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
                                    {renamingId === document.id ? null : isPendingDelete ? (
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
                      ) : documents.documents.length === 0 ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="text-center">
                            <p className="text-sm text-slate-400">No documents uploaded yet.</p>
                            <p className="mt-1 text-xs text-slate-500">Upload documents from the composer to build your knowledge base.</p>
                          </div>
                        </div>
                      ) : null}
                      </div>
                    </div>
                  </CollapsibleSection>
                ) : (
                  <>
                    <CollapsibleSection title="Sources">
                      <SourcesList sources={currentSources} emptyLabel="No citations returned yet." />
                    </CollapsibleSection>

                    <CollapsibleSection title="Pipeline">
                      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                        <div className="flex items-center gap-0 min-w-[480px]">
                          {[
                            { label: 'Retriever', active: chat.isLoading || chat.status === 'streaming' },
                            { label: 'Embedding', active: chat.isLoading },
                            { label: 'Ranking', active: chat.isLoading },
                            { label: 'LLM', active: chat.isLoading || chat.status === 'streaming' },
                            { label: 'Citation', active: chat.status === 'streaming' },
                          ].map((step, i) => (
                            <div key={step.label} className="flex items-center gap-0">
                              <div className="flex flex-col items-center gap-1.5">
                                <div className={`h-2 w-2 rounded-full transition-all duration-500 ${
                                  step.active
                                    ? 'bg-atlas-teal shadow-[0_0_8px_rgba(72,215,200,0.5)] animate-pulse'
                                    : 'bg-slate-600'
                                }`} style={step.active ? { animationDuration: '1.2s' } : undefined} />
                                <span className={`text-[10px] font-medium whitespace-nowrap ${
                                  step.active ? 'text-white' : 'text-slate-500'
                                }`}>{step.label}</span>
                              </div>
                              {i < 4 && (
                                <div className="flex items-center px-2">
                                  {step.active ? (
                                    <svg className="h-3.5 w-5 text-atlas-teal/60 animate-pulse" viewBox="0 0 20 8" fill="currentColor">
                                      <path d="M0 3h14v2H0z" opacity="0.3" />
                                      <path d="M14 0l6 4-6 4V0z" />
                                    </svg>
                                  ) : (
                                    <svg className="h-3.5 w-5 text-slate-600" viewBox="0 0 20 8" fill="currentColor">
                                      <path d="M0 3h14v2H0z" opacity="0.15" />
                                      <path d="M14 0l6 4-6 4V0z" opacity="0.3" />
                                    </svg>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </CollapsibleSection>

                    <CollapsibleSection title={`Conversation Context (${chat.conversationDocuments.length})`}>
                      {chat.conversationDocumentsLoading && chat.conversationDocuments.length === 0 ? (
                        <div className="flex items-center justify-center py-10">
                          <p className="text-sm text-slate-400">Loading conversation context...</p>
                        </div>
                      ) : (
                        <>
                          {groupedCollections.length > 0 && (
                            <div className="mb-4 space-y-4">
                              {groupedCollections.map(({ collection: col, documents: docs }) => (
                                <div key={col.id}>
                                  <div className="group mb-2 flex items-center gap-2">
                                    <svg className="h-4 w-4 shrink-0 text-atlas-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    <span className="text-sm font-semibold text-white">{col.name}</span>
                                    <span className="text-xs text-slate-500">({docs.length})</span>
                                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                                      Attached
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleDetachCollection(col.id)}
                                      className="ml-auto rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-200 opacity-0 transition hover:bg-amber-500/20 group-hover:opacity-100"
                                    >
                                      Detach
                                    </button>
                                  </div>
                                  <div className="ml-5 space-y-1 border-l border-white/10 pl-3">
                                    {docs.map((doc) => (
                                      <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <svg className="h-3.5 w-3.5 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                          </svg>
                                          <span className="truncate text-sm text-slate-300">{doc.fileName}</span>
                                          {doc.status === 'ready' ? (
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                                          ) : doc.status === 'failed' ? (
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                                          ) : (
                                            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (chat.activeConversationId) {
                                              chat.detachDocument(chat.activeConversationId, doc.id).catch(() => {});
                                            }
                                          }}
                                          className="shrink-0 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 opacity-0 transition hover:bg-amber-500/20 group-hover:opacity-100"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {looseConversationDocs.length > 0 && (
                            <div className="mb-4 space-y-1">
                              <div className="flex items-center gap-2">
                                <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Documents</span>
                              </div>
                              {looseConversationDocs.map((doc) => (
                                <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <svg className="h-3.5 w-3.5 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                    </svg>
                                    <span className="truncate text-sm text-slate-300">{doc.fileName}</span>
                                    {doc.status === 'ready' ? (
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                                    ) : doc.status === 'failed' ? (
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                                    ) : (
                                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (chat.activeConversationId) {
                                        chat.detachDocument(chat.activeConversationId, doc.id).catch(() => {});
                                      }
                                    }}
                                    className="shrink-0 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 opacity-0 transition hover:bg-amber-500/20 group-hover:opacity-100"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-slate-300">
                              {chat.conversationDocuments.length} document{chat.conversationDocuments.length !== 1 ? 's' : ''}
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

                          {chat.conversationDocumentsError && (
                            <p className="text-sm text-rose-200">{chat.conversationDocumentsError}</p>
                          )}

                          {chat.conversationDocuments.length === 0 && !chat.conversationDocumentsLoading && (
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
                        </>
                      )}
                    </CollapsibleSection>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <DocumentAttachModal
        open={showAttachModal}
        onClose={() => setShowAttachModal(false)}
        allDocuments={documents.documents}
        attachedDocuments={chat.conversationDocuments}
        conversationId={chat.activeConversationId}
        onAttach={async (documentId) => {
          if (chat.activeConversationId) {
            await chat.attachDocument(chat.activeConversationId, documentId);
          }
        }}
        collections={collections}
        onCreateCollection={createCollection}
        onRenameCollection={renameCollection}
        onDeleteCollection={deleteCollection}
        onAddDocumentsToCollection={addDocumentsToCollection}
        onRemoveDocumentFromCollection={removeDocumentFromCollection}
        attachedCollectionIds={chat.activeConversationId ? chat.attachedCollectionIds : pendingCollectionIds}
        onAttachCollection={handleAttachCollection}
        onDetachCollection={handleDetachCollection}
        isFlushingCollections={flushingCollections}
        initialTab={attachModalTab}
      />

      {showCheatSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCheatSheet(false)}>
          <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
              <button type="button" onClick={() => setShowCheatSheet(false)} className="rounded-lg p-1 text-slate-500 hover:text-white transition">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              {[
                { keys: '⌘K', desc: 'Focus composer' },
                { keys: '⌘N', desc: 'New conversation' },
                { keys: '/', desc: 'Open slash commands' },
                { keys: '⌘1-9', desc: 'Select command by number' },
                { keys: '↑↓', desc: 'Navigate command list' },
                { keys: 'Enter', desc: 'Send message / Select command' },
                { keys: 'Shift+Enter', desc: 'New line in composer' },
                { keys: '?', desc: 'Toggle this cheat sheet' },
              ].map((shortcut) => (
                <div key={shortcut.keys} className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">{shortcut.desc}</span>
                  <kbd className="rounded border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-slate-400">{shortcut.keys}</kbd>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Easter Eggs</h3>
              <div className="space-y-1.5 text-sm text-slate-400">
                <p><kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-xs">/coffee</kbd> — Get a coffee</p>
                <p>Konami code — Unlock diagnostics</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDiagnostics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDiagnostics(false)}>
          <div className="mx-4 w-full max-w-md rounded-2xl border border-atlas-teal/20 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-atlas-teal">Atlas Diagnostics</h2>
              <button type="button" onClick={() => setShowDiagnostics(false)} className="rounded-lg p-1 text-slate-500 hover:text-white transition">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Conversations</span>
                <span className="text-white">{chat.conversations.length}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Documents</span>
                <span className="text-white">{documents.documents.length}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Messages</span>
                <span className="text-white">{chat.messages.length}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Active Conversation</span>
                <span className="text-white">{chat.activeConversationId ? chat.activeConversationId.slice(0, 8) : 'None'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Chat Status</span>
                <span className="text-white">{chat.status}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Creating Conversation</span>
                <span className="text-white">{chat.isCreatingConversation ? 'Yes' : 'No'}</span>
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-slate-500">Konami code activated.</p>
          </div>
        </div>
      )}
    </main>
  );
}
