import { useState, useEffect, useRef } from 'react';

export function CustomCursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const posRef = useRef({ x: -100, y: -100 });
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef(null);
  const expandedRef = useRef(false);

  useEffect(() => {
    document.documentElement.style.cursor = 'none';

    function onMouseMove(e) {
      posRef.current = { x: e.clientX, y: e.clientY };
      if (!visible) setVisible(true);

      const target = e.target;
      if (target && target.closest) {
        const isInteractive = !!(
          target.closest('a') ||
          target.closest('button') ||
          target.closest('input') ||
          target.closest('textarea') ||
          target.closest('[role="button"]') ||
          target.closest('[tabindex]:not([tabindex="-1"])')
        );
        if (isInteractive !== expandedRef.current) {
          expandedRef.current = isInteractive;
          setExpanded(isInteractive);
        }
      }
    }

    function onMouseLeave() {
      setVisible(false);
    }

    function tick() {
      const { x, y } = posRef.current;
      const t = `translate3d(${x}px, ${y}px, 0)`;
      if (dotRef.current) dotRef.current.style.transform = t;
      if (ringRef.current) ringRef.current.style.transform = t;
      rafRef.current = requestAnimationFrame(tick);
    }

    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave);

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      document.documentElement.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <div
        ref={dotRef}
        className="fixed top-0 left-0 z-[9999] pointer-events-none"
        style={{
          width: 5,
          height: 5,
          marginLeft: -2.5,
          marginTop: -2.5,
          borderRadius: '50%',
          background: '#48d7c8',
          willChange: 'transform',
        }}
      />
      <div
        ref={ringRef}
        className="fixed top-0 left-0 z-[9999] pointer-events-none rounded-full"
        style={{
          width: expanded ? 34 : 22,
          height: expanded ? 34 : 22,
          marginLeft: expanded ? -17 : -11,
          marginTop: expanded ? -17 : -11,
          border: '1px solid rgba(72, 215, 200, 0.4)',
          transition: 'width 0.15s ease, height 0.15s ease, margin-left 0.15s ease, margin-top 0.15s ease',
          willChange: 'transform',
        }}
      />
    </>
  );
}
