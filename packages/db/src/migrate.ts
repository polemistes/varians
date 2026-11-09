import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://varians@127.0.0.1:54329/varians_dev';
const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool, { casing: 'snake_case' });

await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
await pool.end();
console.log('migrated', url.replace(/:\/\/.*@/, '://***@'));
