import { useCallback, useEffect, useRef } from 'react';

const ORB_CORE_RADIUS = 28;
const ORBIT_RINGS = 3;
const PACKETS_PER_RING = 6;
const TEAL = { r: 72, g: 215, b: 200 };
const SKY = { r: 124, g: 199, b: 255 };

export function KnowledgeOrb({ mouseX = 0.5, mouseY = 0.5, isActive = true }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);
  const smoothX = useRef(0.5);
  const smoothY = useRef(0.5);
  const packetsRef = useRef(null);

  const initPackets = useCallback(() => {
    const packets = [];
    for (let r = 0; r < ORBIT_RINGS; r++) {
      const ringRadius = 45 + r * 28;
      for (let i = 0; i < PACKETS_PER_RING; i++) {
        packets.push({
          ring: r,
          ringRadius,
          angle: (i / PACKETS_PER_RING) * Math.PI * 2 + Math.random() * 0.5,
          speed: 0.004 + r * 0.002 + Math.random() * 0.001,
          length: 6 + Math.random() * 3,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    packetsRef.current = packets;
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
      initPackets();
    }

    resize();
    window.addEventListener('resize', resize);

    function draw() {
      timeRef.current += 1;
      const t = timeRef.current;

      const targetX = mouseX ?? 0.5;
      const targetY = mouseY ?? 0.5;
      smoothX.current += (targetX - smoothX.current) * 0.06;
      smoothY.current += (targetY - smoothY.current) * 0.06;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      const cx = w / 2;
      const cy = h / 2;
      const maxDim = Math.min(w, h);
      const scale = maxDim / 280;

      const dx = (smoothX.current - 0.5) * 20 * scale;
      const dy = (smoothY.current - 0.5) * 16 * scale;

      ctx.clearRect(0, 0, w, h);

      // Outer glow
      const breathGlow = 0.08 + 0.04 * Math.sin(t * 0.012);
      const glowRadius = 80 * scale + 20 * Math.sin(t * 0.01);
      const glow = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, glowRadius);
      glow.addColorStop(0, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${breathGlow})`);
      glow.addColorStop(0.5, `rgba(${SKY.r}, ${SKY.g}, ${SKY.b}, ${breathGlow * 0.5})`);
      glow.addColorStop(1, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Orbit rings
      if (isActive) {
        for (let r = 0; r < ORBIT_RINGS; r++) {
          const ringRadius = (45 + r * 28) * scale;
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${0.04 + 0.02 * Math.sin(t * 0.008 + r)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Packets traveling on orbits
      const packets = packetsRef.current;
      if (packets) {
        for (const p of packets) {
          p.angle += p.speed;
          const radius = p.ringRadius * scale;
          const px = cx + dx + Math.cos(p.angle) * radius;
          const py = cy + dy + Math.sin(p.angle) * radius;

          const distFromCenter = Math.sqrt(
            (Math.cos(p.angle) * radius) ** 2 + (Math.sin(p.angle) * radius) ** 2
          );
          const colorFade = Math.min(1, distFromCenter / (80 * scale)) || 0;

          const tangent = p.angle + Math.PI / 2;
          const trailLength = p.length * scale;

          // Packet glow
          const pg = ctx.createRadialGradient(px, py, 0, px, py, trailLength * 1.5);
          pg.addColorStop(0, `rgba(${SKY.r}, ${SKY.g}, ${SKY.b}, ${0.3 * colorFade})`);
          pg.addColorStop(1, `rgba(${SKY.r}, ${SKY.g}, ${SKY.b}, 0)`);
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(px, py, trailLength * 1.5, 0, Math.PI * 2);
          ctx.fill();

          // Packet trail
          const trailX = px - Math.cos(tangent) * trailLength;
          const trailY = py - Math.sin(tangent) * trailLength;

          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(trailX, trailY);
          ctx.strokeStyle = `rgba(${SKY.r}, ${SKY.g}, ${SKY.b}, ${0.4 * colorFade})`;
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'round';
          ctx.stroke();

          // Packet head (brighter dot at front)
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${SKY.r}, ${SKY.g}, ${SKY.b}, ${0.7 * colorFade})`;
          ctx.fill();

          // Faint copy behind for depth
          ctx.beginPath();
          ctx.arc(trailX, trailY, 1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${SKY.r}, ${SKY.g}, ${SKY.b}, ${0.15 * colorFade})`;
          ctx.fill();
        }
      }

      // Orb core
      const corePulse = 0.7 + 0.3 * Math.sin(t * 0.015);
      const coreRadius = ORB_CORE_RADIUS * scale * corePulse;

      const coreGlow = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, coreRadius * 2);
      coreGlow.addColorStop(0, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${0.25 * corePulse})`);
      coreGlow.addColorStop(0.4, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${0.1 * corePulse})`);
      coreGlow.addColorStop(1, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, 0)`);
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, coreRadius * 2, 0, Math.PI * 2);
      ctx.fill();

      const coreGrad = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, coreRadius);
      coreGrad.addColorStop(0, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, 0.9)`);
      coreGrad.addColorStop(0.6, `rgba(${SKY.r}, ${SKY.g}, ${SKY.b}, 0.4)`);
      coreGrad.addColorStop(1, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright core
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, coreRadius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * corePulse})`;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [mouseX, mouseY, isActive, initPackets]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: 'none' }}
    />
  );
}
