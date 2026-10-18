import { randomUUID } from 'node:crypto';

import { DatabaseError } from '../errors.js';
import { lockDocumentForUpdate } from '../documents/documentLock.js';
import { applyTransactionTimeouts } from '../db/transactionTimeouts.js';

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

      // Bound the lock wait and the statements in this transaction. The document
      // row lock is held only for the short replacement, so a wedged holder must
      // not be allowed to pin this connection indefinitely.
      await applyTransactionTimeouts(client);

      // Serialize with any concurrent backfill completion or document deletion
      // for the same document. If the document is already gone there is nothing
      // to replace; roll back cleanly and report that no chunks were written.
      const locked = await lockDocumentForUpdate(client, documentId);

      if (!locked) {
        await client.query('ROLLBACK');
        return [];
      }

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

      // The chunk set changed, so every embedding space's recorded progress for
      // this document is now stale. Dropping the rows in the same transaction
      // guarantees a completed status can never survive a replacement.
      await client.query(
        'DELETE FROM embedding_backfill_progress WHERE document_id = $1',
        [documentId]
      );

      // A `ready` document must never keep that status against a brand-new chunk
      // set. Move it back into `embedding` inside the same transaction (we already
      // hold its row lock), so readiness is only ever republished by the
      // orchestrator after authoritative completeness verification. The status
      // transition and the new chunks commit atomically — there is no window in
      // which a committed `ready` document has unembedded chunks.
      await client.query(
        `
          UPDATE documents
          SET status = 'embedding',
              progress = LEAST(progress, 90),
              updated_at = now()
          WHERE id = $1
            AND status = 'ready'
        `,
        [documentId]
      );

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
