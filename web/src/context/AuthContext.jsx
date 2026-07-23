import { createContext, useContext, useMemo } from 'react';

import { authClient, useSession } from '../api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { data: session, isPending, refetch } = useSession();

  const value = useMemo(() => {
    console.log('[AUTH INIT] isPending=%s hasUser=%s', isPending, !!session?.user);

    async function signup({ email, password, name }) {
      const result = await authClient.signUp.email({
        email,
        password,
        name: name || email.split('@')[0] || email,
      });
      if (result.error) throw result.error;
      await refetch();
      return { ok: true, user: result.data?.user ?? null };
    }

    async function login({ email, password }) {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw result.error;
      await refetch();
      return { ok: true, user: result.data?.user ?? null };
    }

    async function logout() {
      const result = await authClient.signOut();
      if (result.error) throw result.error;
      await refetch();
      return { ok: true };
    }

    return {
      user: session?.user ?? null,
      session,
      isLoading: isPending,
      signup,
      login,
      logout,
    };
  }, [session, isPending, refetch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
