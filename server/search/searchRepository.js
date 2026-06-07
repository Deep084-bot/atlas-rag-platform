import { toSql } from 'pgvector';

import { DatabaseError } from '../errors.js';

export class SearchRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async searchChunksByEmbedding(embedding, limit = 10) {
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
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector ASC, created_at ASC
        LIMIT $2
      `,
      [toSql(embedding), limit]
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

  async searchChunksByEmbeddingForUser({ userId, embedding, limit = 10 }) {
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
        ORDER BY chunks.embedding <=> $2::vector ASC, chunks.created_at ASC
        LIMIT $3
      `,
      [userId, toSql(embedding), limit]
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
}