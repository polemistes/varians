/**
 * The save protocol against a real PostgreSQL: run with the test database
 * migrated (DATABASE_URL_TEST or the default below).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyOps,
  defaultProfile,
  fold,
  fromText,
  newId,
  sequentialIds,
  toText,
  type Item,
  type Op,
  type Stream,
} from '@varians/core';
import {
  createDatabase,
  pages,
  referenceSchemes,
  segments,
  transcriptionSegments,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import {
  CHECKPOINT_EVERY,
  VersionConflict,
  documentAt,
  history,
  rebuildSegmentIndex,
  saveOps,
} from './service.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = {
  user: newId(),
  scheme: newId(),
  work: newId(),
  witness: newId(),
  transcription: newId(),
  segment: newId(),
};

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db
    .insert(users)
    .values({ id: ids.user, email: `${ids.user}@test`, name: 'T', passwordHash: 'x' });
  await db.insert(referenceSchemes).values({
    id: ids.scheme,
    name: 'line',
    levels: [{ key: 'line', label: 'Line', type: 'number', separator: '' }],
  });
  await db.insert(works).values({
    id: ids.work,
    slug: `w-${ids.work}`,
    title: 'W',
    schemeId: ids.scheme,
    profile: defaultProfile('grc'),
  });
  await db.insert(segments).values({
    id: ids.segment,
    workId: ids.work,
    address: { line: '1' },
    label: '1',
    sortKey: '00000001',
  });
  await db
    .insert(witnesses)
    .values({ id: ids.witness, slug: `a-${ids.witness}`, siglum: 'A', name: 'A' });
  await db
    .insert(transcriptions)
    .values({ id: ids.transcription, witnessId: ids.witness, name: 'T', ownerId: ids.user });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  await db.delete(users).where(eq(users.id, ids.user));
  await pool.end();
});

describe('saveOps', () => {
  it('applies operations, bumps the version and records the changeset with its reverse', async () => {
    const stream: Stream = fromText('μῆνιν ἄειδε', { ids: sequentialIds('a') });
    (stream.items[0] as { segment?: unknown }).segment = { segmentId: ids.segment };
    const first = await saveOps(db, 'transcription', ids.transcription, ids.user, 0, [
      { t: 'insert', after: null, items: stream.items },
    ]);
    expect(first.version).toBe(1);
    expect(toText(first.content)).toBe('μῆνιν ἄειδε');
    const second = await saveOps(db, 'transcription', ids.transcription, ids.user, 1, [
      { t: 'set', id: 'a2', fields: { form: 'ἄειδε,' } },
    ]);
    expect(second.version).toBe(2);
    const log = await history(db, 'transcription', ids.transcription);
    expect(log.map((c) => c.version)).toEqual([2, 1]);
    expect(log[0]!.reverse).toEqual([{ t: 'set', id: 'a2', fields: { form: 'ἄειδε' } }]);
    const indexed = await db.query.transcriptionSegments.findMany({
      where: (t, { eq }) => eq(t.transcriptionId, ids.transcription),
    });
    expect(indexed).toHaveLength(1);
    expect(indexed[0]!.foldText).toBe('μῆνιν ἄειδε');
    expect(indexed[0]!.unitCount).toBe(2);
  });

  it('refuses a stale version and hands back what changed since', async () => {
    await expect(
      saveOps(db, 'transcription', ids.transcription, ids.user, 1, [
        { t: 'set', id: 'a1', fields: { form: 'x' } },
      ]),
    ).rejects.toBeInstanceOf(VersionConflict);
    try {
      await saveOps(db, 'transcription', ids.transcription, ids.user, 1, [
        { t: 'set', id: 'a1', fields: { form: 'x' } },
      ]);
    } catch (error) {
      const conflict = error as VersionConflict;
      expect(conflict.current.version).toBe(2);
      expect(conflict.since.map((c) => c.version)).toEqual([2]);
    }
  });

  it('rebuilds the document as it stood at an earlier version', async () => {
    const atOne = await documentAt(db, 'transcription', ids.transcription, 1);
    expect(toText(atOne)).toBe('μῆνιν ἄειδε');
    const atTwo = await documentAt(db, 'transcription', ids.transcription, 2);
    expect(toText(atTwo)).toBe('μῆνιν ἄειδε,');
  });

  it('writes a checkpoint every so many versions and reads forward from it', async () => {
    let version = 2;
    while (version < CHECKPOINT_EVERY + 2) {
      const result = await saveOps(db, 'transcription', ids.transcription, ids.user, version, [
        { t: 'set', id: 'a1', fields: { form: `v${version + 1}` } },
      ]);
      version = result.version;
    }
    const checkpoint = await db.query.checkpoints.findFirst({
      where: (t, { eq }) => eq(t.documentId, ids.transcription),
    });
    expect(checkpoint?.version).toBe(CHECKPOINT_EVERY);
    const at = await documentAt(db, 'transcription', ids.transcription, CHECKPOINT_EVERY + 1);
    expect(toText(at).startsWith(`v${CHECKPOINT_EVERY + 1}`)).toBe(true);
  });
});

describe("saveOps keeps a transcript in the shape of its witness's pages", () => {
  const shaped = newId();
  const p1 = newId();
  const p2 = newId();
  let version = 0;
  /** Page breaks by the page they name, everything else by its id. */
  const shape = (stream: Stream) =>
    stream.items.map((i) =>
      i.kind === 'break' ? `#${i.type === 'page' ? i.pageId : i.type}` : i.id,
    );
  const word = (id: string): Item => ({ kind: 'token', id, form: id });
  const pageBreak = (id: string, pageId: string): Item => ({
    kind: 'break',
    id,
    type: 'page',
    pageId,
  });
  const save = async (ops: Op[]) => {
    const saved = await saveOps(db, 'transcription', shaped, ids.user, version, ops);
    version = saved.version;
    return saved;
  };

  beforeAll(async () => {
    await db
      .insert(transcriptions)
      .values({ id: shaped, witnessId: ids.witness, name: 'Shaped', ownerId: ids.user });
    await db.insert(pages).values([
      { id: p1, witnessId: ids.witness, label: '1r', position: 1 },
      { id: p2, witnessId: ids.witness, label: '1v', position: 2 },
    ]);
  });

  it('adds nothing to a save that leaves the pages in shape', async () => {
    const saved = await save([
      { t: 'insert', after: null, items: [word('u1'), pageBreak('b1', p1), word('a1')] },
    ]);
    expect(saved.version).toBe(1);
    expect(saved.conformed).toBeUndefined();
    expect(shape(saved.content)).toEqual(['u1', `#${p1}`, 'a1']);
  });

  it('sends the text under a break naming no page of the witness to Not on a page, as a changeset of its own', async () => {
    const before = (await save([{ t: 'set', id: 'u1', fields: { form: 'u1' } }])).content;
    const dead = newId();
    const ops: Op[] = [{ t: 'insert', after: 'a1', items: [pageBreak('gone', dead), word('x1')] }];
    const saved = await save(ops);
    expect(saved.version).toBe(4);
    expect(shape(saved.content)).toEqual(['u1', '#line', 'x1', `#${p1}`, 'a1']);
    // Whoever sent the operations can follow: theirs, then the changeset handed back.
    expect(saved.conformed?.version).toBe(4);
    expect(applyOps(applyOps(before, ops).stream, saved.conformed!.ops).stream).toEqual(
      saved.content,
    );
    const [last, mine] = await history(db, 'transcription', shaped);
    expect(last).toMatchObject({
      version: 4,
      message: 'Pages reorganized',
      id: saved.conformed!.id,
    });
    expect(last!.userId).toBeFalsy();
    expect(mine).toMatchObject({ version: 3, id: saved.changesetId, userId: ids.user });
    // The stored document and its past versions agree with what was answered.
    expect(await documentAt(db, 'transcription', shaped, 4)).toEqual(saved.content);
    expect(shape(await documentAt(db, 'transcription', shaped, 3))).toContain(`#${dead}`);
  });

  it('joins a second break for a page to the first, and puts pages back in the order of the witness', async () => {
    // Two editors each began the text of 1v, and one placed it before 1r.
    const saved = await save([
      { t: 'insert', after: 'x1', items: [pageBreak('b2', p2), word('c1')] },
      { t: 'insert', after: 'a1', items: [pageBreak('b2bis', p2), word('c2')] },
    ]);
    expect(saved.conformed).toBeDefined();
    const pagesNamed = shape(saved.content).filter((s) => s.startsWith('#') && s !== '#line');
    expect(pagesNamed).toEqual([`#${p1}`, `#${p2}`]);
    const text = shape(saved.content).filter((s) => !s.startsWith('#'));
    expect(text).toEqual(['u1', 'x1', 'a1', 'c1', 'c2']);
  });

  it('adds nothing again once the text is in shape', async () => {
    const saved = await saveOps(db, 'transcription', shaped, ids.user, version, [
      { t: 'set', id: 'c2', fields: { form: 'c2!' } },
    ]);
    expect(saved.version).toBe(version + 1);
    expect(saved.conformed).toBeUndefined();
  });
});

