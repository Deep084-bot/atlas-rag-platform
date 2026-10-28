import { toSql } from 'pgvector';

import { DatabaseError } from '../errors.js';

export class SearchRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async searchChunksByEmbedding(embedding, limit = 10, { spaceId = null, includeLegacyUnknown = false } = {}) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT
          chunks.id,
          chunks.document_id,
          documents.file_name,
          chunks.chunk_index,
          chunks.content,
          1 - (chunks.embedding <=> $1::vector) AS similarity
        FROM chunks
        INNER JOIN documents
          ON documents.id = chunks.document_id
        WHERE chunks.embedding IS NOT NULL
          AND (
            $3::text IS NULL
            OR chunks.embedding_space_id = $3
            OR ($4::boolean AND chunks.embedding_space_id IS NULL)
          )
        ORDER BY chunks.embedding <=> $1::vector ASC, chunks.created_at ASC
        LIMIT $2
      `,
      [toSql(embedding), limit, spaceId, includeLegacyUnknown]
    );

    return result.rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      fileName: row.file_name,
      chunkIndex: Number(row.chunk_index),
      similarity: Number(row.similarity),
      chunkText: row.content
    }));
  }

  async searchChunksByEmbeddingForUser({
    userId,
    embedding,
    limit = 10,
    conversationId,
    spaceId = null,
    includeLegacyUnknown = false
  }) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT
        chunks.id,
        chunks.document_id,
        documents.file_name,
        chunks.chunk_index,
        chunks.content,
        1 - (chunks.embedding <=> $2::vector) AS similarity
        FROM chunks
        INNER JOIN documents ON documents.id = chunks.document_id
        WHERE chunks.embedding IS NOT NULL
          AND documents.user_id = $1
          AND ($4::uuid IS NULL OR chunks.document_id IN (
            SELECT document_id FROM conversation_documents
            WHERE conversation_id = $4::uuid
          ))
          AND (
            $5::text IS NULL
            OR chunks.embedding_space_id = $5
            OR ($6::boolean AND chunks.embedding_space_id IS NULL)
          )
        ORDER BY chunks.embedding <=> $2::vector ASC, chunks.created_at ASC
        LIMIT $3
      `,
      [userId, toSql(embedding), limit, conversationId ?? null, spaceId, includeLegacyUnknown]
    );

    return result.rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      fileName: row.file_name,
      chunkIndex: Number(row.chunk_index),
      similarity: Number(row.similarity),
      chunkText: row.content
    }));
  }

  async summarizeIncompatibleEmbeddings({ spaceId, includeLegacyUnknown = false } = {}) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    if (typeof spaceId !== 'string' || spaceId.length === 0) {
      throw new DatabaseError('An embedding space id is required to check retrieval compatibility.');
    }

    const result = await this.pool.query(
      `
        SELECT
          COALESCE(embedding_space_id, 'legacy-unknown') AS embedding_space,
          COUNT(*)::int AS chunk_count
        FROM chunks
        WHERE embedding IS NOT NULL
          AND embedding_space_id IS DISTINCT FROM $1::text
          AND ($2::boolean = false OR embedding_space_id IS NOT NULL)
        GROUP BY 1
        ORDER BY 1
      `,
      [spaceId, includeLegacyUnknown]
    );

    const spaces = result.rows.map((row) => ({
      spaceId: row.embedding_space,
      chunkCount: Number(row.chunk_count)
    }));

    return {
      total: spaces.reduce((sum, entry) => sum + entry.chunkCount, 0),
      spaces
    };
  }
}
