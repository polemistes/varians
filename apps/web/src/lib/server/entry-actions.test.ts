/**
 * What may be done with a work and a witness, as the server gives it: the
 * rights each list hands its rows, the reason a deletion is refused as the
 * page tells it, and the deletion that stays on a list.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { SCHEME_PRESETS, newId } from '@varians/core';
import {
  createDatabase,
  editionSigla,
  editions,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
  type Role,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import type { CurrentUser } from '$lib/types';
import { recordActions } from '$lib/strings/record-actions';
import { load as searchPage } from '../../routes/(public)/search/+page.server';
import { load as witnessPage } from '../../routes/(public)/witnesses/[slug]/+page.server';
import { load as workPage } from '../../routes/(public)/works/[slug]/+page.server';
import { actions as witnessEdit } from '../../routes/(app)/witnesses/[slug]/edit/+page.server';
import { actions as workEdit } from '../../routes/(app)/works/[slug]/edit/+page.server';
import { reportReading } from './conjectures';
import { addMaintainer, createWitness, createWork } from './registry';
import { resolveLabels, schemeOfWork } from './segments';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { publishEdition } from './publish.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const tag = newId().slice(-8).toLowerCase();
let db: Database;
let pool: pg.Pool;

function person(role: Role, name: string): CurrentUser {
  const id = newId();
  return {
    id,
    email: `${id}@entry.test`,
    name: `${name} ${tag}`,
    role,
    preferences: {} as CurrentUser['preferences'],
    termsVersion: 1,
  };
}

const creator = person('member', 'Creator');
const maintainer = person('member', 'Maintainer');
const siteEditor = person('editor', 'Site editor');
const stranger = person('member', 'Stranger');
const administrator = person('administrator', 'Administrator');
const drafter = person('member', 'Drafter');
const people = [creator, maintainer, siteEditor, stranger, administrator, drafter];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: any) => unknown;
type Outcome = { status: number; data?: Record<string, unknown>; location?: string };

/** Runs a load or a form action as `who`, as SvelteKit would; a thrown redirect or error is its status. */
async function run(
  handler: Handler | undefined,
  who: CurrentUser | null,
  options: { slug?: string; q?: string; fields?: Record<string, string> } = {},
): Promise<Outcome> {
  const body = new FormData();
  for (const [name, value] of Object.entries(options.fields ?? {})) body.append(name, value);
  const request = new Request('http://localhost/action', {
    method: options.fields ? 'POST' : 'GET',
    ...(options.fields ? { body } : {}),
  });
  const address = new URL('http://localhost/path');
  if (options.q) address.searchParams.set('q', options.q);
  try {
    const value = (await handler!({
      request,
      locals: { db, user: who },
      params: { slug: options.slug ?? '' },
      url: address,
    })) as Record<string, unknown> & { status?: number; data?: Record<string, unknown> };
    if (value && typeof value.status === 'number' && 'data' in value)
      return { status: value.status, data: value.data as Record<string, unknown> };
    return { status: 200, data: value ?? {} };
  } catch (cause) {
    if (isRedirect(cause)) return { status: cause.status, location: cause.location };
    const status = (cause as { status?: number }).status;
    if (typeof status === 'number') return { status };
    throw cause;
  }
}

const ids = { work: '', witness: '', scheme: newId(), draft: newId(), published: newId() };
let workSlug = '';
let witnessSlug = '';
const DRAFT_TITLE = `Secret draft ${tag}`;
const PUBLISHED_TITLE = `Open edition ${tag}`;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values(
    people.map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      passwordHash: 'x',
    })),
  );
  const work = await createWork(
    db,
    { title: `Entry work ${tag}`, scheme: { preset: SCHEME_PRESETS[0]!.name } },
    creator.id,
  );
  ids.work = work.id;
  workSlug = work.slug;
  const witness = await createWitness(
    db,
    { siglum: 'E', name: `Entry witness ${tag}` },
    creator.id,
  );
  ids.witness = witness.id;
  witnessSlug = witness.slug;
  const segment = (await resolveLabels(db, await schemeOfWork(db, work.id), ['1.1'])).get('1.1')!;
  await reportReading(
    db,
    {
      workId: work.id,
      segmentId: segment.id,
      witnessId: witness.id,
      lemma: 'arma',
      reading: 'armo',
    },
    creator.id,
  );
  await addMaintainer(db, 'work', work.id, maintainer.email);
  await addMaintainer(db, 'witness', witness.id, maintainer.email);

  const edition = (id: string, title: string) => ({
    id,
    workId: work.id,
    slug: `entry-${id}`,
    title,
    ownerId: drafter.id,
    conventions: DEFAULT_CONVENTIONS,
  });
  await db
    .insert(editions)
    .values([edition(ids.draft, DRAFT_TITLE), edition(ids.published, PUBLISHED_TITLE)]);
  // Both editions name the witness, so that it too is depended on.
  await db.insert(editionSigla).values(
    [ids.draft, ids.published].map((editionId, position) => ({
      editionId,
      witnessId: witness.id,
      transcriptionId: null,
      siglum: `S${position}`,
      position,
    })),
  );
  await publishEdition(db, ids.published, drafter.id);
});

