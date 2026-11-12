/**
 * Copying text from a transcript of the conspectus into an edition: what a
 * copy would bring, the copy as one change of the edition's history, its
 * guard against a change made meanwhile, who may copy what, and undoing it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCHEME_PRESETS,
  fromText,
  newId,
  toText,
  type Item,
  type Stream,
  type Token,
} from '@varians/core';
import {
  changesets,
  createDatabase,
  editionSigla,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { VersionConflict, loadDocument, replaceContent, saveOps } from './documents/service.ts';
import { undoChangeset } from './history.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { publishTranscription } from './publish.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';
import { CopyRefused, copyText, previewCopy } from './text-copy.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const strangerId = newId();
const actor = { id: userId, role: 'member' as const };
const WORK = 'text-copy-work';
const SLUGS = ['text-copy-a', 'text-copy-b', 'text-copy-c', 'text-copy-d'];

/** Made-up lines of two witnesses that differ in a word or two. */
const A: Record<string, string> = {
  '1.1': 'κάλος ἔφυ λίθος',
  '1.2': 'ποταμὸς ῥέει μέγας',
  '1.3': 'ἄστρον φαίνει νύκτωρ',
  '1.4': 'δένδρον ἔχει φύλλα',
  '1.5': 'ἄνεμος πνεῖ σφόδρα',
  '1.6': 'θάλασσα κυμαίνει πάλιν',
};
const B: Record<string, string> = {
  '1.1': 'καλὸς ἔφυ λίθος',
  '1.2': 'ποταμὸς ῥεῖ μέγας',
  '1.3': 'ἄστρα φαίνει νύκτωρ',
  '1.4': 'δένδρον ἔχει φύλλον',
  '1.5': 'ἄνεμος πνέει σφόδρα',
  '1.6': 'θάλαττα κυμαίνει πάλιν',
};

let segmentIdOf: (label: string) => string;
let workId: string;
let editionId: string;
const transcriptionOf: Record<string, string> = {};

/** Lines to a stream, each line a segment. */
function stream(lines: Record<string, string>): Stream {
  const items: Item[] = [];
  Object.entries(lines).forEach(([label, text], k) => {
    if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
    const line = fromText(text, { lang: 'grc' });
    (line.items[0] as Token).segment = { segmentId: segmentIdOf(label) };
    items.push(...line.items);
  });
  return { items };
}

async function transcription(
  siglum: string,
  content: Stream,
  options: { owner?: string; published?: boolean } = {},
): Promise<string> {
  const witnessId = newId();
  await db.insert(witnesses).values({
    id: witnessId,
    slug: `text-copy-${siglum.toLowerCase()}`,
    siglum,
    name: `Witness ${siglum}`,
    createdBy: userId,
  });
  const id = newId();
  await db.insert(transcriptions).values({
    id,
    witnessId,
    name: 'Book 1',
    ownerId: options.owner ?? userId,
    keepsWrittenForm: false,
  });
  await replaceContent(db, 'transcription', id, options.owner ?? userId, 0, content, 'seed');
  if (options.published ?? true) await publishTranscription(db, id, options.owner ?? userId);
  transcriptionOf[siglum] = id;
  return witnessId;
}

async function edition() {
  const [row] = await db.select().from(editions).where(eq(editions.id, editionId));
  return row!;
}

/** The edition's text, one line a segment, in the read forms. */
async function text(): Promise<string> {
  return toText((await loadDocument(db, 'edition', editionId)).content);
}

async function version(): Promise<number> {
  return (await loadDocument(db, 'edition', editionId)).version;
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, WORK));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await cleanUp();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' },
    { id: strangerId, email: `${strangerId}@test`, name: 'Stranger', passwordHash: 'x' },
  ]);
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: SCHEME_PRESETS[0]!.name,
    levels: SCHEME_PRESETS[0]!.scheme.levels,
    createdBy: userId,
  });
  workId = newId();
  await db.insert(works).values({
    id: workId,
    slug: WORK,
    title: 'Copied lines',
    schemeId,
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), Object.keys(A));
  segmentIdOf = (label) => segments.get(label)!.id;

  const a = await transcription('A', stream(A));
  const b = await transcription('B', stream(B));
  // C is not in the conspectus; D is, but is another person's draft.
  await transcription('C', stream(A));
  const d = await transcription('D', stream(B), { owner: strangerId, published: false });
  editionId = newId();
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: 'text-copy-edition',
    title: 'Copied lines, an edition',
    editors: ['Editor'],
    ownerId: userId,
    conventions: DEFAULT_CONVENTIONS,
  });
  await db.insert(editionSigla).values([
    { editionId, witnessId: a, transcriptionId: transcriptionOf.A!, siglum: 'A', position: 0 },
    { editionId, witnessId: b, transcriptionId: transcriptionOf.B!, siglum: 'B', position: 1 },
    { editionId, witnessId: d, transcriptionId: transcriptionOf.D!, siglum: 'D', position: 2 },
  ]);
});

