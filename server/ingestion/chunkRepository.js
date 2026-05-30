import { randomUUID } from 'node:crypto';

import { DatabaseError } from '../errors.js';

export class ChunkRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async replaceDocumentChunks(documentId, chunks) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);

      const insertedChunks = [];

      for (const chunk of chunks) {
        const result = await client.query(
          `
            INSERT INTO chunks (
              id,
              document_id,
              chunk_index,
              content,
              character_count
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING id, document_id, chunk_index, content, character_count, created_at
          `,
          [randomUUID(), documentId, chunk.chunkIndex, chunk.content, chunk.characterCount]
        );

        insertedChunks.push(this.toChunkRecord(result.rows[0]));
      }

      await client.query('COMMIT');
      return insertedChunks;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listDocumentChunks(documentId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, document_id, chunk_index, content, character_count, created_at
        FROM chunks
        WHERE document_id = $1
        ORDER BY chunk_index ASC, created_at ASC
      `,
      [documentId]
    );

    return result.rows.map((row) => this.toChunkRecord(row));
  }

  toChunkRecord(row) {
    return {
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      characterCount: Number(row.character_count),
      createdAt: row.created_at
    };
  }
}
