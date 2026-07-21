import { useState } from 'react';

const STEPS = [
  {
    title: 'Documents',
    description: 'Upload PDFs, TXT, and markdown files. Atlas validates and extracts metadata automatically.',
    detail: 'Supports batch upload, OCR for scanned documents, and preserves document structure including headings, paragraphs, and page boundaries.',
  },
  {
    title: 'Extraction',
    description: 'Text is extracted using OCR pipelines that handle both digital and scanned documents.',
    detail: 'Tesseract OCR engine processes scanned PDFs. Digital documents use direct text extraction with layout preservation.',
  },
  {
    title: 'Chunking',
    description: 'Extracted text is split into optimized segments with configurable overlap.',
    detail: 'Default chunk size is 512 tokens with 10% overlap. Supports recursive character splitting and semantic boundary detection.',
  },
  {
    title: 'Embeddings',
    description: 'Converts document chunks into high-dimensional vector representations.',
    detail: 'Supports OpenAI text-embedding-ada-002, local models via llama.cpp, and custom embedding endpoints with configurable dimensionality.',
  },
  {
    title: 'Vector Database',
    description: 'Stores searchable vector representations using PostgreSQL with pgvector.',
    detail: 'Supports IVFFlat and HNSW index types. Vectors live alongside document metadata in a single Postgres instance.',
  },
  {
    title: 'Retriever',
    description: 'Finds the most relevant context by matching query embeddings against the vector index.',
    detail: 'Cosine similarity search with configurable top-K retrieval and minimum score threshold. Supports hybrid search with BM25 keyword scoring.',
  },
  {
    title: 'LLM',
    description: 'Generates citation-backed answers grounded in the retrieved context.',
    detail: 'Supports GPT-4, Claude, and local models. Retrieved chunks are injected into a prompt template with the user query for grounded generation.',
  },
  {
    title: 'Citation Answer',
    description: 'Returns responses with inline citations referencing source documents and page numbers.',
    detail: 'Every answer includes source file names, page references, similarity scores, and confidence ratings for full traceability.',
  },
];

function PipelineNode({ step, index, total, hovered, onHover, onLeave }) {
  const isHovered = hovered === index;

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => onHover(index)}
      onMouseLeave={onLeave}
    >
      {/* Connector line after this node (except last) */}
      {index < total - 1 && (
        <div className="absolute left-[calc(50%+24px)] top-[20px] hidden h-px w-[calc(100%-48px)] lg:block">
          <div className="h-full w-full bg-gradient-to-r from-atlas-teal/30 to-atlas-teal/10" />
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-atlas-teal/40" />
        </div>
      )}

      {/* Node circle + pulse ring */}
      <div className="relative z-10">
        <div
          className="h-10 w-10 animate-pulse rounded-full border-2"
          style={{
            borderColor: isHovered ? 'rgba(72, 215, 200, 0.5)' : 'rgba(72, 215, 200, 0.2)',
            animationDuration: '3s',
            boxShadow: isHovered
              ? '0 0 20px rgba(72, 215, 200, 0.2)'
              : 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
        >
          <div className="flex h-full w-full items-center justify-center">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: '#48d7c8',
                opacity: isHovered ? 1 : 0.6,
                transition: 'opacity 0.2s',
              }}
            />
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="mt-3 text-center">
        <span
          className="text-xs font-semibold tracking-wide transition-colors duration-200"
          style={{ color: isHovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)' }}
        >
          {step.title}
        </span>
      </div>

      {/* Description */}
      <p className="mt-1 max-w-[140px] text-center text-[11px] leading-relaxed text-white/30">
        {step.description}
      </p>

      {/* Expanded info card on hover */}
      <div
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-3 w-72 -translate-x-1/2 transition-all duration-200"
        style={{
          opacity: isHovered ? 1 : 0,
          transform: isHovered ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(-4px)',
        }}
      >
        <div className="rounded-lg border border-white/[0.08] bg-[#0f1f2f] px-4 py-3 shadow-soft">
          <p className="text-xs leading-relaxed text-white/50">{step.detail}</p>
        </div>
      </div>
    </div>
  );
}

export function PipelineSection() {
  const [hovered, setHovered] = useState(null);

  return (
    <section className="border-t border-white/[0.04] py-20 lg:py-24" aria-labelledby="pipeline-heading">
      <div className="section-container">
        <div className="section-header">
          <h2 id="pipeline-heading" className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            How Atlas understands your documents.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/40">
            From raw documents to citation-backed answers — the RAG pipeline powers every interaction.
          </p>
        </div>

        {/* Horizontal pipeline (desktop) */}
        <div className="relative mt-16 hidden items-start justify-center gap-4 lg:flex">
          {STEPS.map((step, i) => (
            <PipelineNode
              key={step.title}
              step={step}
              index={i}
              total={STEPS.length}
              hovered={hovered}
              onHover={setHovered}
              onLeave={() => setHovered(null)}
            />
          ))}
        </div>

        {/* Vertical pipeline (mobile) */}
        <div className="mt-12 space-y-8 lg:hidden">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-atlas-teal/20">
                  <div className="h-2 w-2 rounded-full bg-atlas-teal/60" />
                </div>
                {i < STEPS.length - 1 && (
                  <div className="mt-1 h-8 w-px bg-gradient-to-b from-atlas-teal/20 to-transparent" />
                )}
              </div>
              <div className="flex-1 pt-1">
                <div className="text-sm font-semibold text-white/80">{step.title}</div>
                <p className="mt-0.5 text-sm leading-relaxed text-white/40">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
