import "dotenv/config";
import app from "./app.js";
import { getPool } from "./db.js";
import { startReconcileScheduler } from "./documents/reconcileScheduler.js";

console.log(
  "DATABASE_URL:",
  process.env.DATABASE_URL ? "FOUND" : "MISSING"
);
console.log("HF_API_KEY:", process.env.HF_API_KEY ? "FOUND" : "MISSING");
console.log("EMBEDDING_PROVIDER:", process.env.EMBEDDING_PROVIDER);

const port = Number(process.env.PORT ?? 8787);

let reconcileScheduler = null;

const server = app.listen(port, () => {
  console.log(`Atlas API listening on http://localhost:${port}`);

  try {
    const pool = getPool();

    if (pool) {
      reconcileScheduler = startReconcileScheduler({
        pool,
        intervalMs: Number(process.env.RECONCILE_INTERVAL_MS) || undefined,
        timeoutMinutes: Number(process.env.RECONCILE_STUCK_MINUTES) || undefined
      });
    }
  } catch (err) {
    console.error('[reconcile] Failed to start:', err.message);
  }
});

function shutdown(signal) {
  console.log('[atlas] %s received, shutting down gracefully', signal);

  if (reconcileScheduler) {
    reconcileScheduler.stop();
    reconcileScheduler = null;
  }

  server.close(() => {
    console.log('[atlas] HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[atlas] forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[atlas] Unhandled Rejection:', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (error) => {
  console.error('[atlas] Uncaught Exception:', error.stack);
  process.exit(1);
});
