import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId, siteKey, type Token } from '@varians/core';
import {
  collationCache,
  conjectures,
  createDatabase,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { setSiteKind } from './collation.ts';
import { registerConjecture } from './conjectures.ts';
import {
  editionOutline,
  editionView,
  refreshView,
  segmentViewsFor,
  type EditionView,
  type SegmentView,
} from './reader.ts';
import { loadReader, readerDetail, readerSites } from './reader-pages.ts';
import { forgetCollations } from './passages.ts';
import { outlineOf } from '../edition/outline.ts';
import { alignedUnits } from '../reader/sites.ts';
import { detailOf, unpackReader, unpackSegments, withDetail } from '../reader/wire.ts';
import { seedSample } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const strangerId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

/** The passage of a view that holds the segment of this label. */
function passageAt(view: EditionView, label: string): SegmentView {
  const found = Object.values(view.segments).find((p) => p.segments.some((s) => s.label === label));
  if (!found) throw new Error(`no passage holds ${label}`);
  return found;
}

/** The segment ids of the passages of a view, in order. */
const segmentsOf = (views: Record<string, SegmentView>) =>
  Object.values(views).flatMap((p) => p.segments.map((s) => s.segmentId));

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Reader', passwordHash: 'x' },
    { id: strangerId, email: `${strangerId}@test`, name: 'Stranger', passwordHash: 'x' },
  ]);
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(inArray(users.id, [userId, strangerId]));
  await pool.end();
});

describe('editionView', () => {
  it('assembles lines, sigla and apparatus entries with conjectures and reported readings placed', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null);
    expect(view.lines).toHaveLength(10);
    expect(view.lines[0]!.label).toBe('1.1');
    expect(view.lines[4]!.label).toBe('1.5');
    expect(view.lines[1]!.label).toBeNull();
    expect(view.sigla.map((s) => s.siglum)).toEqual(['A', 'B', 'C', 'T']);
    const five = passageAt(view, '1.5');
    // Each entry is labelled by the segments its words lie in.
    const at = (label: string) =>
      Object.values(view.segments)
        .flatMap((p) => p.entries)
        .filter((e) => e.label === label);
    const lines = at('1.5').map((e) => formatEntry(e, view.apparatus));
    expect(lines).toContain('1.5 πᾶσι A B C : δαῖτα Zenodotus (conjectured)');
    // C has lost words of 1.5: it is named only where it is there.
    expect(lines.some((l) => l.includes('lac.'))).toBe(false);
    const one = passageAt(view, '1.1');
    expect(
      at('1.1').some((e) =>
        e.variants.some((v) => v.attachment?.kind === 'reported' && v.sigla[0]!.startsWith('T')),
      ),
    ).toBe(true);
    // B and C are without line 1.6 within the stretch their transcripts cover: it is not in them, and they are not absent.
    // The segments on either side are one passage with it.
    const six = passageAt(view, '1.6');
    expect(six.segments.map((s) => s.label)).toEqual(expect.arrayContaining(['1.5', '1.6', '1.7']));
    expect(six.absent).toEqual([]);
    expect(at('1.6').map((e) => formatEntry(e, view.apparatus))).toEqual([
      '1.6 ἐξ … ἐρίσαντε A : not in B C',
    ]);
    expect(at('1.4').some((e) => e.variants.some((v) => v.attachment?.name === 'Berge'))).toBe(
      true,
    );
    // B has no line 1.6 but every other line in the edition's order; nobody reorders whole lines.
    expect(view.order).toEqual([]);
    const some = await segmentViewsFor(db, sample.editionId, [five.segmentId, one.segmentId]);
    expect(Object.keys(some)).toHaveLength(five === one ? 1 : 2);
    expect(some[five.segmentId]!.entries.length).toBe(five.entries.length);
  });

  it('puts the editor’s kind of a site over what the letters say, and goes back to the letters', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null);
    const segment = Object.values(view.segments).find((s) =>
      s.collation.sites.some((site) => site.kind === 'textual'),
    )!;
    const site = segment.collation.sites.find((x) => x.kind === 'textual')!;
    const key = siteKey(site, segment.baseUnits);
    const kindNow = async () =>
      (await segmentViewsFor(db, sample.editionId, [segment.segmentId]))[
        segment.segmentId
      ]!.collation.sites.find((x) => x.index === site.index)!;
    await setSiteKind(db, sample.editionId, segment.segmentId, key, 'interpretative', userId);
    expect(await kindNow()).toMatchObject({ kind: 'interpretative', kindByEditor: true });
    await setSiteKind(db, sample.editionId, segment.segmentId, key, null, userId);
    const back = await kindNow();
    expect(back.kind).toBe('textual');
    expect(back.kindByEditor).toBeUndefined();
  });

  it('says nothing of how a reading is formed: no relation to the edition’s words is given', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null);
    for (const segment of Object.values(view.segments))
      expect(segment).not.toHaveProperty('relations');
  });

  it('shows every conjecture of the work, whoever entered it', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null);
    const passage = passageAt(view, '1.4');
    const four = passage.segments.find((s) => s.label === '1.4')!;
    const conjecture = await registerConjecture(
      db,
      {
        workId: sample.workId,
        segmentId: four.segmentId,
        kind: 'substitution',
        lemma: 'κύνεσσιν',
        reading: 'κύνεσι',
        proposer: 'Stranger',
      },
      strangerId,
    );
    const some = await segmentViewsFor(db, sample.editionId, [four.segmentId]);
    const named = some[passage.segmentId]!.entries.flatMap((e) =>
      e.variants.map((v) => v.attachment?.name),
    ).concat(some[passage.segmentId]!.unplaced.map((u) => u.name));
    // The edition owner's conjecture (Berge) and a stranger's are both laid at their variants.
    expect(named).toEqual(expect.arrayContaining(['Berge', 'Stranger']));
    await db.delete(conjectures).where(eq(conjectures.id, conjecture.id));
  });

  it('notices words of the edition whose source witness now reads otherwise', async () => {
    const sample = await seedSample(db, userId);
    const before = await editionView(db, sample.editionId, null);
    expect(Object.values(before.segments).flatMap((v) => v.drift)).toEqual([]);
    const taken = before.content.items.find(
      (i): i is Token => i.kind === 'token' && i.source?.kind === 'witness',
    )!;
    const source = taken.source as { transcriptionId: string; tokenIds: string[] };
    const [row] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, source.transcriptionId));
    const changed = structuredClone(row!.content);
    const word = changed.items.find((i) => i.id === source.tokenIds[0]) as Token;
    word.norm = 'ἄλλο';
    await db.update(transcriptions).set({ content: changed }).where(eq(transcriptions.id, row!.id));
    try {
      const after = await editionView(db, sample.editionId, null);
      const drift = Object.values(after.segments).flatMap((v) => v.drift);
      expect(drift).toEqual([
        { tokenId: taken.id, siglum: 'A', transcriptionId: row!.id, now: 'ἄλλο' },
      ]);
    } finally {
      await db
        .update(transcriptions)
        .set({ content: row!.content })
        .where(eq(transcriptions.id, row!.id));
    }
  });
});

