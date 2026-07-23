import { useState } from 'react';
import { LandingNavbar } from '../components/LandingNavbar.jsx';
import { Footer } from '../components/Footer.jsx';

const sections = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'rag-pipeline', label: 'RAG Pipeline' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'api-reference', label: 'API Reference' },
];

function FeatureCard({ icon, title, description }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-atlas-teal">
        {icon}
      </div>
      <h3 className="mb-1 text-sm font-semibold text-white/90">{title}</h3>
      <p className="text-sm leading-relaxed text-white/40">{description}</p>
    </div>
  );
}

function CodeBlock({ children }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#0a1628] p-4">
      <pre className="text-[13px] leading-relaxed text-white/70"><code>{children}</code></pre>
    </div>
  );
}

function InlineCode({ children }) {
  return (
    <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[13px] font-medium text-atlas-teal">
      {children}
    </code>
  );
}

function MethodBadge({ method }) {
  const styles = {
    POST: 'bg-green-500/10 text-green-400',
    GET: 'bg-blue-500/10 text-blue-400',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${styles[method] || 'bg-white/[0.04] text-white/40'}`}>
      {method}
    </span>
  );
}

function PipelineStep({ num, title, description, active }) {
  return (
    <div className={`flex items-start gap-4 border-l-2 px-4 py-3.5 ${active ? 'border-atlas-teal/30 bg-white/[0.02]' : 'border-white/[0.06] bg-white/[0.01]'}`}>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold ${active ? 'bg-atlas-teal/10 text-atlas-teal' : 'bg-white/[0.04] text-white/40'}`}>
        {num}
      </div>
      <div>
        <div className="text-sm font-semibold text-white/80">{title}</div>
        <div className="mt-0.5 text-sm text-white/40">{description}</div>
      </div>
    </div>
  );
}

function Introduction() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">What is Atlas?</h1>
      <p className="mt-4 text-base leading-relaxed text-white/60">
        Atlas is an open-source Retrieval-Augmented Generation (RAG) platform for building private AI knowledge systems. It lets you upload documents, embed them into a vector database, and query them using natural language — all self-hosted with Docker.
      </p>

      <h2 className="mt-12 text-lg font-semibold text-white">Core Capabilities</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          }
          title="Document Ingestion"
          description="Upload PDFs with OCR-based text extraction. Atlas automatically processes scanned documents and extracts text content with structure preservation."
        />
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          }
          title="Semantic Search"
          description="Queries are matched against your knowledge base using vector similarity search powered by pgvector with HNSW and IVFFlat index support."
        />
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          title="Citation Answers"
          description="Every response links back to source documents with page references, similarity scores, and confidence ratings for full traceability."
        />
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
          title="Self Hosted"
          description="Your data never leaves your infrastructure. Single Docker Compose command with PostgreSQL + pgvector included. MIT licensed."
        />
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Getting Started</h2>
      <p className="mt-2 text-base leading-relaxed text-white/60">
        Deploy Atlas in minutes with Docker. Follow the <a href="#deployment" className="text-atlas-teal underline underline-offset-2 hover:text-atlas-teal/80">deployment guide</a> to get started, or explore the <a href="#architecture" className="text-atlas-teal underline underline-offset-2 hover:text-atlas-teal/80">architecture overview</a> to understand how the system works.
      </p>
    </>
  );
}

