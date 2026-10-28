import { EmbeddingProvider } from './EmbeddingProvider.js';
import { ProviderError } from '../errors.js';
import { verifyArtifacts } from './embeddingManifest.js';
import { sanitizePublicErrorDetail, sanitizeServerLogDetail } from '../security/sanitize.js';

const DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5';
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_POOLING = 'mean';

async function defaultLoadExtractor({ model, quantized, cacheDir, allowRemoteModels, revision, progressCallback }) {
  const { pipeline, env } = await import('@xenova/transformers');

  if (cacheDir) {
    env.cacheDir = cacheDir;
  }

  if (typeof allowRemoteModels === 'boolean') {
    env.allowRemoteModels = allowRemoteModels;
  }

  const options = {
    quantized,
    progress_callback: progressCallback
  };

  if (revision) {
    options.revision = revision;
  }

  return pipeline('feature-extraction', model, options);
}

function tensorToVectors(output) {
  if (!output) {
    return null;
  }

  if (typeof output.tolist === 'function') {
    return output.tolist();
  }

  return Array.isArray(output) ? output : null;
}

export class LocalTransformersProvider extends EmbeddingProvider {
  constructor({
    model = DEFAULT_MODEL,
    dimensions = DEFAULT_DIMENSIONS,
    pooling = DEFAULT_POOLING,
    normalize = true,
    quantized = false,
    cacheDir,
    revision,
    allowRemoteModels = false,
    strictCache = false,
    progressCallback = null,
    loadExtractor = defaultLoadExtractor,
    verifyCache = verifyArtifacts,
    logger = console
  } = {}) {
    super();
    this.model = model;
    this.dimensions = dimensions;
    this.pooling = pooling;
    this.normalize = normalize;
    this.quantized = quantized;
    this.cacheDir = cacheDir;
    this.revision = revision;
    this.allowRemoteModels = allowRemoteModels;
    this.strictCache = strictCache;
    this.progressCallback = progressCallback;
    this.loadExtractor = loadExtractor;
    this.verifyCache = verifyCache;
    this.logger = logger;
    this._extractorPromise = null;
  }

  _getExtractor() {
    if (!this._extractorPromise) {
      this._extractorPromise = this._createExtractor().catch((error) => {
        this._extractorPromise = null;
        throw error;
      });
    }

    return this._extractorPromise;
  }

  async _createExtractor() {
    if (this.strictCache && !this.cacheDir && !this.allowRemoteModels) {
      throw new ProviderError(
        'Local embedding cache integrity cannot be verified: no cache directory is configured and remote downloads are disabled.',
        { provider: 'local', statusCode: 503 }
      );
    }

    if (this.strictCache && this.cacheDir) {
      const integrity = await this.verifyCache({ cacheDir: this.cacheDir });

      if (!integrity.ok) {
        const details = integrity.failures
          .map((failure) => `${failure.path} (${failure.reason})`)
          .join(', ');

        throw new ProviderError(
          `Local embedding cache failed integrity verification (${details}); refusing to initialize model.`,
          { provider: 'local', statusCode: 503 }
        );
      }
    }

    try {
      return await this.loadExtractor({
        model: this.model,
        quantized: this.quantized,
        cacheDir: this.cacheDir,
        revision: this.revision,
        allowRemoteModels: this.allowRemoteModels,
        progressCallback: this.progressCallback
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const publicReason = sanitizePublicErrorDetail(reason);

      this.logger?.error?.('[embeddings] local model initialization failed', {
        model: this.model,
        revision: this.revision,
        cacheConfigured: Boolean(this.cacheDir),
        causeName: error instanceof Error ? error.name : null,
        detail: sanitizeServerLogDetail(reason)
      });

      throw new ProviderError(
        publicReason
          ? `Local embedding model failed to initialize: ${publicReason}`
          : 'Local embedding model failed to initialize.',
        {
          provider: 'local',
          statusCode: 503,
          cause: error instanceof Error ? error : null
        }
      );
    }
  }

  async embed(text) {
    const embeddings = await this.embedMany([text]);

    return embeddings[0];
  }

  async embedMany(texts) {
    if (!Array.isArray(texts)) {
      throw new TypeError('embedMany expects an array of strings.');
    }

    if (texts.length === 0) {
      return [];
    }

    if (!texts.every((text) => typeof text === 'string')) {
      throw new TypeError('embedMany expects an array of strings.');
    }

    const extractor = await this._getExtractor();

    let output;

    try {
      output = await extractor(texts, {
        pooling: this.pooling,
        normalize: this.normalize
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const publicReason = sanitizePublicErrorDetail(reason);

      this.logger?.error?.('[embeddings] local model inference failed', {
        model: this.model,
        revision: this.revision,
        causeName: error instanceof Error ? error.name : null,
        detail: sanitizeServerLogDetail(reason)
      });

      throw new ProviderError(
        publicReason
          ? `Local embedding inference failed: ${publicReason}`
          : 'Local embedding inference failed.',
        {
          provider: 'local',
          statusCode: 502,
          cause: error instanceof Error ? error : null
        }
      );
    }

    const vectors = tensorToVectors(output);

    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new ProviderError('Local embedding model returned an unexpected number of embeddings.', {
        provider: 'local',
        statusCode: 502
      });
    }

    for (const vector of vectors) {
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new ProviderError('Local embedding model returned an empty embedding.', {
          provider: 'local',
          statusCode: 502
        });
      }

      if (!vector.every((value) => Number.isFinite(value))) {
        throw new ProviderError('Local embedding model returned invalid embedding values.', {
          provider: 'local',
          statusCode: 502
        });
      }

      if (Number.isFinite(this.dimensions) && this.dimensions > 0 && vector.length !== this.dimensions) {
        throw new ProviderError('Local embedding model returned embedding with unexpected dimensions.', {
          provider: 'local',
          statusCode: 502
        });
      }
    }

    return vectors;
  }
}
