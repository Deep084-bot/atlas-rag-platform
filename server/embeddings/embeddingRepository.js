import { toSql } from 'pgvector';

import { DatabaseError, ValidationError } from '../errors.js';

export class EmbeddingRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getChunksForDocument(documentId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, document_id, chunk_index, content, character_count, created_at
        FROM chunks
        WHERE document_id = $1
        ORDER BY chunk_index ASC, id ASC
      `,
      [documentId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      characterCount: Number(row.character_count),
      createdAt: row.created_at
    }));
  }

  async updateChunkEmbedding(chunkId, embedding, { spaceId = null, client = null } = {}) {
    const queryable = client ?? this.pool;

    if (queryable === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    if (!spaceId || typeof spaceId !== 'string') {
      throw new ValidationError('A space id is required to persist an embedding.');
    }

    const result = await queryable.query(
      `
        UPDATE chunks
        SET embedding = $2::vector,
            embedding_space_id = $3
        WHERE id = $1
        RETURNING id, document_id, chunk_index, content, character_count, embedding, embedding_space_id, created_at
      `,
      [chunkId, toSql(embedding), spaceId]
    );

    return result.rows[0] ?? null;
  }

  async countTotalChunks(documentId, { client = null } = {}) {
    const queryable = client ?? this.pool;

    if (queryable === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await queryable.query(
      `
        SELECT COUNT(*)::int AS total_chunks
        FROM chunks
        WHERE document_id = $1
      `,
      [documentId]
    );

    return Number(result.rows[0]?.total_chunks ?? 0);
  }

  async countEmbeddedChunks(documentId, {
    client = null,
    spaceId = null,
    includeLegacyUnknown = false
  } = {}) {
    const queryable = client ?? this.pool;

    if (queryable === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await queryable.query(
      `
        SELECT COUNT(*)::int AS embedded_chunks
        FROM chunks
        WHERE document_id = $1
          AND embedding IS NOT NULL
          AND (
            $2::text IS NULL
            OR embedding_space_id = $2
            OR ($3::boolean AND embedding_space_id IS NULL)
          )
      `,
      [documentId, spaceId, includeLegacyUnknown]
    );

    return Number(result.rows[0]?.embedded_chunks ?? 0);
  }
}
