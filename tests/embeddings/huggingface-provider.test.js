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

test('throws ProviderError on upstream error with message preserved', async () => {
  const provider = new HuggingFaceProvider({ apiKey: 'test' });
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 402,
    async text() { return 'You have no remaining credits. Purchase pre-paid credits to continue using Inference Providers.'; },
    async json() { return {}; }
  });
  try {
    await assert.rejects(async () => provider.embed('hi'), (err) => {
      assert.equal(err.name, 'ProviderError');
      assert.equal(err.statusCode, 502);
      assert.ok(err.message.includes('no remaining credits'));
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
