import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';
import { ProviderError } from '../../server/errors.js';

function mockFetch(handler) {
  const original = globalThis.fetch;

  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    async json() {
      return payload;
    },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    }
  };
}

test('embedMany sends a Voyage request and returns embeddings', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [
      { index: 0, embedding: [1, 0, 0] },
      { index: 1, embedding: [0, 1, 0] }
    ],
    usage: { total_tokens: 12 }
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    const vectors = await provider.embedMany(['a', 'b']);

    assert.equal(vectors.length, 2);
    assert.deepEqual(vectors[0], [1, 0, 0]);
    assert.deepEqual(vectors[1], [0, 1, 0]);

    const [{ url, options }] = mock.calls;
    assert.ok(url.endsWith('/embeddings'));
    assert.equal(options.headers.Authorization, 'Bearer test-key');

    const body = JSON.parse(options.body);
    assert.equal(body.model, 'voyage-4-lite');
    assert.deepEqual(body.input, ['a', 'b']);
    assert.equal(body.input_type, 'document');
    assert.equal(body.output_dimension, undefined);
  } finally {
    mock.restore();
  }
});

test('embedMany respects index ordering even when responses are unordered', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [
      { index: 1, embedding: [0, 1, 0] },
      { index: 0, embedding: [1, 0, 0] }
    ]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    const vectors = await provider.embedMany(['a', 'b']);

    assert.deepEqual(vectors[0], [1, 0, 0]);
    assert.deepEqual(vectors[1], [0, 1, 0]);
  } finally {
    mock.restore();
  }
});

test('embedMany normalizes embeddings by default', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding: [3, 4] }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key' });
    const [vector] = await provider.embedMany(['a']);

    assert.ok(Math.abs(vector[0] - 0.6) < 1e-9);
    assert.ok(Math.abs(vector[1] - 0.8) < 1e-9);
  } finally {
    mock.restore();
  }
});

test('embedMany includes output_dimension when configured', async () => {
  const embedding = new Array(256).fill(0);
  embedding[0] = 1;

  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', dimensions: 256, normalize: false });
    await provider.embedMany(['a']);

    const body = JSON.parse(mock.calls[0].options.body);
    assert.equal(body.output_dimension, 256);
  } finally {
    mock.restore();
  }
});

test('embedMany uses input_type "document" and embed uses "query"', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding: [1, 0] }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });

    await provider.embedMany(['a']);
    assert.equal(JSON.parse(mock.calls[0].options.body).input_type, 'document');

    await provider.embed('a');
    assert.equal(JSON.parse(mock.calls[1].options.body).input_type, 'query');
  } finally {
    mock.restore();
  }
});

test('an explicit inputType overrides the per-method default', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding: [1, 0] }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false, inputType: 'document' });

    await provider.embed('a');
    assert.equal(JSON.parse(mock.calls[0].options.body).input_type, 'document');
  } finally {
    mock.restore();
  }
});

test('constructing with an unsupported output dimension throws', () => {
  assert.throws(
    () => new VoyageProvider({ apiKey: 'test-key', dimensions: 384 }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.ok(error.message.includes('Unsupported Voyage output dimension'));
      return true;
    }
  );
});

test('constructing with an invalid inputType throws', () => {
  assert.throws(
    () => new VoyageProvider({ apiKey: 'test-key', inputType: 'passage' }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.ok(error.message.includes('Unsupported Voyage inputType'));
      return true;
    }
  );
});

test('embed returns a single embedding', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding: [0.5, 0.5] }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    const vector = await provider.embed('hello');
    assert.deepEqual(vector, [0.5, 0.5]);
  } finally {
    mock.restore();
  }
});

test('embedMany returns empty array for empty input without calling fetch', async () => {
  const mock = mockFetch(() => jsonResponse(200, { data: [] }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key' });
    const vectors = await provider.embedMany([]);
    assert.deepEqual(vectors, []);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('embedMany rejects batches larger than the maximum without calling fetch', async () => {
  const mock = mockFetch(() => jsonResponse(200, { data: [] }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', maxBatchSize: 2 });
    await assert.rejects(() => provider.embedMany(['a', 'b', 'c']), (error) => {
      assert.ok(error instanceof ProviderError);
      return true;
    });
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('embedMany throws on invalid embedding values', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding: [1, Number.NaN] }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    await assert.rejects(() => provider.embedMany(['a']), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.provider, 'Voyage');
      return true;
    });
  } finally {
    mock.restore();
  }
});

test('embedMany throws on dimension mismatch when dimensions configured', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding: [1, 0, 0] }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', dimensions: 256, normalize: false });
    await assert.rejects(() => provider.embedMany(['a']), (error) => {
      assert.ok(error instanceof ProviderError);
      return true;
    });
  } finally {
    mock.restore();
  }
});

test('embedMany surfaces auth failures without leaking the API key', async () => {
  const mock = mockFetch(() => jsonResponse(401, { detail: 'invalid key secret-abc' }));

  try {
    const provider = new VoyageProvider({ apiKey: 'secret-abc', retries: 0 });
    await assert.rejects(() => provider.embedMany(['a']), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.statusCode, 401);
      assert.ok(error.message.includes('status 401'));
      assert.ok(!error.message.includes('secret-abc'));
      return true;
    });
  } finally {
    mock.restore();
  }
});

test('embedMany surfaces rate limiting as a ProviderError', async () => {
  const mock = mockFetch(() => jsonResponse(429, 'too many requests'));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', retries: 0 });
    await assert.rejects(() => provider.embedMany(['a']), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.statusCode, 429);
      assert.equal(error.provider, 'Voyage');
      return true;
    });
  } finally {
    mock.restore();
  }
});

test('embedMany throws on an unexpected number of embeddings', async () => {
  const mock = mockFetch(() => jsonResponse(200, {
    data: [{ index: 0, embedding: [1, 0] }]
  }));

  try {
    const provider = new VoyageProvider({ apiKey: 'test-key', normalize: false });
    await assert.rejects(() => provider.embedMany(['a', 'b']), (error) => {
      assert.ok(error instanceof ProviderError);
      return true;
    });
  } finally {
    mock.restore();
  }
});