afterAll(async () => {
  await db.delete(works).where(inArray(works.id, [ids.work].filter(Boolean)));
  await db.delete(witnesses).where(inArray(witnesses.id, [ids.witness].filter(Boolean)));
  await db.delete(editions).where(inArray(editions.id, [ids.draft, ids.published]));
  await db.delete(referenceSchemes).where(
    inArray(
      referenceSchemes.createdBy,
      people.map((p) => p.id),
    ),
  );
  await db.delete(users).where(
    inArray(
      users.id,
      people.map((p) => p.id),
    ),
  );
  await pool.end();
});

type Row = { id: string; slug: string; can: Record<string, boolean> };
const none = { maintain: false, merge: false, delete: false };
const rowRights = async (handler: 'works' | 'witnesses', who: CurrentUser | null) => {
  const found = (await run(searchPage, who, { q: tag })).data!;
  const row = (found[handler] as Row[]).find((r) =>
    handler === 'works' ? r.id === ids.work : r.id === ids.witness,
  );
  return row?.can;
};

describe('the rights a list gives each work', () => {
  it('by viewer: the creator and an administrator delete, a maintainer merges, a site editor only edits', async () => {
    const asAdmin = { maintain: true, merge: true, delete: true, administrator: true };
    expect(await rowRights('works', creator)).toEqual({ ...asAdmin, administrator: false });
    expect(await rowRights('works', administrator)).toEqual(asAdmin);
    expect(await rowRights('works', maintainer)).toEqual({
      maintain: true,
      merge: true,
      delete: false,
      administrator: false,
    });
    expect(await rowRights('works', siteEditor)).toEqual({
      maintain: true,
      merge: false,
      delete: false,
      administrator: false,
    });
    for (const who of [stranger, null])
      expect(await rowRights('works', who)).toEqual({ ...none, administrator: false });
  });

  it('never sends who added the work to the browser', async () => {
    const found = (await run(searchPage, administrator, { q: tag })).data!;
    expect(JSON.stringify(found.works)).not.toContain('"createdBy"');
  });
});

describe('the rights a list gives each witness', () => {
  it('by viewer', async () => {
    expect(await rowRights('witnesses', creator)).toEqual({
      maintain: true,
      merge: true,
      delete: true,
    });
    expect(await rowRights('witnesses', administrator)).toEqual({
      maintain: true,
      merge: true,
      delete: true,
    });
    expect(await rowRights('witnesses', maintainer)).toEqual({
      maintain: true,
      merge: true,
      delete: false,
    });
    expect(await rowRights('witnesses', siteEditor)).toEqual({
      maintain: true,
      merge: false,
      delete: false,
    });
    for (const who of [stranger, null]) expect(await rowRights('witnesses', who)).toEqual(none);
  });
});

describe('the rights the witness’s page gives each reported reading', () => {
  const rightsOf = async (who: CurrentUser | null) => {
    const readings = (await run(witnessPage, who, { slug: witnessSlug })).data!.readings as {
      can: Record<string, boolean>;
    }[];
    expect(readings).toHaveLength(1);
    return readings[0]!.can;
  };

  it('are the same as the work’s page gives: the owner edits and deletes, a maintainer of the work edits', async () => {
    expect(await rightsOf(creator)).toEqual({ edit: true, delete: true });
    expect(await rightsOf(administrator)).toEqual({ edit: true, delete: true });
    expect(await rightsOf(maintainer)).toEqual({ edit: true, delete: false });
    expect(await rightsOf(siteEditor)).toEqual({ edit: true, delete: false });
    for (const who of [stranger, null])
      expect(await rightsOf(who)).toEqual({ edit: false, delete: false });
  });
});

