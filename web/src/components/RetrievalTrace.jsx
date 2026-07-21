import { useState, useEffect, useRef } from 'react';

const STEPS = [
  { id: 'index', label: 'Document indexed' },
  { id: 'embed', label: 'Query embedded' },
  { id: 'search', label: 'Similar chunks found' },
  { id: 'cite', label: 'Citation generated' },
];

const CYCLE_INTERVAL = 2500;

export function RetrievalTrace() {
  const [activeStep, setActiveStep] = useState(-1);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    function advance() {
      setActiveStep((prev) => {
        if (prev >= STEPS.length - 1) return -1;
        return prev + 1;
      });
      setAnimating(true);
    }

    timerRef.current = setInterval(advance, CYCLE_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="pointer-events-none rounded-xl border border-white/[0.06] bg-[#0a1628]/80 px-4 py-3 shadow-soft backdrop-blur-sm">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
        Atlas Retrieval Engine
      </div>
      <div className="space-y-1.5">
        {STEPS.map((step, i) => {
          const state = i < activeStep ? 'done' : i === activeStep ? 'active' : 'pending';
          return (
            <div key={step.id} className="flex items-center gap-2 text-xs">
              {state === 'done' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#48d7c8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : state === 'active' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
                  <circle cx="12" cy="12" r="5" fill="#48d7c8" opacity="0.8">
                    <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                  <circle cx="12" cy="12" r="8" fill="none" stroke="#48d7c8" strokeWidth="1" opacity="0.3">
                    <animate attributeName="opacity" values="0.3;0.1;0.3" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-white/15">
                  <circle cx="12" cy="12" r="8" />
                </svg>
              )}
              <span
                className="transition-all duration-500"
                style={{
                  color:
                    state === 'done'
                      ? 'rgba(72, 215, 200, 0.7)'
                      : state === 'active'
                      ? 'rgba(255, 255, 255, 0.7)'
                      : 'rgba(255, 255, 255, 0.2)',
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
