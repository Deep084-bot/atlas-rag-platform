import { useRef, useEffect } from 'react';

const CLUSTERS = [
  {
    label: 'Documents',
    bx: 0.10,
    nodes: [
      'Annual_Report.pdf',
      'Research.pdf',
      'Customer_Data.csv',
      'Product_Spec.pdf',
      'Budget_2026.pdf',
      'Meeting_Notes.txt',
      'Email_Archive',
    ],
  },
  {
    label: 'Embeddings',
    bx: 0.28,
    nodes: [
      'Sentence_Embed',
      'Semantic_Vec',
      'Dense_Retrieve',
      'Sparse_BM25',
      'Vector_Index',
      'Dim_Reduce',
    ],
  },
  {
    label: 'Vector DB',
    bx: 0.44,
    nodes: [
      'HNSW_Graph',
      'ANN_Search',
      'Cosine_Sim',
      'Exact_KNN',
      'Vector_Store',
      'Hybrid_Query',
    ],
  },
  {
    label: 'Retrieval',
    bx: 0.60,
    nodes: [
      'Context_Build',
      'Hybrid_Fusion',
      'Rerank_Step',
      'Filter_Chunks',
      'Source_Merge',
      'BM25_Score',
    ],
  },
  {
    label: 'Generation',
    bx: 0.76,
    nodes: [
      'LLM_Model',
      'Token_Stream',
      'Prompt_Tpl',
      'Response_Gen',
      'Context_Window',
    ],
  },
  {
    label: 'Citations',
    bx: 0.89,
    nodes: [
      'Source_Ref',
      'Citation_Map',
      'Confidence',
      'Snippet_Extract',
      'Page_Ref',
    ],
  },
];

const TEAL = { r: 72, g: 215, b: 200 };
const BLUE = { r: 124, g: 199, b: 255 };

// Build node list with globally unique indices
const NODE_NAMES = [];
const NODE_CLUSTER = [];
for (let ci = 0; ci < CLUSTERS.length; ci++) {
  for (const name of CLUSTERS[ci].nodes) {
    NODE_NAMES.push(name);
    NODE_CLUSTER.push(ci);
  }
}
const TOTAL_NODES = NODE_NAMES.length; // 35

// Edges: connect clusters sequentially and within clusters
const EDGE_DEFS = [];
let offset = 0;
for (let ci = 0; ci < CLUSTERS.length; ci++) {
  const clusterSize = CLUSTERS[ci].nodes.length;
  // Connect within cluster (each node to next)
  for (let i = 0; i < clusterSize - 1; i++) {
    EDGE_DEFS.push([offset + i, offset + i + 1]);
  }
  // Connect to next cluster (every node to ~every other node in next cluster)
  if (ci < CLUSTERS.length - 1) {
    const nextSize = CLUSTERS[ci + 1].nodes.length;
    for (let i = 0; i < clusterSize; i += 2) {
      for (let j = 1; j < nextSize; j += 2) {
        EDGE_DEFS.push([offset + i, offset + clusterSize + j]);
      }
    }
    // Backbone connection: last of this cluster to first of next
    EDGE_DEFS.push([offset + clusterSize - 1, offset + clusterSize]);
  }
  offset += clusterSize;
}