function Architecture() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">Architecture</h1>
      <p className="mt-4 text-base leading-relaxed text-white/60">
        Atlas follows a modular pipeline architecture with clearly separated concerns. Each component is independently scalable and replaceable, allowing you to swap embedding models, vector stores, or LLM providers without changing the rest of the system.
      </p>

      <h2 className="mt-12 text-lg font-semibold text-white">Pipeline Flow</h2>
      <div className="mt-4 space-y-px">
        <PipelineStep num={1} title="Upload" description="PDF documents are uploaded through the web interface or REST API. Atlas validates file types and extracts metadata." active />
        <PipelineStep num={2} title="Extraction" description="OCR and text extraction pipelines process document content. Tesseract OCR handles scanned documents while preserving headings, paragraphs, and page boundaries." />
        <PipelineStep num={3} title="Chunking" description="Text is split into optimized chunks with configurable size (default: 512 tokens) and overlap (default: 10%) to maintain context across chunk boundaries." />
        <PipelineStep num={4} title="Embeddings" description="Each chunk is converted to a vector embedding using the configured embedding model. Supports OpenAI, local models via llama.cpp, and custom endpoints." />
        <PipelineStep num={5} title="pgvector" description="Vectors are stored and indexed in PostgreSQL with the pgvector extension. Supports IVFFlat and HNSW index types for efficient approximate nearest neighbor search." />
        <PipelineStep num={6} title="Retrieval" description="User queries are embedded and matched against the vector index using cosine similarity. Results are ranked by similarity score with configurable top-K retrieval and minimum score thresholds." />
        <PipelineStep num={7} title="LLM Response" description="Retrieved chunks are injected into a prompt template. The LLM generates a response grounded in the provided context, with inline citations referencing source documents and page numbers." active />
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Key Design Decisions</h2>
      <div className="mt-4 space-y-3">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-sm font-semibold text-white/80">PostgreSQL + pgvector</div>
          <p className="mt-1 text-sm text-white/40">Using pgvector eliminates the need for a separate vector database. Your vectors live alongside your metadata in a single Postgres instance, reducing operational complexity.</p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-sm font-semibold text-white/80">Pluggable Providers</div>
          <p className="mt-1 text-sm text-white/40">Embedding models, LLMs, and vector stores are abstracted behind provider interfaces. Swap OpenAI for local models, or pgvector for Pinecone, without code changes.</p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-sm font-semibold text-white/80">Session-based Auth</div>
          <p className="mt-1 text-sm text-white/40">Authentication uses express-session with PostgreSQL session storage. No external auth providers required — works out of the box in air-gapped environments.</p>
        </div>
      </div>
    </>
  );
}

function RAGPipeline() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">RAG Pipeline</h1>
      <p className="mt-4 text-base leading-relaxed text-white/60">
        The RAG pipeline transforms raw documents into actionable knowledge through a sequence of processing stages. Each stage is configurable and observable through the dashboard.
      </p>

      <div className="mt-8 space-y-4">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <InlineCode>docs/ingest</InlineCode>
            <span className="text-sm text-white/40">POST /api/documents</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/40">
            Upload a PDF document. Atlas extracts text using OCR (Tesseract) and preserves document structure including headings, paragraphs, and page boundaries. Supported formats: PDF, TXT, MD.
          </p>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <InlineCode>chunk</InlineCode>
            <span className="text-sm text-white/40">Configurable strategy</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/40">
            Text is split into chunks of configurable size (default: 512 tokens) with overlap to maintain context across chunk boundaries. Supports recursive character splitting and semantic boundary detection.
          </p>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <InlineCode>embed</InlineCode>
            <span className="text-sm text-white/40">Configurable model</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/40">
            Each chunk is converted to a vector embedding. Atlas supports OpenAI (<InlineCode>text-embedding-ada-002</InlineCode>), local models via llama.cpp, and custom embedding endpoints. Dimensionality is configurable per provider.
          </p>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <InlineCode>search</InlineCode>
            <span className="text-sm text-white/40">pgvector index</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/40">
            Queries are embedded and searched against the pgvector index using cosine similarity. Supports IVFFlat and HNSW index types. Results ranked by similarity with configurable top-K retrieval and minimum score threshold.
          </p>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <InlineCode>generate</InlineCode>
            <span className="text-sm text-white/40">GPT-4 / Claude / Local</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/40">
            Retrieved chunks are injected into a prompt template with the user's query. The LLM generates a response grounded in the provided context, with inline citations referencing source documents, page numbers, and similarity scores.
          </p>
        </div>
      </div>
    </>
  );
}

