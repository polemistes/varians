/**
 * The state of the installation for /health: whether the database answers,
 * and whether its migrations are those this release expects. Drizzle records
 * each applied migration with the time stamp of its journal entry, and
 * applies those newer than the newest recorded; the same comparison tells
 * whether the database is behind this release (migrations to run), level
 * with it, or ahead of it (an earlier release running on a newer database,
 * which is allowed, since migrations only add).
 */
import journal from '@varians/db/journal';
import { sql, type Database } from '@varians/db';
import { VERSION } from '$lib/version';

export type DatabaseState = 'ok' | 'ahead' | 'behind' | 'unreachable';

export interface Health {
  status: 'ok' | 'unavailable';
  version: string;
  database: DatabaseState;
}

/** The time stamp of the newest migration this release carries. */
export const EXPECTED_MIGRATION: number = Math.max(
  0,
  ...journal.entries.map((entry) => entry.when),
);

/** Compares the newest applied migration with the newest known one. Pure. */
export function migrationState(
  applied: number | null,
  expected = EXPECTED_MIGRATION,
): Exclude<DatabaseState, 'unreachable'> {
  if (applied === null || applied < expected) return 'behind';
  return applied > expected ? 'ahead' : 'ok';
}

/** The answer of /health from the database's state. Pure. */
export function healthOf(database: DatabaseState, version = VERSION): Health {
  return {
    status: database === 'ok' || database === 'ahead' ? 'ok' : 'unavailable',
    version,
    database,
  };
}

/** How long the database may take to answer before it counts as unreachable. */
export const HEALTH_TIMEOUT_MS = 3000;

/** Asks the database for its newest applied migration; never throws. */
export async function databaseState(
  db: Pick<Database, 'execute'>,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<DatabaseState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const query = db
      .execute(sql`select max(created_at)::bigint as applied from drizzle.__drizzle_migrations`)
      .then((result) => {
        const value = (result.rows[0] as { applied?: string | number | null } | undefined)?.applied;
        return migrationState(value === null || value === undefined ? null : Number(value));
      });
    const state = await Promise.race([query, timeout]);
    // A query that finishes after the timeout must not reject unobserved.
    query.catch(() => undefined);
    return state === 'timeout' ? 'unreachable' : state;
  } catch (error) {
    // The table is missing when no migration has run yet.
    const code =
      (error as { code?: string; cause?: { code?: string } }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (code === '42P01') return 'behind';
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}
