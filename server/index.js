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

app.listen(port, async () => {
  console.log(`Atlas API listening on http://localhost:${port}`);

  try {
    const pool = getPool();
    if (pool) await reconcileStuckDocuments(pool);
  } catch (err) {
    console.error('[reconcile] Failed:', err.message);
  }
});