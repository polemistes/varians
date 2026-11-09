/**
 * The Drizzle client: one per process, from DATABASE_URL. Server-only.
 */
import { env } from '$env/dynamic/private';
import { createDatabase, type Database } from '@varians/db';

const url = env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and point it at PostgreSQL.');
}

const created = createDatabase(url);

export const db: Database = created.db;
export const pool = created.pool;
export type { Database };
