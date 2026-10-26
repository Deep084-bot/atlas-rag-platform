import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HuggingFaceProvider } from '../../server/embeddings/HuggingFaceProvider.js';

test('returns single embedding when HF returns number array', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return Array(384).fill(0).map((_, i) => i / 384);
    },
    async text() { return ''; }
  });
  try {
    const emb = await provider.embed('hello');
    assert.ok(Array.isArray(emb));
    assert.equal(emb.length, 384);
    assert.ok(emb.every((v) => Number.isFinite(v)));
    const mag = Math.sqrt(emb.reduce((s, v) => s + v*v, 0));
    assert.ok(mag > 0.99 && mag < 1.01);
  } finally {
    global.fetch = origFetch;
  }
});

test('routes requests to the hf-inference feature-extraction endpoint', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() { return Array(384).fill(0.1); },
      async text() { return ''; }
    };
  };
  try {
    await provider.embed('hello');
  } finally {
    global.fetch = origFetch;
  }

  assert.ok(captured);
  assert.equal(
    captured.url,
    'https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5/pipeline/feature-extraction'
  );
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, 'Bearer test');
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(captured.options.body).inputs, 'hello');
});

test('throws ProviderError when HF returns empty payload', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return []; },
    async text() { return ''; }
  });
  try {
    await assert.rejects(async () => provider.embed('hi'), (err) => err.name === 'ProviderError');
  } finally {
    global.fetch = origFetch;
  }
});

test('throws ProviderError when HF returns malformed data', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return [[null, 'bad']]; },
    async text() { return ''; }
  });
  try {
    await assert.rejects(async () => provider.embed('hi'), (err) => err.name === 'ProviderError');
  } finally {
    global.fetch = origFetch;
  }
});

test('throws ProviderError when batch count mismatched', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return [Array(384).fill(0.1), Array(384).fill(0.2), Array(384).fill(0.3)];
    },
    async text() { return ''; }
  });
  try {
    await assert.rejects(async () => provider.embedMany(['a','b']), (err) => err.name === 'ProviderError');
  } finally {
    global.fetch = origFetch;
  }
});

test('preserves upstream 402 while keeping application status 502', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  let textCalls = 0;
  global.fetch = async () => ({
    ok: false,
    status: 402,
    body: { async cancel() {} },
    async text() { textCalls += 1; return 'You have no remaining credits. Purchase pre-paid credits to continue using Inference Providers.'; },
    async json() { return {}; }
  });
  try {
    await assert.rejects(async () => provider.embed('hi'), (err) => {
      assert.equal(err.name, 'ProviderError');
      assert.equal(err.statusCode, 502);
      assert.equal(err.upstreamStatusCode, 402);
      assert.equal(err.retryable, false);
      assert.ok(!err.message.includes('no remaining credits'));
      assert.ok(!err.message.includes('credits'));
      assert.ok(!err.message.includes('{'));
      assert.ok(err.message.includes('status 402'));
      return true;
    });
    assert.equal(textCalls, 0);
  } finally {
    global.fetch = origFetch;
  }
});

test('preserves genuine 502 and marks it retryable', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  let calls = 0;
  let textCalls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 502,
      body: { async cancel() {} },
      async text() { textCalls += 1; return 'bad gateway'; },
      async json() { return {}; }
    };
  };
  try {
    await assert.rejects(async () => provider.embed('hi'), (err) => {
      assert.equal(err.name, 'ProviderError');
      assert.equal(err.statusCode, 502);
      assert.equal(err.upstreamStatusCode, null);
      assert.equal(err.retryable, true);
      assert.ok(!err.message.includes('bad gateway'));
      return true;
    });
    assert.equal(calls, 3);
    assert.equal(textCalls, 0);
  } finally {
    global.fetch = origFetch;
  }
});

test('does not assign upstream status to a 2xx parse failure', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { throw new SyntaxError('Unexpected token <'); },
    async text() { return ''; }
  });
  try {
    await assert.rejects(async () => provider.embed('hi'), (err) => {
      assert.equal(err.name, 'ProviderError');
      assert.equal(err.statusCode, 502);
      assert.equal(err.upstreamStatusCode, null);
      assert.equal(err.retryable, false);
      return true;
    });
  } finally {
    global.fetch = origFetch;
  }
});

test('throws ProviderError when embedding has wrong dimensions', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return Array(10).fill(0.1); },
    async text() { return ''; }
  });
  try {
    await assert.rejects(async () => provider.embed('hi'), (err) => {
      assert.equal(err.name, 'ProviderError');
      assert.equal(err.statusCode, 502);
      assert.equal(err.upstreamStatusCode, null);
      assert.equal(err.retryable, false);
      assert.ok(err.message.includes('dimensions'));
      return true;
    });
  } finally {
    global.fetch = origFetch;
  }
});

test('throws ProviderError when batch includes empty vector', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return [Array(384).fill(0.1), []]; },
    async text() { return ''; }
  });
  try {
    await assert.rejects(async () => provider.embedMany(['a', 'b']), (err) => err.name === 'ProviderError');
  } finally {
    global.fetch = origFetch;
  }
});

test('embedMany returns one valid embedding per input', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return [Array(384).fill(0.5), Array(384).fill(0.25)];
    },
    async text() { return ''; }
  });
  try {
    const embeddings = await provider.embedMany(['a', 'b']);
    assert.equal(embeddings.length, 2);
    assert.equal(embeddings[0].length, 384);
    assert.equal(embeddings[1].length, 384);
  } finally {
    global.fetch = origFetch;
  }
});
