const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export function buildUrl(path) {
  return `${apiBaseUrl}${path}`;
}
import { requestJson, buildUrl } from './client.js';

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.message ?? payload?.error ?? `Request failed with status ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function requestJson(path, { method = 'GET', body, signal } = {}) {
  const options = {
    method,
    signal,
    headers: {},
    credentials: 'include'
  };

  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path), options);
  return parseResponse(response);
}
