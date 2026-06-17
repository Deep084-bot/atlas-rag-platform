-- Migration: Add conversation_documents junction table
-- Conversation-scoped document retrieval

CREATE TABLE IF NOT EXISTS conversation_documents (
  conversation_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, document_id)
);

CREATE INDEX IF NOT EXISTS cd_conversation_id_idx ON conversation_documents (conversation_id);
CREATE INDEX IF NOT EXISTS cd_document_id_idx ON conversation_documents (document_id);
