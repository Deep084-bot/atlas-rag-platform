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
