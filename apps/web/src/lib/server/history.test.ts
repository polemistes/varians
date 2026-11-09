/**
 * The history against a real PostgreSQL: run with the test database
 * migrated (DATABASE_URL_TEST or the default below). The tests run in
 * order and build one document's history step by step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultProfile, fromText, newId, sequentialIds, toText, type Op, type Stream, type Token } from '@varians/core';
import {
  changesets,
  checkpoints,
  createDatabase,
  editions,
  moments,
  referenceSchemes,
  reviewState,
  segments,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
  type DocumentKind,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { loadDocument, nameMoment, saveOps } from './documents/service.ts';
import {
  HistoryError,
  acceptChangesets,
  addMoment,
  documentWithChanges,
  getReviewState,
  historyOf,
  reviewChanges,
  revertTo,
  setReviewFrom,
  undoChangeset,
} from './history.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = {
  ann: newId(),
  bob: newId(),
  scheme: newId(),
  work: newId(),
  witness: newId(),
  transcription: newId(),
  edition: newId(),
  s1: newId(),
  s2: newId(),
};
const T: DocumentKind = 'transcription';
/** Changeset ids by version, as the tests make them. */
const v: Record<number, string> = {};

/** Save as the protocol does, then set the changeset's time, so that sessions can be made. */
async function save(userId: string, ops: Op[], at: string, kind: DocumentKind = T, documentId = ids.transcription) {
  const current = await loadDocument(db, kind, documentId);
  const saved = await saveOps(db, kind, documentId, userId, current.version, ops);
  await db.update(changesets).set({ at: new Date(at) }).where(eq(changesets.id, saved.changesetId));
  if (kind === T) v[saved.version] = saved.changesetId;
  return saved;
}

async function textNow(): Promise<string> {
  return toText((await loadDocument(db, T, ids.transcription)).content);
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values([
    { id: ids.ann, email: `${ids.ann}@test`, name: 'Ann', passwordHash: 'x' },
    { id: ids.bob, email: `${ids.bob}@test`, name: 'Bob', passwordHash: 'x' },
  ]);
  await db.insert(referenceSchemes).values({ id: ids.scheme, name: 'line', levels: [{ key: 'line', label: 'Line', type: 'number', separator: '' }] });
  await db.insert(works).values({ id: ids.work, slug: `w-${ids.work}`, title: 'W', schemeId: ids.scheme, profile: defaultProfile('grc') });
  await db.insert(segments).values([
    { id: ids.s1, workId: ids.work, address: { line: '1' }, label: '1', sortKey: '00000001' },
    { id: ids.s2, workId: ids.work, address: { line: '2' }, label: '2', sortKey: '00000002' },
  ]);
  await db.insert(witnesses).values({ id: ids.witness, slug: `h-${ids.witness}`, siglum: 'H', name: 'H' });
  await db.insert(transcriptions).values({ id: ids.transcription, witnessId: ids.witness, name: 'T', ownerId: ids.ann });
  await db.insert(editions).values({ id: ids.edition, workId: ids.work, slug: `e-${ids.edition}`, title: 'E', ownerId: ids.ann, conventions: DEFAULT_CONVENTIONS });
});

afterAll(async () => {
  const docs = [ids.transcription, ids.edition];
  await db.delete(changesets).where(inArray(changesets.documentId, docs));
  await db.delete(checkpoints).where(inArray(checkpoints.documentId, docs));
  await db.delete(moments).where(inArray(moments.documentId, docs));
  await db.delete(reviewState).where(inArray(reviewState.documentId, docs));
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  await db.delete(users).where(inArray(users.id, [ids.ann, ids.bob]));
  await pool.end();
});