function Deployment() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">Deployment</h1>
      <p className="mt-4 text-base leading-relaxed text-white/60">
        Atlas is designed for simple Docker-based deployment. The entire stack runs in containers, orchestrated by Docker Compose.
      </p>

      <h2 className="mt-12 text-lg font-semibold text-white">Quick Start</h2>
      <p className="mt-2 text-sm text-white/40">Clone the repository and start all services:</p>
      <div className="mt-3">
        <CodeBlock>
          {`git clone https://github.com/Deep084-bot/atlas-rag-platform.git
cd atlas-rag-platform
cp .env.example .env
# Edit .env with your API keys
docker compose up -d`}
        </CodeBlock>
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Services</h2>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white/80">Web App</div>
            <div className="text-sm text-white/40">React frontend served by Express</div>
          </div>
          <span className="rounded bg-white/[0.04] px-2 py-0.5 text-sm text-white/40">:3000</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white/80">API Server</div>
            <div className="text-sm text-white/40">Express REST API with session auth</div>
          </div>
          <span className="rounded bg-white/[0.04] px-2 py-0.5 text-sm text-white/40">:3001</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white/80">PostgreSQL</div>
            <div className="text-sm text-white/40">Database with pgvector extension</div>
          </div>
          <span className="rounded bg-white/[0.04] px-2 py-0.5 text-sm text-white/40">:5432</span>
        </div>
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Requirements</h2>
      <ul className="mt-3 space-y-2">
        {[
          'Docker Engine 24+',
          'Docker Compose v2+',
          '4GB RAM minimum (8GB recommended)',
          'OpenAI API key or local LLM endpoint',
        ].map((req) => (
          <li key={req} className="flex items-center gap-2 text-sm text-white/60">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-atlas-teal/60" />
            {req}
          </li>
        ))}
      </ul>
    </>
  );
}

function Configuration() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">Configuration</h1>
      <p className="mt-4 text-base leading-relaxed text-white/60">
        Atlas is configured through environment variables. Copy <InlineCode>.env.example</InlineCode> to <InlineCode>.env</InlineCode> and adjust the values below.
      </p>

      <div className="mt-6">
        <CodeBlock>
          <span className="text-white/30">{'# Application'}</span>
          {'\n'}
          {'NODE_ENV=production\n'}
          {'PORT=3001\n'}
          {'SESSION_SECRET='}<span className="text-atlas-teal/70">your-secret-key</span>
          {'\n\n'}
          <span className="text-white/30">{'# Database'}</span>
          {'\n'}
          {'DATABASE_URL=postgresql://atlas:atlas@db:5432/atlas\n\n'}
          <span className="text-white/30">{'# Vector Store'}</span>
          {'\n'}
          {'PGVECTOR_DIMENSION=1536\n'}
          {'PGVECTOR_INDEX_TYPE=ivfflat\n'}
          {'PGVECTOR_LISTS=100\n\n'}
          <span className="text-white/30">{'# Embeddings'}</span>
          {'\n'}
          {'EMBEDDING_PROVIDER=openai\n'}
          {'OPENAI_API_KEY='}<span className="text-atlas-teal/70">sk-...</span>
          {'\n'}
          {'EMBEDDING_MODEL=text-embedding-ada-002\n\n'}
          <span className="text-white/30">{'# LLM'}</span>
          {'\n'}
          {'LLM_PROVIDER=openai\n'}
          {'LLM_MODEL=gpt-4o-mini\n'}
          {'LLM_TEMPERATURE=0.3\n'}
          {'LLM_MAX_TOKENS=2048\n\n'}
          <span className="text-white/30">{'# Chunking'}</span>
          {'\n'}
          {'CHUNK_SIZE=512\n'}
          {'CHUNK_OVERLAP=50\n\n'}
          <span className="text-white/30">{'# Retrieval'}</span>
          {'\n'}
          {'RETRIEVAL_TOP_K=5\n'}
          {'RETRIEVAL_MIN_SCORE=0.7'}
        </CodeBlock>
      </div>
    </>
  );
}

