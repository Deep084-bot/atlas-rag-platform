import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar.jsx';
import { Footer } from '../components/Footer.jsx';
import { DashboardMockup } from '../components/DashboardMockup.jsx';
import { KnowledgeGraph } from '../components/KnowledgeGraph.jsx';
import { RetrievalTrace } from '../components/RetrievalTrace.jsx';
import { PipelineSection } from '../components/PipelineSection.jsx';
import { CustomCursor } from '../components/CustomCursor.jsx';

const GITHUB_URL = 'https://github.com/Deep084-bot/atlas-rag-platform';

function FeatureCard({ icon, title, description }) {
  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition hover:border-white/[0.12] hover:bg-white/[0.03]">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04] text-atlas-teal">
        {icon}
      </div>
      <h3 className="mb-1.5 text-sm font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-white/40">{description}</p>
    </article>
  );
}

const features = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
    title: 'Semantic Search',
    description: 'Find information across thousands of pages using vector retrieval.'
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Citation-aware Answers',
    description: 'Every response is grounded in your source documents.'
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    title: 'Production Ready',
    description: 'Deploy with Docker, PostgreSQL, and pgvector.'
  }
];

export function LandingPage() {
  return (
    <div className="cursor-none" data-landing-root>
      <CustomCursor />
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden lg:flex lg:min-h-[calc(100vh-73px)] lg:items-center" aria-labelledby="hero-heading">
        <KnowledgeGraph />
        <div
          className="pointer-events-none absolute hidden animate-breathe lg:block"
          style={{
            width: 'clamp(480px, 44vw, 740px)',
            height: 'clamp(380px, 36vw, 580px)',
            right: 'clamp(2%, 8vw, 12%)',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'radial-gradient(ellipse at center, rgba(72, 215, 200, 0.12) 0%, transparent 65%)',
          }}
          aria-hidden="true"
        />
        <div className="section-container relative w-full py-8 lg:py-12">
          <div className="flex flex-col items-center lg:flex-row lg:gap-24">
            {/* Left: Headline + CTA — 34% */}
            <div className="flex w-full flex-col items-center text-center lg:w-[34%] lg:items-start lg:text-left">
              <h1 id="hero-heading" className="text-5xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
                Chat with your{' '}
                <span className="gradient-text">documents.</span>
              </h1>

              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/50 sm:text-lg">
                Upload PDFs, search semantically, and get citation-backed answers — all self-hosted with Docker.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
                <Link
                  to="/signup"
                  className="inline-flex h-12 items-center gap-2 rounded-lg bg-atlas-teal px-6 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
                >
                  Get Started
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-6 text-sm font-medium text-white/50 transition hover:border-white/[0.15] hover:bg-white/[0.04] hover:text-white/80"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  Star on GitHub
                </a>
              </div>
            </div>

            {/* Right: Dashboard — 66% */}
            <div className="relative flex w-full justify-center lg:w-[66%] lg:justify-end">
              <div className="relative w-full max-w-[820px]">
                <DashboardMockup />
                <div className="absolute hidden lg:block" style={{ top: '-44px', right: '24px', zIndex: 20 }}>
                  <RetrievalTrace />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PipelineSection />

      {/* FEATURES */}
      <section id="features" className="border-t border-white/[0.04]" aria-labelledby="features-heading">
        <div className="section-container py-24">
          <div className="section-header">
            <h2 id="features-heading" className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Built for document intelligence.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <FeatureCard key={feature.title} {...feature} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/[0.04]" aria-labelledby="cta-heading">
        <div className="section-container py-24 text-center">
          <h2 id="cta-heading" className="mx-auto max-w-xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Your documents. Your infrastructure. Your AI.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/40">
            Deploy a production-ready RAG system with Docker.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/signup"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-atlas-teal px-6 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
            >
              Get Started
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-6 text-sm font-medium text-white/50 transition hover:border-white/[0.15] hover:bg-white/[0.04] hover:text-white/80"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