export function KnowledgeGraph() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(null);

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
      const h = canvas.height;
      const clusterSpacingY = h * 0.72;
      const clusterStartY = h * 0.14;

      const degree = new Array(TOTAL_NODES).fill(0);
      for (const [i, j] of EDGE_DEFS) {
        degree[i]++;
        degree[j]++;
      }
      const maxDegree = Math.max(...degree);

      nodes = NODE_NAMES.map((name, i) => {
        const ci = NODE_CLUSTER[i];
        const cluster = CLUSTERS[ci];
        const nodeIdxInCluster = cluster.nodes.indexOf(name);
        const clusterSize = cluster.nodes.length;
        const yPos = clusterStartY + (nodeIdxInCluster / (clusterSize - 1 || 1)) * clusterSpacingY;

        return {
          x: cluster.bx * canvas.width + (Math.random() - 0.5) * canvas.width * 0.03,
          y: yPos + (Math.random() - 0.5) * canvas.height * 0.04,
          vx: (Math.random() - 0.5) * 0.03,
          vy: (Math.random() - 0.5) * 0.03,
          r: 1 + (degree[i] / maxDegree) * 2.5,
          baseOpacity: 0.35 + (degree[i] / maxDegree) * 0.35,
          pulsePhase: Math.random() * Math.PI * 2,
          label: name,
          cluster: ci,
        };
      });

      edges = EDGE_DEFS.map(([i, j]) => ({
        i,
        j,
        phase: Math.random() * Math.PI * 2,
      }));

      particles = [];
      for (let ei = 0; ei < edges.length; ei += 2) {
        particles.push({
          edgeIndex: ei,
          t: Math.random(),
          speed: 0.0008 + Math.random() * 0.0008,
        });
      }
    }

    function draw(timestamp) {
      const w = canvas.width;
      const h = canvas.height;
      const t = timestamp * 0.001;

      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxDist = Math.max(w, h) * 0.6;

      // Update nodes
      for (const n of nodes) {
        const mdx = mouseRef.current.x - n.x;
        const mdy = mouseRef.current.y - n.y;
        const mDist = Math.sqrt(mdx * mdx + mdy * mdy);

        if (mDist < 180) {
          const force = (1 - mDist / 180) * 0.02;
          n.vx += mdx * force * 0.08;
          n.vy += mdy * force * 0.08;
        }

        n.vx *= 0.97;
        n.vy *= 0.97;
        n.x += n.vx;
        n.y += n.vy;

        const margin = 30;
        if (n.x < -margin) n.x = w + margin;
        if (n.x > w + margin) n.x = -margin;
        if (n.y < -margin) n.y = h + margin;
        if (n.y > h + margin) n.y = -margin;
      }

      // Mouse edge boost
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
            mouseEdgeBoost[ei] = (1 - dist / 160) * 0.25;
          }
        }
      }

      // Draw edges
      for (let ei = 0; ei < edges.length; ei++) {
        const { i, j } = edges[ei];
        const n1 = nodes[i];
        const n2 = nodes[j];
        const dx = n1.x - n2.x;
        const dy = n1.y - n2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxEdgeDist = Math.max(w, h) * 0.35;

        if (dist < maxEdgeDist) {
          const edgeFade = 1 - dist / maxEdgeDist;
          const midX = (n1.x + n2.x) / 2;
          const midY = (n1.y + n2.y) / 2;
          const fadeCenter = 1 - Math.sqrt((midX - cx) ** 2 + (midY - cy) ** 2) / maxDist;

          const baseA = 0.12 * edgeFade * Math.max(0, fadeCenter);
          const a = Math.min(baseA + mouseEdgeBoost[ei], 0.35);
          if (a < 0.005) continue;

          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.strokeStyle = `rgba(${BLUE.r}, ${BLUE.g}, ${BLUE.b}, ${a})`;
          ctx.lineWidth = 0.5 + a;
          ctx.stroke();
        }
      }

      // Particles
      for (const p of particles) {
        if (p.edgeIndex >= edges.length) continue;
        const { i, j } = edges[p.edgeIndex];
        const n1 = nodes[i];
        const n2 = nodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxEdgeDist = Math.max(w, h) * 0.35;

        if (dist < maxEdgeDist && dist > 2) {
          p.t += p.speed;
          if (p.t > 1) p.t = 0;

          const px = n1.x + dx * p.t;
          const py = n1.y + dy * p.t;

          // Mouse speed
          const mdx = mouseRef.current.x - px;
          const mdy = mouseRef.current.y - py;
          const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
          const speedBoost = mDist < 140 ? 1 + (1 - mDist / 140) * 2 : 1;

          // Fade toward edges
          const fadeCenter = 1 - Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / maxDist;
          const pulse = 0.4 + 0.6 * Math.sin(t * 0.6 + p.t * Math.PI * 4);
          const finalA = Math.max(0, fadeCenter) * pulse * 0.5;

          if (finalA > 0.02) {
            ctx.beginPath();
            ctx.arc(px, py, Math.min(1.5 * speedBoost, 2.8), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${finalA})`;
            ctx.fill();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        const dcx = n.x - cx;
        const dcy = n.y - cy;
        const distCenter = Math.sqrt(dcx * dcx + dcy * dcy);
        const vignette = Math.max(0, 1 - distCenter / maxDist);
        const pulse = 0.8 + 0.2 * Math.sin(t * 0.5 + n.pulsePhase);
        const a = n.baseOpacity * vignette * pulse;
        if (a < 0.01) continue;

        // Glow
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 2.5);
        grad.addColorStop(0, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${a * 0.25})`);
        grad.addColorStop(1, `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, 0)`);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${TEAL.r}, ${TEAL.g}, ${TEAL.b}, ${a})`;
        ctx.fill();
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
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
