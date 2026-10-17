import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchWithRetry, parseRetryAfter } from '../../server/http/fetchWithRetry.js';
import { ProviderError } from '../../server/errors.js';

function makeResponse(status, { headers = {}, body = '' } = {}) {
  const lower = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        return lower.has(key) ? lower.get(key) : null;
      }
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    }
  };
}

async function runWithRetry(responses, options = {}) {
  const delays = [];
  const state = { fetchCount: 0 };

  const fetchImpl = async () => {
    state.fetchCount += 1;
    if (responses.length === 0) {
      throw new Error('mocked fetch queue exhausted');
    }
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };

  const sleep = async (ms) => {
    delays.push(ms);
  };

  try {
    const response = await fetchWithRetry('https://example.test/embeddings', {}, {
      providerName: 'TestProvider',
      sleep,
      fetchImpl,
      ...options
    });

    return { response, delays, fetchCount: state.fetchCount, error: null };
  } catch (error) {
    return { response: null, delays, fetchCount: state.fetchCount, error };
  }
}

test('parseRetryAfter parses integer seconds', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter('  12 '), 12000);
});

test('parseRetryAfter parses HTTP-dates relative to now', () => {
  const now = 1_700_000_000_000;
  const header = new Date(now + 4000).toUTCString();

  assert.equal(parseRetryAfter(header, { now: () => now }), 4000);
});

test('parseRetryAfter clamps past HTTP-dates to zero', () => {
  const now = 1_700_000_000_000;
  const header = new Date(now - 10_000).toUTCString();

  assert.equal(parseRetryAfter(header, { now: () => now }), 0);
});

test('parseRetryAfter returns null for missing, empty, or invalid values', () => {
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('   '), null);
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter('-5'), null);
  assert.equal(parseRetryAfter('1.5'), null);
});

test('honors a numeric Retry-After on 429 and then succeeds', async () => {
  const result = await runWithRetry([
    makeResponse(429, { headers: { 'Retry-After': '2' }, body: 'slow down' }),
    makeResponse(200, { body: { data: [] } })
  ]);

  assert.equal(result.error, null);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.delays, [2000]);
});

test('honors an HTTP-date Retry-After on 429', async () => {
  const now = 1_700_000_000_000;
  const result = await runWithRetry([
    makeResponse(429, { headers: { 'Retry-After': new Date(now + 5000).toUTCString() } }),
    makeResponse(200)
  ], { now: () => now });

  assert.equal(result.error, null);
  assert.deepEqual(result.delays, [5000]);
});

test('caps Retry-After delays at maxDelayMs', async () => {
  const result = await runWithRetry([
    makeResponse(429, { headers: { 'Retry-After': '600' } }),
    makeResponse(200)
  ], { maxDelayMs: 30000 });

  assert.deepEqual(result.delays, [30000]);
});

test('falls back to a rate-limit floor when Retry-After is missing or invalid', async () => {
  const missing = await runWithRetry([
    makeResponse(429),
    makeResponse(200)
  ], { baseDelayMs: 100, rateLimitDelayMs: 5000 });

  assert.deepEqual(missing.delays, [5000]);

  const invalid = await runWithRetry([
    makeResponse(429, { headers: { 'Retry-After': 'not-a-date' } }),
    makeResponse(200)
  ], { baseDelayMs: 250, rateLimitDelayMs: 1000 });

  assert.deepEqual(invalid.delays, [1000]);
});

test('throws a sanitized ProviderError after exhausting retries on 429', async () => {
  const result = await runWithRetry([
    makeResponse(429, { headers: { 'Retry-After': '1' } }),
    makeResponse(429, { headers: { 'Retry-After': '1' } }),
    makeResponse(429, { headers: { 'Retry-After': '1' } })
  ]);

  assert.ok(result.error instanceof ProviderError);
  assert.equal(result.error.statusCode, 429);
  assert.equal(result.error.retryable, true);
  assert.equal(result.error.provider, 'TestProvider');
  assert.equal(result.fetchCount, 3);
  assert.deepEqual(result.delays, [1000, 1000]);
});

test('never leaks the raw response body in the thrown error', async () => {
  const result = await runWithRetry([
    makeResponse(429, { body: 'Bearer sk-secret-token from upstream' })
  ], { retries: 0 });

  assert.ok(result.error instanceof ProviderError);
  assert.ok(!result.error.message.includes('sk-secret-token'));
  assert.ok(!result.error.message.includes('Bearer'));
  assert.equal(result.error.message, 'TestProvider request failed with status 429.');
});

test('does not sleep when retries are disabled', async () => {
  const result = await runWithRetry([makeResponse(429)], { retries: 0 });

  assert.ok(result.error instanceof ProviderError);
  assert.deepEqual(result.delays, []);
  assert.equal(result.fetchCount, 1);
});

test('retries transient 5xx errors with exponential backoff', async () => {
  const result = await runWithRetry([
    makeResponse(500),
    makeResponse(503),
    makeResponse(200)
  ]);

  assert.equal(result.error, null);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.delays, [250, 500]);
  assert.equal(result.fetchCount, 3);
});

test('throws after exhausting retries on persistent 5xx', async () => {
  const result = await runWithRetry([
    makeResponse(502),
    makeResponse(502),
    makeResponse(502)
  ], { baseDelayMs: 10 });

  assert.ok(result.error instanceof ProviderError);
  assert.equal(result.error.statusCode, 502);
  assert.equal(result.error.retryable, true);
  assert.deepEqual(result.delays, [10, 20]);
});

test('does not retry non-retryable statuses and returns the response', async () => {
  const result = await runWithRetry([
    makeResponse(400, { body: 'bad request' })
  ]);

  assert.equal(result.error, null);
  assert.equal(result.response.status, 400);
  assert.equal(result.fetchCount, 1);
  assert.deepEqual(result.delays, []);
});

test('clamps an excessive retry count to the maximum bound', async () => {
  const responses = new Array(20).fill(null).map(() => makeResponse(429));

  const result = await runWithRetry(responses, {
    maxRetries: 99,
    baseDelayMs: 0,
    rateLimitDelayMs: 0
  });

  assert.ok(result.error instanceof ProviderError);
  assert.equal(result.fetchCount, 11);
  assert.equal(result.delays.length, 10);
});

test('treats abort/timeout as a retryable failure', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';

  const result = await runWithRetry([
    abortError,
    makeResponse(200)
  ]);

  assert.equal(result.error, null);
  assert.equal(result.response.status, 200);
  assert.equal(result.fetchCount, 2);
});

test('surfaces a sanitized timeout error once retries are exhausted', async () => {
  const abortError = new Error('timed out');
  abortError.name = 'AbortError';

  const result = await runWithRetry([
    abortError,
    abortError,
    abortError
  ], { baseDelayMs: 10 });

  assert.ok(result.error instanceof ProviderError);
  assert.equal(result.error.statusCode, 504);
  assert.equal(result.error.retryable, true);
  assert.deepEqual(result.delays, [10, 20]);
});

test('drains the body of a retryable response without reading it', async () => {
  let cancelled = 0;
  const first = makeResponse(429, { headers: { 'Retry-After': '0' } });
  first.body = {
    cancel: async () => {
      cancelled += 1;
    }
  };

  const result = await runWithRetry([first, makeResponse(200)]);

  assert.equal(result.error, null);
  assert.equal(result.response.status, 200);
  assert.equal(cancelled, 1);
});
