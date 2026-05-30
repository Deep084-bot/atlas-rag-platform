import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

export const pool =
  databaseUrl === undefined
    ? null
    : new Pool({
        connectionString: databaseUrl,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
