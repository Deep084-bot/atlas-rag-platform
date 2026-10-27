-- Migration: persist document attachment metadata on user messages
-- Stores a snapshot of the documents sent with each user message so history
-- renders the same metadata after reload, independent of later detachments.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
