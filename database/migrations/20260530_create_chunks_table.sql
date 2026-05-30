CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  character_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE chunks
ADD COLUMN embedding vector(384);