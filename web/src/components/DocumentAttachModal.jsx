import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadDocument } from '../api/atlasApi.js';

function formatUploadDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const TABS = [
  { id: 'documents', label: 'Uploaded Documents' },
  { id: 'collections', label: 'Collections' },
  { id: 'upload', label: 'Upload New' },
];

function CollectionCard({ col, isColAttached, previewNames, remaining, onOpen, onAttach, onDetach, isMenuOpen, onMenuToggle, onRename, onAddDocs, onRemoveDocs, onDelete, attaching = false }) {
  return (
    <div className="group/card relative rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.07]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
            <svg className="h-5 w-5 text-atlas-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{col.name}</p>
            <p className="text-xs text-slate-500">{col.documentIds.length} document{col.documentIds.length !== 1 ? 's' : ''}</p>
            {previewNames.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {previewNames.map((name) => (
                  <p key={name} className="truncate text-[11px] text-slate-500">{name}</p>
                ))}
                {remaining > 0 && <p className="text-[11px] text-slate-600">+{remaining} more</p>}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
          >
            Open
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5">
        {isColAttached ? (
          <button
            type="button"
            onClick={onDetach}
            disabled={attaching}
            className="group flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all duration-200 disabled:opacity-50 bg-emerald-500/15 hover:bg-rose-500/20"
          >
            <svg className="h-3.5 w-3.5 text-emerald-300 group-hover:text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
              <path d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-emerald-300 group-hover:hidden group-hover:text-rose-300">{attaching ? 'Detaching...' : 'Attached'}</span>
            <span className="hidden text-rose-300 group-hover:inline">{attaching ? 'Detaching...' : '\u2715 Detach'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onAttach}
            disabled={attaching}
            className="rounded-lg bg-atlas-teal/15 px-4 py-1.5 text-xs font-semibold text-atlas-teal transition hover:bg-atlas-teal/25 disabled:opacity-50"
          >
            {attaching ? 'Attaching...' : 'Attach Collection'}
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={onMenuToggle}
            className="rounded-lg p-1.5 text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-white group-hover/card:opacity-100"
            aria-label="Collection menu"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={onMenuToggle} />
              <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-xl">
                <button
                  type="button"
                  onClick={onRename}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/10"
                >
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Rename
                </button>
                <button
                  type="button"
                  onClick={onAddDocs}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/10"
                >
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                  Add documents
                </button>
                <button
                  type="button"
                  onClick={onRemoveDocs}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/10"
                >
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Remove documents
                </button>
                <div className="border-t border-white/10" />
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
                >
                  <svg className="h-4 w-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function DocumentAttachModal({
  open,
  onClose,
  allDocuments,
  attachedDocuments,
  onAttach,
  conversationId,
  collections = [],
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onAddDocumentsToCollection,
  onRemoveDocumentFromCollection,
  attachedCollectionIds = [],
  onAttachCollection,
  onDetachCollection,
  initialTab = 'documents',
  isFlushingCollections = false,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [attachingColId, setAttachingColId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [localDocuments, setLocalDocuments] = useState(null);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [colViewIdx, setColViewIdx] = useState(0);
  const [colDetailId, setColDetailId] = useState(null);
  const [menuColId, setMenuColId] = useState(null);
  const [renamingColId, setRenamingColId] = useState(null);
  const [renameColValue, setRenameColValue] = useState('');
  const [confirmDeleteColId, setConfirmDeleteColId] = useState(null);
  const [colRemovingIds, setColRemovingIds] = useState([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelectedIds, setPickerSelectedIds] = useState([]);

  const dropRef = useRef(null);
  const fileInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const closeRef = useRef(null);
  const prevOpenRef = useRef(open);

  const attachedIds = useMemo(() => {
    const ids = new Set();
    for (const doc of attachedDocuments) {
      ids.add(doc.id);
    }
    return ids;
  }, [attachedDocuments]);

  const mergedDocuments = useMemo(() => {
    return localDocuments ?? allDocuments;
  }, [allDocuments, localDocuments]);

  const availableDocuments = useMemo(() => {
    return mergedDocuments.filter((doc) => !attachedIds.has(doc.id));
  }, [mergedDocuments, attachedIds]);

  const filteredDocuments = useMemo(() => {
    if (!search.trim()) return availableDocuments;
    const q = search.toLowerCase();
    return availableDocuments.filter((d) => d.fileName.toLowerCase().includes(q));
  }, [availableDocuments, search]);

  const filteredCollections = useMemo(() => {
    if (!collectionSearch.trim()) return collections;
    const q = collectionSearch.toLowerCase();
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, collectionSearch]);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setActiveTab(initialTab);
      setSelectedIds([]);
      setSearch('');
      setCollectionSearch('');
      setNewCollectionName('');
      setColViewIdx(0);
      setColDetailId(null);
      setColRemovingIds([]);
      setMenuColId(null);
      setRenamingColId(null);
      setRenameColValue('');
      setConfirmDeleteColId(null);
      setAttaching(false);
      setUploadError('');
      setUploadProgress(0);
      setLocalDocuments(null);

      const focusTarget = initialTab === 'collections' ? 300 : 100;
      setTimeout(() => {
        if (initialTab === 'collections') {
          /* focus handled by input render */
        } else {
          searchInputRef.current?.focus();
        }
      }, focusTarget);
    }
    prevOpenRef.current = open;
  }, [open, initialTab]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
    }
  }, [open]);

  function toggleSelection(documentId) {
    setSelectedIds((prev) =>
      prev.includes(documentId)
        ? prev.filter((id) => id !== documentId)
        : [...prev, documentId],
    );
  }

  function toggleAll() {
    if (selectedIds.length === filteredDocuments.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredDocuments.map((d) => d.id));
    }
  }

  async function handleAttach() {
    if (selectedIds.length === 0 || attaching) return;
    setAttaching(true);
    try {
      for (const documentId of selectedIds) {
        await onAttach(documentId);
      }
      onClose();
    } catch {
      setAttaching(false);
    }
  }

  async function handleAttachCollection(collection) {
    if (!onAttachCollection || attachingColId) return;
    setAttachingColId(collection.id);
    try {
      await onAttachCollection(collection.id);
    } finally {
      setAttachingColId(null);
    }
  }

  async function handleDetachCollection(collectionId) {
    if (!onDetachCollection || attachingColId) return;
    setAttachingColId(collectionId);
    try {
      await onDetachCollection(collectionId);
    } finally {
      setAttachingColId(null);
    }
  }

  async function handleCreateCollection() {
    const trimmed = newCollectionName.trim();
    if (!trimmed || creatingCollection) return;
    setCreatingCollection(true);
    try {
      await onCreateCollection?.(trimmed);
      setNewCollectionName('');
    } finally {
      setCreatingCollection(false);
    }
  }

  function openCollectionDetail(collectionId) {
    setColDetailId(collectionId);
    setColRemovingIds([]);
    setColViewIdx(1);
  }

  function backToCollectionList() {
    setColViewIdx(0);
    setColDetailId(null);
    setColRemovingIds([]);
  }

  function openDocumentPicker() {
    const col = collections.find((c) => c.id === colDetailId);
    if (col) {
      setPickerSelectedIds([...col.documentIds]);
    }
    setPickerSearch('');
    setColViewIdx(2);
  }

  function backToCollectionDetail() {
    setColViewIdx(1);
  }

  function togglePickerDoc(docId) {
    setPickerSelectedIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  }

  function toggleRemoveDoc(docId) {
    setColRemovingIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  }

  function handleSavePicker() {
    if (!colDetailId) return;
    const col = collections.find((c) => c.id === colDetailId);
    if (!col) return;
    const existing = col.documentIds;
    const toAdd = pickerSelectedIds.filter((id) => !existing.includes(id));
    const toRemove = existing.filter((id) => !pickerSelectedIds.includes(id));
    if (toAdd.length > 0) onAddDocumentsToCollection?.(colDetailId, toAdd);
    for (const id of toRemove) onRemoveDocumentFromCollection?.(colDetailId, id);
    setColViewIdx(1);
  }

  function handleRemoveDocsFromCollection() {
    if (!colDetailId || colRemovingIds.length === 0) return;
    for (const id of colRemovingIds) onRemoveDocumentFromCollection?.(colDetailId, id);
    setColRemovingIds([]);
  }

  function handleRenameCollection() {
    if (!colDetailId || !renameColValue.trim()) return;
    onRenameCollection?.(colDetailId, renameColValue.trim());
    setRenamingColId(null);
    setRenameColValue('');
  }

  function handleDeleteCollection() {
    if (!confirmDeleteColId) return;
    onDeleteCollection?.(confirmDeleteColId);
    if (colDetailId === confirmDeleteColId) {
      setColViewIdx(0);
      setColDetailId(null);
    }
    setConfirmDeleteColId(null);
  }

  async function handleUpload(file) {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError('');
    setUploadProgress(0);

    const interval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + Math.random() * 15, 85));
    }, 300);

    try {
      const result = await uploadDocument({
        file,
        conversationId: conversationId || undefined,
      });
      clearInterval(interval);
      setUploadProgress(100);

      const doc = result.document ?? result;
      setLocalDocuments((prev) => (prev ?? allDocuments).concat(doc));

      setTimeout(() => {
        if (doc.id) {
          setSelectedIds((prev) => (prev.includes(doc.id) ? prev : [...prev, doc.id]));
        }
        setUploading(false);
        setUploadProgress(0);
        setActiveTab('documents');
      }, 400);
    } catch (err) {
      clearInterval(interval);
      setUploadProgress(0);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  }

  const getFileIcon = useCallback((type) => {
    const t = (type ?? '').toLowerCase();
    if (t.includes('pdf')) {
      return (
        <svg className="h-5 w-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }
    return (
      <svg className="h-5 w-5 text-atlas-sky" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Attach documents"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 mx-4 flex max-h-[85vh] w-full max-w-lg flex-col animate-slide-down rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-atlas-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <h2 className="text-lg font-semibold text-white">Attach Documents</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Close modal"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-white/10 px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'border-atlas-teal text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ── Documents Tab ── */}
          {activeTab === 'documents' && (
            <>
              <div className="relative mb-4">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search documents..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-800"
                  aria-label="Search documents"
                />
              </div>

              {availableDocuments.length === 0 && !search ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                      <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-400">All documents attached</p>
                    <p className="mt-1 text-xs text-slate-500">Every document in your library is already linked to this conversation.</p>
                  </div>
                </div>
              ) : filteredDocuments.length === 0 && search ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                      <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-400">No matching documents</p>
                    <p className="mt-1 text-xs text-slate-500">Try a different search term.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400">
                      <div className="relative flex h-4 w-4 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.length === filteredDocuments.length && filteredDocuments.length > 0}
                          onChange={toggleAll}
                          className="h-4 w-4 appearance-none rounded border border-white/20 bg-white/5 checked:border-atlas-teal checked:bg-atlas-teal transition-colors"
                        />
                        {selectedIds.length === filteredDocuments.length && filteredDocuments.length > 0 && (
                          <svg className="pointer-events-none absolute h-2.5 w-2.5 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      Select all
                    </label>
                    <span className="rounded-md border border-white/5 bg-white/5 px-2 py-0.5 text-xs text-slate-500">
                      {selectedIds.length}/{filteredDocuments.length}
                    </span>
                  </div>

                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1" role="list" aria-label="Document list">
                    {filteredDocuments.map((doc) => {
                      const isSelected = selectedIds.includes(doc.id);
                      const status = doc.status;
                      const isReady = status === 'ready';
                      const isProcessing = status && status !== 'ready' && status !== 'failed';

                      return (
                        <label
                          key={doc.id}
                          className={`group flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-all ${
                            isSelected
                              ? 'border-atlas-teal/30 bg-atlas-teal/10 shadow-[0_0_16px_rgba(72,215,200,0.06)]'
                              : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
                          }`}
                          role="listitem"
                        >
                          <div className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelection(doc.id)}
                              className={`h-4 w-4 appearance-none rounded border transition-colors ${
                                isSelected
                                  ? 'border-atlas-teal bg-atlas-teal'
                                  : 'border-white/20 bg-white/5 group-hover:border-white/30'
                              }`}
                              aria-label={`Select ${doc.fileName}`}
                            />
                            {isSelected && (
                              <svg className="pointer-events-none absolute h-2.5 w-2.5 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>

                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                              isSelected
                                ? 'border-atlas-teal/30 bg-atlas-teal/15'
                                : 'border-white/10 bg-white/[0.04] group-hover:border-white/20'
                            }`}>
                              {getFileIcon(doc.fileType)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-white">{doc.fileName}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                                <span className="font-medium text-slate-400">{doc.fileType?.toUpperCase() || 'UNKNOWN'}</span>
                                {doc.createdAt && (
                                  <>
                                    <span className="text-white/20">·</span>
                                    <span>Uploaded {formatUploadDate(doc.createdAt)}</span>
                                  </>
                                )}
                              </div>
                              {status && (
                                <div className="mt-2 flex items-center gap-2">
                                  {isReady ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                      Ready
                                    </span>
                                  ) : isProcessing ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                                      Processing
                                    </span>
                                  ) : status === 'failed' ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-200">
                                      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                                      Failed
                                    </span>
                                  ) : null}
                                  {doc.progress != null && doc.progress >= 0 && !isReady && (
                                    <div className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className="h-full rounded-full bg-atlas-teal transition-all"
                                        style={{ width: `${Math.min(100, Math.max(0, Number(doc.progress)))}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Collections Tab ── */}
          {activeTab === 'collections' && (
            <>
              {colViewIdx === 0 && (
                <div className="mb-4 flex gap-2">
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateCollection();
                      if (e.key === 'Escape') setNewCollectionName('');
                    }}
                    placeholder="New collection name..."
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-800"
                    aria-label="New collection name"
                  />
                  <button
                    type="button"
                    onClick={handleCreateCollection}
                    disabled={!newCollectionName.trim() || creatingCollection}
                    className="shrink-0 rounded-xl bg-atlas-teal px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingCollection ? (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      'Create'
                    )}
                  </button>
                </div>
              )}

              <div className="relative overflow-hidden" style={{ width: '100%' }}>
                <div
                  className="flex transition-transform duration-300 ease-out"
                  style={{ width: '300%', transform: `translateX(${-colViewIdx * 33.333}%)` }}
                >
                  {/* ── View 0: Collection List ── */}
                  <div className="w-1/3 shrink-0 pr-1">
                    <div className="relative mb-4">
                      <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        value={collectionSearch}
                        onChange={(e) => setCollectionSearch(e.target.value)}
                        placeholder="Search collections..."
                        className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-800"
                        aria-label="Search collections"
                      />
                    </div>

                    {filteredCollections.length === 0 ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="text-center">
                          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                            <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                          </div>
                          <p className="text-sm text-slate-400">
                            {collectionSearch ? 'No matching collections' : 'No collections yet'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {collectionSearch ? 'Try a different search term.' : 'Create a collection above to group your documents.'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2" role="list" aria-label="Collections list">
                        {filteredCollections.map((col) => {
                          const colDocs = mergedDocuments.filter((d) => col.documentIds.includes(d.id));
                          const previewNames = colDocs.slice(0, 3).map((d) => d.fileName);
                          const remaining = colDocs.length - 3;
                          const isColAttached = attachedCollectionIds.includes(col.id);

                          return (
                            <CollectionCard
                              key={col.id}
                              col={col}
                              isColAttached={isColAttached}
                              previewNames={previewNames}
                              remaining={remaining}
                              onOpen={() => openCollectionDetail(col.id)}
                              onAttach={() => handleAttachCollection(col)}
                              onDetach={() => handleDetachCollection(col.id)}
                              isMenuOpen={menuColId === col.id}
                              onMenuToggle={() => setMenuColId(menuColId === col.id ? null : col.id)}
                              onRename={() => { setMenuColId(null); openCollectionDetail(col.id); setTimeout(() => setRenamingColId(col.id), 350); }}
                              onAddDocs={() => { setMenuColId(null); openCollectionDetail(col.id); }}
                              onRemoveDocs={() => { setMenuColId(null); openCollectionDetail(col.id); }}
                              onDelete={() => { setMenuColId(null); setConfirmDeleteColId(col.id); }}
                              attaching={isFlushingCollections || attachingColId === col.id}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── View 1: Collection Detail ── */}
                  <div className="w-1/3 shrink-0 px-1">
                    <button
                      type="button"
                      onClick={backToCollectionList}
                      className="mb-4 flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back
                    </button>

                    {(() => {
                      const col = collections.find((c) => c.id === colDetailId);
                      if (!col) return null;
                      const colDocs = mergedDocuments.filter((d) => col.documentIds.includes(d.id));

                      return (
                        <>
                          <div className="mb-4 flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                              <svg className="h-5 w-5 text-atlas-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              {renamingColId === col.id ? (
                                <input
                                  type="text"
                                  value={renameColValue}
                                  onChange={(e) => setRenameColValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameCollection();
                                    if (e.key === 'Escape') { setRenamingColId(null); setRenameColValue(''); }
                                  }}
                                  onBlur={handleRenameCollection}
                                  autoFocus
                                  className="w-full rounded-lg border border-atlas-teal/30 bg-slate-800 px-2 py-1 text-sm font-medium text-white outline-none"
                                />
                              ) : (
                                <p className="truncate text-sm font-semibold text-white">{col.name}</p>
                              )}
                              <p className="text-xs text-slate-500">
                                {col.documentIds.length} document{col.documentIds.length !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>

                          {colDocs.length > 0 && (
                            <div className="mb-4 space-y-1" role="list" aria-label="Collection documents">
                              {colDocs.map((doc) => {
                                const isRemoving = colRemovingIds.includes(doc.id);
                                return (
                                  <label
                                    key={doc.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                                      isRemoving ? 'border-rose-500/30 bg-rose-500/10' : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isRemoving}
                                      onChange={() => toggleRemoveDoc(doc.id)}
                                      className="h-3.5 w-3.5 appearance-none rounded border border-white/20 bg-white/5 checked:border-rose-400 checked:bg-rose-400 transition-colors"
                                      aria-label={`Remove ${doc.fileName}`}
                                    />
                                    {isRemoving && (
                                      <svg className="pointer-events-none absolute ml-[3px] h-2 w-2 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                    <div className="flex min-w-0 items-center gap-2">
                                      <svg className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                      </svg>
                                      <span className="truncate text-sm text-slate-300">{doc.fileName}</span>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}

                          {colRemovingIds.length > 0 && (
                            <button
                              type="button"
                              onClick={handleRemoveDocsFromCollection}
                              className="mb-3 w-full rounded-lg bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/25"
                            >
                              Remove {colRemovingIds.length} document{colRemovingIds.length !== 1 ? 's' : ''}
                            </button>
                          )}

                          <div className="space-y-2 border-t border-white/10 pt-3">
                            <button
                              type="button"
                              onClick={openDocumentPicker}
                              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
                            >
                              <svg className="h-4 w-4 text-atlas-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                              Add Documents
                            </button>
                            {renamingColId !== col.id && (
                              <button
                                type="button"
                                onClick={() => { setRenamingColId(col.id); setRenameColValue(col.name); }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
                              >
                                <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                Rename
                              </button>
                            )}
                            {confirmDeleteColId === col.id ? (
                              <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                                <span className="flex-1 text-xs text-rose-200">Delete "{col.name}"?</span>
                                <button type="button" onClick={handleDeleteCollection} className="rounded-md bg-rose-500/30 px-2.5 py-1 text-xs font-semibold text-rose-100">Delete</button>
                                <button type="button" onClick={() => setConfirmDeleteColId(null)} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">Cancel</button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteColId(col.id)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-rose-300 transition hover:bg-rose-500/10"
                              >
                                <svg className="h-4 w-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete Collection
                              </button>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* ── View 2: Document Picker ── */}
                  <div className="w-1/3 shrink-0 pl-1">
                    <button
                      type="button"
                      onClick={backToCollectionDetail}
                      className="mb-4 flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back
                    </button>

                    {(() => {
                      const col = collections.find((c) => c.id === colDetailId);
                      const filteredPickerDocs = !pickerSearch.trim()
                        ? mergedDocuments
                        : mergedDocuments.filter((d) => d.fileName.toLowerCase().includes(pickerSearch.toLowerCase()));

                      return (
                        <>
                          <p className="mb-3 text-sm font-medium text-white">Add documents to "{col?.name ?? ''}"</p>

                          <div className="relative mb-3">
                            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                              type="text"
                              value={pickerSearch}
                              onChange={(e) => setPickerSearch(e.target.value)}
                              placeholder="Search documents..."
                              className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-800"
                              aria-label="Search documents to add"
                            />
                          </div>

                          <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                            {filteredPickerDocs.length === 0 ? (
                              <p className="py-6 text-center text-sm text-slate-500">No documents found.</p>
                            ) : (
                              filteredPickerDocs.map((doc) => {
                                const isPicked = pickerSelectedIds.includes(doc.id);
                                return (
                                  <label
                                    key={doc.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                                      isPicked ? 'border-atlas-teal/30 bg-atlas-teal/10' : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isPicked}
                                      onChange={() => togglePickerDoc(doc.id)}
                                      className={`h-3.5 w-3.5 appearance-none rounded border transition-colors ${
                                        isPicked ? 'border-atlas-teal bg-atlas-teal' : 'border-white/20 bg-white/5'
                                      }`}
                                      aria-label={doc.fileName}
                                    />
                                    {isPicked && (
                                      <svg className="pointer-events-none absolute ml-[3px] h-2 w-2 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                    <span className="truncate text-sm text-slate-300">{doc.fileName}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>

                          <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
                            <button
                              type="button"
                              onClick={backToCollectionDetail}
                              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleSavePicker}
                              className="rounded-lg bg-atlas-teal px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
                            >
                              Save
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Upload Tab ── */}
          {activeTab === 'upload' && (
            <div
              ref={dropRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`relative rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                dragOver
                  ? 'border-atlas-teal/60 bg-atlas-teal/5'
                  : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
              }`}
              aria-label="Drop zone for file upload"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Choose file to upload"
              />

              {uploading ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 text-sm text-atlas-teal">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Uploading...
                  </div>
                  <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-atlas-teal transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500">{Math.round(uploadProgress)}%</p>
                </div>
              ) : (
                <>
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                    <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <p className="text-sm text-slate-300">
                    Drag & drop a file here, or{' '}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="font-semibold text-atlas-teal underline underline-offset-2 hover:text-atlas-teal/80"
                    >
                      choose a file
                    </button>
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Supported: PDF, DOCX, TXT, MD
                  </p>
                </>
              )}

              {uploadError && (
                <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-rose-200">{uploadError}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadError('');
                        setUploadProgress(0);
                      }}
                      className="shrink-0 rounded-lg border border-rose-500/20 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
          {activeTab === 'documents' ? (
            <>
              <p className="text-xs text-slate-500">
                {selectedIds.length} document{selectedIds.length !== 1 ? 's' : ''} selected
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAttach}
                  disabled={selectedIds.length === 0 || attaching}
                  className="rounded-lg bg-atlas-teal px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {attaching ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Attaching...
                    </span>
                  ) : (
                    `Attach (${selectedIds.length})`
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="flex w-full items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10"
              >
                {activeTab === 'upload' && !uploadError ? 'Done' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
