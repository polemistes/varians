/**
 * A variant the editor judges minor: in the editor's view, marked and set
 * apart; in the print apparatus and the plain text, absent; in a reader's
 * data, there and flagged, for the page to show or not; in the TEI, written
 * as minor; in a published version, as it was when it was published. The
 * kind and the grade are separate words.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId, siteKey, siteTokenIds } from '@varians/core';
import {
  conjectures,
  createDatabase,
  editionSiteKinds,
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
  listingMinor,
  markSites,
  siglaOrderOf,
  siteByToken,
  withMinor,
} from '$lib/reader/sites';
import type { ReaderData } from '$lib/reader/types';
import { unpackReader } from '$lib/reader/wire';
import { setSiteKind, setSiteMark, setSiteMinor } from './collation.ts';
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

const minor = (p: Place, is: boolean) =>
  setSiteMinor(db, sample.editionId, p.segment.segmentId, p.key, is, userId);
const markMinor = (p: Place) => minor(p, true);
const markMajor = (p: Place) => minor(p, false);
const rows = (p: Place) =>
  db
    .select()
    .from(editionSiteKinds)
    .where(
      and(
        eq(editionSiteKinds.editionId, sample.editionId),
        eq(editionSiteKinds.segmentId, p.segment.segmentId),
        eq(editionSiteKinds.siteKey, p.key),
      ),
    );

/** The reader's data as the page has it once it has unpacked what it was sent. */
const reader = async (request: ReaderRequest) =>
  unpackReader(await loadReader(db, request.draft ? actor : null, sample.editionSlug, request));

/** What a reader's page prints for a segment in the print apparatus, as the page works it out from its data. */
function printed(data: ReaderData, segmentId: string): string[] {
  const entries = entriesBySegment(data.segments, data.apparatus, siglaOrderOf(data.sigla));
  return (entries.get(segmentId) ?? []).map((entry) => formatEntry(entry, data.apparatus));
}

/** The words of the reader's page that are marked as having a variant, with the minor variants shown or not as the reader chose. */
function markedWords(data: ReaderData, showMinor = false): Set<string> {
  const segments = withMinor(data.segments, showMinor);
  const entries = entryBySite(
    entriesBySegment(listingMinor(segments), data.apparatus, siglaOrderOf(data.sigla)),
  );
  return markSites(siteByToken({ segments }), entries, segments).marked;
}

const download = async (kind: 'text' | 'tei', request: ReaderRequest = DRAFT) =>
  (
    await readerDownload(db, request.draft ? actor : null, sample.editionSlug, request, kind)
  ).text();

