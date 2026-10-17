-- Migration: create embedding_backfill_progress (Voyage backfill progress)
-- Design source: docs/voyage-migration-stage-0-design.md
--   - §5.4 Resumable backfill (per-document progress rows)
--   - §6 Stage 3 (resumable backfill), AC-BACKFILL-1..5
--
-- Additive only: this migration creates a NEW table and does not ALTER or DROP
-- any existing table. Existing BGE vectors (chunks.embedding, 384-d) and Voyage
-- vectors (chunk_embeddings.embedding, 1024-d) are untouched. No rows are written
-- by this migration.
--
-- Assumptions recorded here (no existing-table behaviour is relied upon):
--   * `token_count` is the measured delta of Voyage
--     `getUsageSnapshot().totalTokens` across a document's latest attempt. It is
--     only trusted when every request in the attempt returned usage
--     (`tokens_available = true`); otherwise it is stored as 0 with
--     `tokens_available = false` rather than a fabricated estimate.
--   * Failed/interrupted attempts: `status` moves
--     pending -> in_progress -> (completed | failed). A crash leaves a row in
--     `in_progress`, which the runner treats as resumable and re-processes
--     (chunk writes are idempotent upserts on (chunk_id, space_id)).
--   * `last_error` must hold a sanitized reason only. API keys, document text,
--     and raw provider response bodies are never stored here (enforced by the
--     runner, not by this schema).
--   * `document_id ... ON DELETE CASCADE` means deleting a document removes its
--     progress row, so a deleted document cannot leave a permanently stale
--     "completed" record.

CREATE TABLE IF NOT EXISTS embedding_backfill_progress (
  space_id              text NOT NULL,
  document_id           uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'pending',
  expected_chunk_count  integer NOT NULL DEFAULT 0,
  completed_chunk_count integer NOT NULL DEFAULT 0,
  token_count           integer NOT NULL DEFAULT 0,
  tokens_available      boolean NOT NULL DEFAULT false,
  attempts              integer NOT NULL DEFAULT 0,
  last_error            text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, document_id),
  CONSTRAINT embedding_backfill_progress_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  CONSTRAINT embedding_backfill_progress_counts_check
    CHECK (
      expected_chunk_count >= 0
      AND completed_chunk_count >= 0
      AND token_count >= 0
      AND attempts >= 0
    )
);

-- Supports the runner's resume scan (list non-completed documents for a space)
-- and operational counts grouped by status. The primary key already covers
-- (space_id, document_id) lookups; this index adds the status predicate.
CREATE INDEX IF NOT EXISTS embedding_backfill_progress_status_idx
  ON embedding_backfill_progress (space_id, status);
