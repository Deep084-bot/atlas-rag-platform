import { Pool } from "pg";

import { DatabaseError } from './errors.js';

let pool = null;

export function getPool() {
  if (pool) {
    return pool;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return null;
  }

  const useSsl = process.env.DATABASE_SSL !== 'false';

  pool = new Pool({
    connectionString: databaseUrl,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  return pool;
}

import { sanitizeServerLogDetail } from './security/sanitize.js';

export async function verifyDatabaseConnection() {
  const pool = getPool();

  if (!pool) {
    throw new DatabaseError("DATABASE_URL is not configured.");
  }

  try {
    await pool.query("SELECT 1");
    console.log("Neon database connection verified");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err ?? '');
    console.error("DATABASE ERROR:", sanitizeServerLogDetail(detail));
    throw err;
  }
}