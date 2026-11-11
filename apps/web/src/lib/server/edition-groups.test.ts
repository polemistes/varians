/**
 * The family sigla of an edition through the conspectus dialog's form action:
 * stored with their note, kept true when the conspectus changes, refused when
 * they cannot be kept, and printed by the apparatus as the core prints them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId } from '@varians/core';
import {
  createDatabase,
  editionSigla,
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
import { actions } from '../../routes/(app)/editions/[slug]/edit/+page.server';
import { editionView, type Audience } from './reader.ts';
import { parseDescription, removePage, seedPage, type PageSeedResult } from './seed/page.ts';
import { seedSample, type SampleResult } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const PAGE = 'edition-groups-page';
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
type Result = { status?: number; data?: Record<string, unknown>; ok?: boolean };

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

/** The conspectus as the dialog sends it back. */
async function conspectusOf(editionId: string) {
  const rows = await db
    .select()
    .from(editionSigla)
    .where(eq(editionSigla.editionId, editionId))
    .orderBy(editionSigla.position);
  return rows.map((r) => ({
    witnessId: r.witnessId,
    transcriptionId: r.transcriptionId,
    siglum: r.siglum,
    states: r.states,
    variantSiglum: r.variantSiglum,
  }));
}

type Entry = Awaited<ReturnType<typeof conspectusOf>>[number];

const conventionsOf = async (editionId: string) =>
  (await db.select().from(editions).where(eq(editions.id, editionId)))[0]!.conventions;

const printed = async (editionId: string) => {
  const view = await editionView(db, editionId, null, audience);
  return Object.values(view.segments).flatMap((segment) =>
    segment.entries.map((entry) => formatEntry(entry, view.apparatus)),
  );
};

async function clean(): Promise<void> {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await removePage(db, PAGE);
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' });
});