describe('an edition with divided words and paragraphs of both kinds', () => {
  /** The sample's content with its first word divided over two lines and its fourth to sixth lines made one prose paragraph. */
  async function withDivisions(editionId: string) {
    const [row] = await db.select().from(editions).where(eq(editions.id, editionId));
    const content = structuredClone(row!.content);
    const items = content.items;
    const first = items.findIndex((item) => item.kind === 'token') as number;
    const word = items[first] as Token;
    const half = Math.floor(word.form.length / 2);
    const rest: Token = {
      kind: 'token',
      id: newId(),
      form: word.form.slice(half),
      source: word.source!,
    };
    word.form = word.form.slice(0, half);
    word.joinNext = true;
    items.splice(first + 1, 0, { kind: 'break', id: newId(), type: 'line' }, rest);
    // The fourth line begins a prose paragraph; the line after the sixth begins one marked as verse.
    const breaks = items
      .map((item, i) => (item.kind === 'break' ? i : -1))
      .filter((i) => i >= 0 && i > first + 2);
    (items[breaks[2]!] as { type: string; lineation?: string }).type = 'paragraph';
    (items[breaks[2]!] as { lineation?: string }).lineation = 'prose';
    (items[breaks[5]!] as { type: string; lineation?: string }).type = 'paragraph';
    (items[breaks[5]!] as { lineation?: string }).lineation = 'verse';
    await db.update(editions).set({ content }).where(eq(editions.id, editionId));
    return { original: row!.content, word, rest };
  }

  it('lays out verse as lines with a hyphen where a divided word ends one, and a prose paragraph as one line', async () => {
    const sample = await seedSample(db, userId);
    const { original, word, rest } = await withDivisions(sample.editionId);
    try {
      const view = await editionView(db, sample.editionId, null);
      // The ten lines are eleven with the divided word, and the paragraph of three is one.
      expect(view.lines.map((l) => l.lineation)).toEqual([
        'verse',
        'verse',
        'verse',
        'verse',
        'prose',
        'verse',
        'verse',
        'verse',
        'verse',
      ]);
      // The first line ends in the divided word's first part, drawn with a hyphen.
      expect(view.lines[0]!.hyphen).toBe(true);
      expect(view.lines[0]!.items.at(-1)).toMatchObject({ id: word.id, joinNext: true });
      expect(view.lines[1]!.items[0]).toMatchObject({ id: rest.id });
      // A prose paragraph is one line, holding its line breaks among its items, and no hyphen.
      const prose = view.lines.find((l) => l.lineation === 'prose')!;
      expect(prose.hyphen).toBe(false);
      expect(prose.items.some((item) => item.kind === 'break')).toBe(true);
      // The word, divided, is one word and its source has not drifted.
      expect(Object.values(view.segments).flatMap((v) => v.drift)).toEqual([]);
    } finally {
      await db.update(editions).set({ content: original }).where(eq(editions.id, sample.editionId));
    }
  });
});

