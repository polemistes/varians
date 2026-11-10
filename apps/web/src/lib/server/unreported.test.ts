/**
 * A place of variation the editor does not report: in the editor's view,
 * marked and set apart; in everything a reader is given, absent; in a
 * published version, as it was left out or reported when it was published.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId, siteKey, siteTokenIds } from '@varians/core';
import {
  conjectures,
  createDatabase,
  moments,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type pg from 'pg';
import {
  entriesBySegment,
  entryBySite,
  markSites,
  siglaOrderOf,
  siteByToken,
} from '$lib/reader/sites';
import type { ReaderData } from '$lib/reader/types';
import { setSiteKind } from './collation.ts';
import { registerConjecture } from './conjectures.ts';
import { publishEdition } from './publish.ts';
import { loadReader, readerDownload, type ReaderRequest } from './reader-pages.ts';
import { editionView, type Audience } from './reader.ts';
import { seedSample, type SampleResult } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const owner: Audience = { kind: 'editor', viewer: { id: userId, role: 'member' } };
const actor = { id: userId, role: 'member' as const };
/** What the owner sees of the draft, and what everyone sees of the published version. */
const DRAFT: ReaderRequest = { draft: true };
const PUBLISHED: ReaderRequest = {};
let sample: SampleResult;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' });
  sample = await seedSample(db, userId);
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

/** The place of a segment where some witness has these words, as the editor's view has it. */
async function placeOf(label: string, reading: string) {
  const view = await editionView(db, sample.editionId, null, owner);
  const segment = Object.values(view.segments).find((s) => s.label === label)!;
  const site = segment.collation.sites.find((x) => x.readings.some((r) => r.text === reading))!;
  return { segment, site, key: siteKey(site, segment.baseUnits) };
}
type Place = Awaited<ReturnType<typeof placeOf>>;

const mark = (p: Place, kind: 'unreported' | null) =>
  setSiteKind(db, sample.editionId, p.segment.segmentId, p.key, kind, userId);
const leaveOut = (p: Place) => mark(p, 'unreported');
const reportAgain = (p: Place) => mark(p, null);

const reader = (request: ReaderRequest) =>
  loadReader(db, request.draft ? actor : null, sample.editionSlug, request);

/** What a reader's page prints for a segment, as the page works it out from its data. */
function printed(data: ReaderData, segmentId: string): string[] {
  const entries = entriesBySegment(data.segments, data.apparatus, siglaOrderOf(data.sigla));
  return (entries.get(segmentId) ?? []).map((entry) => formatEntry(entry, data.apparatus));
}

/** The words of the reader's page that are marked as having a variant. */
function markedWords(data: ReaderData): Set<string> {
  const entries = entryBySite(
    entriesBySegment(data.segments, data.apparatus, siglaOrderOf(data.sigla)),
  );
  return markSites(siteByToken({ segments: data.segments }), entries, data.segments).marked;
}

const download = async (kind: 'text' | 'tei', request: ReaderRequest = DRAFT) =>
  (
    await readerDownload(db, request.draft ? actor : null, sample.editionSlug, request, kind)
  ).text();

describe('a place the editor does not report', () => {
  it('stays in the editor’s view, marked and without an entry, and is absent from what a reader is given', async () => {
    const p = await placeOf('1.8', 'συνέηκε');
    const words = siteTokenIds(p.site, p.segment.baseUnits);
    expect(words.length).toBeGreaterThan(0);
    const id = p.segment.segmentId;
    const before = await reader(DRAFT);
    expect(printed(before, id)).toEqual(['1.8 ξυνέηκε A C : συνέηκε B']);
    expect(words.every((w) => markedWords(before).has(w))).toBe(true);

    await leaveOut(p);

    // The editor's view keeps the place, flagged, and has no entry for it.
    const editors = await editionView(db, sample.editionId, null, owner);
    const there = editors.segments[id]!.collation.sites.find((x) => x.index === p.site.index)!;
    expect(there.unreported).toBe(true);
    expect(editors.segments[id]!.entries).toEqual([]);
    const other = Object.values(editors.segments).find((s) => s.label === '1.2')!;
    expect(other.entries.length).toBeGreaterThan(0);

    // The reader is given neither the place nor its words as marked, nor its entry.
    const data = await reader(DRAFT);
    expect(data.segments[id]!.collation.sites.map((x) => x.index)).not.toContain(p.site.index);
    expect(printed(data, id)).toEqual([]);
    expect(words.some((w) => markedWords(data).has(w))).toBe(false);
    expect(printed(data, other.segmentId)).not.toEqual([]);
    expect(JSON.stringify(data.segments[id])).not.toContain('συνέηκε');

    // Nor do the plain text and the TEI have it; the edition's words stand.
    for (const kind of ['text', 'tei'] as const) {
      const file = await download(kind);
      expect(file, kind).not.toContain('συνέηκε');
      expect(file, kind).toContain('ξυνέηκε');
      expect(file, kind).toContain('μυρία');
    }

    await reportAgain(p);
    expect(printed(await reader(DRAFT), id)).toEqual(['1.8 ξυνέηκε A C : συνέηκε B']);
    expect(await download('text')).toContain('συνέηκε B');
    const again = await editionView(db, sample.editionId, null, owner);
    expect(
      again.segments[id]!.collation.sites.find((x) => x.index === p.site.index)!.unreported,
    ).toBeUndefined();
  });

  it('can be a place that only a conjecture opens', async () => {
    const view = await editionView(db, sample.editionId, null, owner);
    const segment = Object.values(view.segments).find((s) => s.label === '1.7')!;
    const id = segment.segmentId;
    // The witnesses agree here: there is no place until a conjecture opens one.
    expect(segment.collation.sites).toEqual([]);
    const conjecture = await registerConjecture(
      db,
      {
        workId: sample.workId,
        segmentId: id,
        kind: 'substitution',
        lemma: 'ἄναξ',
        reading: 'ἄνακτος',
        proposer: 'Quill',
      },
      userId,
    );
    let key: string | null = null;
    try {
      const opened = (await editionView(db, sample.editionId, null, owner)).segments[id]!;
      expect(opened.collation.sites).toHaveLength(1);
      const site = opened.collation.sites[0]!;
      key = siteKey(site, opened.baseUnits);
      expect(opened.attachments[site.index]).toHaveLength(1);
      const lines = printed(await reader(DRAFT), id);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('ἄνακτος Quill (coni.)');

      await setSiteKind(db, sample.editionId, id, key, 'unreported', userId);
      // The editor keeps the place and what was attached to it.
      const editors = (await editionView(db, sample.editionId, null, owner)).segments[id]!;
      expect(editors.collation.sites[0]!.unreported).toBe(true);
      expect(editors.attachments[site.index]).toHaveLength(1);
      expect(editors.entries).toEqual([]);
      // A reader is given neither.
      const data = await reader(DRAFT);
      expect(data.segments[id]!.collation.sites).toEqual([]);
      expect(data.segments[id]!.attachments).toEqual({});
      expect(printed(data, id)).toEqual([]);
      expect(await download('text')).not.toContain('Quill');
      expect(await download('tei')).not.toContain('Quill');
    } finally {
      if (key) await setSiteKind(db, sample.editionId, id, key, null, userId);
      await db.delete(conjectures).where(eq(conjectures.id, conjecture.id));
    }
  });
});