describe('a minor variant', () => {
  it('stays in the editor’s view, flagged, and is sent to a reader flagged, for the page to show or not', async () => {
    const p = await placeOf('1.8', 'συνέηκε');
    const words = siteTokenIds(p.site, p.segment.baseUnits);
    expect(words.length).toBeGreaterThan(0);
    const id = p.segment.segmentId;
    const before = await reader(DRAFT);
    expect(printed(before, id)).toEqual(['1.8 ξυνέηκε A C : συνέηκε B']);
    expect(words.every((w) => markedWords(before).has(w))).toBe(true);

    await markMinor(p);

    // The editor's view keeps the place, flagged, and the print apparatus has no entry for it.
    const editors = await editionView(db, sample.editionId, null, owner);
    const there = editors.segments[id]!.collation.sites.find((x) => x.index === p.site.index)!;
    expect(there.minor).toBe(true);
    expect(editors.segments[id]!.entries).toEqual([]);
    const other = Object.values(editors.segments).find((s) => s.label === '1.2')!;
    expect(other.entries.length).toBeGreaterThan(0);

    // The reader is given the place, with its readings, flagged.
    const data = await reader(DRAFT);
    const given = data.segments[id]!.collation.sites.find((x) => x.index === p.site.index)!;
    expect(given.minor).toBe(true);
    expect(given.readings.some((r) => r.text === 'συνέηκε')).toBe(true);
    // The print apparatus leaves it out whatever the reader chose; the page marks it only when asked.
    expect(printed(data, id)).toEqual([]);
    expect(words.some((w) => markedWords(data).has(w))).toBe(false);
    expect(words.every((w) => markedWords(data, true).has(w))).toBe(true);
    expect(printed(data, other.segmentId)).not.toEqual([]);

    // The plain text leaves it out as a printed edition does; the TEI has it, as a minor variant of its kind.
    const text = await download('text');
    expect(text).not.toContain('συνέηκε');
    expect(text).toContain('ξυνέηκε');
    expect(text).toContain('μυρία');
    const tei = await download('tei');
    expect(tei).toMatch(/<app type="(textual|interpretative)" subtype="minor">[^]*?συνέηκε/u);

    await markMajor(p);
    expect(printed(await reader(DRAFT), id)).toEqual(['1.8 ξυνέηκε A C : συνέηκε B']);
    expect(await download('text')).toContain('συνέηκε B');
    expect(await download('tei')).not.toContain('subtype="minor"');
    const again = await editionView(db, sample.editionId, null, owner);
    expect(
      again.segments[id]!.collation.sites.find((x) => x.index === p.site.index)!.minor,
    ).toBeUndefined();
  });

  it('is a word apart from the kind: each is set and cleared without touching the other', async () => {
    const p = await placeOf('1.8', 'συνέηκε');
    const kindOf = async () =>
      (await editionView(db, sample.editionId, null, owner)).segments[
        p.segment.segmentId
      ]!.collation.sites.find((x) => x.index === p.site.index)!;
    const letters = p.site.kind;
    const other = letters === 'textual' ? 'interpretative' : 'textual';

    await setSiteKind(db, sample.editionId, p.segment.segmentId, p.key, other, userId);
    await markMinor(p);
    expect(await kindOf()).toMatchObject({ kind: other, kindByEditor: true, minor: true });
    // The kind goes back to the letters; the grade stays.
    await setSiteKind(db, sample.editionId, p.segment.segmentId, p.key, null, userId);
    expect(await kindOf()).toMatchObject({ kind: letters, minor: true });
    expect(await rows(p)).toMatchObject([{ kind: null, minor: true }]);
    // A kind set again on a minor place; then the grade goes and the kind stays.
    await setSiteKind(db, sample.editionId, p.segment.segmentId, p.key, other, userId);
    await markMajor(p);
    expect(await kindOf()).toMatchObject({ kind: other, kindByEditor: true });
    expect((await kindOf()).minor).toBeUndefined();
    expect(await rows(p)).toMatchObject([{ kind: other, minor: false }]);
    // With neither word said, the place has no row.
    await setSiteKind(db, sample.editionId, p.segment.segmentId, p.key, null, userId);
    expect(await rows(p)).toEqual([]);
    // Both in one change, and a change that says nothing.
    await setSiteMark(
      db,
      sample.editionId,
      p.segment.segmentId,
      p.key,
      { kind: other, minor: true },
      userId,
    );
    await setSiteMark(db, sample.editionId, p.segment.segmentId, p.key, {}, userId);
    expect(await rows(p)).toMatchObject([{ kind: other, minor: true }]);
    await setSiteMark(
      db,
      sample.editionId,
      p.segment.segmentId,
      p.key,
      { kind: null, minor: false },
      userId,
    );
    expect(await rows(p)).toEqual([]);
  });

  it('can be a variant that only a conjecture opens', async () => {
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

      await setSiteMinor(db, sample.editionId, id, key, true, userId);
      // The editor keeps the place and what was attached to it.
      const editors = (await editionView(db, sample.editionId, null, owner)).segments[id]!;
      expect(editors.collation.sites[0]!.minor).toBe(true);
      expect(editors.attachments[site.index]).toHaveLength(1);
      expect(editors.entries).toEqual([]);
      // A reader is given both, flagged; the print apparatus and the plain text leave it out.
      const data = await reader(DRAFT);
      expect(data.segments[id]!.collation.sites[0]!.minor).toBe(true);
      expect(data.segments[id]!.attachments[site.index]).toHaveLength(1);
      expect(printed(data, id)).toEqual([]);
      expect(await download('text')).not.toContain('Quill');
      expect(await download('tei')).toContain('Quill');
    } finally {
      if (key) await setSiteMinor(db, sample.editionId, id, key, false, userId);
      await db.delete(conjectures).where(eq(conjectures.id, conjecture.id));
    }
  });
});

