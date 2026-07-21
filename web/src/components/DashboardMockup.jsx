import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

const conversationData = [
  {
    id: 'q2-financial',
    title: 'Q2 Financial Review',
    time: '2h ago',
    group: 'today',
    messages: [
      { role: 'user', text: "What's the revenue growth from the Q2 report?" },
      { role: 'assistant', text: 'Revenue grew <strong>12% year-over-year</strong> driven by enterprise segment expansion and new product adoption. Operating margins improved by 3.2 percentage points, largely due to cost optimization in cloud infrastructure.' }
    ],
    citation: {
      fileName: 'Q2_Report.pdf',
      similarity: '0.92',
      page: '3',
      snippet: 'Revenue grew 12% year-over-year driven by enterprise segment expansion and new product adoption. Operating margins improved by 3.2 percentage points.'
    }
  },
  {
    id: 'budget-planning',
    title: 'Budget Planning 2026',
    time: '5h ago',
    group: 'today',
    messages: [
      { role: 'user', text: 'What are the key budget allocations for next year?' },
      { role: 'assistant', text: 'The 2026 budget allocates <strong>$4.2M to R&D</strong> (up 18% YoY), $2.8M to marketing, and $1.5M to infrastructure. The board has approved a 15% headcount increase across engineering and product teams.' }
    ],
    citation: {
      fileName: 'Budget_2026.pdf',
      similarity: '0.88',
      page: '18',
      snippet: 'The 2026 budget allocates $4.2M to R&D (up 18% YoY), $2.8M to marketing, and $1.5M to infrastructure.'
    }
  },
  {
    id: 'product-roadmap',
    title: 'Product Roadmap',
    time: '1d ago',
    group: 'earlier',
    messages: [
      { role: 'user', text: 'What features are planned for next quarter?' },
      { role: 'assistant', text: 'Q3 priorities include: <strong>real-time collaboration</strong>, API rate limiting dashboard, and an improved search relevance model. The team is also evaluating vector search performance benchmarks for the HNSW index.' }
    ],
    citation: {
      fileName: 'Roadmap_v3.pdf',
      similarity: '0.85',
      page: '7',
      snippet: 'Q3 priorities include real-time collaboration, API rate limiting dashboard, and improved search relevance model.'
    }
  },
  {
    id: 'customer-feedback',
    title: 'Customer Feedback',
    time: '2d ago',
    group: 'earlier',
    messages: [
      { role: 'user', text: 'Summarize the latest customer feedback themes.' },
      { role: 'assistant', text: 'Top themes from June feedback: <strong>85% of users</strong> request PDF batch upload, 62% want custom chunk size configuration, and 47% ask for multi-language OCR support. NPS improved from 42 to 56 quarter-over-quarter.' }
    ],
    citation: {
      fileName: 'Customer_Insights.pdf',
      similarity: '0.91',
      page: '5',
      snippet: '85% of users request PDF batch upload, 62% want custom chunk size configuration, and 47% ask for multi-language OCR support.'
    }
  },
  {
    id: 'meeting-notes',
    title: 'Meeting Notes',
    time: '3d ago',
    group: 'earlier',
    messages: [
      { role: 'user', text: 'What decisions were made in the last sprint review?' },
      { role: 'assistant', text: 'The sprint review confirmed: <strong>embedding pipeline latency reduced by 40%</strong>, streaming SSE delivery is stable at p99 < 200ms, and the team agreed to deprecate the legacy search endpoint in favor of the new retrieval API v2.' }
    ],
    citation: {
      fileName: 'Meeting_Notes.pdf',
      similarity: '0.87',
      page: '12',
      snippet: 'Embedding pipeline latency reduced by 40%, streaming SSE delivery stable at p99 < 200ms.'
    }
  }
];