describe('the segment index of a transcript', () => {
  const indexed = newId();
  const segmentIds = [newId(), newId(), newId()];
  let version = 0;
  const save = async (ops: Op[]) => {
    version = (await saveOps(db, 'transcription', indexed, ids.user, version, ops)).version;
  };
  /** The rows, by segment, with the transaction that wrote each: a row left alone keeps its own. */
  const rows = async () => {
    const found = await db.execute<{
      segment_id: string;
      fold_text: string;
      unit_count: number;
      written: string;
    }>(
      sql`select segment_id, fold_text, unit_count, xmin::text as written from transcription_segments where transcription_id = ${indexed}`,
    );
    return new Map(found.rows.map((r) => [r.segment_id, r] as const));
  };
  const line = (n: number, text: string): Item[] =>
    text.split(' ').map((form, i) => ({
      kind: 'token',
      id: `s${n}w${i + 1}`,
      form,
      ...(i === 0 ? { segment: { segmentId: segmentIds[n]! } } : {}),
    }));

  beforeAll(async () => {
    await db.insert(segments).values(
      segmentIds.map((id, n) => ({
        id,
        workId: ids.work,
        address: { line: String(n + 10) },
        label: String(n + 10),
        sortKey: `0000001${n}`,
      })),
    );
    await db
      .insert(transcriptions)
      .values({ id: indexed, witnessId: ids.witness, name: 'Indexed', ownerId: ids.user });
  });

  it('holds a row for each segment, and rewrites only the rows of the segments a save changed', async () => {
    await save([
      {
        t: 'insert',
        after: null,
        items: [...line(0, 'ἄλφα βῆτα'), ...line(1, 'γάμμα δέλτα'), ...line(2, 'ἔψιλον')],
      },
    ]);
    const first = await rows();
    expect([...first.keys()].sort()).toEqual([...segmentIds].sort());
    const folded = (text: string) => fold(text, defaultProfile('grc').fold);
    expect(first.get(segmentIds[1]!)!.fold_text).toBe(folded('γάμμα') + ' ' + folded('δέλτα'));
    await save([{ t: 'set', id: 's1w2', fields: { form: 'Δέλτα' } }]);
    const second = await rows();
    // The fold does not tell Δέλτα from δέλτα: nothing was written. A word that differs is.
    expect(folded('Δέλτα')).toBe(folded('δέλτα'));
    expect(second.get(segmentIds[1]!)!.written).toBe(first.get(segmentIds[1]!)!.written);
    await save([{ t: 'set', id: 's1w2', fields: { form: 'ζῆτα' } }]);
    const third = await rows();
    expect(third.get(segmentIds[1]!)!.fold_text).toBe(folded('γάμμα') + ' ' + folded('ζῆτα'));
    expect(third.get(segmentIds[1]!)!.written).not.toBe(first.get(segmentIds[1]!)!.written);
    for (const id of [segmentIds[0]!, segmentIds[2]!])
      expect(third.get(id)!.written).toBe(first.get(id)!.written);
  });

  it('drops the rows of a segment that loses its text and adds those of one that gains some', async () => {
    const before = await rows();
    await save([
      { t: 'delete', ids: ['s2w1'] },
      { t: 'insert', after: 's0w2', items: [{ kind: 'token', id: 'n1', form: 'νῦ' }] },
    ]);
    const after = await rows();
    expect([...after.keys()].sort()).toEqual([segmentIds[0]!, segmentIds[1]!].sort());
    expect(after.get(segmentIds[0]!)!.fold_text).toBe(
      ['ἄλφα', 'βῆτα', 'νῦ'].map((w) => fold(w, defaultProfile('grc').fold)).join(' '),
    );
    expect(after.get(segmentIds[0]!)!.unit_count).toBe(3);
    expect(after.get(segmentIds[1]!)!.written).toBe(before.get(segmentIds[1]!)!.written);
  });

  it('is what a rebuild from nothing would give', async () => {
    const current = await rows();
    await db
      .delete(transcriptionSegments)
      .where(eq(transcriptionSegments.transcriptionId, indexed));
    expect((await rows()).size).toBe(0);
    await rebuildSegmentIndex(db, indexed, await documentAt(db, 'transcription', indexed, version));
    const rebuilt = await rows();
    const flat = (m: typeof rebuilt) =>
      [...m].map(([k, r]) => [k, r.fold_text, r.unit_count] as const).sort();
    expect(flat(rebuilt)).toEqual(flat(current));
  });

  it('puts right a row that has come to differ from the text when it is rebuilt whole, and leaves it where a save touched other segments', async () => {
    const content = await documentAt(db, 'transcription', indexed, version);
    const tamper = () =>
      db
        .update(transcriptionSegments)
        .set({ foldText: 'wrong' })
        .where(eq(transcriptionSegments.segmentId, segmentIds[1]!));
    await tamper();
    await save([{ t: 'set', id: 's0w1', fields: { form: 'ἄλφα,' } }]);
    expect((await rows()).get(segmentIds[1]!)!.fold_text).toBe('wrong');
    await rebuildSegmentIndex(db, indexed, content);
    expect((await rows()).get(segmentIds[1]!)!.fold_text).not.toBe('wrong');
  });
});
