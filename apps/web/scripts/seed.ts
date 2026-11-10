/**
 * Seeds a database for development. Idempotent: run it as often as you like.
 *
 *   pnpm --filter @varians/web seed
 *
 * Reads DATABASE_URL from the environment, else from apps/web/.env.
 */
import { fileURLToPath } from 'node:url';
import { newId } from '@varians/core';
import { createDatabase, eq, sql, users, type Database } from '@varians/db';
import { hashPassword } from '../src/lib/server/password.ts';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch {
    // No .env: DATABASE_URL must come from the environment.
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const ADMINISTRATOR = { email: 'test@example.com', name: 'Test User', password: 'password' };

async function seedAdministrator(db: Database): Promise<void> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, ADMINISTRATOR.email.toLowerCase()))
    .limit(1);
  if (existing) {
    console.log(`administrator exists: ${ADMINISTRATOR.email}`);
    return;
  }
  await db.insert(users).values({
    id: newId(),
    email: ADMINISTRATOR.email,
    name: ADMINISTRATOR.name,
    passwordHash: await hashPassword(ADMINISTRATOR.password),
    role: 'administrator',
  });
  console.log(
    `created administrator ${ADMINISTRATOR.email} (password "${ADMINISTRATOR.password}")`,
  );
}

// ---------------------------------------------------------------------------
// Works, witnesses and texts
//
// Milestone 2 onwards seeds the registry here: the opening of Iliad 1 with
// three witnesses that differ as an apparatus expects, a
// prose work on Stephanus pages, and a right-to-left sample. Look entries up
// by slug before inserting so that the script stays idempotent.
// ---------------------------------------------------------------------------
async function seedWorks(_db: Database): Promise<void> {
  // Nothing yet.
}

const { db, pool } = createDatabase(url);
try {
  await seedAdministrator(db);
  await seedWorks(db);
  console.log('seeded', url.replace(/:\/\/.*@/, '://***@'));
} finally {
  await pool.end();
}
