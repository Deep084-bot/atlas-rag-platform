ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

WITH document_stats AS (
  SELECT
    d.id,
    COALESCE(chunk_stats.total_chunks, 0) AS total_chunks,
    COALESCE(chunk_stats.embedded_chunks, 0) AS embedded_chunks
  FROM documents d
  LEFT JOIN (
    SELECT
      document_id,
      COUNT(*)::int AS total_chunks,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded_chunks
    FROM chunks
    GROUP BY document_id
  ) AS chunk_stats ON chunk_stats.document_id = d.id
)
UPDATE documents d
SET
  status = CASE
    WHEN document_stats.total_chunks = 0 THEN COALESCE(d.status, 'uploaded')
    WHEN document_stats.embedded_chunks = 0 THEN 'chunking'
    WHEN document_stats.embedded_chunks < document_stats.total_chunks THEN 'embedding'
    ELSE 'ready'
  END,
  progress = CASE
    WHEN document_stats.total_chunks = 0 THEN COALESCE(d.progress, 10)
    WHEN document_stats.embedded_chunks = 0 THEN 60
    WHEN document_stats.embedded_chunks < document_stats.total_chunks THEN 90
    ELSE 100
  END,
  processing_started_at = CASE
    WHEN document_stats.total_chunks > 0 THEN COALESCE(d.processing_started_at, d.created_at)
    ELSE d.processing_started_at
  END,
  ready_at = CASE
    WHEN document_stats.total_chunks > 0 AND document_stats.embedded_chunks = document_stats.total_chunks THEN COALESCE(d.ready_at, d.updated_at, d.created_at)
    ELSE d.ready_at
  END
FROM document_stats
WHERE document_stats.id = d.id;

UPDATE documents
SET status = COALESCE(status, 'uploaded'),
    progress = COALESCE(progress, 0)
WHERE status IS NULL;

ALTER TABLE documents
  ALTER COLUMN status SET DEFAULT 'uploaded',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN progress SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_status_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_status_check
      CHECK (status IN ('uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_progress_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_progress_check
      CHECK (progress >= 0 AND progress <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS documents_status_idx ON documents (status);
