import { createAuthClient } from "better-auth/react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_AUTH_URL ?? '';
const authBaseURL = apiBaseUrl
  ? apiBaseUrl.endsWith('/api/auth')
    ? apiBaseUrl
    : `${apiBaseUrl.replace(/\/$/, '')}/api/auth`
  : 'http://localhost:8787/api/auth';

export const authClient = createAuthClient({
  baseURL: authBaseURL
});

export async function signup({ email, password, name }) {
  const payload = await authClient.signUp.email({
    email,
    password,
    name: name || email.split('@')[0] || email
  });

  if (payload.error) {
    throw payload.error;
  }

  return payload.data;
}

export async function login({ email, password }) {
  const payload = await authClient.signIn.email({
    email,
    password
  });

  if (payload.error) {
    throw payload.error;
  }

  return payload.data;
}

export async function logout() {
  const payload = await authClient.signOut();

  if (payload.error) {
    throw payload.error;
  }

  return payload.data;
}

export async function getSession() {
  const payload = await authClient.getSession();
  if (payload.error) {
    throw payload.error;
  }
  return payload.data;
}

export function useSession() {
  return authClient.useSession();
}