describe('a published version, and the places left out', () => {
  const basisOfLast = async () =>
    (
      await db
        .select({ basis: moments.basis })
        .from(moments)
        .where(and(eq(moments.documentId, sample.editionId), eq(moments.kind, 'published')))
        .orderBy(desc(moments.number))
    )[0]!.basis!;

  it('keeps the places left out as they were when it was published, whatever the editors do afterwards', async () => {
    const eight = await placeOf('1.8', 'συνέηκε');
    const two = await placeOf('1.2', 'μυρία');
    const id8 = eight.segment.segmentId;
    const id2 = two.segment.segmentId;
    await leaveOut(eight);
    await publishEdition(db, sample.editionId, userId);
    // What stands in the basis is every mark: the kind the sample gives a place, and the place left out.
    const recorded = (await basisOfLast()).siteKinds!;
    expect(recorded.map((m) => m.kind).sort()).toEqual(['textual', 'unreported']);
    expect(recorded).toContainEqual({ segmentId: id8, siteKey: eight.key, kind: 'unreported' });

    const now = await reader(PUBLISHED);
    expect(now.mode.kind).toBe('published');
    expect(printed(now, id8)).toEqual([]);
    expect(printed(now, id2)).toEqual([
      '1.2 μυρί᾽ A C : μυρία B',
      '1.2 ἄλγε᾽ ἔθηκε A C : ἄλγεα θῆκε B',
    ]);

    // A place left out afterwards is left out of the draft only.
    await leaveOut(two);
    expect(printed(await reader(PUBLISHED), id2)).toHaveLength(2);
    expect(printed(await reader(DRAFT), id2)).toEqual(['1.2 ἄλγε᾽ ἔθηκε A C : ἄλγεα θῆκε B']);

    // A place reported again afterwards is reported in the draft only.
    await reportAgain(eight);
    expect(printed(await reader(PUBLISHED), id8)).toEqual([]);
    expect(printed(await reader(DRAFT), id8)).toEqual(['1.8 ξυνέηκε A C : συνέηκε B']);
    const text = await download('text', PUBLISHED);
    expect(text).not.toContain('συνέηκε');
    expect(text).toContain('μυρία B');
    expect(await download('tei', PUBLISHED)).not.toContain('συνέηκε');
    await reportAgain(two);
  });

  it('reads a version published before the marks were recorded with the marks set before it', async () => {
    const eight = await placeOf('1.8', 'συνέηκε');
    const two = await placeOf('1.2', 'μυρία');
    // The published version is made to be of the old kind: no marks in its basis, and a time after the first mark.
    await leaveOut(eight);
    await db.execute(
      sql`update ${moments} set basis = basis - 'siteKinds', at = now() where ${moments.documentId} = ${sample.editionId} and ${moments.kind} = 'published'`,
    );
    expect((await basisOfLast()).siteKinds).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await leaveOut(two);
    const data = await reader(PUBLISHED);
    expect(printed(data, eight.segment.segmentId)).toEqual([]);
    expect(printed(data, two.segment.segmentId)).toHaveLength(2);
    await reportAgain(eight);
    await reportAgain(two);
  });
});