afterAll(async () => {
  await cleanUp();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(inArray(users.id, [userId, strangerId]));
  await pool.end();
});

const lines = (record: Record<string, string>, labels: string[]) =>
  labels.map((label) => record[label]).join('\n');

describe('copying text from a transcript', () => {
  it('says what a copy would bring, and changes nothing', async () => {
    const e = await edition();
    expect(await previewCopy(db, e, actor, { transcriptionId: transcriptionOf.A! })).toEqual({
      segments: 6,
      replaced: 0,
    });
    expect(
      await previewCopy(db, e, actor, { transcriptionId: transcriptionOf.A!, from: '1.2' }),
    ).toEqual({ segments: 5, replaced: 0 });
    expect(
      await previewCopy(db, e, actor, {
        transcriptionId: transcriptionOf.A!,
        from: '1.2',
        to: '1.3',
      }),
    ).toEqual({ segments: 2, replaced: 0 });
    expect(await version()).toBe(0);
  });

  it('copies a range as one change of the history, named by the range and the siglum', async () => {
    const done = await copyText(
      db,
      await edition(),
      actor,
      { transcriptionId: transcriptionOf.A!, from: '1.1', to: '1.3' },
      0,
    );
    expect(done).toMatchObject({ version: 1, segments: 3, replaced: 0 });
    expect(await text()).toBe(lines(A, ['1.1', '1.2', '1.3']));
    const [change] = await db
      .select()
      .from(changesets)
      .where(and(eq(changesets.documentKind, 'edition'), eq(changesets.documentId, editionId)))
      .orderBy(desc(changesets.version));
    expect(change!.message).toBe('Text of 1.1–1.3 copied from A');
    expect(change!.id).toBe(done.changesetId);
    const first = (await loadDocument(db, 'edition', editionId)).content.items[0] as Token;
    expect(first.source).toMatchObject({ kind: 'witness', transcriptionId: transcriptionOf.A });
  });

  it('puts what the edition did not have after it, and replaces what it had', async () => {
    const e = await edition();
    await copyText(db, e, actor, { transcriptionId: transcriptionOf.B!, from: '1.4' }, 1);
    expect(await text()).toBe(
      `${lines(A, ['1.1', '1.2', '1.3'])}\n${lines(B, ['1.4', '1.5', '1.6'])}`,
    );
    expect(
      await previewCopy(db, e, actor, {
        transcriptionId: transcriptionOf.B!,
        from: '1.2',
        to: '1.3',
      }),
    ).toEqual({ segments: 2, replaced: 2 });
    await copyText(
      db,
      e,
      actor,
      { transcriptionId: transcriptionOf.B!, from: '1.2', to: '1.3' },
      2,
    );
    expect(await text()).toBe(
      [A['1.1'], B['1.2'], B['1.3'], B['1.4'], B['1.5'], B['1.6']].join('\n'),
    );
  });

  it('refuses a copy against a version the edition has moved on from', async () => {
    const before = await text();
    await expect(
      copyText(db, await edition(), actor, { transcriptionId: transcriptionOf.A! }, 1),
    ).rejects.toBeInstanceOf(VersionConflict);
    expect(await text()).toBe(before);
  });

  it('refuses a transcript outside the conspectus, another person’s draft, and a label of no segment', async () => {
    const e = await edition();
    const refusal = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (cause: unknown) => (cause instanceof CopyRefused ? cause.status : cause),
      );
    expect(await refusal(previewCopy(db, e, actor, { transcriptionId: transcriptionOf.C! }))).toBe(
      404,
    );
    expect(await refusal(previewCopy(db, e, actor, { transcriptionId: transcriptionOf.D! }))).toBe(
      404,
    );
    expect(
      await refusal(
        previewCopy(db, e, actor, { transcriptionId: transcriptionOf.A!, from: 'seven' }),
      ),
    ).toBe(400);
  });

  it('copies nothing where the transcript has nothing in the range', async () => {
    const v = await version();
    const done = await copyText(
      db,
      await edition(),
      actor,
      { transcriptionId: transcriptionOf.A!, from: '2.1' },
      v,
    );
    expect(done).toMatchObject({ version: v, segments: 0 });
    expect(await version()).toBe(v);
  });

  it('is undone from the history like any other change', async () => {
    const before = await text();
    const v = await version();
    const done = await copyText(
      db,
      await edition(),
      actor,
      { transcriptionId: transcriptionOf.A!, from: '1.5', to: '1.6' },
      v,
    );
    expect(await text()).toBe(
      [A['1.1'], B['1.2'], B['1.3'], B['1.4'], A['1.5'], A['1.6']].join('\n'),
    );
    const undone = await undoChangeset(db, 'edition', editionId, userId, done.changesetId);
    expect(undone.ok).toBe(true);
    expect(await text()).toBe(before);
    // And the edition goes on taking ordinary edits.
    const now = await loadDocument(db, 'edition', editionId);
    await saveOps(db, 'edition', editionId, userId, now.version, [
      { t: 'delete', ids: [now.content.items[0]!.id] },
    ]);
  });
});
