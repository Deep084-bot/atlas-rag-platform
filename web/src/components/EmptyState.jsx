import { useCallback, useEffect, useRef, useState } from 'react';
import { KnowledgeOrb } from './KnowledgeOrb.jsx';

const SUGGESTED_PROMPTS = [
  { label: 'Summarize a document', description: 'Upload a PDF and get an instant summary', icon: 'M4 6h16M4 12h16M4 18h16' },
  { label: 'Compare two PDFs', description: 'Find differences and similarities', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { label: 'Explain a research paper', description: 'Understand complex topics easily', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { label: 'Prepare interview questions', description: 'Generate questions from documents', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
];

export function EmptyState({
  onNewConversation,
  onUpload,
  fadingOut = false,
  pulseTrigger = 0,
}) {
  const [mouseX, setMouseX] = useState(0.5);
  const [mouseY, setMouseY] = useState(0.5);
  const [mounted, setMounted] = useState(false);
  const [orbPulse, setOrbPulse] = useState(false);
  const [btnGlow, setBtnGlow] = useState(false);
  const prevPulseRef = useRef(0);
  const containerRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (pulseTrigger !== prevPulseRef.current) {
      prevPulseRef.current = pulseTrigger;
      setOrbPulse(true);
      setBtnGlow(true);
      const t1 = setTimeout(() => setOrbPulse(false), 600);
      const t2 = setTimeout(() => setBtnGlow(false), 800);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [pulseTrigger]);

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMouseX((e.clientX - rect.left) / rect.width);
    setMouseY((e.clientY - rect.top) / rect.height);
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${
        fadingOut ? 'pointer-events-none' : ''
      }`}
    >
      <div className={`transition-all duration-[600ms] ease-in-out ${
        fadingOut
          ? 'scale-[0.3] translate-y-[-120px] opacity-0'
          : 'scale-100 translate-y-0 opacity-100'
      } ${orbPulse ? 'animate-[orbPulse_0.6s_ease-out]' : ''}`}>
        <KnowledgeOrb mouseX={mouseX} mouseY={mouseY} isActive={mounted && !fadingOut} />
      </div>

      <div className="relative z-10 mx-auto flex max-w-lg flex-col items-center px-6">
        <div
          className={`w-full text-center transition-all duration-700 ${
            mounted && !fadingOut ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Your private knowledge workspace
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Upload documents, then ask questions and get AI-powered answers with citations.
          </p>
        </div>

        <div
          className={`mt-8 flex items-center gap-3 transition-all duration-700 delay-150 ${
            mounted && !fadingOut ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <button
            type="button"
            onClick={onNewConversation}
            className={`group rounded-full bg-atlas-teal px-5 py-2.5 text-sm font-semibold text-slate-950 transition-all hover:bg-atlas-teal/90 active:scale-[0.97] ${
              btnGlow
                ? 'shadow-[0_0_32px_rgba(72,215,200,0.5)] scale-[1.02]'
                : 'shadow-lg shadow-atlas-teal/20 hover:shadow-atlas-teal/30'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 transition group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Conversation
            </span>
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="group rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-white/10 active:scale-[0.97]"
          >
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              Upload Document
            </span>
          </button>
        </div>

        <div
          className={`mt-10 grid w-full grid-cols-2 gap-3 transition-all duration-700 delay-300 ${
            mounted && !fadingOut ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt.label}
              type="button"
              onClick={onNewConversation}
              className="group rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-left transition-all hover:border-white/15 hover:bg-white/[0.06] active:scale-[0.98]"
            >
              <svg className="mb-2 h-4 w-4 text-atlas-teal/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={prompt.icon} />
              </svg>
              <p className="text-sm font-medium text-slate-200">{prompt.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{prompt.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
