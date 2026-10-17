import { ValidationError } from '../errors.js';

export const LEGACY_STORAGE_KIND = 'legacy';
export const TABLE_STORAGE_KIND = 'table';

export function isTableSpace(space) {
  return space?.kind === 'voyage';
}

export function resolveEmbeddingWriteTarget(space) {
  if (!space || typeof space !== 'object' || typeof space.id !== 'string' || space.id.length === 0) {
    throw new ValidationError('An embedding space with an id is required to resolve a write target.');
  }

  if (!Number.isFinite(space.dimensions) || space.dimensions <= 0) {
    throw new ValidationError(`Embedding space "${space.id}" must declare positive dimensions.`);
  }

  if (isTableSpace(space)) {
    return {
      kind: TABLE_STORAGE_KIND,
      spaceId: space.id,
      table: 'chunk_embeddings',
      dimensions: space.dimensions,
      documentInputType: space.documentInputType ?? null,
      queryInputType: space.queryInputType ?? null
    };
  }

  return {
    kind: LEGACY_STORAGE_KIND,
    spaceId: space.id,
    column: space.storageColumn ?? 'embedding',
    dimensions: space.dimensions,
    documentInputType: null,
    queryInputType: null
  };
}

export function computeEmbeddingL2Norm(embedding, { dimensions } = {}) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new ValidationError('Cannot compute an L2 norm for an empty embedding.');
  }

  if (Number.isFinite(dimensions) && embedding.length !== dimensions) {
    throw new ValidationError(`Embedding has ${embedding.length} dimensions; expected ${dimensions}.`);
  }

  let sumOfSquares = 0;

  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Cannot compute an L2 norm for an embedding with non-finite values.');
    }

    sumOfSquares += value * value;
  }

  return Math.sqrt(sumOfSquares);
}
