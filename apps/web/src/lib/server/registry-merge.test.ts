import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCHEME_PRESETS, fromText, newId, type Item, type Stream, type Token } from '@varians/core';
import {
  alignmentConstraints,
  changesets,
  citations,
  bibliographyItems,
  conjectures,
  createDatabase,
  editionSigla,
  editionSiteReviews,
  editions,
  moments,
  notes,
  pages,
  referenceSchemes,
  registryMerges,
  reportedReadings,
  segments,
  transcriptionSegments,
  transcriptionWorks,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  type Database,
  type Role,
} from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { grantsFor, type Actor } from './authz';
import { replaceContent, saveOps } from './documents/service.ts';
import { searchWitnesses, searchWorks } from './library';
import { addMaintainer, createTranscription, createWitness, createWork, searchRegistry } from './registry';
import {
  addressKey,
  mergeWitnesses,
  mergeWorks,
  mergesInto,
  previewWitnessMerge,
  previewWorkMerge,
  renumberParts,
  replaceIds,
  sameLevels,
} from './registry-merge';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';

// The test database is shared: every record here carries this run's tag and
// is deleted at the end; nothing else is touched.
const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const tag = newId().slice(-8).toLowerCase();
/** Digits no other run uses, for identifiers. */
const digits = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let db: Database;
let pool: pg.Pool;

const created = { works: [] as string[], witnesses: [] as string[], items: [] as string[] };

function person(role: Role, name: string): Actor & { email: string; name: string } {
  const id = newId();
  return { id, role, name: `${name} ${tag}`, email: `${id}@merge.test` };
}

const alice = person('member', 'Alice');
const bob = person('member', 'Bob');
const carol = person('member', 'Carol');
const editor = person('editor', 'Editor');
const admin = person('administrator', 'Admin');
const people = [alice, bob, carol, editor, admin];

const epic = { preset: SCHEME_PRESETS[0]!.name };

async function work(title: string, owner = alice, scheme: Parameters<typeof createWork>[1]['scheme'] = epic, extra: Partial<Parameters<typeof createWork>[1]> = {}) {
  const row = await createWork(db, { title: `${title} ${tag}`, language: 'grc', scheme, ...extra }, owner.id);
  created.works.push(row.id);
  return row;
}

async function witness(name: string, owner = alice, fields: Partial<Parameters<typeof createWitness>[1]> = {}) {
  const row = await createWitness(db, { siglum: 'X', name: `${name} ${tag}`, ...fields }, owner.id);
  created.witnesses.push(row.id);
  return row;
}

async function edition(workId: string, owner: Actor, sigla: { witnessId: string; transcriptionId: string | null }[] = []) {
  const id = newId();
  await db.insert(editions).values({
    id,
    workId,
    slug: `merge-edition-${tag}-${id.slice(-6).toLowerCase()}`,
    title: `Edition ${id.slice(-4)} ${tag}`,
    ownerId: owner.id,
    conventions: DEFAULT_CONVENTIONS,
  });
  if (sigla.length) await db.insert(editionSigla).values(sigla.map((s, i) => ({ editionId: id, ...s, siglum: `S${i}`, position: i })));
  return id;
}

/** Lines of text, each starting a segment of the work with the given label. */
async function textOf(workId: string, lines: Record<string, string>): Promise<Stream> {
  const scheme = await schemeOfWork(db, workId);
  const resolved = await resolveLabels(db, scheme, Object.keys(lines));
  const items: Item[] = [];
  for (const [label, text] of Object.entries(lines)) {
    if (items.length) items.push({ kind: 'break', id: newId(), type: 'line' });
    const line = fromText(text);
    (line.items[0] as Token).segment = { segmentId: resolved.get(label)!.id };
    items.push(...line.items);
  }
  return { items };
}

async function segmentId(workId: string, label: string): Promise<string> {
  const [row] = await db.select({ id: segments.id }).from(segments).where(and(eq(segments.workId, workId), eq(segments.label, label)));
  if (row) return row.id;
  const scheme = await schemeOfWork(db, workId);
  return (await resolveLabels(db, scheme, [label])).get(label)!.id;
}

