import { useState } from 'react';

import { authClient, useSession } from '../api/auth.js';

export function useAuth() {
  const { data: session, isPending, refetch } = useSession();
  const [isSaving, setIsSaving] = useState(false);

  const user = session?.user ?? null;
  async function signup({ email, password, name }) {
    setIsSaving(true);
    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name: name || email.split('@')[0] || email,
      });

      if (result.error) {
        throw result.error;
      }

      await refetch();
      return { ok: true, user: result.data?.user ?? null };
    } catch (err) {
      return { ok: false, error: err };
    } finally {
      setIsSaving(false);
    }
  }

  async function login({ email, password }) {
    setIsSaving(true);
    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        throw result.error;
      }

      await refetch();
      return { ok: true, user: result.data?.user ?? null };
    } catch (err) {
      return { ok: false, error: err };
    } finally {
      setIsSaving(false);
    }
  }

  async function logout() {
    setIsSaving(true);
    try {
      const result = await authClient.signOut();

      if (result.error) {
        throw result.error;
      }

      await refetch();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    } finally {
      setIsSaving(false);
    }
  }

  return { user, session, isLoading: isPending || isSaving, signup, login, logout };
}
