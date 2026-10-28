import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LocalTransformersProvider } from '../../server/embeddings/LocalTransformersProvider.js';

function makeTensor(vectors) {
  return {
    dims: [vectors.length, Array.isArray(vectors[0]) ? vectors[0].length : 0],
    data: [],
    tolist() {
      return vectors;
    }
  };
}

function vector(size, fill = 0.1) {
  return Array(size).fill(fill);
}

function makeLoader({ vectors, delay = 0, error = null, onCall } = {}) {
  const loader = async (options) => {
    if (typeof onCall === 'function') {
      onCall(options);
    }

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (error) {
      throw error;
    }

    const extractor = async (inputs, options2) => {
      const batch = Array.isArray(inputs) ? inputs : [inputs];
      const result = typeof vectors === 'function' ? vectors(batch, options2) : vectors;

      return makeTensor(result);
    };

    extractor.lastOptions = null;
    const wrapped = async (inputs, extractorOptions) => {
      extractor.lastOptions = extractorOptions;
      return extractor(inputs, extractorOptions);
    };

    return wrapped;
  };

  return loader;
}

test('embed returns a single finite 384-dimensional vector', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [vector(384, 0.2)] })
  });

  const embedding = await provider.embed('hello world');

  assert.equal(embedding.length, 384);
  assert.ok(embedding.every((value) => Number.isFinite(value)));
});

test('embedMany returns one valid embedding per input', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [vector(384, 0.1), vector(384, 0.3)] })
  });

  const embeddings = await provider.embedMany(['a', 'b']);

  assert.equal(embeddings.length, 2);
  assert.equal(embeddings[0].length, 384);
  assert.equal(embeddings[1].length, 384);
});

test('embedMany returns [] for empty input without initializing the model', async () => {
  let loadCount = 0;
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [], onCall: () => { loadCount += 1; } })
  });

  const embeddings = await provider.embedMany([]);

  assert.deepEqual(embeddings, []);
  assert.equal(loadCount, 0);
});

test('embedMany rejects non-array input', async () => {
  const provider = new LocalTransformersProvider({ loadExtractor: makeLoader({ vectors: [] }) });

  await assert.rejects(() => provider.embedMany('nope'), TypeError);
});

test('embedMany rejects non-string items', async () => {
  const provider = new LocalTransformersProvider({ loadExtractor: makeLoader({ vectors: [] }) });

  await assert.rejects(() => provider.embedMany(['ok', 42]), TypeError);
});

test('passes cache, revision, and remote-model options to the loader', async () => {
  let captured = null;
  const provider = new LocalTransformersProvider({
    cacheDir: '/tmp/atlas-bundled-cache',
    revision: 'pinned-revision',
    allowRemoteModels: false,
    loadExtractor: async (options) => {
      captured = options;

      return async () => makeTensor([vector(384)]);
    }
  });

  await provider.embed('hello');

  assert.equal(captured.cacheDir, '/tmp/atlas-bundled-cache');
  assert.equal(captured.revision, 'pinned-revision');
  assert.equal(captured.allowRemoteModels, false);
});

test('passes pooling and normalize options to the extractor', async () => {
  let captured = null;
  const provider = new LocalTransformersProvider({
    pooling: 'cls',
    normalize: true,
    loadExtractor: async () =>
      (async (_inputs, options) => {
        captured = options;
        return makeTensor([vector(384)]);
      })
  });

  await provider.embed('hello');

  assert.deepEqual(captured, { pooling: 'cls', normalize: true });
});

test('throws ProviderError when the model returns too few embeddings', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [] })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) => error.name === 'ProviderError' && /unexpected number/.test(error.message)
  );
});

test('throws ProviderError when an embedding is empty', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [[]] })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) => error.name === 'ProviderError' && /empty embedding/.test(error.message)
  );
});

test('throws ProviderError when a vector has non-finite values', async () => {
  const bad = vector(384);
  bad[0] = Number.NaN;
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [bad] })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) => error.name === 'ProviderError' && /invalid embedding values/.test(error.message)
  );
});

test('throws ProviderError when a vector has unexpected dimensions', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [vector(10)] })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) => error.name === 'ProviderError' && /unexpected dimensions/.test(error.message)
  );
});

test('throws ProviderError when batch size does not match input count', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ vectors: [vector(384), vector(384), vector(384)] })
  });

  await assert.rejects(
    () => provider.embedMany(['a', 'b']),
    (error) => error.name === 'ProviderError' && /unexpected number/.test(error.message)
  );
});

test('initializes the model only once under concurrent requests', async () => {
  let loadCount = 0;
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({
      vectors: (batch) => batch.map(() => vector(384)),
      delay: 20,
      onCall: () => { loadCount += 1; }
    })
  });

  const results = await Promise.all([
    provider.embed('a'),
    provider.embed('b'),
    provider.embedMany(['c', 'd'])
  ]);

  assert.equal(loadCount, 1);
  assert.equal(results[0].length, 384);
  assert.equal(results[1].length, 384);
  assert.equal(results[2].length, 2);
});

