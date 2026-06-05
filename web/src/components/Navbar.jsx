import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../hooks/useAuth.js';

export function Navbar() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleLogout() {
    const result = await auth.logout();
    if (result.ok) {
      toast.success('Logged out successfully');
      navigate('/');
    }
  }

  const isWorkspace = location.pathname === '/app';

  return (
    <nav className="flex items-center justify-between border-b border-white/10 px-6 py-4 lg:px-10">
      <Link to="/" className="text-xs font-semibold uppercase tracking-[0.3em] text-atlas-sky/80">
        Atlas
      </Link>
      <div className="flex items-center gap-3">
        {auth.isLoading ? null : auth.user ? (
          <>
            <span className="text-sm text-slate-300">{auth.user.email}</span>
            {!isWorkspace && (
              <Link
                to="/app"
                className="rounded-full bg-atlas-teal px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
              >
                Workspace
              </Link>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="rounded-full bg-atlas-teal px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
