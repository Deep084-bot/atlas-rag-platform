import {
  EMBEDDING_MANIFEST,
  EMBEDDING_SPACE_ID
} from './embeddingManifest.js';

export const HOSTED_BGE_SPACE_ID = 'bge-small-en-v1.5-hosted-l2-v1';
export const LOCAL_BGE_SPACE_ID = EMBEDDING_SPACE_ID;

export const EMBEDDING_SPACE_CONFIG_VERSION = 1;

export const VOYAGE_MODEL_DEFAULT = 'voyage-4-lite';
export const VOYAGE_DIMENSIONS_DEFAULT = 1024;

export function voyageSpaceId(dimensions = VOYAGE_DIMENSIONS_DEFAULT) {
  return `${VOYAGE_MODEL_DEFAULT}-query-document-l2-${dimensions}-v1`;
}

export const VOYAGE_SPACE_ID = voyageSpaceId(VOYAGE_DIMENSIONS_DEFAULT);

export const LEGACY_UNKNOWN_SPACE_LABEL = 'legacy-unknown';

export const HOSTED_BGE_SPACE = Object.freeze({
  id: HOSTED_BGE_SPACE_ID,
  configVersion: EMBEDDING_SPACE_CONFIG_VERSION,
  kind: 'bge',
  provider: 'huggingface',
  providers: Object.freeze(['huggingface']),
  model: 'BAAI/bge-small-en-v1.5',
  revision: null,
  dimensions: 384,
  normalization: 'l2',
  pooling: null,
  quantization: null,
  queryInputType: null,
  documentInputType: null,
  storageColumn: 'embedding',
  legacyUnknownPolicy: 'block'
});

export const LOCAL_BGE_SPACE = Object.freeze({
  id: LOCAL_BGE_SPACE_ID,
  configVersion: EMBEDDING_SPACE_CONFIG_VERSION,
  kind: 'bge',
  provider: 'local',
  providers: Object.freeze(['local', 'local-transformers']),
  model: EMBEDDING_MANIFEST.model.repository,
  revision: EMBEDDING_MANIFEST.model.revision,
  dimensions: EMBEDDING_MANIFEST.dimensions,
  normalization: EMBEDDING_MANIFEST.normalization,
  pooling: EMBEDDING_MANIFEST.pooling,
  quantization: EMBEDDING_MANIFEST.quantization,
  queryInputType: null,
  documentInputType: null,
  storageColumn: 'embedding',
  legacyUnknownPolicy: 'block'
});

export const VOYAGE_SPACE = Object.freeze({
  id: VOYAGE_SPACE_ID,
  configVersion: EMBEDDING_SPACE_CONFIG_VERSION,
  kind: 'voyage',
  provider: 'voyage',
  providers: Object.freeze(['voyage']),
  model: VOYAGE_MODEL_DEFAULT,
  revision: null,
  dimensions: VOYAGE_DIMENSIONS_DEFAULT,
  normalization: 'l2',
  pooling: null,
  quantization: null,
  queryInputType: 'query',
  documentInputType: 'document',
  storageColumn: 'embedding',
  legacyUnknownPolicy: 'block',
  pricing: Object.freeze({
    perMillionTokensUsd: 0.02,
    freeTokensPerAccount: 200_000_000,
    source: 'voyage-ai-public-pricing-2026'
  })
});

export const EMBEDDING_SPACES = Object.freeze({
  [HOSTED_BGE_SPACE_ID]: HOSTED_BGE_SPACE,
  [LOCAL_BGE_SPACE_ID]: LOCAL_BGE_SPACE,
  [VOYAGE_SPACE_ID]: VOYAGE_SPACE
});

export const DEFAULT_EMBEDDING_SPACE_ID = HOSTED_BGE_SPACE_ID;

const PROVIDER_SPACE_IDS = Object.freeze({
  huggingface: HOSTED_BGE_SPACE_ID,
  local: LOCAL_BGE_SPACE_ID,
  'local-transformers': LOCAL_BGE_SPACE_ID,
  voyage: VOYAGE_SPACE_ID
});

