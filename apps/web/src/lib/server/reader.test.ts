import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId, siteKey, type Token } from '@varians/core';
import {
  collationCache,
  conjectures,
  createDatabase,
  editionCollaborators,
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
  PUBLIC,
  editionOutline,
  editionView,
  refreshView,
  segmentViewsFor,
  type Audience,
} from './reader.ts';
import { loadReader, readerDetail, readerSites } from './reader-pages.ts';
import { outlineOf } from '../edition/outline.ts';
import { alignedUnits } from '../reader/sites.ts';
import { detailOf, unpackReader, unpackSegments, withDetail } from '../reader/wire.ts';
import { seedSample } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const strangerId = newId();
const helperId = newId();
const owner: Audience = { kind: 'editor', viewer: { id: userId, role: 'member' } };
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Reader', passwordHash: 'x' },
    { id: strangerId, email: `${strangerId}@test`, name: 'Stranger', passwordHash: 'x' },
    { id: helperId, email: `${helperId}@test`, name: 'Helper', passwordHash: 'x' },
  ]);
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(inArray(users.id, [userId, strangerId, helperId]));
  await pool.end();
});

describe('editionView', () => {
  it('assembles lines, sigla and apparatus entries with conjectures and reported readings placed', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null, owner);
    expect(view.lines).toHaveLength(10);
    expect(view.lines[0]!.label).toBe('1.1');
    expect(view.lines[4]!.label).toBe('1.5');
    expect(view.lines[1]!.label).toBeNull();
    expect(view.sigla.map((s) => s.siglum)).toEqual(['A', 'B', 'C', 'T']);
    const byLabel = Object.fromEntries(Object.values(view.segments).map((s) => [s.label, s]));
    const five = byLabel['1.5']!;
    const lines = five.entries.map((e) => formatEntry(e, view.apparatus));
    expect(lines).toContain('1.5 πᾶσι A B C : δαῖτα Zenodotus (coni.)');
    expect(lines.some((l) => l.includes('lac. C'))).toBe(true);
    const one = byLabel['1.1']!;
    expect(
      one.entries.some((e) =>
        e.variants.some((v) => v.attachment?.kind === 'reported' && v.sigla[0]!.startsWith('T')),
      ),
    ).toBe(true);
    // B and C lack line 1.6 within the stretch their transcripts cover: they omit it, and are not merely absent.
    expect(byLabel['1.6']!.absent).toEqual([]);
    expect(byLabel['1.6']!.entries.map((e) => formatEntry(e, view.apparatus))).toEqual([
      '1.6 ἐξ … ἐρίσαντε A : om. B C',
    ]);
    expect(
      byLabel['1.4']!.entries.some((e) => e.variants.some((v) => v.attachment?.name === 'Berge')),
    ).toBe(true);
    // B has no line 1.6 but every other line in the edition's order; nobody reorders whole lines.
    expect(view.order).toEqual([]);
    const some = await segmentViewsFor(
      db,
      sample.editionId,
      [five.segmentId, one.segmentId],
      owner,
    );
    expect(Object.keys(some)).toHaveLength(2);
    expect(some[five.segmentId]!.entries.length).toBe(five.entries.length);
  });

  it('puts the editor’s kind of a site over what the letters say, and goes back to the letters', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null, owner);
    const segment = Object.values(view.segments).find((s) =>
      s.collation.sites.some((site) => site.kind === 'textual'),
    )!;
    const site = segment.collation.sites.find((x) => x.kind === 'textual')!;
    const key = siteKey(site, segment.baseUnits);
    const kindNow = async () =>
      (await segmentViewsFor(db, sample.editionId, [segment.segmentId], owner))[
        segment.segmentId
      ]!.collation.sites.find((x) => x.index === site.index)!;
    await setSiteKind(db, sample.editionId, segment.segmentId, key, 'interpretative', userId);
    expect(await kindNow()).toMatchObject({ kind: 'interpretative', kindByEditor: true });
    await setSiteKind(db, sample.editionId, segment.segmentId, key, null, userId);
    const back = await kindNow();
    expect(back.kind).toBe('textual');
    expect(back.kindByEditor).toBeUndefined();
  });

  it('tells another form of the same word from another word, by the analyser', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null, owner);
    const found: string[] = [];
    for (const segment of Object.values(view.segments)) {
      for (const [index, list] of Object.entries(segment.relations ?? {})) {
        const site = segment.collation.sites.find((x) => x.index === Number(index))!;
        list.forEach((relation, k) => {
          if (relation)
            found.push(
              `${site.readings.find((r) => r.base)!.text} ${site.readings[k]!.text} ${relation}`,
            );
        });
      }
    }
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => /(form|word|order)$/.test(f))).toBe(true);
  });

  it('shows readers published records only, and each editor the drafts they may see', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null, owner);
    const four = Object.values(view.segments).find((s) => s.label === '1.4')!;
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
    const named = async (audience: Audience) => {
      const some = await segmentViewsFor(db, sample.editionId, [four.segmentId], audience);
      return some[four.segmentId]!.entries.flatMap((e) =>
        e.variants.map((v) => v.attachment?.name),
      ).concat(some[four.segmentId]!.unplaced.map((u) => u.name));
    };
    const stranger: Audience = { kind: 'editor', viewer: { id: strangerId, role: 'member' } };
    const helper: Audience = { kind: 'editor', viewer: { id: helperId, role: 'member' } };
    // Readers see neither the owner's draft (Berge) nor the stranger's.
    expect(await named(PUBLIC)).not.toContain('Berge');
    expect(await named(PUBLIC)).not.toContain('Stranger');
    // The owner maintains the work, and maintainers see every draft on it.
    expect(await named(owner)).toEqual(expect.arrayContaining(['Berge', 'Stranger']));
    // A collaborator sees the owner's drafts, not a stranger's; the stranger sees their own only.
    await db.insert(editionCollaborators).values({ editionId: sample.editionId, userId: helperId });
    expect(await named(helper)).toContain('Berge');
    expect(await named(helper)).not.toContain('Stranger');
    expect(await named(stranger)).toContain('Stranger');
    expect(await named(stranger)).not.toContain('Berge');
    await db.delete(editionCollaborators).where(eq(editionCollaborators.userId, helperId));
    // Published, it is everyone's.
    await db
      .update(conjectures)
      .set({ visibility: 'published' })
      .where(eq(conjectures.id, conjecture.id));
    expect(await named(PUBLIC)).toContain('Stranger');
    await db.delete(conjectures).where(eq(conjectures.id, conjecture.id));
  });

  it('notices words of the edition whose source witness now reads otherwise', async () => {
    const sample = await seedSample(db, userId);
    const before = await editionView(db, sample.editionId, null, owner);
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
      const after = await editionView(db, sample.editionId, null, owner);
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

describe('what a page needs of an edition, by stretches', () => {
  const asJson = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;

  it('makes the views of the first segments only, as the whole edition would have them', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null, owner);
    const ids = Object.keys(whole.segments);
    expect(ids.length).toBeGreaterThan(4);
    const some = await editionView(db, sample.editionId, null, owner, { first: 3, lines: false });
    expect(Object.keys(some.segments)).toEqual(ids.slice(0, 3));
    expect(some.lines).toEqual([]);
    for (const id of ids.slice(0, 3))
      expect(asJson(some.segments[id])).toEqual(asJson(whole.segments[id]));
    // The words of the text and its apparatus conventions come whole.
    expect(some.content).toEqual(whole.content);
    expect(some.order).toEqual(whole.order);
    const named = await editionView(db, sample.editionId, null, owner, {
      segments: [ids[4]!, ids[1]!, 'no-such-segment'],
      order: false,
    });
    expect(Object.keys(named.segments).sort()).toEqual([ids[1]!, ids[4]!].sort());
    expect(named.order).toEqual([]);
    expect(asJson(named.segments[ids[4]!])).toEqual(asJson(whole.segments[ids[4]!]));
  });

  it('leaves out of a lean view what the reader makes for itself, and nothing else', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null, owner);
    const lean = await editionView(db, sample.editionId, null, owner, { lean: true });
    for (const [id, view] of Object.entries(whole.segments)) {
      const other = lean.segments[id]!;
      expect(other.entries).toEqual([]);
      expect(other.drift).toEqual([]);
      expect(asJson({ ...other, entries: view.entries, drift: view.drift })).toEqual(asJson(view));
    }
  });

  it('gives the outline of every segment as the segment itself gives it, with the labels', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null, owner);
    const { outline, labelOf } = await editionOutline(db, sample.editionId, owner);
    expect(Object.keys(outline)).toEqual(Object.keys(whole.segments));
    for (const [id, view] of Object.entries(whole.segments))
      expect(asJson(outline[id])).toEqual(asJson(outlineOf(view)));
    expect(labelOf).toEqual(whole.labelOf);
    expect(Object.values(outline).some((o) => o.sites.length > 0)).toBe(true);
    // What the editor refreshes after a change gives the same outline.
    const [id] = Object.keys(whole.segments);
    const fresh = await refreshView(db, sample.editionId, [id!], owner);
    expect(asJson(outlineOf(fresh.segments[id!]!))).toEqual(asJson(outline[id!]));
  });

  it('sends the reader the places of every segment without the words of each text, and the detail of a segment brings them', async () => {
    const sample = await seedSample(db, userId);
    const actor = { id: userId, role: 'member' as const };
    const wire = await loadReader(db, actor, sample.editionSlug, {});
    const page = unpackReader(wire);
    const whole = await editionView(db, sample.editionId, null, owner);
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
  it('makes the views of the segments nearest the one asked for, names the others, and gives them when asked', async () => {
    const sample = await seedSample(db, userId);
    const whole = await editionView(db, sample.editionId, null, owner);
    const ids = Object.keys(whole.segments);
    const labels = ids.map((id) => whole.labelOf[id]!);
    await db.delete(collationCache).where(eq(collationCache.editionId, sample.editionId));
    const some = await editionView(db, sample.editionId, null, owner, {
      lean: true,
      lines: false,
      order: false,
      budget: 3,
      near: labels[5]!,
    });
    expect(Object.keys(some.segments).sort()).toEqual([ids[4]!, ids[5]!, ids[6]!].sort());
    // The rest are named, nearest the one asked for first.
    expect(some.pending).toHaveLength(ids.length - 3);
    expect([...some.pending.slice(0, 2)].sort()).toEqual([ids[3]!, ids[7]!].sort());
    expect(new Set([...some.pending, ...Object.keys(some.segments)])).toEqual(new Set(ids));
    // Without a budget nothing is left.
    expect((await editionView(db, sample.editionId, null, owner)).pending).toEqual([]);
    // And the places of those left come as the page asks, as it would have been sent them.
    const actor = { id: userId, role: 'member' as const };
    const sites = await readerSites(db, actor, sample.editionSlug, {}, some.pending);
    const arrived = unpackSegments(sites.segments, sites.texts, sample.editionId);
    expect(Object.keys(arrived).sort()).toEqual([...some.pending].sort());
    const page = unpackReader(await loadReader(db, actor, sample.editionSlug, {}));
    for (const id of some.pending)
      expect(arrived[id]!.collation.sites).toEqual(page.segments[id]!.collation.sites);
    expect(page.pending).toEqual([]);
  });
});
