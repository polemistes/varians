/**
 * A segment that witnesses have and the edition does not print is a
 * variant: after the edition's segment that precedes it in the work's
 * numbering, with nothing in the edition, the segment's words in the
 * witnesses that have it, and with the edition the witnesses whose text runs
 * on without it. Lines outside the stretch the edition has are not reported.
 * The order of whole segments is a variant too, given to the editor and the
 * reader alike.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCHEME_PRESETS,
  additionIn,
  defaultProfile,
  fromText,
  newId,
  siteKey,
  type Item,
  type Stream,
  type Token,
} from '@varians/core';
import {
  collationCache,
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
import { and, eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { countNeeding } from '../edition/outline.ts';
import { sitesInOrder, stepSite } from '../edition/workspace.ts';
import { unpackReader } from '../reader/wire.ts';
import { setSiteMinor } from './collation.ts';
import { replaceContent } from './documents/service.ts';
import { publishEdition } from './publish.ts';
import { loadReader, readerSites } from './reader-pages.ts';
import { editionOutline, editionView, refreshView, type Audience } from './reader.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';
import { setChosenWorks } from './transcription-works.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const owner: Audience = { kind: 'editor', viewer: { id: userId, role: 'member' } };
const actor = { id: userId, role: 'member' as const };
const WORK = 'unprinted-lines';
const SLUGS = ['unprinted-a', 'unprinted-b', 'unprinted-c', 'unprinted-d'];
const EDITION = 'unprinted-lines-edition';

const LINES: Record<string, string> = {
  '1.1': 'alpha beta gamma',
  '1.2': 'delta epsilon zeta',
  '1.3': 'eta theta iota',
  '1.4': 'kappa lambda mu',
  '1.5': 'nu xi omicron',
  '1.6': 'pi rho sigma',
};

let segmentIdOf: (label: string) => string;
let editionId: string;
let workId: string;
const transcriptionOf: Record<string, string> = {};

/** Lines to a stream, each line a segment; `null` puts a gap (a loss) in the place of a line. */
function stream(lines: [label: string, text: string | null][]): Stream {
  const items: Item[] = [];
  lines.forEach(([label, text], k) => {
    if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
    if (text === null) {
      items.push({ kind: 'object', id: newId(), type: 'gap', attrs: { reason: 'lost' } });
      return;
    }
    const line = fromText(text);
    (line.items[0] as Token).segment = { segmentId: segmentIdOf(label) };
    items.push(...line.items);
  });
  return { items };
}

const of = (labels: string[]) => labels.map((l) => [l, LINES[l]!] as [string, string]);

async function transcription(siglum: string, content: Stream): Promise<string> {
  const witnessId = newId();
  await db.insert(witnesses).values({
    id: witnessId,
    slug: `unprinted-${siglum.toLowerCase()}`,
    siglum,
    name: `Witness ${siglum}`,
    createdBy: userId,
  });
  const id = newId();
  await db.insert(transcriptions).values({
    id,
    witnessId,
    name: 'Book 1',
    ownerId: userId,
    keepsWrittenForm: false,
    visibility: 'published',
  });
  await setChosenWorks(db, id, [workId]);
  await replaceContent(db, 'transcription', id, userId, 0, content, 'seed');
  transcriptionOf[siglum] = id;
  return witnessId;
}

async function setContent(siglum: string, content: Stream) {
  const [row] = await db
    .select({ version: transcriptions.version })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionOf[siglum]!));
  await replaceContent(
    db,
    'transcription',
    transcriptionOf[siglum]!,
    userId,
    row!.version,
    content,
  );
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, WORK));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await cleanUp();
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' });
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
    title: 'Unprinted lines',
    language: 'grc',
    schemeId,
    profile: defaultProfile('grc'),
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), Object.keys(LINES));
  segmentIdOf = (label) => segments.get(label)!.id;

  // A has line 3, and line 6, which lies beyond the edition's last line; B runs on without
  // line 3; C has lost it.
  const a = await transcription('A', stream(of(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6'])));
  const b = await transcription('B', stream(of(['1.1', '1.2', '1.4', '1.5', '1.6'])));
  const c = await transcription(
    'C',
    stream([...of(['1.1', '1.2']), ['1.3', null], ...of(['1.4', '1.5'])]),
  );
  editionId = newId();
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: EDITION,
    title: 'Unprinted lines, an edition',
    editors: ['Editor'],
    ownerId: userId,
    conventions: DEFAULT_CONVENTIONS,
  });
  await replaceContent(
    db,
    'edition',
    editionId,
    userId,
    0,
    stream(of(['1.1', '1.2', '1.4', '1.5'])),
    'start',
  );
  await db.insert(editionSigla).values([
    { editionId, witnessId: a, transcriptionId: transcriptionOf.A!, siglum: 'A', position: 0 },
    { editionId, witnessId: b, transcriptionId: transcriptionOf.B!, siglum: 'B', position: 1 },
    { editionId, witnessId: c, transcriptionId: transcriptionOf.C!, siglum: 'C', position: 2 },
  ]);
});

