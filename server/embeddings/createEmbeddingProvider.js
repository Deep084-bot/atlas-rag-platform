import { HuggingFaceProvider } from './HuggingFaceProvider.js';
import { LocalTransformersProvider } from './LocalTransformersProvider.js';
import { VoyageProvider } from './VoyageProvider.js';
import {
  EMBEDDING_MANIFEST,
  assertRuntimeConfigMatchesManifest,
  hasPinnedArtifacts,
  parseBoolean,
  resolveBundledCacheDir
} from './embeddingManifest.js';

const HUGGINGFACE_MODEL = 'BAAI/bge-small-en-v1.5';
const LOCAL_MODEL = EMBEDDING_MANIFEST.model.repository;
const DEFAULT_POOLING = EMBEDDING_MANIFEST.pooling;

export function createEmbeddingProvider({ providerName, env = process.env } = {}) {
  const resolvedName = (providerName ?? env.EMBEDDING_PROVIDER ?? 'huggingface').trim().toLowerCase() || 'huggingface';

  switch (resolvedName) {
    case 'huggingface':
      return new HuggingFaceProvider({
        apiKey: env.HF_API_KEY,
        model: HUGGINGFACE_MODEL
      });

    case 'local':
    case 'local-transformers': {
      if (parseBoolean(env.EMBEDDING_LOCAL_STRICT, false)) {
        assertRuntimeConfigMatchesManifest(env);
      }

      const explicitCacheDir =
        env.EMBEDDING_CACHE_DIR || env.TRANSFORMERS_CACHE_DIR || env.MODEL_CACHE_DIR || undefined;
      const bundledCacheDir = resolveBundledCacheDir({ env });

      // Prefer an explicitly configured cache only when it already holds the
      // pinned artifacts. This keeps a correctly provisioned persistent disk
      // working, but falls back to the image-bundled cache when the configured
      // path is absent/empty/unwritable (e.g. a stale /var/data setting).
      const useBundledCache = !hasPinnedArtifacts(explicitCacheDir) && hasPinnedArtifacts(bundledCacheDir);
      const cacheDir = useBundledCache ? bundledCacheDir : explicitCacheDir;

      return new LocalTransformersProvider({
        model: env.LOCAL_EMBEDDING_MODEL || env.EMBEDDING_LOCAL_MODEL || LOCAL_MODEL,
        dimensions: Number(env.EMBEDDING_LOCAL_DIMENSIONS) || EMBEDDING_MANIFEST.dimensions,
        pooling: env.EMBEDDING_LOCAL_POOLING || DEFAULT_POOLING,
        normalize: parseBoolean(env.EMBEDDING_LOCAL_NORMALIZE, EMBEDDING_MANIFEST.normalize),
        quantized: parseBoolean(env.EMBEDDING_LOCAL_QUANTIZED, EMBEDDING_MANIFEST.quantization === 'int8'),
        cacheDir,
        revision: env.EMBEDDING_LOCAL_REVISION || EMBEDDING_MANIFEST.model.revision,
        allowRemoteModels: useBundledCache
          ? false
          : parseBoolean(env.EMBEDDING_LOCAL_ALLOW_REMOTE, false),
        strictCache: parseBoolean(env.EMBEDDING_LOCAL_STRICT, false)
      });
    }

    case 'voyage': {
      if (!env.VOYAGE_API_KEY) {
        throw new Error('EMBEDDING_PROVIDER "voyage" requires VOYAGE_API_KEY to be set.');
      }

      return new VoyageProvider({
        apiKey: env.VOYAGE_API_KEY,
        model: env.VOYAGE_MODEL || 'voyage-4-lite',
        baseUrl: env.VOYAGE_BASE_URL || 'https://api.voyageai.com/v1',
        dimensions: Number(env.VOYAGE_OUTPUT_DIMENSION) || null,
        inputType: env.VOYAGE_INPUT_TYPE || null,
        normalize: parseBoolean(env.VOYAGE_NORMALIZE, true)
      });
    }

    default:
      throw new Error(`Unsupported EMBEDDING_PROVIDER "${resolvedName}". Supported values: huggingface, local, voyage.`);
  }
}
