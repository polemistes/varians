/**
 * A segment that witnesses have and the edition does not print is a variant
 * at a point: in the passage of the edition's segment that precedes it in
 * the work's numbering, after that segment's words, with nothing in the
 * edition, the segment's words in the witnesses that have it, and with the
 * edition the witnesses whose text runs on without it. Lines outside the
 * stretch the edition has are not reported. The order of whole segments is a
 * variant too, given to the editor and the reader alike.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCHEME_PRESETS,
  additionIn,
  defaultProfile,
  fromText,
  newId,
  segmentAt,
  siteKey,
  toText,
  type Item,
  type Op,
  type Stream,
  type Site,
  type Token,
  type Unit,
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
import { opsForReading } from '../edition/adopt-client.ts';
import { countNeeding } from '../edition/outline.ts';
import { unprintedAt } from '../reader/passages.ts';
import { sitesInOrder, stepSite } from '../edition/workspace.ts';
import { unpackReader } from '../reader/wire.ts';
import { setSiteMinor } from './collation.ts';
import { replaceContent, saveOps } from './documents/service.ts';
import { publishEdition } from './publish.ts';
import { loadReader, readerSites } from './reader-pages.ts';
import { editionOutline, editionView, refreshView } from './reader.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
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

/** Each reading of each variant given: its words with its sigla. */
function readingsOf(sites: { readings: { text: string; sigla: string[]; base: boolean }[] }[]) {
  return sites.map((site) =>
    site.readings.map((r) => `${r.base ? '*' : ''}${r.text || '(nothing)'}: ${r.sigla.join(' ')}`),
  );
}

type Passage = {
  segmentId: string;
  segments: { segmentId: string; from: number; to: number; printed: boolean }[];
  siteSegments: Record<number, string[]>;
  collation: { sites: Site[] };
  baseUnits: Unit[];
};

/** The variant at a segment the edition does not print, with the passage it is in; null when there is none. */
function unprintedVariant<T extends Passage>(
  segments: Record<string, T>,
  segmentId: string,
): { passage: T; site: Site } | null {
  for (const passage of Object.values(segments))
    for (const site of passage.collation.sites)
      if (unprintedAt(passage, site.index)?.segmentId === segmentId) return { passage, site };
  return null;
}

/** The variants over the words of a segment of a passage. */
function sitesOver(passage: Passage, segmentId: string): Site[] {
  const part = passage.segments.find((s) => s.segmentId === segmentId)!;
  return passage.collation.sites.filter(
    (site) => site.baseFrom >= part.from && site.baseTo <= part.to && site.baseTo > site.baseFrom,
  );
}

