import { useRef, useEffect } from 'react';

const LABELS = [
  'Documents',
  'Embeddings',
  'Vector DB',
  'Retriever',
  'LLM',
  'Citation',
];

const TEAL = { r: 72, g: 215, b: 200 };
const BLUE = { r: 124, g: 199, b: 255 };

export function KnowledgeFlow() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let nodes = [];
    let edges = [];
    let particles = [];

    function resize() {
      const parent = canvas.parentElement;
      canvas.width = parent.offsetWidth;
      canvas.height = parent.offsetHeight;
    }

    function init() {
      const w = canvas.width;
      const h = canvas.height;
      const midY = h * 0.48;
      const spacing = Math.min(w * 0.13, 130);
      const startX = w * 0.5 - spacing * 2.5;

      nodes = LABELS.map((_, i) => ({
        x: startX + spacing * i,
        y: midY,
        r: 14,
        pulsePhase: Math.random() * Math.PI * 2,
      }));

      edges = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({ i, j: i + 1 });
      }

      particles = edges.map((e, ei) => ({
        edgeIndex: ei,
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.001,
      }));
    }

    function draw(timestamp) {
      const w = canvas.width;
      const h = canvas.height;
      const t = timestamp * 0.001;

      ctx.clearRect(0, 0, w, h);

      // Edge centers for mouse proximity
      const mouseEdgeBoost = new Array(edges.length).fill(0);
      if (mouseRef.current.x > -5000) {
        for (let ei = 0; ei < edges.length; ei++) {
          const { i, j } = edges[ei];
          const mx = (nodes[i].x + nodes[j].x) / 2;
          const my = (nodes[i].y + nodes[j].y) / 2;
          const dx = mouseRef.current.x - mx;
          const dy = mouseRef.current.y - my;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 160) {
            mouseEdgeBoost[ei] = (1 - dist / 160) * 0.2;
          }
        }
      }

      // Draw edges
      for (let ei = 0; ei < edges.length; ei++) {
        const { i, j } = edges[ei];
        const jitter = 0.06 * Math.sin(t * 0.3 + ei);
        const by = nodes[i].y + (nodes[j].y - nodes[i].y) * 0.5;
        const cpx = (nodes[i].x + nodes[j].x) / 2;
        const cpy = by + h * jitter * 0.08;

        const baseA = 0.12 + mouseEdgeBoost[ei];
        const alpha = Math.min(baseA, 0.35);

        // Gradient along edge
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.quadraticCurveTo(cpx, cpy, nodes[j].x, nodes[j].y);
        ctx.strokeStyle = `rgba(${BLUE.r}, ${BLUE.g}, ${BLUE.b}, ${alpha})`;
        ctx.lineWidth = 0.6 + mouseEdgeBoost[ei] * 1.5;
        ctx.stroke();

        // Arrow dot midway
        const arrowT = 0.48;
        const ax = (1 - arrowT) * (1 - arrowT) * nodes[i].x + 2 * (1 - arrowT) * arrowT * cpx + arrowT * arrowT * nodes[j].x;
        const ay = (1 - arrowT) * (1 - arrowT) * nodes[i].y + 2 * (1 - arrowT) * arrowT * cpy + arrowT * arrowT * nodes[j].y;
        if (alpha > 0.06) {
          ctx.beginPath();
          ctx.arc(ax, ay, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${BLUE.r}, ${BLUE.g}, ${BLUE.b}, ${alpha * 0.6})`;
          ctx.fill();
        }
      }

      // Update and draw particles
      for (const p of particles) {
        if (p.edgeIndex >= edges.length) continue;
        const { i, j } = edges[p.edgeIndex];
        const jitter = 0.06 * Math.sin(t * 0.3 + p.edgeIndex);
        const by = nodes[i].y + (nodes[j].y - nodes[i].y) * 0.5;
        const cpx = (nodes[i].x + nodes[j].x) / 2;
        const cpy = by + canvas.height * jitter * 0.08;

        p.t += p.speed;
        if (p.t > 1) p.t = 0;

        const t2 = p.t;
        const px = (1 - t2) * (1 - t2) * nodes[i].x + 2 * (1 - t2) * t2 * cpx + t2 * t2 * nodes[j].x;
        const py = (1 - t2) * (1 - t2) * nodes[i].y + 2 * (1 - t2) * t2 * cpy + t2 * t2 * nodes[j].y;

        // Pulse
        const pulse = 0.4 + 0.6 * Math.sin(t * 0.8 + p.t * Math.PI * 4);

        // Mouse speed boost
        const mdx = mouseRef.current.x - px;
        const mdy = mouseRef.current.y - py;
        const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        const speedBoost = mDist < 120 ? 1 + (1 - mDist / 120) * 1.5 : 1;

        ctx.beginPath();
        ctx.arc(px, py, Math.min(1.5 * speedBoost, 2.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${pulse * 0.5})`;
        ctx.fill();
      }

      // Draw nodes
      for (const n of nodes) {
        const pulse = 0.8 + 0.2 * Math.sin(t * 0.5 + n.pulsePhase);

        // Outer ring
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${0.12 * pulse})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Core glow
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 1.2);
        grad.addColorStop(0, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${0.2 * pulse})`);
        grad.addColorStop(1, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, 0)`);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Core fill
        ctx.beginPath();
        ctx.arc(n.x, n.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${0.5 * pulse})`;
        ctx.fill();

        // Label
        const label = LABELS[nodes.indexOf(n)];
        ctx.font = '11px "Inter", system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * pulse})`;
        ctx.fillText(label, n.x, n.y + n.r + 24);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    function handleMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    function handleMouseLeave() {
      mouseRef.current = { x: -9999, y: -9999 };
    }

    function handleResize() {
      resize();
      init();
    }

    resize();
    init();
    rafRef.current = requestAnimationFrame(draw);

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full pointer-events-none"
      aria-hidden="true"
      style={{ height: '350px' }}
    />
  );
}