function APIReference() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">API Reference</h1>
      <p className="mt-4 text-base leading-relaxed text-white/60">
        Atlas exposes a REST API for document management, search, and conversation operations. All endpoints are prefixed with <InlineCode>/api</InlineCode>.
      </p>

      <div className="mt-8 space-y-4">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <MethodBadge method="POST" />
            <code className="text-sm font-medium text-white/80">/api/documents/upload</code>
          </div>
          <p className="mt-2 text-sm text-white/40">Upload a PDF document for ingestion. Accepts multipart form data with a file field.</p>
          <div className="mt-3">
            <CodeBlock>
              {`curl -X POST http://localhost:3001/api/documents/upload \\
  -F "file=@report.pdf"`}
            </CodeBlock>
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <MethodBadge method="GET" />
            <code className="text-sm font-medium text-white/80">/api/documents</code>
          </div>
          <p className="mt-2 text-sm text-white/40">List all ingested documents with status and metadata.</p>
          <div className="mt-3">
            <CodeBlock>
              {'curl http://localhost:3001/api/documents'}
            </CodeBlock>
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <MethodBadge method="GET" />
            <code className="text-sm font-medium text-white/80">/api/search?q={'{query}'}</code>
          </div>
          <p className="mt-2 text-sm text-white/40">Semantic search across all ingested documents. Returns ranked results with similarity scores and source references.</p>
          <div className="mt-3">
            <CodeBlock>
              {'curl "http://localhost:3001/api/search?q=revenue+growth+2026"'}
            </CodeBlock>
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <MethodBadge method="POST" />
            <code className="text-sm font-medium text-white/80">/api/chat</code>
          </div>
          <p className="mt-2 text-sm text-white/40">Send a message in a conversation. Returns an LLM-generated response grounded in retrieved documents with inline citations.</p>
          <div className="mt-3">
            <CodeBlock>
              {`curl -X POST http://localhost:3001/api/chat \\
  -H "Content-Type: application/json" \\
  -d '{"message": "What is the revenue growth?", "conversation_id": "abc123"}'`}
            </CodeBlock>
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <MethodBadge method="POST" />
            <code className="text-sm font-medium text-white/80">/api/conversations</code>
          </div>
          <p className="mt-2 text-sm text-white/40">Create a new conversation thread with an optional title.</p>
          <div className="mt-3">
            <CodeBlock>
              {`curl -X POST http://localhost:3001/api/conversations \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Q2 Analysis"}'`}
            </CodeBlock>
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <MethodBadge method="GET" />
            <code className="text-sm font-medium text-white/80">/api/conversations/{'{id}'}</code>
          </div>
          <p className="mt-2 text-sm text-white/40">Retrieve a conversation with all messages and citation metadata.</p>
          <div className="mt-3">
            <CodeBlock>
              {'curl http://localhost:3001/api/conversations/abc123'}
            </CodeBlock>
          </div>
        </div>
      </div>
    </>
  );
}

const CONTENT = {
  'introduction': <Introduction />,
  'architecture': <Architecture />,
  'rag-pipeline': <RAGPipeline />,
  'deployment': <Deployment />,
  'configuration': <Configuration />,
  'api-reference': <APIReference />,
};

function SidebarNav({ activeSection, onNavigate }) {
  return (
    <nav className="w-60 shrink-0 border-r border-white/[0.06]" aria-label="Documentation">
      <div className="sticky top-0 p-5">
        <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20">Getting Started</div>
        <div className="space-y-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onNavigate(s.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-all duration-150 ${
                activeSection === s.id
                  ? 'bg-atlas-teal/[0.08] font-semibold text-atlas-teal'
                  : 'text-white/50 hover:bg-white/[0.03] hover:text-white/70'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

export function DocsPage() {
  const [activeSection, setActiveSection] = useState('introduction');

  return (
    <>
      <LandingNavbar />
      <div className="flex min-h-[calc(100vh-73px)]">
        <SidebarNav activeSection={activeSection} onNavigate={setActiveSection} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[900px] px-8 py-12 lg:px-12">
            {CONTENT[activeSection]}
          </div>
        </main>
      </div>
      <Footer />
    </>
  );
}