test('wraps initialization failures in a ProviderError without falling back', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: makeLoader({ error: new Error('cannot load onnxruntime') })
  });

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not reach the network');
  };

  try {
    await assert.rejects(
      () => provider.embed('hi'),
      (error) => {
        assert.equal(error.name, 'ProviderError');
        assert.equal(error.provider, 'local');
        assert.equal(error.statusCode, 503);
        assert.match(error.message, /failed to initialize/);
        assert.match(error.message, /cannot load onnxruntime/);
        return true;
      }
    );
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('allows retry after an initialization failure', async () => {
  let loadCount = 0;
  const provider = new LocalTransformersProvider({
    loadExtractor: async () => {
      loadCount += 1;
      if (loadCount === 1) {
        throw new Error('transient failure');
      }
      return async () => makeTensor([vector(384)]);
    }
  });

  await assert.rejects(() => provider.embed('hi'), (error) => error.name === 'ProviderError');
  const embedding = await provider.embed('hi');

  assert.equal(loadCount, 2);
  assert.equal(embedding.length, 384);
});

test('wraps inference failures in a ProviderError', async () => {
  const provider = new LocalTransformersProvider({
    loadExtractor: async () =>
      (async () => {
        throw new Error('inference exploded');
      })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) =>
      error.name === 'ProviderError' &&
      error.statusCode === 502 &&
      /inference failed/.test(error.message)
  );
});

test('strict cache verification blocks initialization before loading the model', async () => {
  let loadCount = 0;
  let verifyCount = 0;
  const provider = new LocalTransformersProvider({
    cacheDir: '/tmp/atlas-corrupt-cache',
    strictCache: true,
    verifyCache: async () => {
      verifyCount += 1;
      return {
        ok: false,
        failures: [{ path: 'onnx/model_quantized.onnx', reason: 'checksum-mismatch' }]
      };
    },
    loadExtractor: makeLoader({ vectors: [vector(384)], onCall: () => { loadCount += 1; } })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) =>
      error.name === 'ProviderError' &&
      error.statusCode === 503 &&
      /cache failed integrity verification/.test(error.message) &&
      /checksum-mismatch/.test(error.message)
  );

  assert.equal(verifyCount, 1);
  assert.equal(loadCount, 0);
});

test('strict cache verification allows a verified cache to initialize', async () => {
  let loadCount = 0;
  const provider = new LocalTransformersProvider({
    cacheDir: '/tmp/atlas-valid-cache',
    strictCache: true,
    verifyCache: async () => ({ ok: true, failures: [] }),
    loadExtractor: makeLoader({ vectors: [vector(384)], onCall: () => { loadCount += 1; } })
  });

  const embedding = await provider.embed('hi');

  assert.equal(embedding.length, 384);
  assert.equal(loadCount, 1);
});

test('strict mode fails clearly when no cache is available and remote is disabled', async () => {
  let loadCount = 0;
  const provider = new LocalTransformersProvider({
    cacheDir: null,
    allowRemoteModels: false,
    strictCache: true,
    loadExtractor: makeLoader({ vectors: [vector(384)], onCall: () => { loadCount += 1; } })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) =>
      error.name === 'ProviderError' &&
      error.statusCode === 503 &&
      /no cache directory is configured/.test(error.message)
  );
  assert.equal(loadCount, 0);
});

test('strict mode rejects a same-size corrupted real manifest cache before loading', async (t) => {
  const { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { EMBEDDING_MANIFEST } = await import('../../server/embeddings/embeddingManifest.js');

  const cacheDir = mkdtempSync(path.join(tmpdir(), 'atlas-corrupt-cache-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));

  for (const artifact of EMBEDDING_MANIFEST.artifacts) {
    const target = path.join(
      cacheDir,
      'Xenova',
      'bge-small-en-v1.5',
      EMBEDDING_MANIFEST.model.revision,
      artifact.path
    );
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '');
    truncateSync(target, artifact.bytes);
  }

  let loadCount = 0;
  const provider = new LocalTransformersProvider({
    cacheDir,
    strictCache: true,
    loadExtractor: makeLoader({ vectors: [vector(384)], onCall: () => { loadCount += 1; } })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) =>
      error.name === 'ProviderError' &&
      /cache failed integrity verification/.test(error.message) &&
      /checksum-mismatch/.test(error.message)
  );
  assert.equal(loadCount, 0);
});

test('initialization failures do not expose cache paths or credentials to callers', async () => {
  const logCalls = [];
  const provider = new LocalTransformersProvider({
    cacheDir: '/Users/alice/.cache/atlas/model',
    logger: { error: (...args) => logCalls.push(args) },
    loadExtractor: async () => {
      throw new Error(
        'cannot read /Users/alice/.cache/atlas/model/tokenizer.json ' +
        'HF_API_KEY=sk-live-secret postgresql://atlas:db-password@localhost:5432/atlas'
      );
    }
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) => {
      assert.equal(error.name, 'ProviderError');
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /failed to initialize/);
      assert.doesNotMatch(error.message, /\/Users\/alice/);
      assert.doesNotMatch(error.message, /sk-live-secret/);
      assert.doesNotMatch(error.message, /db-password/);
      return true;
    }
  );

  const serializedLogs = JSON.stringify(logCalls);
  assert.match(serializedLogs, /local model initialization failed/);
  assert.match(serializedLogs, /\/Users\/alice\/\.cache\/atlas/);
  assert.doesNotMatch(serializedLogs, /sk-live-secret/);
  assert.doesNotMatch(serializedLogs, /db-password/);
});

test('inference failures do not expose filesystem paths to callers', async () => {
  const provider = new LocalTransformersProvider({
    logger: { error: () => {} },
    loadExtractor: async () =>
      (async () => {
        throw new Error('inference failed reading /Users/alice/.cache/atlas/model.onnx');
      })
  });

  await assert.rejects(
    () => provider.embed('hi'),
    (error) => {
      assert.equal(error.name, 'ProviderError');
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /inference failed/);
      assert.doesNotMatch(error.message, /\/Users\/alice/);
      return true;
    }
  );
});
