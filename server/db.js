import { Pool } from "pg";

let pool = null;

export function getPool() {
  if (pool) {
    return pool;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return null;
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  return pool;
}

export async function verifyDatabaseConnection() {
  console.log(
    "verifyDatabaseConnection DATABASE_URL:",
    process.env.DATABASE_URL ? "FOUND" : "MISSING"
  );

  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  try {
    await pool.query("SELECT 1");
    console.log("Neon database connection verified");
  } catch (err) {
    console.error("DATABASE ERROR:", err);
    throw err;
  }
}