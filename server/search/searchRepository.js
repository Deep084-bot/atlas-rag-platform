import { toSql } from 'pgvector';

export class SearchRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async searchChunksByEmbedding(embedding, limit = 10) {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT
          id,
          document_id,
          chunk_index,
          content,
          1 - (embedding <=> $1::vector) AS similarity
        FROM chunks
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector ASC, created_at ASC
        LIMIT $2
      `,
      [toSql(embedding), limit]
    );

    return result.rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      chunkIndex: Number(row.chunk_index),
      similarity: Number(row.similarity),
      chunkText: row.content
    }));
  }
}