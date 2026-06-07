import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth.js';

export function GuestRoute({ children }) {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#06111f] text-slate-100">
        <p className="text-sm text-slate-400">Loading…</p>
      </main>
    );
  }

  if (auth.user) {
    return <Navigate to="/app" replace />;
  }

  return children;
}
