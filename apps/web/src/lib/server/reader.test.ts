import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId, siteKey, type Token } from '@varians/core';
import { conjectures, createDatabase, editionCollaborators, referenceSchemes, transcriptions, users, witnesses, works, type Database } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { setSiteKind } from './collation.ts';
import { registerConjecture } from './conjectures.ts';
import { PUBLIC, editionView, segmentViewsFor, type Audience } from './reader.ts';
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
    expect(one.entries.some((e) => e.variants.some((v) => v.attachment?.kind === 'reported' && v.sigla[0]!.startsWith('T')))).toBe(true);
    expect(byLabel['1.6']!.absent).toEqual(['B', 'C']);
    expect(byLabel['1.4']!.entries.some((e) => e.variants.some((v) => v.attachment?.name === 'Berge'))).toBe(true);
    // B has no line 1.6 but every other line in the edition's order; nobody reorders whole lines.
    expect(view.order).toEqual([]);
    const some = await segmentViewsFor(db, sample.editionId, [five.segmentId, one.segmentId], owner);
    expect(Object.keys(some)).toHaveLength(2);
    expect(some[five.segmentId]!.entries.length).toBe(five.entries.length);
  });

  it('puts the editor’s kind of a site over what the letters say, and goes back to the letters', async () => {
    const sample = await seedSample(db, userId);
    const view = await editionView(db, sample.editionId, null, owner);
    const segment = Object.values(view.segments).find((s) => s.collation.sites.some((site) => site.kind === 'textual'))!;
    const site = segment.collation.sites.find((x) => x.kind === 'textual')!;
    const key = siteKey(site, segment.baseUnits);
    const kindNow = async () => (await segmentViewsFor(db, sample.editionId, [segment.segmentId], owner))[segment.segmentId]!.collation.sites.find((x) => x.index === site.index)!;
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
          if (relation) found.push(`${site.readings.find((r) => r.base)!.text} ${site.readings[k]!.text} ${relation}`);
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
      { workId: sample.workId, segmentId: four.segmentId, kind: 'substitution', lemma: 'κύνεσσιν', reading: 'κύνεσι', proposer: 'Stranger' },
      strangerId,
    );
    const named = async (audience: Audience) => {
      const some = await segmentViewsFor(db, sample.editionId, [four.segmentId], audience);
      return some[four.segmentId]!.entries.flatMap((e) => e.variants.map((v) => v.attachment?.name)).concat(some[four.segmentId]!.unplaced.map((u) => u.name));
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
    await db.update(conjectures).set({ visibility: 'published' }).where(eq(conjectures.id, conjecture.id));
    expect(await named(PUBLIC)).toContain('Stranger');
    await db.delete(conjectures).where(eq(conjectures.id, conjecture.id));
  });

  it('notices words of the edition whose source witness now reads otherwise', async () => {
    const sample = await seedSample(db, userId);
    const before = await editionView(db, sample.editionId, null, owner);
    expect(Object.values(before.segments).flatMap((v) => v.drift)).toEqual([]);
    const taken = before.content.items.find((i): i is Token => i.kind === 'token' && i.source?.kind === 'witness')!;
    const source = taken.source as { transcriptionId: string; tokenIds: string[] };
    const [row] = await db.select().from(transcriptions).where(eq(transcriptions.id, source.transcriptionId));
    const changed = structuredClone(row!.content);
    const word = changed.items.find((i) => i.id === source.tokenIds[0]) as Token;
    word.norm = 'ἄλλο';
    await db.update(transcriptions).set({ content: changed }).where(eq(transcriptions.id, row!.id));
    try {
      const after = await editionView(db, sample.editionId, null, owner);
      const drift = Object.values(after.segments).flatMap((v) => v.drift);
      expect(drift).toEqual([{ tokenId: taken.id, siglum: 'A', transcriptionId: row!.id, now: 'ἄλλο' }]);
    } finally {
      await db.update(transcriptions).set({ content: row!.content }).where(eq(transcriptions.id, row!.id));
    }
  });
});
