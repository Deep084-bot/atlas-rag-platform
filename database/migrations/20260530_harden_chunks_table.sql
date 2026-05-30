-- Hardening migration for the active chunks table.
-- Assumption: no duplicate (document_id, chunk_index) rows exist before this migration runs.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE chunks
  ADD CONSTRAINT chunks_document_id_chunk_index_key UNIQUE (document_id, chunk_index);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS chunks_created_at_idx ON chunks (created_at DESC);
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);
