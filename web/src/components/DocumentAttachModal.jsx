import { useEffect, useMemo, useState } from 'react';

export function DocumentAttachModal({
  open,
  onClose,
  allDocuments,
  attachedDocuments,
  onAttach
}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [attaching, setAttaching] = useState(false);

  const attachedIds = useMemo(() => {
    const ids = new Set();
    for (const doc of attachedDocuments) {
      ids.add(doc.id);
    }
    return ids;
  }, [attachedDocuments]);

  const availableDocuments = useMemo(() => {
    return allDocuments.filter((doc) => !attachedIds.has(doc.id));
  }, [allDocuments, attachedIds]);

  const filteredDocuments = useMemo(() => {
    if (!search.trim()) return availableDocuments;
    const q = search.toLowerCase();
    return availableDocuments.filter((d) => d.fileName.toLowerCase().includes(q));
  }, [availableDocuments, search]);

  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      setSearch('');
      setAttaching(false);
    }
  }, [open]);

  function toggleSelection(documentId) {
    setSelectedIds((prev) =>
      prev.includes(documentId)
        ? prev.filter((id) => id !== documentId)
        : [...prev, documentId]
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 mx-4 w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Attach Documents</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-800"
          />

          {availableDocuments.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-sm text-slate-400">All documents are already attached.</p>
              </div>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-sm text-slate-400">No matching documents.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filteredDocuments.length && filteredDocuments.length > 0}
                    onChange={toggleAll}
                    className="rounded border-white/20 bg-white/5 text-atlas-teal outline-none focus:ring-atlas-teal/30"
                  />
                  Select all
                </label>
                <span className="text-xs text-slate-500">
                  {selectedIds.length} of {filteredDocuments.length} selected
                </span>
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto">
                {filteredDocuments.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(doc.id)}
                      onChange={() => toggleSelection(doc.id)}
                      className="rounded border-white/20 bg-white/5 text-atlas-teal outline-none focus:ring-atlas-teal/30"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{doc.fileName}</p>
                      <p className="text-xs text-slate-500">{doc.fileType?.toUpperCase()}</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAttach}
            disabled={selectedIds.length === 0 || attaching}
            className="rounded-full bg-atlas-teal px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {attaching ? 'Attaching...' : `Attach Selected (${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
