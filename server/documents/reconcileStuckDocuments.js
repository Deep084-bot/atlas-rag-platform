export async function reconcileStuckDocuments(pool, timeoutMinutes = 30) {
  const result = await pool.query(
    `UPDATE documents
     SET status = 'failed',
         failure_reason = 'Processing was interrupted. Please re-upload the document.',
         failed_at = NOW(),
         updated_at = NOW()
     WHERE status IN ($1, $2, $3, $4)
       AND (
         processing_started_at IS NULL
         OR processing_started_at < NOW() - $5::integer * INTERVAL '1 minute'
       )
     RETURNING id, status`,
    ['extracting', 'ocr', 'chunking', 'embedding', timeoutMinutes]
  );

  if (result.rowCount > 0) {
    console.log(
      `[reconcile] Marked ${result.rowCount} stuck document(s) as failed:`,
      result.rows.map((r) => `${r.id} (was ${r.status})`).join(', ')
    );
  }

  return result.rowCount;
}
