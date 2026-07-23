import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

const GITHUB_URL = 'https://github.com/Deep084-bot/atlas-rag-platform';

export function LandingNavbar() {
  const location = useLocation();
  const auth = useAuth();
  const isLanding = location.pathname === '/';
  const isAuthenticated = !auth.isLoading && !!auth.user;

  function renderButtons() {
    if (auth.isLoading) {
      return <div className="h-9 w-28" />;
    }

    if (isLanding) {
      return (
        <>
          <Link
            to="/docs"
            className="hidden rounded-lg px-3 py-1.5 text-sm text-white/40 transition hover:text-white/80 sm:inline-block"
          >
            Docs
          </Link>
          {isAuthenticated ? (
            <Link
              to="/app"
              className="rounded-lg bg-atlas-teal px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
            >
              Open App
            </Link>
          ) : (
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-sm text-white/50 transition hover:border-white/[0.15] hover:text-white/80 sm:inline-flex"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Star
            </a>
          )}
        </>
      );
    }

    return isAuthenticated ? (
      <Link
        to="/app"
        className="rounded-lg bg-atlas-teal px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
      >
        Open App
      </Link>
    ) : (
      <>
        <Link
          to="/login"
          className="rounded-lg px-3 py-1.5 text-sm text-white/50 transition hover:text-white/80"
        >
          Log in
        </Link>
        <Link
          to="/signup"
          className="rounded-lg bg-atlas-teal px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
        >
          Sign up
        </Link>
      </>
    );
  }

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
              <linearGradient id="lnav-logo" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#48d7c8" />
                <stop offset="100%" stopColor="#7cc7ff" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="48" fill="none" stroke="url(#lnav-logo)" strokeWidth="6" />
            <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#lnav-logo)" textAnchor="middle">A</text>
          </svg>
          ATLAS
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {renderButtons()}
        </div>
      </div>
    </nav>
  );
}
