import { DatabaseError, ValidationError } from '../errors.js';

/**
 * Row-level lock used to serialize every mutation of a document's chunk set.
 *
 * A document is the coordination point for the backfill protocol: chunk
 * replacement, backfill completion, and document deletion all take the same
 * `documents` row lock first. Because the lock is transaction-scoped, it is
 * held until the surrounding transaction commits or rolls back, so the two
 * operations can never interleave inside their critical sections.
 *
 * Lock ordering is always "document row first, then child rows
 * (chunks / chunk_embeddings / embedding_backfill_progress)" to avoid deadlocks
 * between competing writers.
 */
export async function lockDocumentForUpdate(queryable, documentId) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new DatabaseError('A database client is required to lock a document.');
  }

  if (!documentId) {
    throw new ValidationError('A document id is required to lock a document.');
  }

  const result = await queryable.query(
    'SELECT id FROM documents WHERE id = $1 FOR UPDATE',
    [documentId]
  );

  return result.rows.length > 0;
}
