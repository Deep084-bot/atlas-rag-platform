import { Link } from 'react-router-dom';

export function AuthNavbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/[0.04] bg-[#06111f]/70 backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-sm font-bold tracking-[0.18em] text-white/90 transition hover:text-white"
          aria-label="Atlas home"
        >
          <svg width="18" height="18" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="anav-logo" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#48d7c8" />
                <stop offset="100%" stopColor="#7cc7ff" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="48" fill="none" stroke="url(#anav-logo)" strokeWidth="6" />
            <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#anav-logo)" textAnchor="middle">A</text>
          </svg>
          ATLAS
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            to="/docs"
            className="hidden rounded-lg px-3 py-1.5 text-sm text-white/40 transition hover:text-white/80 sm:inline-block"
          >
            Docs
          </Link>
          <Link
            to="/"
            className="rounded-lg px-3 py-1.5 text-sm text-white/50 transition hover:text-white/80"
          >
            Home
          </Link>
        </div>
      </div>
    </nav>
  );
}
