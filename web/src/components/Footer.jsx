import { Link } from 'react-router-dom';

const GITHUB_URL = 'https://github.com/Deep084-bot/atlas-rag-platform';

function FooterColumn({ title, links }) {
  return (
    <div>
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/30">{title}</div>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.label}>
            {link.to ? (
              <Link to={link.to} className="text-sm text-white/40 transition hover:text-white/70">
                {link.label}
              </Link>
            ) : (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/40 transition hover:text-white/70"
              >
                {link.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/[0.04] bg-[#050b13]">
      <div className="section-container py-16">
        <div className="flex flex-col gap-12 lg:flex-row lg:gap-24">
          {/* Brand */}
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5">
              <svg width="18" height="18" viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <linearGradient id="footer-logo-g" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#48d7c8" />
                    <stop offset="100%" stopColor="#7cc7ff" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="48" fill="none" stroke="url(#footer-logo-g)" strokeWidth="6" />
                <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#footer-logo-g)" textAnchor="middle">A</text>
              </svg>
              <span className="text-sm font-bold tracking-[0.15em] text-white/60">ATLAS</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white/30">
              Open-source RAG platform for private AI knowledge systems. Self-hosted with Docker.
            </p>
          </div>

          {/* Columns */}
          <div className="flex flex-1 flex-wrap gap-10 sm:gap-16">
            <FooterColumn
              title="Product"
              links={[
                { label: 'Features', to: '/#features' },
                { label: 'Documentation', to: '/docs' },
                { label: 'GitHub', href: GITHUB_URL },
              ]}
            />
            <FooterColumn
              title="Resources"
              links={[
                { label: 'API Reference', to: '/docs' },
                { label: 'Deployment', to: '/docs' },
                { label: 'Configuration', to: '/docs' },
              ]}
            />
            <FooterColumn
              title="Community"
              links={[
                { label: 'GitHub', href: GITHUB_URL },
                { label: 'Issues', href: `${GITHUB_URL}/issues` },
                { label: 'Discussions', href: `${GITHUB_URL}/discussions` },
              ]}
            />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-start gap-3 border-t border-white/[0.03] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-white/20">
            Atlas <span className="text-white/15">v0.1.0</span>
          </div>
          <div className="text-xs text-white/15">
            React &middot; Express &middot; PostgreSQL &middot; pgvector
          </div>
          <div className="text-xs text-white/15">
            MIT License
          </div>
        </div>
      </div>
    </footer>
  );
}
