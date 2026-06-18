CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  storage_path text,
  extracted_text text,
  source_type text NOT NULL DEFAULT 'upload',
  status text NOT NULL DEFAULT 'uploaded',
  progress integer NOT NULL DEFAULT 0,
  failure_reason text,
  ocr_quality double precision,
  processing_started_at timestamptz,
  ready_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('uploaded', 'extracting', 'ocr', 'chunking', 'embedding', 'ready', 'failed'));

ALTER TABLE documents
  ADD CONSTRAINT documents_progress_check
  CHECK (progress >= 0 AND progress <= 100);

CREATE INDEX IF NOT EXISTS documents_status_idx ON documents (status);

CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  character_count integer NOT NULL,
  embedding vector(384),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS chunks_created_at_idx ON chunks (created_at DESC);
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);

-- Conversation tables are retained in schema form for future generation-layer conversation storage.
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  title text NOT NULL DEFAULT 'Untitled thread',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_id_idx ON chat_messages (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_documents (
  conversation_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, document_id)
);

CREATE INDEX IF NOT EXISTS cd_conversation_id_idx ON conversation_documents (conversation_id);
CREATE INDEX IF NOT EXISTS cd_document_id_idx ON conversation_documents (document_id);
