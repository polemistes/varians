import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@varians/db';
import journal from '@varians/db/journal';
import { EXPECTED_MIGRATION, databaseState, healthOf, migrationState } from './health';
import { VERSION } from '$lib/version';
import { GET } from '../../routes/health/+server';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const { db, pool } = createDatabase(url);

afterAll(async () => {
  await pool.end();
});

type Executor = Parameters<typeof databaseState>[0];

function fakeDb(execute: () => Promise<unknown>): Executor {
  return { execute } as unknown as Executor;
}

describe('the state of the migrations', () => {
  it('expects the newest migration of the journal', () => {
    expect(EXPECTED_MIGRATION).toBe(Math.max(...journal.entries.map((e) => e.when)));
  });

  it('is level, behind or ahead of this release', () => {
    expect(migrationState(EXPECTED_MIGRATION)).toBe('ok');
    expect(migrationState(EXPECTED_MIGRATION - 1)).toBe('behind');
    expect(migrationState(null)).toBe('behind');
    expect(migrationState(EXPECTED_MIGRATION + 1)).toBe('ahead');
  });
});

describe('the health of the installation', () => {
  it('is ok when the database is level or ahead, unavailable otherwise', () => {
    expect(healthOf('ok')).toEqual({ status: 'ok', version: VERSION, database: 'ok' });
    expect(healthOf('ahead').status).toBe('ok');
    expect(healthOf('behind').status).toBe('unavailable');
    expect(healthOf('unreachable').status).toBe('unavailable');
  });

  it('reads the migrated test database as level with this release', async () => {
    expect(await databaseState(db)).toBe('ok');
  });

  it('counts a database that fails or does not answer in time as unreachable', async () => {
    expect(await databaseState(fakeDb(() => Promise.reject(new Error('connection refused'))))).toBe(
      'unreachable',
    );
    expect(
      await databaseState(
        fakeDb(() => new Promise(() => undefined)),
        20,
      ),
    ).toBe('unreachable');
  });

  it('counts a database without the migrations table as behind', async () => {
    const missing = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    expect(await databaseState(fakeDb(() => Promise.reject(missing)))).toBe('behind');
    const wrapped = Object.assign(new Error('Failed query'), { cause: missing });
    expect(await databaseState(fakeDb(() => Promise.reject(wrapped)))).toBe('behind');
  });

  it('answers 200 with the version when healthy and 503 otherwise, never cached', async () => {
    const ok = await GET({ locals: { db } } as unknown as Parameters<typeof GET>[0]);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ status: 'ok', version: VERSION, database: 'ok' });

    const down = await GET({
      locals: {
        db: fakeDb(() =>
          Promise.reject(new Error('password authentication failed for user "varians"')),
        ),
      },
    } as unknown as Parameters<typeof GET>[0]);
    expect(down.status).toBe(503);
    const body = await down.json();
    expect(body).toEqual({ status: 'unavailable', version: VERSION, database: 'unreachable' });
    expect(JSON.stringify(body)).not.toContain('password');
  });
});