describe('a segment the edition does not print', () => {
  it('is a variant after the line before it, with the witnesses that are there', async () => {
    const view = await editionView(db, editionId, null);
    const three = segmentIdOf('1.3');
    const found = unprintedVariant(view.segments, three)!;
    expect(found).not.toBeNull();
    const { passage, site } = found;
    // In the passage of 1.2, after its words, at a point; the edition has no words of it.
    expect(passage.segments.map((s) => [s.label, s.printed])).toEqual(
      expect.arrayContaining([
        ['1.2', true],
        ['1.3', false],
      ]),
    );
    const two = passage.segments.find((s) => s.label === '1.2')!;
    expect(site.baseFrom).toBe(two.to);
    expect(site.baseTo).toBe(two.to);
    expect(passage.siteSegments[site.index]).toEqual([three]);
    // A has the words; B runs on without them and stands with the edition; C has lost them and is not there.
    expect(readingsOf([site])).toEqual([['*(nothing): ed. B', 'eta theta iota: A']]);
    expect(additionIn(site, editionId, false)).toEqual([transcriptionOf.A]);
    // Each of A's words names the segment it is in.
    const a = site.readings.find((r) => r.sigla.includes('A'))!;
    expect(a.units[transcriptionOf.A!]!.map((u) => u.segmentId)).toEqual([three, three, three]);
    // A line outside the edition's stretch is not reported.
    expect(unprintedVariant(view.segments, segmentIdOf('1.6'))).toBeNull();
    expect(
      Object.values(view.segments).some((p) =>
        p.segments.some((s) => s.segmentId === segmentIdOf('1.6')),
      ),
    ).toBe(false);
    // The passages hold the edition's lines in their order, the line not printed among them in the order of the work.
    expect(Object.values(view.segments).flatMap((p) => p.segments.map((s) => s.label))).toEqual([
      '1.1',
      '1.2',
      '1.3',
      '1.4',
      '1.5',
    ]);
    // It is cached with its passage, under the passage's first segment.
    const cached = await db
      .select()
      .from(collationCache)
      .where(
        and(
          eq(collationCache.editionId, editionId),
          eq(collationCache.segmentId, passage.segmentId),
        ),
      );
    expect(cached).toHaveLength(1);
    expect(cached[0]!.result).toHaveProperty('passage');
  });

  it('is given to the editor among the first segments, again after a change, and in the outline it counts', async () => {
    const three = segmentIdOf('1.3');
    const first = await editionView(db, editionId, null, { first: 2, lines: false });
    expect(unprintedVariant(first.segments, three)).not.toBeNull();
    const fresh = await refreshView(db, editionId, [three]);
    const passage = unprintedVariant(fresh.segments, three)!.passage;
    expect(Object.keys(fresh.segments)).toEqual([passage.segmentId]);

    const { outline } = await editionOutline(db, editionId);
    const sites = outline[passage.segmentId]!.sites.filter((s) => s.unprinted);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.unprinted).toEqual({ segmentId: three, after: segmentIdOf('1.2') });
    expect(sites[0]!.segments).toEqual([three]);
    const order = ['1.1', '1.2', '1.4', '1.5'].map(segmentIdOf);
    const all = sitesInOrder(order, outline);
    const at = all.findIndex((ref) => ref.site.unprinted?.segmentId === three);
    expect(at).toBeGreaterThanOrEqual(0);
    const key = sites[0]!.key;
    expect(countNeeding(outline, new Map())).toBe(all.filter((r) => r.site.needs).length);
    // Reviewed under the segment it is.
    expect(countNeeding(outline, new Map([[three, new Set([key])]]))).toBe(
      all.filter((r) => r.site.needs).length - 1,
    );
    // Stepping reaches it in its place: on from the line it follows, and back from the next place after it.
    expect(
      stepSite(order, outline, null, 1, {}, false, segmentIdOf('1.2'))?.site.unprinted,
    ).toEqual({ segmentId: three, after: segmentIdOf('1.2') });
    const after = all[at + 1];
    if (after) {
      const back = { segmentId: after.segmentId, siteIndex: after.site.index };
      expect(stepSite(order, outline, back, -1, {})?.site.unprinted?.segmentId).toBe(three);
    }
  });

  it('is printed when a reading of it is adopted, and given back after its absence is adopted', async () => {
    const three = segmentIdOf('1.3');
    const save = async (ops: Op[]) => {
      const [row] = await db
        .select({ version: editions.version })
        .from(editions)
        .where(eq(editions.id, editionId));
      return saveOps(db, 'edition', editionId, userId, row!.version, ops);
    };
    const [a] = await db
      .select({ content: transcriptions.content })
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionOf.A!));
    const aWords = a!.content.items.filter(
      (item, i) => item.kind === 'token' && segmentAt(a!.content, i)?.segmentId === three,
    );
    const sourcesOf = (content: Stream) =>
      content.items.flatMap((item, i) =>
        item.kind === 'token' && segmentAt(content, i)?.segmentId === three ? [item.source] : [],
      );
    const fromA = aWords.map((t) => ({
      kind: 'witness',
      transcriptionId: transcriptionOf.A,
      tokenIds: [t.id],
    }));

    const before = await editionView(db, editionId, null);
    const original = before.content;
    const { passage: variant, site } = unprintedVariant(before.segments, three)!;
    const reading = site.readings.find((r) => r.sigla.includes('A'))!;
    // The ordinary adoption: each word in the segment A gives it, the line on a line of its own.
    await save(opsForReading(original, variant, site, reading, transcriptionOf.A!));

    // Printed from A, after 1.2: collated as a printed line, the variant over the whole of it says B has it not.
    const printed = await editionView(db, editionId, null);
    expect(unprintedVariant(printed.segments, three)).toBeNull();
    expect(toText(printed.content).split('\n')).toEqual(
      ['1.1', '1.2', '1.3', '1.4', '1.5'].map((l) => LINES[l]),
    );
    expect(sourcesOf(printed.content)).toEqual(fromA);
    const line = Object.values(printed.segments).find((p) =>
      p.segments.some((s) => s.segmentId === three && s.printed),
    )!;
    const part = line.segments.find((s) => s.segmentId === three)!;
    expect(line.baseUnits.slice(part.from, part.to).map((u) => u.text)).toEqual([
      'eta',
      'theta',
      'iota',
    ]);
    expect(readingsOf(sitesOver(line, three))).toEqual([
      ['*eta theta iota: ed. A', '(nothing): B'],
    ]);

    // Its absence adopted: not printed, and a variant after 1.2 again.
    const wanting = sitesOver(line, three).find((s) => s.wanting)!;
    const notIn = wanting.readings.find((r) => r.sigla.includes('B'))!;
    await save(opsForReading(printed.content, line, wanting, notIn, transcriptionOf.B!));
    const without = await editionView(db, editionId, null);
    expect(unprintedVariant(without.segments, three)).not.toBeNull();
    expect(toText(without.content)).not.toContain('theta');

    // Adopted back from its variant: the line as it was printed, its words from A.
    const again = unprintedVariant(without.segments, three)!;
    const its = again.site.readings.find((r) => r.sigla.includes('A'))!;
    await save(opsForReading(without.content, again.passage, again.site, its, transcriptionOf.A!));
    const back = await editionView(db, editionId, null);
    expect(toText(back.content)).toBe(toText(printed.content));
    expect(back.content.items.map((i) => i.kind)).toEqual(printed.content.items.map((i) => i.kind));
    expect(sourcesOf(back.content)).toEqual(fromA);
    expect(unprintedVariant(back.segments, three)).toBeNull();

    // The edition as it was, for what follows.
    const [row] = await db
      .select({ version: editions.version })
      .from(editions)
      .where(eq(editions.id, editionId));
    await replaceContent(db, 'edition', editionId, userId, row!.version, original);
  });

  it('takes the editor’s marks by its segment and its site key', async () => {
    const three = segmentIdOf('1.3');
    const view = await editionView(db, editionId, null);
    const { passage, site } = unprintedVariant(view.segments, three)!;
    const key = siteKey(site, passage.baseUnits);
    await setSiteMinor(db, editionId, three, key, true, userId);
    const after = await editionView(db, editionId, null);
    expect(unprintedVariant(after.segments, three)!.site.minor).toBe(true);
    await setSiteMinor(db, editionId, three, key, false, userId);
    const again = await editionView(db, editionId, null);
    expect(unprintedVariant(again.segments, three)!.site.minor).toBeUndefined();
  });

  it('is sent to the reader with the page, or when the page asks for it', async () => {
    const three = segmentIdOf('1.3');
    const data = unpackReader(await loadReader(db, actor, EDITION, { draft: true }));
    expect(data.labelOf[three]).toBe('1.3');
    const found = unprintedVariant(data.segments, three)!;
    expect(readingsOf([found.site])).toEqual([['*(nothing): ed. B', 'eta theta iota: A']]);
    const asked = unpackReader({
      ...(await loadReader(db, actor, EDITION, { draft: true })),
      ...(await readerSites(db, actor, EDITION, { draft: true }, [three, segmentIdOf('1.6')])),
    });
    expect(Object.keys(asked.segments)).toEqual([found.passage.segmentId]);
    expect(unprintedVariant(asked.segments, three)).not.toBeNull();
  });

  it('stays in a published version as it was published when the transcripts change later', async () => {
    const three = segmentIdOf('1.3');
    const published = await publishEdition(db, editionId, userId);
    // A loses line 3 from its text, which now runs on without it, and B is given it.
    await setContent('A', stream(of(['1.1', '1.2', '1.4', '1.5', '1.6'])));
    await setContent('B', stream(of(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6'])));
    const now = await editionView(db, editionId, null);
    expect(readingsOf([unprintedVariant(now.segments, three)!.site])).toEqual([
      ['*(nothing): ed. A', 'eta theta iota: B'],
    ]);
    const then = await editionView(db, editionId, published.version);
    expect(readingsOf([unprintedVariant(then.segments, three)!.site])).toEqual([
      ['*(nothing): ed. B', 'eta theta iota: A'],
    ]);
    // A line no witness has any more is no variant.
    await setContent('B', stream(of(['1.1', '1.2', '1.4', '1.5', '1.6'])));
    const none = await editionView(db, editionId, null);
    expect(unprintedVariant(none.segments, three)).toBeNull();
    expect(
      Object.values(none.segments).some((p) => p.segments.some((s) => s.segmentId === three)),
    ).toBe(false);
    const still = await editionView(db, editionId, published.version);
    expect(readingsOf([unprintedVariant(still.segments, three)!.site])).toEqual([
      ['*(nothing): ed. B', 'eta theta iota: A'],
    ]);
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
    const view = await editionView(db, editionId, null);
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
    const fresh = await refreshView(db, editionId, [four]);
    expect(fresh.orderVariants).toEqual(view.orderVariants);
  });
});