describe('a published version, and the minor variants', () => {
  const basisOfLast = async () =>
    (
      await db
        .select({ basis: moments.basis })
        .from(moments)
        .where(and(eq(moments.documentId, sample.editionId), eq(moments.kind, 'published')))
        .orderBy(desc(moments.number))
    )[0]!.basis!;

  it('keeps the variants minor as they were when it was published, whatever the editors do afterwards', async () => {
    const eight = await placeOf('1.8', 'συνέηκε');
    const two = await placeOf('1.2', 'μυρία');
    const id8 = eight.segment.segmentId;
    const id2 = two.segment.segmentId;
    await markMinor(eight);
    await publishEdition(db, sample.editionId, userId);
    // What stands in the basis is every mark: the kind the sample gives a place, and the minor variant.
    const recorded = (await basisOfLast()).siteKinds!;
    expect(recorded).toHaveLength(2);
    expect(recorded).toContainEqual({ segmentId: id8, siteKey: eight.key, minor: true });
    expect(recorded.filter((m) => m.kind === 'textual')).toHaveLength(1);

    const flagged = (data: ReaderData, id: string, index: number) =>
      data.segments[id]!.collation.sites.find((x) => x.index === index)?.minor === true;
    const now = await reader(PUBLISHED);
    expect(now.mode.kind).toBe('published');
    expect(flagged(now, id8, eight.site.index)).toBe(true);
    expect(printed(now, id8)).toEqual([]);
    expect(printed(now, id2)).toEqual([
      '1.2 μυρί᾽ A C : μυρία B',
      '1.2 ἄλγε᾽ ἔθηκε A C : ἄλγεα θῆκε B',
    ]);

    // A variant made minor afterwards is minor in the draft only.
    await markMinor(two);
    expect(flagged(await reader(PUBLISHED), id2, two.site.index)).toBe(false);
    expect(printed(await reader(PUBLISHED), id2)).toHaveLength(2);
    expect(flagged(await reader(DRAFT), id2, two.site.index)).toBe(true);
    expect(printed(await reader(DRAFT), id2)).toEqual(['1.2 ἄλγε᾽ ἔθηκε A C : ἄλγεα θῆκε B']);

    // A variant that is not minor any longer is so in the draft only.
    await markMajor(eight);
    expect(flagged(await reader(PUBLISHED), id8, eight.site.index)).toBe(true);
    expect(flagged(await reader(DRAFT), id8, eight.site.index)).toBe(false);
    expect(printed(await reader(PUBLISHED), id8)).toEqual([]);
    expect(printed(await reader(DRAFT), id8)).toEqual(['1.8 ξυνέηκε A C : συνέηκε B']);
    const text = await download('text', PUBLISHED);
    expect(text).not.toContain('συνέηκε');
    expect(text).toContain('μυρία B');
    expect(await download('tei', PUBLISHED)).toContain('subtype="minor"');
    await markMajor(two);
  });

  it('reads a basis that says `unreported`, as the first marks of the kind were recorded, as minor', async () => {
    const eight = await placeOf('1.8', 'συνέηκε');
    await markMinor(eight);
    await publishEdition(db, sample.editionId, userId);
    await markMajor(eight);
    // The basis is made to be as it was written when the grade had the kind's place.
    await db.execute(
      sql`update ${moments} set basis = jsonb_set(basis, '{siteKinds}', (select coalesce(jsonb_agg(case when e->>'minor' = 'true' then jsonb_build_object('segmentId', e->'segmentId', 'siteKey', e->'siteKey', 'kind', 'unreported') else e end), '[]'::jsonb) from jsonb_array_elements(basis->'siteKinds') e)) where ${moments.documentId} = ${sample.editionId} and ${moments.kind} = 'published'`,
    );
    expect(JSON.stringify((await basisOfLast()).siteKinds)).toContain('unreported');
    const data = await reader(PUBLISHED);
    const site = data.segments[eight.segment.segmentId]!.collation.sites.find(
      (x) => x.index === eight.site.index,
    )!;
    expect(site.minor).toBe(true);
    expect(printed(data, eight.segment.segmentId)).toEqual([]);
  });

  it('reads a version published before the marks were recorded with the marks set before it', async () => {
    const eight = await placeOf('1.8', 'συνέηκε');
    const two = await placeOf('1.2', 'μυρία');
    // The published version is made to be of the old kind: no marks in its basis, and a time after the first mark.
    await markMinor(eight);
    await db.execute(
      sql`update ${moments} set basis = basis - 'siteKinds', at = now() where ${moments.documentId} = ${sample.editionId} and ${moments.kind} = 'published'`,
    );
    expect((await basisOfLast()).siteKinds).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await markMinor(two);
    const data = await reader(PUBLISHED);
    const minorAt = (p: Place) =>
      data.segments[p.segment.segmentId]!.collation.sites.find((x) => x.index === p.site.index)
        ?.minor === true;
    expect(minorAt(eight)).toBe(true);
    expect(minorAt(two)).toBe(false);
    expect(printed(data, eight.segment.segmentId)).toEqual([]);
    expect(printed(data, two.segment.segmentId)).toHaveLength(2);
    await markMajor(eight);
    await markMajor(two);
  });
});
