-- Step 1 ownership migration
-- Add nullable ownership columns and supporting indexes without changing runtime behavior.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS user_id text;

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS documents_user_id_created_at_idx
  ON documents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_threads_user_id_updated_at_idx
  ON chat_threads (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS chat_threads_user_id_id_idx
  ON chat_threads (user_id, id);
