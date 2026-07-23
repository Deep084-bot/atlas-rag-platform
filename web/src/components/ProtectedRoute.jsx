import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth.js';

function AuthSkeleton() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#050b13]">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center gap-6">
          <div className="h-14 w-14 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-5 w-40 animate-pulse rounded-lg bg-white/5" />
          <div className="mt-4 flex w-full flex-col gap-3">
            <div className="h-3 w-full animate-pulse rounded-lg bg-white/5" />
            <div className="h-3 w-3/4 animate-pulse rounded-lg bg-white/5" />
            <div className="h-3 w-5/6 animate-pulse rounded-lg bg-white/5" />
          </div>
        </div>
      </div>
    </main>
  );
}

export function ProtectedRoute({ children }) {
  const auth = useAuth();

  console.log('[ROUTE CHANGE] ProtectedRoute isLoading=%s hasUser=%s', auth.isLoading, !!auth.user);

  if (auth.isLoading) {
    return <AuthSkeleton />;
  }

  if (!auth.user) {
    console.log('[ROUTE CHANGE] No user, redirecting to /login');
    return <Navigate to="/login" replace />;
  }

  return children;
}
