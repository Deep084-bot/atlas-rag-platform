-- Additive provenance migration for EXISTING databases (column only).
-- Apply this before deploying code that reads/writes embedding_space_id.
-- Create the index separately with CREATE INDEX CONCURRENTLY outside a
-- transaction on large production tables (see the companion migration/runbook).

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedding_space_id text;

COMMENT ON COLUMN chunks.embedding_space_id IS
  'Embedding space that produced chunks.embedding. NULL means legacy/unknown provenance and must not be treated as a hosted or local vector without evidence.';
