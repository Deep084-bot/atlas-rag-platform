import { useState, useRef, useEffect } from 'react';

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
    <div className="relative group">
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
          isActive
            ? 'border border-atlas-teal/30 bg-atlas-teal/15 text-white'
            : 'border border-transparent text-slate-300 hover:bg-white/5'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="truncate">{conversation.title}</p>
          <button
            ref={toggleRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-slate-200"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {new Date(conversation.updatedAt).toLocaleDateString()}
        </p>
      </button>

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
