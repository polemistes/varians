/**
 * The Drizzle client: one per process, from DATABASE_URL. Server-only.
 * The build imports the server's modules without a database, and the pool
 * connects only at the first query, so building needs no DATABASE_URL.
 */
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createDatabase, type Database } from '@varians/db';

const url = env.DATABASE_URL || (building ? 'postgres://localhost/building' : undefined);
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and point it at PostgreSQL.');
}

const created = createDatabase(url);

export const db: Database = created.db;
export const pool = created.pool;
export type { Database };