describe('the reason a work cannot be deleted, as its page tells it', () => {
  it('names the edition one may see and counts the draft one may not', async () => {
    const page = (await run(workPage, creator, { slug: workSlug })).data!;
    const reason = page.deletion as string;
    expect(reason).toContain(PUBLISHED_TITLE);
    expect(reason).toContain('another edition that is not published');
    expect(reason).not.toContain(DRAFT_TITLE);
    expect(reason).not.toContain(drafter.name);
    expect(JSON.stringify(page)).not.toContain(DRAFT_TITLE);
  });

  it('names both for an administrator, who may see every draft', async () => {
    const reason = (await run(workPage, administrator, { slug: workSlug })).data!
      .deletion as string;
    expect(reason).toContain(PUBLISHED_TITLE);
    expect(reason).toContain(DRAFT_TITLE);
  });

  it('is told to those who may delete, and to nobody else', async () => {
    for (const who of [maintainer, siteEditor, stranger, null])
      expect((await run(workPage, who, { slug: workSlug })).data!.deletion).toBeNull();
    expect((await run(workPage, maintainer, { slug: workSlug })).data!.rights).toMatchObject({
      delete: false,
    });
  });

  it('is the refusal of the deletion itself', async () => {
    const refused = await run(workEdit.delete, creator, { slug: workSlug, fields: { stay: '1' } });
    expect(refused.status).toBe(409);
    const said = String(refused.data!.error);
    expect(said).toContain(PUBLISHED_TITLE);
    expect(said).not.toContain(DRAFT_TITLE);
    expect(said).toContain('another edition that is not published');
  });
});

describe('the reason a witness cannot be deleted, as its page tells it', () => {
  it('names the edition one may see and counts the draft one may not', async () => {
    const reason = (await run(witnessPage, creator, { slug: witnessSlug })).data!
      .deletion as string;
    expect(reason).toContain(PUBLISHED_TITLE);
    expect(reason).toContain('another edition that is not published');
    expect(reason).not.toContain(DRAFT_TITLE);
  });

  it('is told to those who may delete, and to nobody else', async () => {
    expect((await run(witnessPage, administrator, { slug: witnessSlug })).data!.deletion).toContain(
      DRAFT_TITLE,
    );
    for (const who of [maintainer, stranger, null])
      expect((await run(witnessPage, who, { slug: witnessSlug })).data!.deletion).toBeNull();
  });

  it('is the refusal of the deletion itself', async () => {
    const refused = await run(witnessEdit.delete, creator, {
      slug: witnessSlug,
      fields: { stay: '1' },
    });
    expect(refused.status).toBe(409);
    expect(String(refused.data!.error)).not.toContain(DRAFT_TITLE);
  });
});

describe('deleting from a list and from the page', () => {
  it('stays on the list, and says so, for a work nothing depends on', async () => {
    await db.delete(editions).where(inArray(editions.id, [ids.draft, ids.published]));
    const gone = await createWork(
      db,
      { title: `Doomed work ${tag}`, scheme: { preset: SCHEME_PRESETS[0]!.name } },
      creator.id,
    );
    const deleted = await run(workEdit.delete, creator, {
      slug: gone.slug,
      fields: { stay: '1' },
    });
    expect(deleted).toMatchObject({
      status: 200,
      data: { message: recordActions.work.deleted(gone.title) },
    });
    expect(await db.select().from(works).where(eq(works.id, gone.id))).toEqual([]);
  });

  it('leads to the front page from the work’s own page', async () => {
    const gone = await createWork(
      db,
      { title: `Doomed too ${tag}`, scheme: { preset: SCHEME_PRESETS[0]!.name } },
      creator.id,
    );
    expect(await run(workEdit.delete, creator, { slug: gone.slug, fields: {} })).toEqual({
      status: 303,
      location: '/',
    });
  });

  it('refuses a maintainer who is not its creator', async () => {
    const refused = await run(workEdit.delete, maintainer, { slug: workSlug, fields: {} });
    expect(refused.status).toBe(403);
  });

  it('stays on the list for a witness, and leads to the front page from its own page', async () => {
    const make = (name: string) =>
      createWitness(db, { siglum: 'D', name: `${name} ${tag}` }, creator.id);
    const first = await make('Doomed witness');
    expect(
      await run(witnessEdit.delete, creator, { slug: first.slug, fields: { stay: '1' } }),
    ).toMatchObject({
      status: 200,
      data: { message: recordActions.witness.deleted(first.name) },
    });
    const second = await make('Doomed witness too');
    expect(await run(witnessEdit.delete, creator, { slug: second.slug, fields: {} })).toEqual({
      status: 303,
      location: '/',
    });
  });
});
