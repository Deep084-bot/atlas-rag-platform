import { ProviderError } from '../errors.js';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 60000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 1000;
const MAX_RETRIES_BOUND = 10;

function defaultSleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function buildDelay(attempt, baseDelayMs) {
  return baseDelayMs * (2 ** attempt);
}

/**
 * Parse an HTTP `Retry-After` header value into milliseconds.
 *
 * Accepts either a non-negative integer number of seconds or an HTTP-date.
 * Returns `null` when the header is missing, empty, or malformed so callers can
 * fall back to their own backoff.
 *
 * @param {string|null|undefined} value
 * @param {{ now?: () => number }} [options]
 * @returns {number|null}
 */
export function parseRetryAfter(value, { now = Date.now } = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  const raw = String(value).trim();

  if (raw === '') {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  // Reject other numeric-looking values (e.g. "-5", "1.5", "+3") that
  // Date.parse would otherwise accept as an (incorrect) date.
  if (/^[0-9.+-]+$/.test(raw)) {
    return null;
  }

  const parsedDate = Date.parse(raw);

  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return Math.max(0, parsedDate - now());
}

function resolveDelayMs({ attempt, status, headers, baseDelayMs, maxDelayMs, rateLimitDelayMs, now }) {
  const retryAfterMs = parseRetryAfter(headers?.get?.('retry-after'), { now });

  if (retryAfterMs !== null) {
    return clamp(retryAfterMs, 0, maxDelayMs);
  }

  const exponential = buildDelay(attempt, baseDelayMs);
  const delay = status === 429 ? Math.max(exponential, rateLimitDelayMs) : exponential;

  return clamp(delay, 0, maxDelayMs);
}

function sanitizedStatusError(providerName, status) {
  // Deliberately excludes the response body so provider details (which may embed
  // account identifiers or echoed credentials) never reach logs or clients.
  return new ProviderError(`${providerName} request failed with status ${status}.`, {
    provider: providerName,
    statusCode: status,
    retryable: true
  });
}

async function drainResponse(response) {
  // Release the response body we are not going to read, without surfacing it.
  try {
    if (response && response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
  } catch {
    // Body cleanup must never affect retry control flow.
  }
}

export async function fetchWithRetry(url, options, {
  providerName,
  timeoutMs = 15000,
  retries = DEFAULT_RETRIES,
  maxRetries,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  rateLimitDelayMs = DEFAULT_RATE_LIMIT_DELAY_MS,
  sleep = defaultSleep,
  now = Date.now,
  fetchImpl = fetch
} = {}) {
  const requestedRetries = maxRetries ?? retries;
  const attempts = clamp(
    Number.isFinite(requestedRetries) ? Math.floor(requestedRetries) : DEFAULT_RETRIES,
    0,
    MAX_RETRIES_BOUND
  );

  let lastError = null;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;

    try {
      response = await fetchImpl(url, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);

      if (isAbortError(error)) {
        lastError = new ProviderError(`${providerName} request timed out after ${timeoutMs}ms.`, {
          provider: providerName,
          statusCode: 504,
          retryable: true,
          cause: error
        });
      } else {
        lastError = new ProviderError(`${providerName} request failed.`, {
          provider: providerName,
          statusCode: 503,
          retryable: true,
          cause: error
        });
      }

      if (attempt < attempts) {
        await sleep(resolveDelayMs({ attempt, status: null, headers: null, baseDelayMs, maxDelayMs, rateLimitDelayMs, now }));
        continue;
      }

      throw lastError;
    }

    clearTimeout(timeoutId);

    if (!RETRYABLE_STATUSES.has(response.status)) {
      return response;
    }

    lastError = sanitizedStatusError(providerName, response.status);

    if (attempt < attempts) {
      await drainResponse(response);
      await sleep(resolveDelayMs({
        attempt,
        status: response.status,
        headers: response.headers,
        baseDelayMs,
        maxDelayMs,
        rateLimitDelayMs,
        now
      }));
      continue;
    }

    await drainResponse(response);
    throw lastError;
  }

  throw lastError ?? sanitizedStatusError(providerName, 503);
}
