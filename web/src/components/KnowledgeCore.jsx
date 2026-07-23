import { useCallback, useEffect, useRef } from 'react';

const NODES = [
  { id: 0, label: 'Documents', x: 0.15, y: 0.50 },
  { id: 1, label: 'Extraction', x: 0.28, y: 0.30 },
  { id: 2, label: 'Chunking', x: 0.42, y: 0.18 },
  { id: 3, label: 'Embeddings', x: 0.58, y: 0.18 },
  { id: 4, label: 'Vector DB', x: 0.72, y: 0.30 },
  { id: 5, label: 'Retrieval', x: 0.85, y: 0.45 },
  { id: 6, label: 'LLM', x: 0.85, y: 0.65 },
  { id: 7, label: 'Answer', x: 0.72, y: 0.80 },
  { id: 8, label: 'Knowledge', x: 0.58, y: 0.88 },
  { id: 9, label: 'Search', x: 0.42, y: 0.88 },
  { id: 10, label: 'Ranking', x: 0.28, y: 0.78 },
];

const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [4, 5], [5, 6], [6, 7],
  [7, 8], [7, 9],
  [5, 10], [10, 6],
  [2, 9], [4, 8],
];

const TEAL = '48, 215, 200';
const SKY = '124, 199, 255';

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function hexToRgba(hex, a) {
  return `rgba(${hex}, ${a})`;
}

export function KnowledgeCore({ mouseX, mouseY, isActive = true }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animRef = useRef(null);
  const timeRef = useRef(0);
  const smoothX = useRef(0.5);
  const smoothY = useRef(0.5);

  const initParticles = useCallback(() => {
    const particles = [];
    for (let i = 0; i < 60; i++) {
      const edgeIdx = Math.floor(Math.random() * EDGES.length);
      const [from, to] = EDGES[edgeIdx];
      particles.push({
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.006,
        size: 1 + Math.random() * 2,
        from,
        to,
      });
    }
    particlesRef.current = particles;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let dpr = 1;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      initParticles();
    }

    resize();
    window.addEventListener('resize', resize);

    function draw() {
      timeRef.current += 1;

      const targetX = mouseX ?? 0.5;
      const targetY = mouseY ?? 0.5;
      smoothX.current += (targetX - smoothX.current) * 0.08;
      smoothY.current += (targetY - smoothY.current) * 0.08;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const px = smoothX.current;
      const py = smoothY.current;
      const parallaxX = (px - 0.5) * 8;
      const parallaxY = (py - 0.5) * 6;

      const cursorGlowX = px * w;
      const cursorGlowY = py * h;

      ctx.clearRect(0, 0, w, h);

      const basePositions = NODES.map((n) => ({
        x: n.x * w,
        y: n.y * h,
      }));

      for (const [from, to] of EDGES) {
        const a = basePositions[from];
        const b = basePositions[to];
        const pulse = 0.12 + 0.08 * Math.sin(timeRef.current * 0.02 + from + to);

        ctx.beginPath();
        ctx.moveTo(a.x + parallaxX, a.y + parallaxY);
        ctx.lineTo(b.x + parallaxX, b.y + parallaxY);
        ctx.strokeStyle = hexToRgba(TEAL, pulse);
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }

      for (let i = 0; i < NODES.length; i++) {
        const base = basePositions[i];
        const float = 3 * Math.sin(timeRef.current * 0.01 + i);
        const nodePulse = 0.35 + 0.15 * Math.sin(timeRef.current * 0.015 + i * 1.5);

        const nx = base.x + parallaxX;
        const ny = base.y + float + parallaxY;

        const dist = Math.sqrt(
          (nx - cursorGlowX) ** 2 + (ny - cursorGlowY) ** 2
        );
        const glowBoost = Math.max(0, 1 - dist / (w * 0.4)) * 0.2;

        const grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, 18);
        grad.addColorStop(0, hexToRgba(TEAL, Math.min(1, nodePulse + glowBoost)));
        grad.addColorStop(0.4, hexToRgba(TEAL, (nodePulse + glowBoost) * 0.4));
        grad.addColorStop(1, hexToRgba(TEAL, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(nx, ny, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(nx, ny, 3, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(TEAL, 0.7 + glowBoost * 0.3);
        ctx.fill();

        if (isActive && Math.sin(timeRef.current * 0.03 + i * 2) > 0.94) {
          ctx.beginPath();
          ctx.arc(nx, ny, 22, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(TEAL, 0.12 + glowBoost * 0.08);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      const cursorGrad = ctx.createRadialGradient(
        cursorGlowX, cursorGlowY, 0,
        cursorGlowX, cursorGlowY, w * 0.3
      );
      cursorGrad.addColorStop(0, hexToRgba(TEAL, 0.04));
      cursorGrad.addColorStop(1, hexToRgba(TEAL, 0));
      ctx.fillStyle = cursorGrad;
      ctx.fillRect(0, 0, w, h);

      const particles = particlesRef.current;
      for (const p of particles) {
        p.t += p.speed;
        if (p.t > 1) {
          p.t = 0;
          const edgeIdx = Math.floor(Math.random() * EDGES.length);
          const [from, to] = EDGES[edgeIdx];
          p.from = from;
          p.to = to;
        }

        const from = basePositions[p.from];
        const to = basePositions[p.to];
        const tEased = easeInOut(p.t);
        const px2 = from.x + (to.x - from.x) * tEased + parallaxX;
        const py2 = from.y + (to.y - from.y) * tEased + parallaxY;

        const gradient = ctx.createRadialGradient(px2, py2, 0, px2, py2, 5);
        gradient.addColorStop(0, hexToRgba(SKY, 0.6));
        gradient.addColorStop(1, hexToRgba(SKY, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px2, py2, p.size + 2, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [mouseX, mouseY, isActive, initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: 'none' }}
    />
  );
}
