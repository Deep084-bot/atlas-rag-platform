import { useState, useRef, useEffect } from 'react';

function formatRelativeTime(date) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ConversationItem({ conversation, isActive, onSelect, onRename, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conversation.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const toggleRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(event) {
      const isOutsideMenu = menuRef.current && !menuRef.current.contains(event.target);
      const isOutsideToggle = toggleRef.current && !toggleRef.current.contains(event.target);
      if (isOutsideMenu && isOutsideToggle) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  function handleStartRename() {
    setEditValue(conversation.title);
    setEditing(true);
    setMenuOpen(false);
  }

  function handleSaveRename() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.id, trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      handleSaveRename();
    } else if (event.key === 'Escape') {
      setEditing(false);
    }
  }

  function handleDelete() {
    onDelete(conversation.id);
    setMenuOpen(false);
    setConfirmDelete(false);
  }

  const docCount = conversation.documentIds?.length ?? 0;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(event) => setEditValue(event.target.value)}
        onBlur={handleSaveRename}
        onKeyDown={handleKeyDown}
        className="w-full rounded-xl border border-atlas-teal/30 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
      />
    );
  }

  return (
    <div className="relative group/item">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(conversation.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(conversation.id);
          }
        }}
        className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
          isActive
            ? 'border border-atlas-teal/30 bg-atlas-teal/15 text-white shadow-[0_0_20px_rgba(72,215,200,0.08)]'
            : 'border border-transparent text-slate-300 hover:bg-white/5 hover:text-slate-100 active:scale-[0.99]'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5 transition-transform duration-200 group-hover/item:translate-x-0.5">
            <svg className={`h-4 w-4 shrink-0 ${isActive ? 'text-atlas-teal' : 'text-slate-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="truncate">{conversation.title}</p>
          </div>
          <div className="flex items-center gap-1">
            <svg className="h-3 w-3 text-slate-500 opacity-0 transition-all duration-200 group-hover/item:opacity-40 group-hover/item:translate-x-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <button
              ref={toggleRef}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
              className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 transition group-hover/item:opacity-100 hover:text-slate-200"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-6.5 transition-transform duration-200 group-hover/item:translate-x-0.5">
          {docCount > 0 && (
            <>
              <span className="text-[11px] text-slate-500">{docCount} doc{docCount !== 1 ? 's' : ''}</span>
              <span className="text-[10px] text-slate-600">·</span>
            </>
          )}
          <span className="text-[11px] text-slate-500">{formatRelativeTime(conversation.updatedAt)}</span>
        </div>
        {isActive && (
          <div className="absolute -left-3 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-atlas-teal shadow-[0_0_8px_rgba(72,215,200,0.4)]" />
        )}
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-2 top-10 z-50 w-40 rounded-xl border border-white/10 bg-slate-900 p-1 shadow-xl"
        >
          {confirmDelete ? (
            <div className="p-2 text-sm">
              <p className="mb-2 text-slate-300">Delete this conversation?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex-1 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/30"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleStartRename}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-500/10"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
