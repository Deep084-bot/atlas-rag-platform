import { toSql } from 'pgvector';

export class EmbeddingRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getChunksForDocument(documentId) {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
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

  async updateChunkEmbedding(chunkId, embedding) {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        UPDATE chunks
        SET embedding = $2::vector
        WHERE id = $1
        RETURNING id, document_id, chunk_index, content, character_count, embedding, created_at
      `,
      [chunkId, toSql(embedding)]
    );

    return result.rows[0] ?? null;
  }

  async countTotalChunks(documentId) {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT COUNT(*)::int AS total_chunks
        FROM chunks
        WHERE document_id = $1
      `,
      [documentId]
    );

    return Number(result.rows[0]?.total_chunks ?? 0);
  }

  async countEmbeddedChunks(documentId) {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT COUNT(*)::int AS embedded_chunks
        FROM chunks
        WHERE document_id = $1
          AND embedding IS NOT NULL
      `,
      [documentId]
    );

    return Number(result.rows[0]?.embedded_chunks ?? 0);
  }
}