afterAll(async () => {
  await clean();
  await removePage(db, PAGE);
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('the family sigla of the sample edition', () => {
  let sample: SampleResult;
  let original: Entry[];
  const conventions = () => conventionsOf(sample.editionId);
  const witnessesOf = (...sigla: string[]) =>
    original.filter((e) => sigla.includes(e.siglum)).map((e) => e.witnessId);
  const saveSigla = (entries: Entry[], groups?: unknown) =>
    run(actions.sigla, sample.editionSlug, {
      sigla: JSON.stringify(entries),
      ...(groups === undefined ? {} : { groups: JSON.stringify(groups) }),
    });

  beforeAll(async () => {
    sample = await seedSample(db, userId);
    original = await conspectusOf(sample.editionId);
  });

  /** Back to the conspectus the sample has, with no group. */
  async function reset() {
    await saveSigla(original, []);
    expect((await conventions()).groups).toBeUndefined();
  }

  it('are stored with their note by the sigla of their members, and the view carries them', async () => {
    const saved = await saveSigla(original, [
      { siglum: 'p', note: 'consensus codicum BC', witnessIds: witnessesOf('C', 'B') },
    ]);
    expect(saved).toMatchObject({ ok: true });
    expect((await conventions()).groups).toEqual([
      { siglum: 'p', members: ['B', 'C'], note: 'consensus codicum BC' },
    ]);
    const view = await editionView(db, sample.editionId, null, audience);
    expect(view.apparatus.groups).toEqual([{ siglum: 'p', members: ['B', 'C'] }]);
    expect(view.edition.conventions.groups?.[0]?.note).toBe('consensus codicum BC');
    expect(await printed(sample.editionId)).toContain('1.6 ἐξ … ἐρίσαντε A : not in p');
    await reset();
  });

  it('keep a member under its new siglum when the conspectus changes, whether or not the form carries them', async () => {
    await saveSigla(original, [{ siglum: 'p', witnessIds: witnessesOf('B', 'C') }]);
    const renamed = original.map((e) => (e.siglum === 'B' ? { ...e, siglum: 'β' } : e));
    // The form says nothing of groups: the edition's own are kept true.
    await saveSigla(renamed);
    expect((await conventions()).groups).toEqual([{ siglum: 'p', members: ['β', 'C'] }]);
    // The form carries them, by witness: the same.
    await saveSigla(original, [{ siglum: 'p', witnessIds: witnessesOf('B', 'C') }]);
    expect((await conventions()).groups).toEqual([{ siglum: 'p', members: ['B', 'C'] }]);
    await reset();
  });

  it('lose a witness that leaves the conspectus, and go when fewer than two are left', async () => {
    await saveSigla(original, [{ siglum: 'p', witnessIds: witnessesOf('A', 'B', 'C') }]);
    await saveSigla(original.filter((e) => e.siglum !== 'C'));
    expect((await conventions()).groups).toEqual([{ siglum: 'p', members: ['A', 'B'] }]);
    await saveSigla(original.filter((e) => e.siglum !== 'C' && e.siglum !== 'B'));
    expect((await conventions()).groups).toBeUndefined();
    // Back in, the witnesses are not members again: the group went.
    await saveSigla(original);
    expect((await conventions()).groups).toBeUndefined();
    await reset();
  });

  it('are refused, and nothing changes, when the siglum is empty or taken or the group has one witness', async () => {
    await saveSigla(original, [{ siglum: 'p', witnessIds: witnessesOf('B', 'C') }]);
    const before = await conventions();
    const refused = async (groups: unknown, entries: Entry[] = original) => {
      const result = await saveSigla(entries, groups);
      expect(result.status).toBe(400);
      expect(await conventions()).toEqual(before);
      expect((await conspectusOf(sample.editionId)).map((e) => e.siglum)).toEqual(
        original.map((e) => e.siglum),
      );
      return String(result.data?.message);
    };
    expect(await refused([{ siglum: '', witnessIds: witnessesOf('A', 'B') }])).toBe(
      'Give every group a siglum.',
    );
    expect(await refused([{ siglum: 'A', witnessIds: witnessesOf('B', 'C') }])).toBe(
      'The siglum A is used twice.',
    );
    expect(
      await refused([
        { siglum: 'p', witnessIds: witnessesOf('A', 'B') },
        { siglum: 'p', witnessIds: witnessesOf('B', 'C') },
      ]),
    ).toBe('The siglum p is used twice.');
    expect(await refused([{ siglum: 'q', witnessIds: witnessesOf('B') }])).toBe(
      'The group q needs at least two witnesses.',
    );
    expect(await refused('not a list')).toBe('The groups could not be read.');
    // A state's siglum is taken as well.
    const withState = original.map((e) =>
      e.siglum === 'A' ? { ...e, states: [{ kind: 'original' as const, siglum: 'q' }] } : e,
    );
    expect(await refused([{ siglum: 'q', witnessIds: witnessesOf('B', 'C') }], withState)).toBe(
      'The siglum q is used twice.',
    );
    // A conspectus change that gives a witness a group's siglum is refused too.
    expect(
      await refused(
        [{ siglum: 'p', witnessIds: witnessesOf('B', 'C') }],
        original.map((e) => (e.siglum === 'A' ? { ...e, siglum: 'p' } : e)),
      ),
    ).toBe('The siglum p is used twice.');
    await reset();
  });
});

describe('an edition that stores a group and the two words', () => {
  let page: PageSeedResult;
  const description = parseDescription({
    work: { slug: PAGE, title: 'The Invented Line', author: 'Nobody', language: 'grc' },
    edition: { title: 'The Invented Line', base: 'R' },
    witnesses: ['R', 'G', 'V', 'H', 'B'].map((siglum) => ({
      siglum,
      name: `Codex ${siglum}`,
      transcribed: true,
    })),
    lines: [{ n: '1', text: 'ὁ ποιητὴς ἔγραψε βιβλίον μικρόν πάνυ' }],
    variants: [
      { line: '1', from: 'ἔγραψε', to: 'ἔγραφε', witnesses: ['G', 'V', 'H'] },
      { line: '1', from: 'μικρόν', to: 'βραχύ', witnesses: ['G', 'V', 'H', 'B'] },
      { line: '1', from: 'πάνυ', to: 'σφόδρα', witnesses: ['R', 'G', 'V', 'H', 'B'] },
    ],
  });

  beforeAll(async () => {
    page = await seedPage(db, userId, description);
  }, 60_000);

  /** The conventions of the print apparatus as an import or an earlier version stored them: no page of the interface sets them. */
  async function store(fields: {
    apparatus: 'positive' | 'negative';
    rest?: string;
    all?: string;
  }) {
    const { rest: _rest, all: _all, ...kept } = await conventionsOf(page.editionId);
    await db
      .update(editions)
      .set({
        conventions: {
          ...kept,
          apparatus: fields.apparatus,
          ...(fields.rest ? { rest: fields.rest } : {}),
          ...(fields.all ? { all: fields.all } : {}),
        },
      })
      .where(eq(editions.id, page.editionId));
  }

  it('names every witness until the words and the group are stored', async () => {
    await store({ apparatus: 'negative' });
    expect(await printed(page.editionId)).toEqual([
      '1 ἔγραψε : ἔγραφε G V H',
      '1 μικρόν : βραχύ G V H B',
      '1 πάνυ : σφόδρα R G V H B',
    ]);
  });

  it('prints the family, the other witnesses and all the witnesses as an entry of the core does', async () => {
    await store({ apparatus: 'negative', rest: 'cett.', all: 'codd.' });
    const conspectus = await conspectusOf(page.editionId);
    const witness = (siglum: string) => conspectus.find((e) => e.siglum === siglum)!.witnessId;
    const saved = await run(actions.sigla, page.editionSlug, {
      sigla: JSON.stringify(conspectus),
      groups: JSON.stringify([
        { siglum: 'g', note: 'consensus codicum VH', witnessIds: [witness('V'), witness('H')] },
      ]),
    });
    expect(saved).toMatchObject({ ok: true });
    expect(await printed(page.editionId)).toEqual([
      '1 ἔγραψε : ἔγραφε G g',
      // Four of five read βραχύ, which is three sigla with the family: the lemma's witness is named.
      '1 μικρόν R : βραχύ cett.',
      '1 πάνυ : σφόδρα codd.',
    ]);
    await store({ apparatus: 'positive', rest: 'cett.', all: 'codd.' });
    expect(await printed(page.editionId)).toEqual([
      '1 ἔγραψε R B : ἔγραφε G g',
      '1 μικρόν R : βραχύ cett.',
      '1 πάνυ : σφόδρα codd.',
    ]);
  });

  it('names every witness again when the words are stored as none, and drops the family with a witness', async () => {
    await store({ apparatus: 'negative' });
    expect(await printed(page.editionId)).toEqual([
      '1 ἔγραψε : ἔγραφε G g',
      '1 μικρόν : βραχύ G g B',
      '1 πάνυ : σφόδρα R G g B',
    ]);
    const conspectus = await conspectusOf(page.editionId);
    await run(actions.sigla, page.editionSlug, {
      sigla: JSON.stringify(conspectus.filter((e) => e.siglum !== 'H')),
    });
    expect((await conventionsOf(page.editionId)).groups).toBeUndefined();
    expect(await printed(page.editionId)).toEqual([
      '1 ἔγραψε : ἔγραφε G V',
      '1 μικρόν : βραχύ G V B',
      '1 πάνυ : σφόδρα R G V B',
    ]);
  });
});