afterAll(async () => {
  await cleanUp();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

/** The one variant of line 3 as a view has it: each reading's words with its sigla. */
function readingsOf(segment: {
  collation: { sites: { readings: { text: string; sigla: string[]; base: boolean }[] }[] };
}) {
  return segment.collation.sites.map((site) =>
    site.readings.map((r) => `${r.base ? '*' : ''}${r.text || '(nothing)'}: ${r.sigla.join(' ')}`),
  );
}

describe('a segment the edition does not print', () => {
  it('is a variant after the line before it, with the witnesses that are there', async () => {
    const view = await editionView(db, editionId, null, owner);
    const three = segmentIdOf('1.3');
    expect(view.unprinted).toEqual([{ segmentId: three, after: segmentIdOf('1.2') }]);
    const segment = view.segments[three]!;
    expect(segment.label).toBe('1.3');
    expect(segment.unprinted).toEqual({ after: segmentIdOf('1.2') });
    expect(segment.baseUnits).toEqual([]);
    // A has the words; B runs on without them and stands with the edition; C has lost them and is not there.
    expect(readingsOf(segment)).toEqual([['*(nothing): ed. B', 'eta theta iota: A']]);
    const site = segment.collation.sites[0]!;
    expect(additionIn(site, editionId, false)).toEqual([transcriptionOf.A]);
    // A line outside the edition's stretch is not reported.
    expect(view.unprinted.map((u) => u.segmentId)).not.toContain(segmentIdOf('1.6'));
    expect(view.segments[segmentIdOf('1.6')]).toBeUndefined();
    // The line stands among the edition's lines in the order of the work.
    expect(Object.keys(view.segments)).toEqual(
      ['1.1', '1.2', '1.3', '1.4', '1.5'].map(segmentIdOf),
    );
    // It is cached like any other segment's collation.
    const cached = await db
      .select()
      .from(collationCache)
      .where(and(eq(collationCache.editionId, editionId), eq(collationCache.segmentId, three)));
    expect(cached).toHaveLength(1);
  });

  it('is given to the editor among the first segments, again after a change, and in the outline it counts', async () => {
    const three = segmentIdOf('1.3');
    const first = await editionView(db, editionId, null, owner, { first: 2, lines: false });
    expect(Object.keys(first.segments)).toEqual(['1.1', '1.2', '1.3'].map(segmentIdOf));
    const fresh = await refreshView(db, editionId, [three], owner);
    expect(fresh.segments[three]!.unprinted).toEqual({ after: segmentIdOf('1.2') });
    expect(fresh.unprinted).toEqual([{ segmentId: three, after: segmentIdOf('1.2') }]);

    const { outline } = await editionOutline(db, editionId, owner);
    expect(outline[three]!.unprinted).toEqual({ after: segmentIdOf('1.2') });
    expect(outline[three]!.sites).toHaveLength(1);
    const order = ['1.1', '1.2', '1.4', '1.5'].map(segmentIdOf);
    const all = sitesInOrder(order, outline);
    expect(all.map((ref) => ref.segmentId)).toContain(three);
    const key = outline[three]!.sites[0]!.key;
    expect(countNeeding(order, outline, new Map())).toBe(all.filter((r) => r.site.needs).length);
    expect(countNeeding(order, outline, new Map([[three, new Set([key])]]))).toBe(
      all.filter((r) => r.site.needs).length - 1,
    );
    // Stepping goes only to the places the window shows, the lines of the text.
    const stepped = stepSite(order, outline, null, 1, {});
    expect(stepped?.segmentId).not.toBe(three);
  });

  it('takes the editor’s marks by its segment and its site key', async () => {
    const three = segmentIdOf('1.3');
    const view = await editionView(db, editionId, null, owner);
    const segment = view.segments[three]!;
    const key = siteKey(segment.collation.sites[0]!, segment.baseUnits);
    await setSiteMinor(db, editionId, three, key, true, userId);
    const after = await editionView(db, editionId, null, owner);
    expect(after.segments[three]!.collation.sites[0]!.minor).toBe(true);
    await setSiteMinor(db, editionId, three, key, false, userId);
    const again = await editionView(db, editionId, null, owner);
    expect(again.segments[three]!.collation.sites[0]!.minor).toBeUndefined();
  });

  it('is sent to the reader with the page, or when the page asks for it', async () => {
    const three = segmentIdOf('1.3');
    const data = unpackReader(await loadReader(db, actor, EDITION, { draft: true }));
    expect(data.unprinted).toEqual([{ segmentId: three, after: segmentIdOf('1.2') }]);
    expect(data.labelOf[three]).toBe('1.3');
    expect(data.segments[three]!.unprinted).toEqual({ after: segmentIdOf('1.2') });
    expect(readingsOf(data.segments[three]!)).toEqual([['*(nothing): ed. B', 'eta theta iota: A']]);
    const asked = unpackReader({
      ...(await loadReader(db, actor, EDITION, { draft: true })),
      ...(await readerSites(db, actor, EDITION, { draft: true }, [three, segmentIdOf('1.6')])),
    });
    expect(Object.keys(asked.segments)).toEqual([three]);
    expect(asked.segments[three]!.unprinted).toEqual({ after: segmentIdOf('1.2') });
  });

  it('stays in a published version as it was published when the transcripts change later', async () => {
    const three = segmentIdOf('1.3');
    const published = await publishEdition(db, editionId, userId);
    // A loses line 3 from its text, which now runs on without it, and B is given it.
    await setContent('A', stream(of(['1.1', '1.2', '1.4', '1.5', '1.6'])));
    await setContent('B', stream(of(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6'])));
    const now = await editionView(db, editionId, null, owner);
    expect(readingsOf(now.segments[three]!)).toEqual([['*(nothing): ed. A', 'eta theta iota: B']]);
    const then = await editionView(db, editionId, published.version);
    expect(then.unprinted).toEqual([{ segmentId: three, after: segmentIdOf('1.2') }]);
    expect(readingsOf(then.segments[three]!)).toEqual([['*(nothing): ed. B', 'eta theta iota: A']]);
    // A line no witness has any more is no variant.
    await setContent('B', stream(of(['1.1', '1.2', '1.4', '1.5', '1.6'])));
    const none = await editionView(db, editionId, null, owner);
    expect(none.unprinted).toEqual([]);
    expect(none.segments[three]).toBeUndefined();
    expect(
      readingsOf((await editionView(db, editionId, published.version)).segments[three]!),
    ).toEqual([['*(nothing): ed. B', 'eta theta iota: A']]);
  });
});

describe('the order of whole segments', () => {
  it('is a variant given to the editor and to the reader', async () => {
    // D has lines 4 and 5 the other way round.
    const d = await transcription('D', stream(of(['1.1', '1.2', '1.5', '1.4'])));
    await db.insert(editionSigla).values({
      editionId,
      witnessId: d,
      transcriptionId: transcriptionOf.D!,
      siglum: 'D',
      position: 3,
    });
    const [four, five] = [segmentIdOf('1.4'), segmentIdOf('1.5')];
    const view = await editionView(db, editionId, null, owner);
    expect(view.order).toEqual([{ siglum: 'D', moved: [four], after: five }]);
    expect(view.orderVariants).toEqual([
      {
        far: false,
        segments: [four, five],
        readings: [
          {
            segments: [four, five],
            base: true,
            textIds: [transcriptionOf.A, transcriptionOf.B, transcriptionOf.C],
            sigla: ['A', 'B', 'C'],
          },
          { segments: [five, four], base: false, textIds: [transcriptionOf.D], sigla: ['D'] },
        ],
      },
    ]);
    const data = await loadReader(db, actor, EDITION, { draft: true });
    expect(data.orderVariants).toEqual(view.orderVariants);
    const fresh = await refreshView(db, editionId, [four], owner);
    expect(fresh.orderVariants).toEqual(view.orderVariants);
  });
});