function Sidebar({ activeId, onSelect, searchActive, searchQuery, onSearchToggle, onSearchChange, onSearchExit }) {
  const filtered = useMemo(() => {
    if (!searchActive || !searchQuery) return conversationData;
    return conversationData.filter((c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchActive, searchQuery]);

  const grouped = useMemo(() => {
    const groups = { today: [], earlier: [] };
    for (const c of filtered) {
      groups[c.group].push(c);
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex w-56 flex-col border-r border-white/[0.06] bg-white/[0.02]">
      <div className="border-b border-white/[0.04] px-3.5 py-3">
        {searchActive ? (
          <div className="flex items-center gap-2 rounded-md bg-white/[0.06] px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/20" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input
              type="text"
              value={searchQuery}
              onChange={onSearchChange}
              onKeyDown={(e) => { if (e.key === 'Escape') onSearchExit(); }}
              placeholder="Search conversations..."
              className="flex-1 bg-transparent text-sm text-white/80 placeholder-white/20 outline-none"
              autoFocus
              aria-label="Search conversations"
            />
            <button type="button" onClick={onSearchExit} className="flex h-5 w-5 items-center justify-center rounded text-white/20 transition hover:text-white/50" aria-label="Clear search">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ) : (
          <button type="button" onClick={onSearchToggle} className="flex w-full items-center gap-2 rounded-md bg-white/[0.04] px-3 py-2 transition hover:bg-white/[0.06]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/20" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <span className="text-sm text-white/20">Search conversations...</span>
          </button>
        )}
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
        {grouped.today.length > 0 && (
          <div className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-widest text-white/20">Today</div>
        )}
        {grouped.today.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => { onSelect(c.id); if (searchActive) onSearchExit(); }}
            className={`w-full rounded-lg px-3 py-2.5 text-left transition-all duration-150 ${
              activeId === c.id
                ? 'bg-atlas-teal/[0.08]'
                : 'hover:bg-white/[0.03]'
            }`}
          >
            <div className={`truncate text-sm ${activeId === c.id ? 'font-semibold text-white' : 'text-white/60'}`}>
              {c.title}
            </div>
            <div className="text-xs text-white/20">{c.time}</div>
          </button>
        ))}
        {grouped.earlier.length > 0 && (
          <div className="mb-2 mt-4 px-2.5 text-[11px] font-semibold uppercase tracking-widest text-white/20">Earlier</div>
        )}
        {grouped.earlier.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => { onSelect(c.id); if (searchActive) onSearchExit(); }}
            className={`w-full rounded-lg px-3 py-2.5 text-left transition-all duration-150 ${
              activeId === c.id
                ? 'bg-atlas-teal/[0.08]'
                : 'hover:bg-white/[0.03]'
            }`}
          >
            <div className={`truncate text-sm ${activeId === c.id ? 'font-semibold text-white' : 'text-white/60'}`}>
              {c.title}
            </div>
            <div className="text-xs text-white/20">{c.time}</div>
          </button>
        ))}
        {filtered.length === 0 && searchQuery && (
          <div className="px-2.5 py-8 text-center text-sm text-white/20">No conversations found</div>
        )}
      </div>
    </div>
  );
}

