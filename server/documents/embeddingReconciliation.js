import { DatabaseError, ValidationError } from '../errors.js';

/**
 * Read-only integrity checks for the versioned embedding store.
 *
 * These queries never write. They are intended to be used by a periodic
 * reconciliation job and by operators to answer two questions:
 *  1. Which `ready` documents are missing embeddings for a given space?
 *  2. Are there any `chunk_embeddings` rows whose chunk no longer exists?
 */
export class EmbeddingReconciliation {
  constructor(pool) {
    this.pool = pool;
  }

  async findReadyDocumentsMissingEmbeddings({ spaceId, limit = 100 } = {}) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    if (!spaceId || typeof spaceId !== 'string') {
      throw new ValidationError('spaceId is required to find documents missing embeddings.');
    }

    const result = await this.pool.query(
      `
        SELECT
          d.id AS document_id,
          COUNT(c.id)::int AS total_chunks,
          COUNT(ce.chunk_id)::int AS embedded_chunks
        FROM documents d
        JOIN chunks c ON c.document_id = d.id
        LEFT JOIN chunk_embeddings ce
          ON ce.chunk_id = c.id
         AND ce.space_id = $1
        WHERE d.status = 'ready'
        GROUP BY d.id
        HAVING COUNT(c.id) <> COUNT(ce.chunk_id)
        ORDER BY d.id
        LIMIT $2
      `,
      [spaceId, limit]
    );

    return result.rows.map((row) => ({
      documentId: row.document_id,
      totalChunks: Number(row.total_chunks),
      embeddedChunks: Number(row.embedded_chunks),
      missingChunks: Number(row.total_chunks) - Number(row.embedded_chunks)
    }));
  }

  /**
   * List the id and status of `ready` documents in keyset-paginated pages.
   *
   * This is the read-only enumeration primitive a dry-run backfill uses to walk
   * the eligible set in bounded batches without loading everything at once.
   * Pages are ordered by `id` and the caller passes the last id it saw as
   * `afterId`. It includes documents with zero chunks (they are trivially
   * complete) and never writes.
   *
   * @returns {Promise<Array<{ documentId: string, status: string }>>}
   */
  async listReadyDocuments({ limit = 100, afterId = null } = {}) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ValidationError('"limit" must be a positive integer.');
    }

    if (afterId !== null && (typeof afterId !== 'string' || afterId.length === 0)) {
      throw new ValidationError('"afterId" must be null or a non-empty document id.');
    }

    const result = await this.pool.query(
      `
        SELECT id, status
        FROM documents
        WHERE status = 'ready'
          AND ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id
        LIMIT $2
      `,
      [afterId, limit]
    );

    return result.rows.map((row) => ({ documentId: row.id, status: row.status }));
  }

  async countOrphanedChunkEmbeddings() {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT COUNT(*)::int AS orphaned
        FROM chunk_embeddings ce
        LEFT JOIN chunks c ON c.id = ce.chunk_id
        WHERE c.id IS NULL
      `
    );

    return Number(result.rows[0]?.orphaned ?? 0);
  }
}
