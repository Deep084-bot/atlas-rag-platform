-- Build the provenance index with CREATE INDEX CONCURRENTLY.
-- Run this OUTSIDE a transaction (e.g. psql --single-transaction? No; run directly).
-- On a busy table this avoids long locks; if it fails partway, a failed
-- CONCURRENTLY build leaves an INVALID index (see pg_index.indisvalid) that
-- must be dropped before retrying.
-- The plain index is still created by 20261027_add_chunk_embedding_space.sql
-- for disposable/test databases if needed, but prefer this path in production.

CREATE INDEX CONCURRENTLY IF NOT EXISTS chunks_embedding_space_idx
  ON chunks (embedding_space_id);