describe('what a page needs of an edition, by stretches', () => {
  const asJson = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;

  it('makes the views of the first segments only, as the whole edition would have them', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null);
    const ids = Object.keys(whole.segments);
    expect(ids.length).toBeGreaterThan(4);
    const order = segmentsOf(whole.segments);
    const some = await editionView(db, sample.editionId, null, { first: 3, lines: false });
    // The passages that hold the first three segments, as the whole edition has them.
    const holding = ids.filter((id) =>
      whole.segments[id]!.segments.some((s) => order.slice(0, 3).includes(s.segmentId)),
    );
    expect(Object.keys(some.segments)).toEqual(holding);
    expect(some.lines).toEqual([]);
    for (const id of holding) expect(asJson(some.segments[id])).toEqual(asJson(whole.segments[id]));
    // The words of the text and its apparatus conventions come whole.
    expect(some.content).toEqual(whole.content);
    expect(some.order).toEqual(whole.order);
    const named = await editionView(db, sample.editionId, null, {
      segments: [ids[4]!, ids[1]!, 'no-such-segment'],
      order: false,
    });
    expect(Object.keys(named.segments).sort()).toEqual([ids[1]!, ids[4]!].sort());
    expect(named.order).toEqual([]);
    expect(asJson(named.segments[ids[4]!])).toEqual(asJson(whole.segments[ids[4]!]));
  });

  it('leaves out of a lean view what the reader makes for itself, and nothing else', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null);
    const lean = await editionView(db, sample.editionId, null, { lean: true });
    for (const [id, view] of Object.entries(whole.segments)) {
      const other = lean.segments[id]!;
      expect(other.entries).toEqual([]);
      expect(other.drift).toEqual([]);
      expect(asJson({ ...other, entries: view.entries, drift: view.drift })).toEqual(asJson(view));
    }
  });

  it('gives the outline of every segment as the segment itself gives it, with the labels', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null);
    const { outline, labelOf } = await editionOutline(db, sample.editionId);
    expect(Object.keys(outline)).toEqual(Object.keys(whole.segments));
    for (const [id, view] of Object.entries(whole.segments))
      expect(asJson(outline[id])).toEqual(asJson(outlineOf(view)));
    expect(labelOf).toEqual(whole.labelOf);
    expect(Object.values(outline).some((o) => o.sites.length > 0)).toBe(true);
    // What the editor refreshes after a change gives the same outline.
    const [id] = Object.keys(whole.segments);
    const fresh = await refreshView(db, sample.editionId, [id!]);
    expect(asJson(outlineOf(fresh.segments[id!]!))).toEqual(asJson(outline[id!]));
  });

  it('sends the reader the places of every segment without the words of each text, and the detail of a segment brings them', async () => {
    const sample = await seedSample(db, userId);
    const actor = { id: userId, role: 'member' as const };
    const wire = await loadReader(db, actor, sample.editionSlug, {});
    const page = unpackReader(wire);
    const whole = await editionView(db, sample.editionId, null);
    expect(Object.keys(page.segments)).toEqual(Object.keys(whole.segments));
    for (const [id, view] of Object.entries(whole.segments)) {
      const got = page.segments[id]!;
      expect(
        got.collation.sites.map((x) => x.readings.map((r) => [r.text, r.textIds, r.sigla])),
      ).toEqual(
        view.collation.sites.map((x) => x.readings.map((r) => [r.text, r.textIds, r.sigla])),
      );
      expect(
        got.collation.sites.every((x) =>
          x.readings.every((r) => Object.keys(r.units).length === 0),
        ),
      ).toBe(true);
      expect(got.aligned).toBeUndefined();
      expect(got.baseUnits).toEqual(view.baseUnits);
      expect(got.attachments).toEqual(view.attachments);
    }
    expect(page.detail).toBe(`/editions/${sample.editionSlug}/detail.json`);
    // The detail of some segments is what was left out, and puts it back.
    const ids = Object.keys(whole.segments).slice(0, 3);
    const detail = await readerDetail(db, actor, sample.editionSlug, {}, ids);
    expect(Object.keys(detail).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const view = whole.segments[id]!;
      expect(detail[id]).toEqual(
        asJson(detailOf(view.collation, alignedUnits(view.collation, view.baseUnits.length))),
      );
      const full = withDetail(page.segments[id]!, detail[id]!);
      expect(full.collation.sites.map((x) => x.readings.map((r) => r.units))).toEqual(
        asJson(view.collation.sites.map((x) => x.readings.map((r) => r.units))),
      );
    }
  });

  it('shows a stranger neither the reader nor the detail of a draft', async () => {
    const sample = await seedSample(db, userId);
    const stranger = { id: strangerId, role: 'member' as const };
    await expect(loadReader(db, stranger, sample.editionSlug, {})).rejects.toMatchObject({
      status: 404,
    });
    await expect(readerDetail(db, stranger, sample.editionSlug, {}, ['x'])).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('a page that does not wait for the whole edition to be collated', () => {
  const asJson = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
  it('makes the views of the segments nearest the one asked for, names the others, and gives them when asked', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null);
    const order = segmentsOf(whole.segments);
    const printed = order.filter((id) =>
      whole.content.items.some((i) => i.kind === 'token' && i.segment?.segmentId === id),
    );
    await db.delete(collationCache).where(eq(collationCache.editionId, sample.editionId));
    forgetCollations();
    // The budget is spent nearest the segment asked for: the passages made are those it reached
    // whole, with the boundaries on either side (1.2–1.4 is one passage, and the boundary after it
    // is known from 1.5).
    const near = printed[1]!;
    const some = await editionView(db, sample.editionId, null, {
      lean: true,
      lines: false,
      order: false,
      budget: 6,
      near: whole.labelOf[near]!,
    });
    const made = segmentsOf(some.segments);
    expect(made.map((id) => whole.labelOf[id])).toEqual(['1.1', '1.2', '1.3', '1.4']);
    expect(made).toContain(near);
    expect(made.length).toBeLessThan(order.length);
    for (const [id, view] of Object.entries(some.segments))
      expect(asJson(view.collation.sites)).toEqual(asJson(whole.segments[id]!.collation.sites));
    // The rest are named, nearest the one asked for first.
    expect(new Set([...some.pending, ...made])).toEqual(new Set(order));
    expect(some.pending.filter((id) => made.includes(id))).toEqual([]);
    const at = (id: string) => Math.abs(order.indexOf(id) - order.indexOf(near));
    expect(at(some.pending[0]!)).toBeLessThanOrEqual(at(some.pending[some.pending.length - 1]!));
    // Without a budget nothing is left.
    expect((await editionView(db, sample.editionId, null)).pending).toEqual([]);
    // And the places of those left come as the page asks, in the passages that hold them, as it would have been sent them.
    const actor = { id: userId, role: 'member' as const };
    const sites = await readerSites(db, actor, sample.editionSlug, {}, some.pending);
    const arrived = unpackSegments(sites.segments, sites.texts, sample.editionId);
    const held = Object.values(arrived).flatMap((p) => p.segments.map((s) => s.segmentId));
    for (const id of some.pending) expect(held).toContain(id);
    const page = unpackReader(await loadReader(db, actor, sample.editionSlug, {}));
    for (const id of Object.keys(arrived))
      expect(arrived[id]!.collation.sites).toEqual(page.segments[id]!.collation.sites);
    expect(page.pending).toEqual([]);
  });
});
