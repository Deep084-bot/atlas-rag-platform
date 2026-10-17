-- Migration: create chunk_embeddings (Voyage 1024-d embedding space)
-- Design source: docs/voyage-migration-stage-0-design.md
--   - §4 Recommendation (Design B: shared vector(1024) table)
--   - §5.1 Space registry, §5.5 Deletion/update propagation
--   - §6 Stage 1 (additive schema + index), AC-SCHEMA-1..4
--
-- Additive only: this migration creates a new table and does not ALTER or DROP
-- chunks.embedding, so the existing BGE (384-d) vectors are preserved untouched.
-- Nothing here has been applied to any database.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id    uuid NOT NULL REFERENCES chunks(id)    ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  space_id    text NOT NULL,
  embedding   vector(1024) NOT NULL,
  l2_norm     double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, space_id)
);

CREATE INDEX IF NOT EXISTS chunk_embeddings_doc_idx
  ON chunk_embeddings (document_id, space_id);

-- Partial HNSW index for the exact Voyage space only. The embedding column is
-- typed vector(1024) (fixed dimension), which is required for HNSW/IVFFlat.
-- The partial predicate keeps rows from any other 1024-d space out of this index;
-- queries must include `space_id = 'voyage-4-lite-query-document-l2-1024-v1'`
-- in their WHERE clause for the planner to use it.
CREATE INDEX IF NOT EXISTS chunk_embeddings_voyage_hnsw
  ON chunk_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE space_id = 'voyage-4-lite-query-document-l2-1024-v1';
