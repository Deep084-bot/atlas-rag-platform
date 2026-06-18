import "dotenv/config";
import app from "./app.js";
import { getPool } from "./db.js";
import { reconcileStuckDocuments } from "./documents/reconcileStuckDocuments.js";

console.log(
  "DATABASE_URL:",
  process.env.DATABASE_URL ? "FOUND" : "MISSING"
);
console.log("HF_API_KEY:", process.env.HF_API_KEY ? "FOUND" : "MISSING");
console.log("EMBEDDING_PROVIDER:", process.env.EMBEDDING_PROVIDER);

const port = Number(process.env.PORT ?? 8787);

const server = app.listen(port, async () => {
  console.log(`Atlas API listening on http://localhost:${port}`);

  try {
    const pool = getPool();
    if (pool) await reconcileStuckDocuments(pool);
  } catch (err) {
    console.error('[reconcile] Failed:', err.message);
  }
});

function shutdown(signal) {
  console.log('[atlas] %s received, shutting down gracefully', signal);
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
