import { useCallback, useEffect, useRef, useState } from 'react';

const SLASH_COMMANDS = [
  { id: 'summarize', label: 'Summarize', description: 'Summarize the conversation so far', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'compare', label: 'Compare', description: 'Compare two or more documents', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'extract', label: 'Extract', description: 'Pull out key insights and data points', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'explain', label: 'Explain', description: 'Explain the last response in detail', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
  { id: 'timeline', label: 'Timeline', description: 'Create a timeline from document events', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  { id: 'translate', label: 'Translate', description: 'Translate content to another language', icon: 'M3 5h12M9 3v2m0 4h.01M21 12l-4-4m4 4l-4 4m4-4H3' },
  { id: 'report', label: 'Generate Report', description: 'Generate a structured report from sources', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
];

export function ChatComposer({
  message,
  setMessage,
  onSend,
  onStop,
  isLoading,
  error,
  isCreatingConversation,
  onAttach,
  onCollections,
  focusTrigger = 0,
}) {
  const textareaRef = useRef(null);
  const menuRef = useRef(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focused, setFocused] = useState(false);

  const showCommandMenu = commandOpen && message.startsWith('/');

  const filteredCommands = showCommandMenu
    ? SLASH_COMMANDS.filter((c) => c.id.includes(commandSearch.toLowerCase()))
    : [];

  useEffect(() => {
    if (focusTrigger > 0) {
      textareaRef.current?.focus();
    }
  }, [focusTrigger]);

  useEffect(() => {
    if (message === '/') {
      setCommandOpen(true);
      setCommandSearch('');
      setSelectedIndex(0);
    } else if (message.startsWith('/')) {
      const parts = message.slice(1).split(' ');
      const searchTerm = parts[0] || '';
      setCommandSearch(searchTerm);
      setCommandOpen(true);
      setSelectedIndex(0);
    } else if (commandOpen) {
      setCommandOpen(false);
    }
  }, [message, commandOpen]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setCommandOpen(false);
      }
    }
    if (commandOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [commandOpen]);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [message, autoResize]);

  function handleKeyDown(e) {
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          setMessage(`/${cmd.id} `);
          setCommandOpen(false);
          textareaRef.current?.focus();
        }
        return;
      }
      if (e.key === 'Escape') {
        setCommandOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (message.trim() && !isLoading) {
        onSend();
      }
    }
  }

  const handleSendClick = useCallback(() => {
    if (message.trim() && !isLoading) {
      onSend();
    }
  }, [message, isLoading, onSend]);

  return (
    <div className="relative">
      {showCommandMenu && filteredCommands.length > 0 && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-1/2 z-50 mb-3 w-[380px] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/[0.08] bg-slate-900 shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)]"
        >
          <div className="border-b border-white/5 px-4 py-2.5">
            <p className="text-xs font-medium text-slate-400">
              <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[11px]">/</kbd> Commands
              <span className="ml-2 text-slate-500">— type to filter</span>
            </p>
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1.5">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => {
                  setMessage(`/${cmd.id} `);
                  setCommandOpen(false);
                  textareaRef.current?.focus();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                  i === selectedIndex
                    ? 'bg-atlas-teal/10 text-white'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${
                  i === selectedIndex ? 'bg-atlas-teal/15' : 'bg-white/5'
                }`}>
                  <svg className={`h-3.5 w-3.5 ${
                    i === selectedIndex ? 'text-atlas-teal' : 'text-slate-400'
                  }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={cmd.icon} />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{cmd.label}</p>
                  <p className="text-[11px] text-slate-500">{cmd.description}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">
            <span>↑↓ Navigate</span>
            <span><kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[11px]">↵</kbd> Select</span>
            <span><kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[11px]">esc</kbd> Close</span>
          </div>
        </div>
      )}

      <div
        className={`rounded-[1.25rem] border bg-slate-950/60 backdrop-blur-sm transition-all ${
          focused
            ? 'border-atlas-teal/50 shadow-[0_0_20px_rgba(72,215,200,0.08)]'
            : 'border-white/10 hover:border-white/20'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={isCreatingConversation ? 'Ask Atlas...' : 'Ask a follow-up question'}
          rows={1}
          className="w-full resize-none bg-transparent px-5 pb-2 pt-4 text-sm text-slate-100 transition placeholder:text-slate-500 focus:outline-none focus:ring-0"
        />

        <div className="flex items-center justify-between border-t border-white/5 px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAttach}
              className="rounded-xl p-2 text-slate-500 transition-all hover:bg-white/5 hover:text-slate-200 active:scale-95"
              title="Attach files"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onCollections}
              className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-all hover:bg-white/5 hover:text-slate-200 active:scale-95"
              title="Collections"
            >
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Collections
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-rose-200/80">{error}</span>
            )}
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
              >
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSendClick}
                disabled={!message.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-atlas-teal px-3 py-1.5 text-xs font-semibold text-slate-950 transition-all hover:bg-atlas-teal/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