const segmentStarts = (stream: Stream) =>
  stream.items.flatMap((i) => (i.kind !== 'break' && i.segment?.segmentId ? [{ id: i.segment.segmentId, part: i.segment.part ?? 1 }] : []));

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values(people.map((p) => ({ id: p.id, email: p.email, name: p.name, role: p.role, passwordHash: 'x' })));
});

afterAll(async () => {
  const userIds = people.map((p) => p.id);
  if (created.works.length) {
    await db.delete(registryMerges).where(inArray(registryMerges.survivorId, created.works));
    await db.delete(works).where(inArray(works.id, created.works));
  }
  if (created.witnesses.length) {
    await db.delete(registryMerges).where(inArray(registryMerges.survivorId, created.witnesses));
    await db.delete(witnesses).where(inArray(witnesses.id, created.witnesses));
  }
  await db.delete(registryMerges).where(inArray(registryMerges.mergedBy, userIds));
  await db.delete(editions).where(inArray(editions.ownerId, userIds));
  await db.delete(transcriptions).where(inArray(transcriptions.ownerId, userIds));
  await db.delete(changesets).where(inArray(changesets.userId, userIds));
  if (created.items.length) await db.delete(bibliographyItems).where(inArray(bibliographyItems.id, created.items));
  await db.delete(referenceSchemes).where(inArray(referenceSchemes.createdBy, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe('pure helpers', () => {
  it('compares levels by key and type only', () => {
    const a = SCHEME_PRESETS[0]!.scheme.levels;
    expect(sameLevels(a, a.map((l) => ({ ...l, label: 'Other', separator: ':' })))).toBe(true);
    expect(sameLevels(a, a.map((l, i) => (i === 1 ? { ...l, type: 'text' as const } : l)))).toBe(false);
    expect(sameLevels(a, a.slice(0, 1))).toBe(false);
  });

  it('keys an address by the values of the levels in order', () => {
    const levels = SCHEME_PRESETS[0]!.scheme.levels;
    expect(addressKey(levels, { line: '5', book: '1' })).toBe(addressKey(levels, { book: '1', line: '5' }));
    expect(addressKey(levels, { book: '1', line: '5' })).not.toBe(addressKey(levels, { book: '1', line: '6' }));
  });

  it('replaces ids anywhere in a value, keeping what is unchanged', () => {
    const value = { a: ['x', { b: 'y' }], c: 'z' };
    const out = replaceIds(value, new Map([['y', 'Y']]));
    expect(out).toEqual({ a: ['x', { b: 'Y' }], c: 'z' });
    expect(replaceIds(value, new Map([['q', 'Q']]))).toBe(value);
  });

  it('numbers the runs of a segment again where two share a part', () => {
    const stream: Stream = {
      items: [
        { kind: 'token', id: 'a', form: 'a', segment: { segmentId: 'S' } },
        { kind: 'token', id: 'b', form: 'b', segment: { segmentId: 'T' } },
        { kind: 'token', id: 'c', form: 'c', segment: { segmentId: 'S' } },
      ],
    };
    expect(segmentStarts(renumberParts(stream, new Set(['S'])))).toEqual([
      { id: 'S', part: 1 },
      { id: 'T', part: 1 },
      { id: 'S', part: 2 },
    ]);
    const fine: Stream = { items: [stream.items[0]!, stream.items[1]!] };
    expect(renumberParts(fine, new Set(['S']))).toBe(fine);
  });
});

describe('search by identifier', () => {
  it('finds a work by any of its identifiers, letter for letter but for case, among those the user may see', async () => {
    const q = `Q${digits}`;
    const open = await work('Identified', alice, epic, { identifiers: [{ scheme: 'wikidata', value: q }] });
    const closed = await work('Identified privately', alice, epic, { identifiers: [{ scheme: 'wikidata', value: q }], visibility: 'private' });
    const urn = await work('By URN', alice, epic, { identifier: `urn:cts:greekLit:tlg${digits}.tlg001` });
    expect((await searchRegistry(db, 'work', q.toLowerCase(), bob, await grantsFor(db, bob))).map((h) => h.id)).toEqual([open.id]);
    expect((await searchRegistry(db, 'work', ` ${q} `, alice, await grantsFor(db, alice))).map((h) => h.id).sort()).toEqual([open.id, closed.id].sort());
    // Exactly: a part of the value finds nothing.
    expect(await searchRegistry(db, 'work', q.slice(0, -1), alice, await grantsFor(db, alice))).toEqual([]);
    expect((await searchRegistry(db, 'work', `URN:CTS:greekLit:tlg${digits}.tlg001`, bob, await grantsFor(db, bob))).map((h) => h.id)).toEqual([urn.id]);
    expect((await searchWorks(db, bob, q)).map((w) => w.id)).toEqual([open.id]);
  });

  it('finds a witness by a Diktyon number', async () => {
    const found = await witness('Diktyon', alice, { identifiers: [{ scheme: 'diktyon', value: digits }] });
    expect((await searchRegistry(db, 'witness', digits, null, await grantsFor(db, null))).map((h) => h.id)).toEqual([found.id]);
    expect((await searchWitnesses(db, digits)).map((w) => w.id)).toEqual([found.id]);
  });
});

describe('merging witnesses', () => {
  it('previews what moves, and is blocked by an edition naming both and by a page both have', async () => {
    const w = await work('Blocked witnesses');
    const from = await witness('Blocked from');
    const into = await witness('Blocked into');
    await db.insert(pages).values([
      { id: newId(), witnessId: from.id, label: '1r', position: 1 },
      { id: newId(), witnessId: from.id, label: '1v', position: 2 },
      { id: newId(), witnessId: into.id, label: '1r', position: 1 },
    ]);
    const both = await edition(w.id, alice, [
      { witnessId: from.id, transcriptionId: null },
      { witnessId: into.id, transcriptionId: null },
    ]);
    const preview = await previewWitnessMerge(db, from.id, into.id);
    expect(preview!.moves.pages).toBe(2);
    expect(preview!.blocks.pageConflicts).toEqual(['1r']);
    expect(preview!.blocks.bothInEdition).toHaveLength(1);
    const refused = await mergeWitnesses(db, from.id, into.id, alice);
    expect(refused).toMatchObject({ ok: false, error: 'blocked' });
    expect(await db.select().from(witnesses).where(eq(witnesses.id, from.id))).toHaveLength(1);

    // Resolved: the page renamed, the witness taken out of the conspectus.
    await db.update(pages).set({ label: '2r' }).where(and(eq(pages.witnessId, from.id), eq(pages.label, '1r')));
    await db.delete(editionSigla).where(and(eq(editionSigla.editionId, both), eq(editionSigla.witnessId, from.id)));
    const clear = await previewWitnessMerge(db, from.id, into.id);
    expect(clear!.blocks).toEqual({ bothInEdition: [], pageConflicts: [] });
    expect(await previewWitnessMerge(db, from.id, from.id)).toBeNull();
  });

  it('moves transcriptions, reported readings, sigla, maintainers, pages, hands and identifiers, and records the merge', async () => {
    const w = await work('Witness merge');
    const from = await witness('Merged codex', alice, {
      hands: [{ id: 'hand1', label: 'm2', description: null, main: false }],
      identifiers: [{ scheme: 'diktyon', value: `${digits}1` }],
    });
    const into = await witness('Surviving codex', alice, {
      hands: [{ id: 'main1', label: 'm1', description: null, main: true }],
      identifiers: [{ scheme: 'viaf', value: '42' }],
    });
    await addMaintainer(db, 'witness', from.id, carol.email);
    await db.insert(pages).values([
      { id: newId(), witnessId: into.id, label: '1r', position: 1 },
      { id: newId(), witnessId: into.id, label: '1v', position: 2 },
      { id: newId(), witnessId: from.id, label: '3v', position: 7 },
      { id: newId(), witnessId: from.id, label: '3r', position: 5 },
    ]);
    const tr = await createTranscription(db, { witnessId: from.id, workIds: [w.id], name: 'T' }, bob.id);
    const segment = await segmentId(w.id, '1.1');
    const [reading] = await db
      .insert(reportedReadings)
      .values({ id: newId(), workId: w.id, segmentId: segment, witnessId: from.id, reading: 'x', ownerId: bob.id })
      .returning();
    const ed = await edition(w.id, bob, [{ witnessId: from.id, transcriptionId: tr.id }]);
    const momentId = newId();
    await db.insert(moments).values({
      id: momentId,
      documentKind: 'edition',
      documentId: ed,
      version: 0,
      name: 'Published',
      kind: 'published',
      number: 1,
      basis: { sigla: [{ siglum: 'S0', witnessId: from.id, transcriptionId: tr.id }], versions: {} },
    });

    const preview = await previewWitnessMerge(db, from.id, into.id);
    expect(preview!.moves).toMatchObject({ transcriptions: 1, readings: 1, pages: 2, hands: ['m2'], identifiers: [`${digits}1`] });
    expect(preview!.moves.sigla).toHaveLength(1);
    expect(preview!.moves.maintainers).toEqual([carol.name]);

    const result = await mergeWitnesses(db, from.id, into.id, alice);
    expect(result.ok).toBe(true);
    expect(await db.select().from(witnesses).where(eq(witnesses.id, from.id))).toHaveLength(0);
    expect((await db.select().from(transcriptions).where(eq(transcriptions.id, tr.id)))[0]!.witnessId).toBe(into.id);
    expect((await db.select().from(reportedReadings).where(eq(reportedReadings.id, reading!.id)))[0]!.witnessId).toBe(into.id);
    expect((await db.select().from(editionSigla).where(eq(editionSigla.editionId, ed)))[0]!.witnessId).toBe(into.id);
    expect((await db.select().from(moments).where(eq(moments.id, momentId)))[0]!.basis!.sigla[0]!.witnessId).toBe(into.id);
    const pageRows = await db.select().from(pages).where(eq(pages.witnessId, into.id)).orderBy(pages.position);
    expect(pageRows.map((p) => p.label)).toEqual(['1r', '1v', '3r', '3v']);
    const maintainerIds = (await db.select().from(witnessMaintainers).where(eq(witnessMaintainers.witnessId, into.id))).map((m) => m.userId);
    expect(maintainerIds.sort()).toEqual([alice.id, carol.id].sort());
    const [survivor] = await db.select().from(witnesses).where(eq(witnesses.id, into.id));
    expect(survivor!.hands.map((h) => [h.id, h.main])).toEqual([
      ['main1', true],
      ['hand1', false],
    ]);
    expect(survivor!.identifiers).toEqual([
      { scheme: 'viaf', value: '42' },
      { scheme: 'diktyon', value: `${digits}1` },
    ]);
    const [record] = await db.select().from(registryMerges).where(eq(registryMerges.oldId, from.id));
    expect(record).toMatchObject({ kind: 'witness', survivorId: into.id, label: from.name, mergedBy: alice.id });
    expect((await mergesInto(db, 'witness', into.id)).map((m) => m.label)).toEqual([from.name]);
  });

  it('points earlier merges into the merged entry at the new survivor', async () => {
    const a = await witness('Chain A');
    const b = await witness('Chain B');
    const c = await witness('Chain C');
    expect((await mergeWitnesses(db, a.id, b.id, alice)).ok).toBe(true);
    expect((await mergeWitnesses(db, b.id, c.id, alice)).ok).toBe(true);
    const rows = await db.select().from(registryMerges).where(inArray(registryMerges.oldId, [a.id, b.id]));
    expect(rows.map((r) => r.survivorId)).toEqual([c.id, c.id]);
    expect((await mergesInto(db, 'witness', c.id)).map((m) => m.label).sort()).toEqual([a.name, b.name].sort());
    expect(await mergesInto(db, 'witness', b.id)).toEqual([]);
  });

  it('is for administrators and the maintainers of both entries only', async () => {
    const mine = await witness('Permission mine', alice);
    const theirs = await witness('Permission theirs', bob);
    expect(await mergeWitnesses(db, mine.id, theirs.id, alice)).toEqual({ ok: false, error: 'forbidden' });
    expect(await mergeWitnesses(db, mine.id, theirs.id, bob)).toEqual({ ok: false, error: 'forbidden' });
    expect(await mergeWitnesses(db, mine.id, theirs.id, editor)).toEqual({ ok: false, error: 'forbidden' });
    expect(await mergeWitnesses(db, mine.id, theirs.id, null)).toEqual({ ok: false, error: 'forbidden' });
    expect(await mergeWitnesses(db, mine.id, mine.id, admin)).toEqual({ ok: false, error: 'same' });
    expect(await mergeWitnesses(db, mine.id, newId(), admin)).toEqual({ ok: false, error: 'not-found' });
    // Alice made a maintainer of Bob's witness: now she maintains both.
    await addMaintainer(db, 'witness', theirs.id, alice.email);
    expect((await mergeWitnesses(db, mine.id, theirs.id, alice)).ok).toBe(true);
    const other = await witness('Permission other', bob);
    const another = await witness('Permission another', carol);
    expect((await mergeWitnesses(db, other.id, another.id, admin)).ok).toBe(true);
  });
});

describe('merging works', () => {
  it('is blocked when the schemes have different levels', async () => {
    const from = await work('Scheme from', alice, epic);
    const into = await work('Scheme into', alice, { preset: SCHEME_PRESETS[1]!.name });
    const preview = await previewWorkMerge(db, from.id, into.id);
    expect(preview!.blocks.schemeDiffers).toBe(true);
    expect(await mergeWorks(db, from.id, into.id, alice)).toMatchObject({ ok: false, error: 'blocked' });
    expect(await mergeWorks(db, from.id, into.id, bob)).toEqual({ ok: false, error: 'forbidden' });
  });

  it('matches segments by address and moves every reference, the rest with them', async () => {
    const from = await work('Duplicate Iliad', alice, epic, {
      identifier: `urn:cts:greekLit:tlg${digits}.tlg002`,
      identifiers: [{ scheme: 'wikidata', value: `Q${digits}2` }],
    });
    // The survivor prints its labels with a colon: the moved segment is labelled in its scheme.
    const into = await work('Iliad', bob, {
      levels: [
        { key: 'book', label: 'Book', type: 'number', separator: '' },
        { key: 'line', label: 'Line', type: 'number', separator: ':' },
      ],
    });
    await addMaintainer(db, 'work', into.id, alice.email);
    await addMaintainer(db, 'work', from.id, carol.email);

    const shared = await segmentId(into.id, '1:1');
    const oldShared = await segmentId(from.id, '1.1');
    const oldOwn = await segmentId(from.id, '1.2');

    // A transcription of the duplicate, one of both works, and one only chosen for the duplicate.
    const wit = await witness('Work merge witness');
    const tr = await createTranscription(db, { witnessId: wit.id, workIds: [from.id], name: 'T' }, bob.id);
    await replaceContent(db, 'transcription', tr.id, bob.id, 0, await textOf(from.id, { '1.1': 'μῆνιν ἄειδε', '1.2': 'οὐλομένην' }));
    const trBoth = await createTranscription(db, { witnessId: wit.id, workIds: [into.id, from.id], name: 'Both' }, bob.id);
    const both = await textOf(into.id, { '1:1': 'μῆνιν' });
    const extra = await textOf(from.id, { '1.1': 'ἄειδε' });
    await replaceContent(db, 'transcription', trBoth.id, bob.id, 0, { items: [...both.items, { kind: 'break', id: newId(), type: 'line' }, ...extra.items] });
    const trChosen = await createTranscription(db, { witnessId: wit.id, workIds: [from.id], name: 'Chosen' }, bob.id);

    // Records on the shared segment.
    const [conj] = await db
      .insert(conjectures)
      .values({ id: newId(), workId: from.id, segmentId: oldShared, lemma: 'a', reading: 'b', ownerId: bob.id })
      .returning();
    const [transposition] = await db
      .insert(conjectures)
      .values({ id: newId(), workId: from.id, segmentId: oldShared, kind: 'transposition', lemma: 'a', sequence: [oldOwn, oldShared], ownerId: bob.id })
      .returning();
    const [reading] = await db
      .insert(reportedReadings)
      .values({ id: newId(), workId: from.id, segmentId: oldShared, witnessId: wit.id, reading: 'x', ownerId: bob.id })
      .returning();
    const ed = await edition(from.id, bob, [{ witnessId: wit.id, transcriptionId: tr.id }]);
    await replaceContent(db, 'edition', ed, bob.id, 0, await textOf(from.id, { '1.1': 'μῆνιν' }));
    const [note] = await db.insert(notes).values({ id: newId(), editionId: ed, segmentId: oldShared, text: 'n', authorId: bob.id }).returning();
    const [constraint] = await db
      .insert(alignmentConstraints)
      .values({ id: newId(), editionId: ed, segmentId: oldShared, baseTokenIds: [], transcriptionId: tr.id, witnessTokenIds: [] })
      .returning();
    await db.insert(editionSiteReviews).values({ editionId: ed, segmentId: oldShared, siteKey: 'k', reviewedBy: bob.id });
    const itemId = newId();
    created.items.push(itemId);
    await db.insert(bibliographyItems).values({ id: itemId, entryType: 'book', citationKey: `merge-${tag}`, fields: {}, label: 'L' });
    const [citation] = await db.insert(citations).values({ id: newId(), itemId, editionId: ed, segmentId: oldShared }).returning();

    const preview = await previewWorkMerge(db, from.id, into.id);
    expect(preview!.blocks).toEqual({ schemeDiffers: false, labelCollisions: [] });
    expect(preview!.moves).toMatchObject({ segmentsMatched: 1, segmentsMoved: 1, conjectures: 2, readings: 1, transcriptions: 3 });
    expect(preview!.moves.editions).toHaveLength(1);
    expect(preview!.moves.maintainers).toEqual([carol.name]);
    expect(preview!.moves.identifiers).toEqual([`urn:cts:greekLit:tlg${digits}.tlg002`, `Q${digits}2`]);

    // Carol maintains only the duplicate.
    expect(await mergeWorks(db, from.id, into.id, carol)).toEqual({ ok: false, error: 'forbidden' });
    const result = await mergeWorks(db, from.id, into.id, alice);
    expect(result.ok).toBe(true);

    expect(await db.select().from(works).where(eq(works.id, from.id))).toHaveLength(0);
    expect(await db.select().from(segments).where(eq(segments.id, oldShared))).toHaveLength(0);
    const [moved] = await db.select().from(segments).where(eq(segments.id, oldOwn));
    expect(moved).toMatchObject({ workId: into.id, label: '1:2' });

    expect((await db.select().from(conjectures).where(eq(conjectures.id, conj!.id)))[0]).toMatchObject({ workId: into.id, segmentId: shared });
    expect((await db.select().from(conjectures).where(eq(conjectures.id, transposition!.id)))[0]!.sequence).toEqual([oldOwn, shared]);
    expect((await db.select().from(reportedReadings).where(eq(reportedReadings.id, reading!.id)))[0]).toMatchObject({ workId: into.id, segmentId: shared });
    expect((await db.select().from(notes).where(eq(notes.id, note!.id)))[0]!.segmentId).toBe(shared);
    expect((await db.select().from(alignmentConstraints).where(eq(alignmentConstraints.id, constraint!.id)))[0]!.segmentId).toBe(shared);
    expect((await db.select().from(citations).where(eq(citations.id, citation!.id)))[0]!.segmentId).toBe(shared);
    expect((await db.select().from(editionSiteReviews).where(eq(editionSiteReviews.editionId, ed)))[0]!.segmentId).toBe(shared);

    // The edition moved, its text naming the survivor's segment, its history too, with no new changeset.
    const [edRow] = await db.select().from(editions).where(eq(editions.id, ed));
    expect(edRow!.workId).toBe(into.id);
    expect(edRow!.version).toBe(1);
    expect(segmentStarts(edRow!.content).map((s) => s.id)).toEqual([shared]);
    const edHistory = await db.select().from(changesets).where(and(eq(changesets.documentKind, 'edition'), eq(changesets.documentId, ed)));
    expect(edHistory).toHaveLength(1);
    expect(JSON.stringify(edHistory[0]!.ops)).not.toContain(oldShared);
    expect(JSON.stringify(edHistory[0]!.ops)).toContain(shared);

    // The transcriptions: text and index on the survivor's segments, the two runs of one segment numbered apart.
    const [trRow] = await db.select().from(transcriptions).where(eq(transcriptions.id, tr.id));
    expect(trRow!.version).toBe(1);
    expect(segmentStarts(trRow!.content).map((s) => s.id)).toEqual([shared, oldOwn]);
    const index = await db.select().from(transcriptionSegments).where(eq(transcriptionSegments.transcriptionId, tr.id));
    expect(index.map((r) => [r.segmentId, r.workId]).sort()).toEqual([[shared, into.id], [oldOwn, into.id]].sort());
    const [bothRow] = await db.select().from(transcriptions).where(eq(transcriptions.id, trBoth.id));
    expect(segmentStarts(bothRow!.content)).toEqual([
      { id: shared, part: 1 },
      { id: shared, part: 2 },
    ]);
    expect(await db.select().from(transcriptionSegments).where(eq(transcriptionSegments.transcriptionId, trBoth.id))).toHaveLength(2);
    const chosen = await db.select().from(transcriptionWorks).where(inArray(transcriptionWorks.transcriptionId, [trBoth.id, trChosen.id]));
    expect(chosen.map((c) => [c.transcriptionId, c.workId]).sort()).toEqual([[trBoth.id, into.id], [trChosen.id, into.id]].sort());

    // Saving the transcription afterwards goes on from its version as before.
    const saved = await saveOps(db, 'transcription', tr.id, bob.id, 1, [{ t: 'set', id: trRow!.content.items[0]!.id, fields: { form: 'μῆνιν' } }]);
    expect(saved.version).toBe(2);

    const maintainerIds = (await db.select().from(workMaintainers).where(eq(workMaintainers.workId, into.id))).map((m) => m.userId);
    expect(maintainerIds.sort()).toEqual([alice.id, bob.id, carol.id].sort());
    const [survivor] = await db.select().from(works).where(eq(works.id, into.id));
    expect(survivor!.identifier).toBe(`urn:cts:greekLit:tlg${digits}.tlg002`);
    expect(survivor!.identifiers).toEqual([{ scheme: 'wikidata', value: `Q${digits}2` }]);
    expect(await db.select().from(referenceSchemes).where(eq(referenceSchemes.id, from.schemeId))).toHaveLength(0);
    const [record] = await db.select().from(registryMerges).where(eq(registryMerges.oldId, from.id));
    expect(record).toMatchObject({ kind: 'work', survivorId: into.id, label: from.title, mergedBy: alice.id });
  });

  it('keeps the survivor its primary identifier and adds the merged one to the others', async () => {
    const from = await work('Primary from', alice, epic, { identifier: `urn:cts:latinLit:phi${digits}.phi001` });
    const into = await work('Primary into', alice, epic, { identifier: `urn:cts:latinLit:phi${digits}.phi002` });
    expect((await mergeWorks(db, from.id, into.id, admin)).ok).toBe(true);
    const [survivor] = await db.select().from(works).where(eq(works.id, into.id));
    expect(survivor!.identifier).toBe(`urn:cts:latinLit:phi${digits}.phi002`);
    expect(survivor!.identifiers).toEqual([{ scheme: 'cts', value: `urn:cts:latinLit:phi${digits}.phi001` }]);
  });

  it('is blocked when a moved segment would take a label the survivor already has for another address', async () => {
    // A label the scheme would never give that address: a guard against data made by hand or by an older version.
    const from = await work('Collision from', alice, epic);
    const into = await work('Collision into', alice, epic);
    await db.insert(segments).values({ id: newId(), workId: into.id, address: { book: '2', line: '5' }, label: '1.11', sortKey: 'x' });
    await segmentId(from.id, '1.11');
    const preview = await previewWorkMerge(db, from.id, into.id);
    expect(preview!.blocks.labelCollisions).toEqual(['1.11']);
    expect(await mergeWorks(db, from.id, into.id, alice)).toMatchObject({ ok: false, error: 'blocked' });
  });
});
