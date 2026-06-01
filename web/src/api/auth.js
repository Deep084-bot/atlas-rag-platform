import { requestJson } from './client.js';

export async function signup({ email, password }) {
  return requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email, password }
  });
}

export async function login({ email, password }) {
  return requestJson('/api/auth/login', {
    method: 'POST',
    body: { email, password }
  });
}

export async function logout() {
  return requestJson('/api/auth/logout', {
    method: 'POST'
  });
}

export async function getSession() {
  return requestJson('/api/auth/session');
}