describe('the history of a document', () => {
  it('groups changesets into sessions, each with its author and what it changed', async () => {
    const text: Stream = fromText('μῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος', { ids: sequentialIds('w') });
    // w1 μῆνιν, w2 ἄειδε, w3 θεὰ, w4 the break, w5 Πηληϊάδεω, w6 Ἀχιλῆος
    (text.items[0] as Token).segment = { segmentId: ids.s1 };
    (text.items[4] as Token).segment = { segmentId: ids.s2 };
    await save(ids.ann, [{ t: 'insert', after: null, items: text.items }], '2026-10-01T10:00:00Z');
    await save(ids.ann, [{ t: 'set', id: 'w2', fields: { form: 'ἄειδε,' } }], '2026-10-01T10:05:00Z');
    await save(ids.bob, [{ t: 'insert', after: 'w3', items: [{ kind: 'token', id: 'x1', form: 'καὶ' }] }], '2026-10-01T10:07:00Z');
    await save(ids.ann, [{ t: 'delete', ids: ['w6'] }], '2026-10-01T11:00:00Z');
    await nameMoment(db, T, ids.transcription, 2, 'first draft', ids.ann);

    const history = await historyOf(db, T, ids.transcription);
    expect(history.currentVersion).toBe(4);
    expect(history.sessions.map((s) => [s.userName, s.fromVersion, s.toVersion])).toEqual([
      ['Ann', 4, 4],
      ['Bob', 3, 3],
      ['Ann', 1, 2],
    ]);
    expect(history.sessions.map((s) => s.summary)).toEqual(['1 word removed', '1 word added', '5 words added, 1 line break added']);
    expect(history.sessions[2]!.from).toBe('2026-10-01T10:00:00.000Z');
    expect(history.sessions[2]!.to).toBe('2026-10-01T10:05:00.000Z');
    expect(history.sessions[2]!.changesets.map((c) => [c.version, c.counts.changed])).toEqual([
      [2, 1],
      [1, 0],
    ]);
    expect(history.moments.map((m) => [m.name, m.version, m.createdByName])).toEqual([['first draft', 2, 'Ann']]);
    expect(history.people).toEqual({ [ids.ann]: 'Ann', [ids.bob]: 'Bob' });
    expect(history.truncated).toBe(false);

    const recent = await historyOf(db, T, ids.transcription, { limit: 2 });
    expect(recent.truncated).toBe(true);
    expect(recent.sessions.map((s) => s.toVersion)).toEqual([4, 3]);
  });

  it('names a moment, refusing a version the document never had', async () => {
    const moment = await addMoment(db, T, ids.transcription, ids.bob, 3, '  with καὶ  ');
    expect([moment.name, moment.version, moment.createdByName]).toEqual(['with καὶ', 3, 'Bob']);
    await expect(addMoment(db, T, ids.transcription, ids.bob, 99, 'later')).rejects.toBeInstanceOf(HistoryError);
    expect((await historyOf(db, T, ids.transcription)).moments.map((m) => m.version)).toEqual([3, 2]);
  });

  it('shows the text at a version with what changed since, and who changed it', async () => {
    const atTwo = await documentWithChanges(db, T, ids.transcription, 2);
    expect(atTwo.since).toBe(1);
    expect(toText(atTwo.stream)).toBe('μῆνιν ἄειδε, θεὰ\nΠηληϊάδεω Ἀχιλῆος');
    expect(atTwo.diff.changes.map((c) => c.kind)).toEqual(['changed']);
    expect(atTwo.authors).toEqual({ w2: ids.ann });
    expect(atTwo.labels).toEqual({ [ids.s1]: '1', [ids.s2]: '2' });

    const sinceOne = await documentWithChanges(db, T, ids.transcription, 4, 1);
    expect(toText(sinceOne.stream)).toBe('μῆνιν ἄειδε, θεὰ καὶ\nΠηληϊάδεω');
    const kinds = Object.fromEntries(sinceOne.diff.changes.map((c) => [c.kind === 'changed' ? c.after.id : c.item.id, c.kind]));
    expect(kinds).toEqual({ w2: 'changed', x1: 'added', w6: 'removed' });
    expect(sinceOne.authors).toEqual({ w2: ids.ann, x1: ids.bob, w6: ids.ann });
    expect(sinceOne.people).toEqual({ [ids.ann]: 'Ann', [ids.bob]: 'Bob' });
    const removed = sinceOne.diff.changes.find((c) => c.kind === 'removed');
    expect(removed?.kind === 'removed' ? removed.after : null).toBe('w5');

    const beginning = await documentWithChanges(db, T, ids.transcription, 0);
    expect(beginning.stream.items).toEqual([]);
    await expect(documentWithChanges(db, T, ids.transcription, 5)).rejects.toBeInstanceOf(HistoryError);
  });

  it('brings the text back as it stood, as a new changeset that keeps ids', async () => {
    const before = await loadDocument(db, T, ids.transcription);
    const result = await revertTo(db, T, ids.transcription, ids.bob, 2);
    expect(result.unchanged).toBe(false);
    expect(result.version).toBe(5);
    v[5] = result.changesetId!;
    const now = await loadDocument(db, T, ids.transcription);
    expect(toText(now.content)).toBe('μῆνιν ἄειδε, θεὰ\nΠηληϊάδεω Ἀχιλῆος');
    expect(now.content.items.map((i) => i.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    const [row] = await db.select().from(changesets).where(eq(changesets.id, result.changesetId!));
    expect(row!.message).toBe('brought back as of version 2');
    expect(row!.userId).toBe(ids.bob);
    expect(row!.ops).toHaveLength(1);
    expect(row!.ops[0]!.t).toBe('replace');

    // The history is not rewritten: version 4 still reads as it did.
    expect(toText((await documentWithChanges(db, T, ids.transcription, 4)).stream)).toBe(toText(before.content));
    // Bringing back what already stands changes nothing; a stale view is refused.
    expect(await revertTo(db, T, ids.transcription, ids.bob, 2)).toEqual({ version: 5, changesetId: null, unchanged: true });
    await expect(revertTo(db, T, ids.transcription, ids.bob, 1, { expectedVersion: 4 })).rejects.toMatchObject({ status: 409 });
  });

  it('undoes one change when no later change touched the same words', async () => {
    await save(ids.ann, [{ t: 'insert', after: 'w3', items: [{ kind: 'token', id: 'y1', form: 'τε' }] }], '2026-10-01T12:00:00Z');
    await save(ids.bob, [{ t: 'set', id: 'w5', fields: { form: 'Πηληιάδεω' } }], '2026-10-01T12:01:00Z');
    expect(await textNow()).toBe('μῆνιν ἄειδε, θεὰ τε\nΠηληιάδεω Ἀχιλῆος');
    const result = await undoChangeset(db, T, ids.transcription, ids.ann, v[6]!);
    expect(result).toMatchObject({ ok: true, version: 8, skipped: 0 });
    expect(await textNow()).toBe('μῆνιν ἄειδε, θεὰ\nΠηληιάδεω Ἀχιλῆος');
    const [row] = await db.select().from(changesets).where(eq(changesets.id, result.ok ? result.changesetId! : ''));
    expect(row!.message).toBe('undid version 6');
    v[8] = row!.id;
  });

  it('refuses an undo that later changes conflict with, naming the words, and does what it can when forced', async () => {
    await save(ids.ann, [{ t: 'set', id: 'w1', fields: { form: 'Μῆνιν' } }], '2026-10-01T12:10:00Z');
    await save(ids.bob, [{ t: 'set', id: 'w1', fields: { form: 'μῆνιν·' } }], '2026-10-01T12:11:00Z');
    const refused = await undoChangeset(db, T, ids.transcription, ids.ann, v[9]!);
    expect(refused).toEqual({ ok: false, conflicts: ['w1'], words: { w1: 'μῆνιν·' } });
    expect((await loadDocument(db, T, ids.transcription)).version).toBe(10);

    const forced = await undoChangeset(db, T, ids.transcription, ids.ann, v[9]!, true);
    expect(forced).toMatchObject({ ok: true, version: 11, skipped: 0 });
    expect(await textNow()).toBe('μῆνιν ἄειδε, θεὰ\nΠηληιάδεω Ἀχιλῆος');

    // An undo of words a later change removed brings back nothing, and says so.
    await save(ids.bob, [{ t: 'insert', after: 'w5', items: [{ kind: 'token', id: 'z1', form: 'Ἀτρεΐδης' }] }], '2026-10-01T12:20:00Z');
    await save(ids.ann, [{ t: 'delete', ids: ['z1'] }], '2026-10-01T12:21:00Z');
    const gone = await undoChangeset(db, T, ids.transcription, ids.ann, v[12]!, true);
    expect(gone).toEqual({ ok: true, version: 13, changesetId: null, skipped: 1 });
    await expect(undoChangeset(db, T, ids.transcription, ids.ann, 'no-such-change')).rejects.toMatchObject({ status: 404 });
  });

  it('lists the changes of others since the review point, accepts them and moves the point', async () => {
    expect(await getReviewState(db, T, ids.transcription, ids.ann)).toEqual({ fromVersion: 0, accepted: [] });
    const review = await reviewChanges(db, T, ids.transcription, ids.ann);
    const bobs = [3, 5, 7, 10, 12];
    expect(review.items.map((i) => i.version).sort((a, b) => a - b)).toEqual(bobs);
    expect(review.items.every((i) => i.userName === 'Bob' && !i.accepted)).toBe(true);
    expect(review.remaining).toBe(5);
    expect(review.labels[ids.s1]).toBe('1');
    // In the order of the text: the first word, then the word added after θεὰ (gone since) and the
    // revert that removed it, then the second line.
    expect(review.items.map((i) => i.version)).toEqual([10, 3, 5, 7, 12]);
    const respelt = review.items.find((i) => i.version === 7)!;
    expect(respelt.summary).toBe('1 word changed');
    expect(respelt.before).toHaveLength(1);
    expect(respelt.after[0]!.segmentId).toBe(ids.s2);
    const changedCell = respelt.after[0]!.cells.find((c) => c?.changed);
    expect(changedCell?.item).toMatchObject({ id: 'w5', form: 'Πηληιάδεω' });

    const state = await acceptChangesets(db, T, ids.transcription, ids.ann, [v[3]!, v[3]!, v[7]!, 'elsewhere']);
    expect(state.accepted.sort()).toEqual([v[3]!, v[7]!].sort());
    await acceptChangesets(db, T, ids.transcription, ids.ann, [v[10]!]);
    const after = await reviewChanges(db, T, ids.transcription, ids.ann);
    expect(after.remaining).toBe(2);
    expect(after.items.filter((i) => i.accepted).map((i) => i.version).sort((a, b) => a - b)).toEqual([3, 7, 10]);

    // Bob sees Ann's changes, not his own.
    const bobsReview = await reviewChanges(db, T, ids.transcription, ids.bob);
    expect(bobsReview.items.every((i) => i.userId === ids.ann)).toBe(true);

    // Moving the review point drops what was accepted before it.
    const moved = await setReviewFrom(db, T, ids.transcription, ids.ann, 7);
    expect(moved).toEqual({ fromVersion: 7, accepted: [v[10]!] });
    const fromSeven = await reviewChanges(db, T, ids.transcription, ids.ann);
    expect(fromSeven.items.map((i) => i.version).sort((a, b) => a - b)).toEqual([10, 12]);
    expect(fromSeven.remaining).toBe(1);
  });

  it('rejects a change in review by undoing it and marking it reviewed', async () => {
    await save(ids.bob, [{ t: 'set', id: 'w3', fields: { form: 'θεά' } }], '2026-10-01T13:00:00Z');
    const result = await undoChangeset(db, T, ids.transcription, ids.ann, v[14]!, false, { reviewed: true });
    expect(result.ok).toBe(true);
    expect(await textNow()).toBe('μῆνιν ἄειδε, θεὰ\nΠηληιάδεω Ἀχιλῆος');
    const state = await getReviewState(db, T, ids.transcription, ids.ann);
    expect(state.accepted).toContain(v[14]!);
    const [row] = await db.select().from(changesets).where(eq(changesets.id, result.ok ? result.changesetId! : ''));
    expect(row!.message).toBe('rejected version 14');
  });

  it('keeps the history of an edition the same way', async () => {
    const text = fromText('ἄνδρα μοι ἔννεπε', { ids: sequentialIds('e') });
    await save(ids.ann, [{ t: 'insert', after: null, items: text.items }], '2026-10-01T09:00:00Z', 'edition', ids.edition);
    await save(ids.bob, [{ t: 'set', id: 'e2', fields: { form: 'μοι,' } }], '2026-10-01T09:30:00Z', 'edition', ids.edition);
    const history = await historyOf(db, 'edition', ids.edition);
    expect(history.sessions.map((s) => s.summary)).toEqual(['1 word changed', '3 words added']);
    const back = await revertTo(db, 'edition', ids.edition, ids.ann, 1);
    expect(back.version).toBe(3);
    expect(toText((await loadDocument(db, 'edition', ids.edition)).content)).toBe('ἄνδρα μοι ἔννεπε');
  });
});
