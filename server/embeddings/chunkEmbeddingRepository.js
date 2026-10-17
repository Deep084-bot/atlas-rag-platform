import { toSql } from 'pgvector';

import { DatabaseError, ValidationError } from '../errors.js';

function resolveQueryable(pool, client) {
  return client ?? pool;
}

/**
 * Repository for the versioned (per-space) embedding store `chunk_embeddings`.
 *
 * Every method accepts an optional `{ client }`. When supplied, the query runs on
 * that connection instead of the pool, which lets the backfill runner commit a
 * batch of chunk upserts and its progress update inside a single transaction.
 * Reads may still be issued against the pool.
 */
export class ChunkEmbeddingRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async upsertChunkEmbedding(
    { chunkId, spaceId, embedding, l2Norm },
    { client = null } = {}
  ) {
    const queryable = resolveQueryable(this.pool, client);

    if (queryable == null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    if (!chunkId) {
      throw new ValidationError('A chunk id is required to persist a chunk embedding.');
    }

    if (!spaceId || typeof spaceId !== 'string') {
      throw new ValidationError('A space id is required to persist a chunk embedding.');
    }

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new ValidationError('A non-empty embedding array is required to persist a chunk embedding.');
    }

    if (!Number.isFinite(l2Norm)) {
      throw new ValidationError('A finite L2 norm is required to persist a chunk embedding.');
    }

    const result = await queryable.query(
      `
        INSERT INTO chunk_embeddings (chunk_id, document_id, space_id, embedding, l2_norm)
        SELECT c.id, c.document_id, $2, $3::vector, $4
        FROM chunks c
        WHERE c.id = $1
        ON CONFLICT (chunk_id, space_id)
        DO UPDATE SET
          embedding = EXCLUDED.embedding,
          l2_norm = EXCLUDED.l2_norm,
          updated_at = now()
        RETURNING chunk_id, document_id, space_id, l2_norm, created_at, updated_at
      `,
      [chunkId, spaceId, toSql(embedding), l2Norm]
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  async countChunksWithEmbedding(documentId, spaceId, { client = null } = {}) {
    const queryable = resolveQueryable(this.pool, client);

    if (queryable == null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await queryable.query(
      `
        SELECT COUNT(*)::int AS embedded_chunks
        FROM chunk_embeddings
        WHERE document_id = $1
          AND space_id = $2
      `,
      [documentId, spaceId]
    );

    return Number(result.rows[0]?.embedded_chunks ?? 0);
  }

  /**
   * Chunk ids for `documentId` that do not yet have a `chunk_embeddings` row in
   * `spaceId`. Used by the backfill runner to resume without re-embedding chunks
   * that are already stored.
   *
   * @returns {Promise<string[]>}
   */
  async findChunkIdsMissingEmbedding(documentId, spaceId, { client = null } = {}) {
    const queryable = resolveQueryable(this.pool, client);

    if (queryable == null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    if (!documentId) {
      throw new ValidationError('A document id is required to find missing chunk embeddings.');
    }

    if (!spaceId || typeof spaceId !== 'string') {
      throw new ValidationError('A space id is required to find missing chunk embeddings.');
    }

    const result = await queryable.query(
      `
        SELECT c.id AS chunk_id
        FROM chunks c
        LEFT JOIN chunk_embeddings ce
          ON ce.chunk_id = c.id
         AND ce.space_id = $2
        WHERE c.document_id = $1
          AND ce.chunk_id IS NULL
        ORDER BY c.chunk_index
      `,
      [documentId, spaceId]
    );

    return result.rows.map((row) => row.chunk_id);
  }

  async isDocumentFullyEmbedded(documentId, spaceId, { client = null } = {}) {
    const queryable = resolveQueryable(this.pool, client);

    if (queryable == null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    if (!documentId) {
      throw new ValidationError('A document id is required to check embedding completeness.');
    }

    if (!spaceId || typeof spaceId !== 'string') {
      throw new ValidationError('A space id is required to check embedding completeness.');
    }

    const result = await queryable.query(
      `
        SELECT
          COUNT(c.id)::int AS total_chunks,
          COUNT(ce.chunk_id)::int AS embedded_chunks
        FROM chunks c
        LEFT JOIN chunk_embeddings ce
          ON ce.chunk_id = c.id
         AND ce.space_id = $2
        WHERE c.document_id = $1
      `,
      [documentId, spaceId]
    );

    const row = result.rows[0] ?? { total_chunks: 0, embedded_chunks: 0 };
    const totalChunks = Number(row.total_chunks);
    const embeddedChunks = Number(row.embedded_chunks);
    const missingChunks = Math.max(totalChunks - embeddedChunks, 0);
    const complete = totalChunks === 0 ? embeddedChunks === 0 : missingChunks === 0;

    return {
      totalChunks,
      embeddedChunks,
      missingChunks,
      complete
    };
  }

  toRecord(row) {
    return {
      chunkId: row.chunk_id,
      documentId: row.document_id,
      spaceId: row.space_id,
      l2Norm: Number(row.l2_norm),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