export function normalizeProviderName(name) {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return key || 'huggingface';
}

export function spaceIdForProvider(name) {
  return PROVIDER_SPACE_IDS[normalizeProviderName(name)] ?? null;
}

export function getEmbeddingSpace(spaceId) {
  if (!spaceId || typeof spaceId !== 'string') {
    return null;
  }

  return EMBEDDING_SPACES[spaceId] ?? null;
}

function buildVoyageSpace(env) {
  const override = Number(env?.VOYAGE_OUTPUT_DIMENSION);

  if (!Number.isFinite(override) || override <= 0 || override === VOYAGE_SPACE.dimensions) {
    return VOYAGE_SPACE;
  }

  return Object.freeze({
    ...VOYAGE_SPACE,
    id: voyageSpaceId(override),
    dimensions: override,
    derivedFrom: VOYAGE_SPACE.id
  });
}

export const LEGACY_UNKNOWN_POLICY_BLOCK = 'block';
export const LEGACY_UNKNOWN_POLICY_INCLUDE = 'include';
export const LEGACY_UNKNOWN_POLICY_ENV = 'EMBEDDING_LEGACY_UNKNOWN_POLICY';

export function resolveLegacyUnknownPolicy(env = process.env) {
  const raw = env?.[LEGACY_UNKNOWN_POLICY_ENV];

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return LEGACY_UNKNOWN_POLICY_BLOCK;
  }

  const normalized = String(raw).trim().toLowerCase();

  if (normalized === LEGACY_UNKNOWN_POLICY_BLOCK || normalized === LEGACY_UNKNOWN_POLICY_INCLUDE) {
    return normalized;
  }

  throw new Error(
    `${LEGACY_UNKNOWN_POLICY_ENV} must be "${LEGACY_UNKNOWN_POLICY_BLOCK}" or `
      + `"${LEGACY_UNKNOWN_POLICY_INCLUDE}", got "${raw}".`
  );
}

function applyLegacyUnknownPolicy(space, env) {
  const policy = resolveLegacyUnknownPolicy(env);

  if (policy === LEGACY_UNKNOWN_POLICY_INCLUDE && space.id !== HOSTED_BGE_SPACE_ID) {
    throw new Error(
      `${LEGACY_UNKNOWN_POLICY_ENV}="${LEGACY_UNKNOWN_POLICY_INCLUDE}" is only supported for the hosted `
        + `BGE space; active space "${space.id}" cannot include legacy unknown vectors.`
    );
  }

  if (policy === space.legacyUnknownPolicy) {
    return space;
  }

  return Object.freeze({
    ...space,
    legacyUnknownPolicy: policy
  });
}

export function resolveEmbeddingSpaceForProvider(name, env = process.env) {
  const spaceId = spaceIdForProvider(name) ?? DEFAULT_EMBEDDING_SPACE_ID;
  const space = spaceId === VOYAGE_SPACE_ID ? buildVoyageSpace(env) : EMBEDDING_SPACES[spaceId];

  return applyLegacyUnknownPolicy(space, env);
}

export function resolveActiveEmbeddingSpace(env = process.env) {
  return resolveEmbeddingSpaceForProvider(env?.EMBEDDING_PROVIDER, env);
}

export function expectedDimensionsForProvider(name, env = process.env) {
  return resolveEmbeddingSpaceForProvider(name, env).dimensions;
}

export function resolveDimensionsForService({ dimensions, provider, space, env = process.env } = {}) {
  if (Number.isFinite(dimensions) && dimensions > 0) {
    return dimensions;
  }

  if (space && Number.isFinite(space.dimensions) && space.dimensions > 0) {
    return space.dimensions;
  }

  if (provider && Number.isFinite(provider.dimensions) && provider.dimensions > 0) {
    return provider.dimensions;
  }

  return resolveActiveEmbeddingSpace(env).dimensions;
}
