/**
 * Brings the database up to this release: applies the migrations of
 * packages/db/drizzle that it has not yet applied. `bin/varians migrate` and
 * `bin/varians serve` run the bundled build/scripts/migrate.js; in
 * development `pnpm db:migrate` does the same from source.
 *
 * MIGRATIONS_DIR overrides where the migrations are looked for.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv, redactUrl } from './env.ts';

function migrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  // @varians/db resolves to its src/index.ts; the migrations sit beside src.
  return fileURLToPath(new URL('../drizzle/', import.meta.resolve('@varians/db')));
}

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool, { casing: 'snake_case' }), { migrationsFolder: migrationsFolder() });
  console.log(`The database at ${redactUrl(url)} is up to date.`);
} catch (error) {
  console.error(`The migrations failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
