export const PROCESSING_STATUSES = ['extracting', 'ocr', 'chunking', 'embedding'];

const RECONCILE_FAILURE_REASON = 'Processing was interrupted. Please re-upload the document.';

export async function reconcileStuckDocuments(pool, timeoutMinutes = 30) {
  const result = await pool.query(
    `UPDATE documents
     SET status = 'failed',
         failure_reason = $1,
         failed_at = NOW(),
         updated_at = NOW()
     WHERE (
         status IN ($3, $4, $5, $6)
         AND (
           processing_started_at IS NULL
           OR processing_started_at < NOW() - ($2::integer * INTERVAL '1 minute')
         )
       )
       OR (
         status = $7
         AND created_at < NOW() - ($2::integer * INTERVAL '1 minute')
       )
     RETURNING id, status`,
    [
      RECONCILE_FAILURE_REASON,
      timeoutMinutes,
      ...PROCESSING_STATUSES,
      'uploaded'
    ]
  );

  if (result.rowCount > 0) {
    console.log(
      `[reconcile] Marked ${result.rowCount} stuck document(s) as failed:`,
      result.rows.map((row) => `${row.id} (was ${row.status})`).join(', ')
    );
  }

  return result.rowCount;
}
