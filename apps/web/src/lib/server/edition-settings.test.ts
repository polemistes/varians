/**
 * What Edition Settings does to an edition's apparatus conventions: the
 * words for the other witnesses and for all of them, through the page's own
 * form action.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId } from '@varians/core';
import {
  createDatabase,
  editions,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import type { CurrentUser } from '$lib/types';
import { actions as settingsActions } from '../../routes/(app)/editions/[slug]/settings/+page.server';
import { editionView, type Audience } from './reader.ts';
import { seedSample, type SampleResult } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

const owner: CurrentUser = {
  id: userId,
  email: `${userId}@test`,
  name: 'Editor',
  role: 'member',
  preferences: {} as CurrentUser['preferences'],
  termsVersion: 1,
};
const audience: Audience = { kind: 'editor', viewer: { id: userId, role: 'member' } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (event: any) => unknown;
type Result = { status?: number; data?: Record<string, unknown>; ok?: boolean; message?: string };

/** Runs a form action as the owner with these fields, as SvelteKit would. */
function run(
  action: Action | undefined,
  slug: string,
  fields: Record<string, string>,
): Promise<Result> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  const request = new Request('http://localhost/action', { method: 'POST', body });
  return Promise.resolve(
    action!({ request, locals: { db, user: owner }, params: { slug } }),
  ) as Promise<Result>;
}

/** The fields the settings form always sends. */
const form = (extra: Record<string, string> = {}): Record<string, string> => ({
  title: 'The Iliad, book 1',
  preface: '',
  sources: '',
  rightsNote: '',
  lineation: 'verse',
  numberEvery: '5',
  apparatus: 'positive',
  interpretative: 'separate',
  speakerDisplay: 'margin',
  ...extra,
});

async function clean(): Promise<void> {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

let sample: SampleResult;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' });
  sample = await seedSample(db, userId);
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

const conventionsOf = async () =>
  (await db.select().from(editions).where(eq(editions.id, sample.editionId)))[0]!.conventions;

describe('the words for the other witnesses and for all of them', () => {
  it('are none for an edition made without them', async () => {
    const conventions = await conventionsOf();
    expect(conventions.rest).toBeUndefined();
    expect(conventions.all).toBeUndefined();
  });

  it('are saved by the settings and read back by the view', async () => {
    const saved = await run(
      settingsActions.save,
      sample.editionSlug,
      form({ rest: 'rell.', all: 'codd.' }),
    );
    expect(saved).toMatchObject({ ok: true });
    expect(await conventionsOf()).toMatchObject({ rest: 'rell.', all: 'codd.' });
    const view = await editionView(db, sample.editionId, null, audience);
    expect(view.apparatus).toMatchObject({ rest: 'rell.', all: 'codd.' });
    expect(view.edition.conventions).toMatchObject({ rest: 'rell.', all: 'codd.' });
  });

  it('go back to none, which stores nothing', async () => {
    await run(settingsActions.save, sample.editionSlug, form({ rest: 'cett.', all: 'codd.' }));
    await run(settingsActions.save, sample.editionSlug, form({ rest: '', all: '' }));
    const conventions = await conventionsOf();
    expect('rest' in conventions).toBe(false);
    expect('all' in conventions).toBe(false);
    const view = await editionView(db, sample.editionId, null, audience);
    expect(view.apparatus.rest).toBeUndefined();
    expect(view.apparatus.all).toBeUndefined();
  });

  it('are refused when they are none of the offered words, and a form without them leaves them', async () => {
    await run(settingsActions.save, sample.editionSlug, form({ rest: 'cett.', all: 'codd.' }));
    const refused = await run(settingsActions.save, sample.editionSlug, form({ rest: 'ceteri' }));
    expect(refused.status).toBe(400);
    expect(await conventionsOf()).toMatchObject({ rest: 'cett.', all: 'codd.' });
    await run(settingsActions.save, sample.editionSlug, form({ numberEvery: '10' }));
    expect(await conventionsOf()).toMatchObject({ rest: 'cett.', all: 'codd.', numberEvery: 10 });
    await run(settingsActions.save, sample.editionSlug, form({ rest: '', all: '' }));
  });
});

describe('an edition stored with the setting for Latin abbreviations, which editions no longer have', () => {
  /** The row as an edition made before had it. */
  async function storeLatin(latin: boolean): Promise<void> {
    const old = { ...(await conventionsOf()), latin };
    await db.update(editions).set({ conventions: old }).where(eq(editions.id, sample.editionId));
  }
  /** What the print apparatus says at 1.6, where two witnesses are without the words the others have. */
  async function printedAtSix(): Promise<string[]> {
    const view = await editionView(db, sample.editionId, null, audience);
    return Object.values(view.segments)
      .flatMap((p) => p.entries)
      .filter((e) => e.label === '1.6')
      .map((e) => formatEntry(e, view.apparatus));
  }

  it('loads, and prints in English words whatever the stored member says', async () => {
    for (const latin of [true, false]) {
      await storeLatin(latin);
      const view = await editionView(db, sample.editionId, null, audience);
      expect(view.apparatus).not.toHaveProperty('latin');
      expect(await printedAtSix()).toEqual(['1.6 ἐξ … ἐρίσαντε A : omitted B C']);
    }
  });

  it('saves without error and drops the member, keeping every other convention', async () => {
    await storeLatin(true);
    await run(settingsActions.save, sample.editionSlug, form({ rest: 'cett.', all: 'codd.' }));
    await storeLatin(true);
    const saved = await run(settingsActions.save, sample.editionSlug, form({ numberEvery: '10' }));
    expect(saved).toMatchObject({ ok: true });
    const conventions = await conventionsOf();
    expect(conventions).not.toHaveProperty('latin');
    expect(conventions).toMatchObject({
      apparatus: 'positive',
      lineation: 'verse',
      numberEvery: 10,
      rest: 'cett.',
      all: 'codd.',
    });
    await run(settingsActions.save, sample.editionSlug, form({ rest: '', all: '' }));
  });

  it('is saved by a page that still sends the setting, which is ignored', async () => {
    await storeLatin(false);
    const saved = await run(settingsActions.save, sample.editionSlug, form({ latin: 'on' }));
    expect(saved).toMatchObject({ ok: true });
    expect(await conventionsOf()).not.toHaveProperty('latin');
    expect(await printedAtSix()).toEqual(['1.6 ἐξ … ἐρίσαντε A : omitted B C']);
  });
});
