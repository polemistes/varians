import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { newId, type Item, type Stream } from '@varians/core';
import {
  changesets,
  createDatabase,
  desc,
  eq,
  pages,
  transcriptions,
  users,
  witnesses,
  type Database,
} from '@varians/db';
import { conformWitness, describeConformance, formatConformance, wordsOnPage } from './conform.ts';
import { replaceContent, saveOps } from './documents/service.ts';
import { revertTo } from './history.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = {
  user: newId(),
  witness: newId(),
  bare: newId(),
  p1: newId(),
  p2: newId(),
  p3: newId(),
  t: newId(),
  u: newId(),
};

const token = (id: string): Item => ({ kind: 'token', id, form: id });
const pb = (id: string, pageId?: string, label?: string): Item => ({
  kind: 'break',
  id,
  type: 'page',
  ...(pageId ? { pageId } : {}),
  ...(label ? { label } : {}),
});
const shape = (stream: Stream) =>
  stream.items
    .map((i) =>
      i.kind === 'break'
        ? i.type === 'page'
          ? `#${i.pageId === ids.p1 ? 'p1' : i.pageId === ids.p2 ? 'p2' : i.pageId === ids.p3 ? 'p3' : '?'}${i.label ? ':' + i.label : ''}`
          : '/'
        : i.id,
    )
    .join(' ');

async function content(id: string): Promise<Stream> {
  const [row] = await db
    .select({ content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.id, id));
  return row!.content;
}

async function setContent(id: string, items: Item[]): Promise<void> {
  await db.update(transcriptions).set({ content: { items } }).where(eq(transcriptions.id, id));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db
    .insert(users)
    .values({ id: ids.user, email: `${ids.user}@test`, name: 'Conformer', passwordHash: 'x' });
  await db.insert(witnesses).values([
    { id: ids.witness, slug: `w-${ids.witness}`, siglum: 'K', name: 'Conform test' },
    { id: ids.bare, slug: `w-${ids.bare}`, siglum: 'L', name: 'A printed edition' },
  ]);
  await db.insert(pages).values([
    { id: ids.p1, witnessId: ids.witness, label: '1r', position: 1 },
    { id: ids.p2, witnessId: ids.witness, label: '1v', position: 2 },
    { id: ids.p3, witnessId: ids.witness, label: '2r', position: 3 },
  ]);
  await db.insert(transcriptions).values([
    { id: ids.t, witnessId: ids.witness, name: 'Paged', ownerId: ids.user },
    { id: ids.u, witnessId: ids.bare, name: 'Unpaged', ownerId: ids.user },
  ]);
});

afterAll(async () => {
  await db.delete(changesets).where(eq(changesets.documentId, ids.t));
  await db.delete(changesets).where(eq(changesets.documentId, ids.u));
  await db.delete(transcriptions).where(eq(transcriptions.witnessId, ids.witness));
  await db.delete(transcriptions).where(eq(transcriptions.witnessId, ids.bare));
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(witnesses).where(eq(witnesses.id, ids.bare));
  await db.delete(users).where(eq(users.id, ids.user));
  await pool.end();
});

describe('the conformance run', () => {
  it('describes and mends every kind of page break out of shape, once', async () => {
    const items = [
      token('u'),
      pb('x1', ids.p3, '2r'),
      token('c'),
      pb('x2'),
      token('d'),
      pb('x3', ids.p1),
      token('a'),
      pb('x4', 'gone'),
      token('g'),
      pb('x5', ids.p1),
      token('e'),
    ];
    await setContent(ids.t, items);
    await setContent(ids.u, [token('w'), pb('y1', undefined, '17')]);
    const report = describeConformance({ items }, [ids.p1, ids.p2, ids.p3]);
    expect(report).toEqual({
      orphanBreaks: 2,
      wordsUnplaced: 2,
      duplicateBreaks: 1,
      reordered: true,
      labels: 1,
    });

    const first = await conformWitness(db, ids.witness, null, 'Pages reorganized');
    expect(first).toHaveLength(1);
    expect(formatConformance(first[0]!)).toMatch(
      /^Paged \(.+\), version \d+: 2 page breaks naming no page of the witness removed, 2 words now in Staging; 1 second page break of a page joined to the first; pages put in the witness order; 1 label removed from page breaks$/u,
    );
    expect(shape(await content(ids.t))).toBe('u / d / g #p1 a / e #p3 c');
    const [log] = await db
      .select()
      .from(changesets)
      .where(eq(changesets.documentId, ids.t))
      .orderBy(desc(changesets.version))
      .limit(1);
    expect(log).toMatchObject({ message: 'Pages reorganized', userId: null });

    // A witness without pages: a stray page break goes, the text is all not on a page.
    // (conformAll runs this over every transcript; here only this test's own, since other test files share the database.)
    const bare = await conformWitness(db, ids.bare, null, 'Pages reorganized');
    expect(bare.map((o) => o.transcriptionId)).toEqual([ids.u]);
    expect(shape(await content(ids.u))).toBe('w');
    // Idempotent: nothing more to do, nothing written.
    expect(await conformWitness(db, ids.witness, null, 'Pages reorganized')).toEqual([]);
    expect(await conformWitness(db, ids.bare, null, 'Pages reorganized')).toEqual([]);
  });

  it('conforms a whole content written at once, and a version brought back from before a page was removed', async () => {
    const [row] = await db
      .select({ version: transcriptions.version })
      .from(transcriptions)
      .where(eq(transcriptions.id, ids.t));
    const saved = await replaceContent(db, 'transcription', ids.t, ids.user, row!.version, {
      items: [
        pb('z1', ids.p2),
        token('b'),
        pb('z2', ids.p1),
        token('a'),
        pb('z3', 'gone'),
        token('q'),
      ],
    });
    expect(shape(saved.content)).toBe('q #p1 a #p2 b');

    // A version from when a page break named a page that is gone now comes back conformed.
    const gone = newId();
    await db.insert(pages).values({ id: gone, witnessId: ids.witness, label: '0v', position: 0.5 });
    const before = await saveOps(db, 'transcription', ids.t, ids.user, saved.version, [
      { t: 'insert', after: 'q', items: [pb('old', gone), token('r')] },
    ]);
    expect(before.conformed).toBeUndefined();
    expect(shape(before.content)).toBe('q #? r #p1 a #p2 b');
    await db.delete(pages).where(eq(pages.id, gone));
    const [after] = await conformWitness(db, ids.witness, ids.user, 'Page 0v removed');
    expect(after!.version).toBeGreaterThan(before.version);
    expect(shape(await content(ids.t))).toBe('q / r #p1 a #p2 b');
    await revertTo(db, 'transcription', ids.t, ids.user, before.version);
    const reverted = await content(ids.t);
    expect(shape(reverted)).toBe('q / r #p1 a #p2 b');
    expect(wordsOnPage(reverted, ids.p1)).toBe(1);
  });
});
