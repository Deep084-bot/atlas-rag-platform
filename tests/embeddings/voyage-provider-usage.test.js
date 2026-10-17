import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';
import { ProviderError } from '../../server/errors.js';

function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

function jsonResponse(status, payload, headers = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: (name) => (lower.has(String(name).toLowerCase()) ? lower.get(String(name).toLowerCase()) : null) },
    async json() {
      return payload;
    },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    }
  };
}

function embeddingPayload(count, { usage } = {}) {
  const payload = {
    data: Array.from({ length: count }, (_, index) => ({
      index,
      embedding: [1, 0]
    }))
  };

  if (usage !== undefined) {
    payload.usage = usage;
  }

  return payload;
}

test('captures usage.total_tokens from a successful response', async () => {
  const mock = mockFetch(() => jsonResponse(200, embeddingPayload(2, { usage: { total_tokens: 42 } })));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    const vectors = await provider.embedMany(['a', 'b']);

    assert.equal(vectors.length, 2);

    const snapshot = provider.getUsageSnapshot();
    assert.equal(snapshot.requestCount, 1);
    assert.equal(snapshot.requestsWithUsage, 1);
    assert.equal(snapshot.requestsWithoutUsage, 0);
    assert.equal(snapshot.totalTokens, 42);
    assert.equal(snapshot.usageAvailable, true);
    assert.equal(snapshot.complete, true);
  } finally {
    mock.restore();
  }
});

test('embedManyWithUsage returns embeddings and the reported usage', async () => {
  const mock = mockFetch(() => jsonResponse(200, embeddingPayload(1, { usage: { total_tokens: 7, prompt_tokens: 7 } })));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    const result = await provider.embedManyWithUsage(['a']);

    assert.equal(result.embeddings.length, 1);
    assert.equal(result.usageAvailable, true);
    assert.equal(result.usage.totalTokens, 7);
    assert.equal(result.usage.promptTokens, 7);
  } finally {
    mock.restore();
  }
});

test('aggregates usage across multiple successful requests', async () => {
  let call = 0;
  const mock = mockFetch(() => {
    call += 1;
    return jsonResponse(200, embeddingPayload(1, { usage: { total_tokens: call === 1 ? 10 : 5 } }));
  });

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });

    await provider.embedMany(['a']);
    await provider.embed('b');

    const snapshot = provider.getUsageSnapshot();
    assert.equal(snapshot.requestCount, 2);
    assert.equal(snapshot.totalTokens, 15);
    assert.equal(snapshot.complete, true);
  } finally {
    mock.restore();
  }
});

test('marks usage unavailable when the API omits it', async () => {
  const mock = mockFetch(() => jsonResponse(200, embeddingPayload(1)));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    const { usage, usageAvailable } = await provider.embedManyWithUsage(['a']);

    assert.equal(usage, null);
    assert.equal(usageAvailable, false);

    const snapshot = provider.getUsageSnapshot();
    assert.equal(snapshot.totalTokens, null);
    assert.equal(snapshot.usageAvailable, false);
    assert.equal(snapshot.requestsWithoutUsage, 1);
    assert.equal(snapshot.complete, false);
  } finally {
    mock.restore();
  }
});

test('marks usage unavailable for malformed usage metadata', async () => {
  const malformed = [
    { usage: 'not-an-object' },
    { usage: { total_tokens: 'many' } },
    { usage: { total_tokens: -3 } },
    { usage: { total_tokens: Number.NaN } },
    { usage: null }
  ];

  let index = 0;
  const mock = mockFetch(() => {
    const payload = embeddingPayload(1, malformed[index]);
    index += 1;
    return jsonResponse(200, payload);
  });

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });

    for (let i = 0; i < malformed.length; i += 1) {
      await provider.embedMany(['a']);
    }

    const snapshot = provider.getUsageSnapshot();
    assert.equal(snapshot.requestCount, malformed.length);
    assert.equal(snapshot.requestsWithUsage, 0);
    assert.equal(snapshot.requestsWithoutUsage, malformed.length);
    assert.equal(snapshot.totalTokens, null);
    assert.equal(snapshot.usageAvailable, false);
  } finally {
    mock.restore();
  }
});

test('does not count a failed request as successful work', async () => {
  const mock = mockFetch(() => jsonResponse(429, 'rate limited'));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', retries: 0 });
    await assert.rejects(() => provider.embedMany(['a']), (error) => error instanceof ProviderError);

    const snapshot = provider.getUsageSnapshot();
    assert.equal(snapshot.requestCount, 0);
    assert.equal(snapshot.totalTokens, null);
    assert.equal(snapshot.usageAvailable, null);
  } finally {
    mock.restore();
  }
});

test('invokes the onUsage callback with availability information', async () => {
  const seen = [];
  const mock = mockFetch(() => jsonResponse(200, embeddingPayload(1, { usage: { total_tokens: 3 } })));

  try {
    const provider = new VoyageProvider({
      apiKey: 'test-key',
      normalize: false,
      onUsage: (event) => seen.push(event)
    });

    await provider.embedMany(['a']);

    assert.equal(seen.length, 1);
    assert.equal(seen[0].available, true);
    assert.equal(seen[0].totalTokens, 3);
    assert.equal(seen[0].requestCount, 1);
  } finally {
    mock.restore();
  }
});

test('resetUsage clears accumulated counters', async () => {
  const mock = mockFetch(() => jsonResponse(200, embeddingPayload(1, { usage: { total_tokens: 4 } })));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    await provider.embedMany(['a']);
    assert.equal(provider.getUsageSnapshot().totalTokens, 4);

    provider.resetUsage();
    const snapshot = provider.getUsageSnapshot();
    assert.equal(snapshot.requestCount, 0);
    assert.equal(snapshot.totalTokens, null);
    assert.equal(snapshot.usageAvailable, null);
  } finally {
    mock.restore();
  }
});

test('embedManyWithUsage on an empty batch makes no request', async () => {
  const mock = mockFetch(() => jsonResponse(200, embeddingPayload(0)));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key' });
    const result = await provider.embedManyWithUsage([]);

    assert.deepEqual(result.embeddings, []);
    assert.equal(result.usage, null);
    assert.equal(result.usageAvailable, null);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});
