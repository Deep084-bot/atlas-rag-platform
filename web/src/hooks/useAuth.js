import { useEffect, useState } from 'react';
import * as authApi from '../api/auth.js';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const payload = await authApi.getSession();
        if (!mounted) return;
        setUser(payload.user ?? null);
      } catch {
        // ignore
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function signup({ email, password }) {
    setIsLoading(true);
    try {
      const { user } = await authApi.signup({ email, password });
      setUser(user ?? null);
      return { ok: true, user };
    } catch (err) {
      return { ok: false, error: err };
    } finally {
      setIsLoading(false);
    }
  }

  async function login({ email, password }) {
    setIsLoading(true);
    try {
      const { user } = await authApi.login({ email, password });
      setUser(user ?? null);
      return { ok: true, user };
    } catch (err) {
      return { ok: false, error: err };
    } finally {
      setIsLoading(false);
    }
  }

  async function logout() {
    setIsLoading(true);
    try {
      await authApi.logout();
      setUser(null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    } finally {
      setIsLoading(false);
    }
  }

  return { user, isLoading, signup, login, logout };
}