function MainPanel({ conversation, messages }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div key={conversation.id} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/[0.04] px-6 py-3.5">
        <h3 className="text-base font-semibold text-white/90">{conversation.title}</h3>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto px-6 pb-14 pt-5">
        {messages.map((msg, i) => (
          msg.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[78%] rounded-2xl rounded-br-md bg-atlas-teal/10 px-5 py-3">
                <p className="text-base text-white/80">{msg.text}</p>
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[88%] space-y-3">
                <div className="rounded-2xl rounded-bl-md border border-white/[0.06] bg-white/[0.02] px-5 py-3.5">
                  <p className="text-base leading-relaxed text-white/80" dangerouslySetInnerHTML={{ __html: msg.text }} />
                  {conversation.citation && (
                    <div className="group relative mt-4">
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-all duration-150 hover:bg-white/[0.04]">
                        <div className="flex items-start gap-3">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#48d7c8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4Z" /><path d="M12 17v.01" /></svg>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-atlas-teal/90">{conversation.citation.fileName}</span>
                              <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-white/30">PDF</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/30">
                              <span>Page {conversation.citation.page}</span>
                              <span className="text-white/10">·</span>
                              <span className="flex items-center gap-1.5">
                                <span className="inline-flex h-1.5 w-14 overflow-hidden rounded-full bg-white/[0.06]">
                                  <span className="h-full rounded-full bg-atlas-teal/60" style={{ width: `${parseFloat(conversation.citation.similarity) * 100}%` }} />
                                </span>
                                <span className="font-medium text-white/40">{parseFloat(conversation.citation.similarity) >= 0.9 ? 'High' : 'Medium'} confidence</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="pointer-events-none absolute bottom-full left-0 right-0 mb-2 translate-y-1 opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
                        <div className="rounded-lg border border-white/[0.12] bg-[#0f1f2f] px-4 py-2.5 shadow-soft">
                          <p className="text-xs leading-relaxed text-white/40">
                            &ldquo;{conversation.citation.snippet}&rdquo;
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function InputBar({ value, onChange, onSend }) {
  return (
    <div className="flex-shrink-0 border-t border-white/[0.04] px-5 py-3.5">
      <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-all duration-150 focus-within:border-atlas-teal/30 focus-within:bg-white/[0.03]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/20" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
          placeholder="Ask anything about your documents..."
          className="flex-1 bg-transparent text-base text-white/80 placeholder-white/20 outline-none focus:ring-1 focus:ring-atlas-teal/30 rounded"
          aria-label="Type a message"
        />
        <button
          type="button"
          onClick={onSend}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-atlas-teal/80 transition-all duration-150 hover:bg-atlas-teal hover:scale-105"
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06111f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polyline points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
      </div>
    </div>
  );
}

function SignInModal({ visible, onDismiss }) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#06111f]/60 backdrop-blur-sm animate-fade-in" style={{ animationDuration: '0.15s' }}>
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0a1628] p-6 shadow-glow-lg animate-fade-in-up" style={{ animationDuration: '0.2s' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 100 100" aria-hidden="true">
              <defs>
                <linearGradient id="modal-logo" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#48d7c8" />
                  <stop offset="100%" stopColor="#7cc7ff" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="48" fill="none" stroke="url(#modal-logo)" strokeWidth="6" />
              <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#modal-logo)" textAnchor="middle">A</text>
            </svg>
            <span className="text-sm font-bold tracking-[0.15em] text-white/80">ATLAS</span>
          </div>
          <button type="button" onClick={onDismiss} className="flex h-6 w-6 items-center justify-center rounded-md text-white/30 transition hover:text-white/60 hover:bg-white/[0.04]" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mt-5">
          <p className="text-base font-semibold text-white/90">Try Atlas with your own documents.</p>
          <p className="mt-1.5 text-sm text-white/40">Sign in to upload documents, search semantically, and chat with citation-backed answers.</p>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/login"
            className="flex h-10 items-center justify-center rounded-xl border border-white/[0.08] text-sm font-medium text-white/60 transition hover:border-white/[0.15] hover:text-white/80"
          >
            Log In
          </Link>
          <Link
            to="/signup"
            className="flex h-10 items-center justify-center rounded-xl bg-atlas-teal text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
          >
            Sign Up
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-10 items-center justify-center rounded-xl text-sm text-white/30 transition hover:text-white/50"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}

const DEMO_IDS = ['q2-financial', 'budget-planning', 'product-roadmap'];

export function DashboardMockup() {
  const [activeId, setActiveId] = useState('q2-financial');
  const [inputValue, setInputValue] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingMessages, setPendingMessages] = useState([]);
  const [hovered, setHovered] = useState(false);
  const timeoutRef = useRef(null);
  const cycleRef = useRef(null);
  const lastInteractRef = useRef(Date.now());

  const startCycle = useCallback(() => {
    if (cycleRef.current) clearInterval(cycleRef.current);
    cycleRef.current = setInterval(() => {
      const idle = Date.now() - lastInteractRef.current;
      if (idle < 10000) return;
      setActiveId((prev) => {
        const idx = DEMO_IDS.indexOf(prev);
        return DEMO_IDS[(idx + 1) % DEMO_IDS.length];
      });
      setPendingMessages([]);
    }, 6000);
  }, []);

  const handleInteraction = useCallback(() => {
    lastInteractRef.current = Date.now();
  }, []);

  useEffect(() => {
    startCycle();
    return () => {
      if (cycleRef.current) clearInterval(cycleRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [startCycle]);

  const activeConversation = useMemo(
    () => conversationData.find((c) => c.id === activeId) || conversationData[0],
    [activeId]
  );

  const allMessages = useMemo(
    () => [...activeConversation.messages, ...pendingMessages],
    [activeConversation, pendingMessages]
  );

  const handleSelect = useCallback((id) => {
    setActiveId(id);
    setPendingMessages([]);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowModal(false);
    handleInteraction();
    startCycle();
  }, [handleInteraction, startCycle]);

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return;

    const text = inputValue.trim();
    setInputValue('');
    setPendingMessages((prev) => [...prev, { role: 'user', text }]);
    handleInteraction();

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setShowModal(true);
    }, 350);
  }, [inputValue, handleInteraction]);

  const handleDismiss = useCallback(() => {
    setShowModal(false);
    setPendingMessages([]);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleSearchToggle = useCallback(() => {
    setSearchActive(true);
    setSearchQuery('');
  }, []);

  const handleSearchExit = useCallback(() => {
    setSearchActive(false);
    setSearchQuery('');
  }, []);

  const handleSearchChange = useCallback((e) => {
    setSearchQuery(e.target.value);
  }, []);

  return (
    <div
      className="mockup-window relative transition-all duration-300"
      style={{
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: hovered
          ? '0 36px 100px rgba(0,0,0,0.55), 0 0 0 1px rgba(72, 215, 200, 0.15)'
          : '0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.10)',
      }}
      onMouseEnter={() => { setHovered(true); handleInteraction(); }}
      onMouseLeave={() => setHovered(false)}
      onClick={handleInteraction}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="demo-logo-g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#48d7c8" />
                <stop offset="100%" stopColor="#7cc7ff" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="48" fill="none" stroke="url(#demo-logo-g)" strokeWidth="6" />
            <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#demo-logo-g)" textAnchor="middle">A</text>
          </svg>
          <span className="text-xs font-bold tracking-[0.15em] text-white/70">ATLAS</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-atlas-teal/20">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#48d7c8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </div>
          <div className="h-1.5 w-1.5 rounded-full bg-atlas-teal/60" />
        </div>
      </div>

      <div className="flex overflow-hidden" style={{ height: '560px' }}>
        <Sidebar
          activeId={activeId}
          onSelect={handleSelect}
          searchActive={searchActive}
          searchQuery={searchQuery}
          onSearchToggle={handleSearchToggle}
          onSearchChange={handleSearchChange}
          onSearchExit={handleSearchExit}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <MainPanel conversation={activeConversation} messages={allMessages} />
          <InputBar value={inputValue} onChange={setInputValue} onSend={handleSend} />
        </div>
      </div>

      <SignInModal visible={showModal} onDismiss={handleDismiss} />
    </div>
  );
}
