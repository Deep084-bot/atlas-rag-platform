import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth.js';

export function AppNavbar({ onHomeClick }) {
  const auth = useAuth();
  const navigate = useNavigate();

  function handleLogoClick(e) {
    e.preventDefault();
    onHomeClick?.();
    navigate('/app');
  }

  async function handleLogout() {
    const result = await auth.logout();
    if (result.ok) {
      toast.success('Logged out successfully');
      navigate('/');
    }
  }

  return (
    <nav className="flex h-16 w-full shrink-0 items-center border-b border-white/[0.06] bg-[#06111f] px-6 lg:px-8">
      <a
        href="/app"
        onClick={handleLogoClick}
        className="flex items-center gap-2.5 text-sm font-bold tracking-[0.18em] text-white/90 transition hover:text-white"
        aria-label="Atlas workspace"
      >
        <svg width="18" height="18" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="appnav-logo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#48d7c8" />
              <stop offset="100%" stopColor="#7cc7ff" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="48" fill="none" stroke="url(#appnav-logo)" strokeWidth="6" />
          <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#appnav-logo)" textAnchor="middle">A</text>
        </svg>
        ATLAS
      </a>

      <div className="ml-auto flex items-center gap-3">
        {auth.user && (
          <span className="hidden text-sm text-white/40 lg:inline-block">{auth.user.email}</span>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-sm text-white/60 transition hover:border-white/[0.15] hover:text-white/90"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
