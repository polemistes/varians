import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, toText, type Token } from '@varians/core';
import { changesets, createDatabase, moments, referenceSchemes, transcriptions, users, witnesses, works, type Database } from '@varians/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { saveOps } from '../documents/service.ts';
import { writeArchive } from './archive.ts';
import { importArchive, removeWorkCompletely } from './import.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let root: string;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

async function clean(): Promise<void> {
  for (const w of await db.select({ id: works.id }).from(works).where(eq(works.slug, 'iliad'))) await removeWorkCompletely(db, w.id);
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values({ id: userId, email: `${userId}@test`, name: 'Reconciler', passwordHash: 'x' });
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-reconcile-'));
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

/** B's transcription as it stands. */
async function transcriptionB(witnessId: string) {
  const [row] = await db.select().from(transcriptions).where(eq(transcriptions.witnessId, witnessId));
  return row!;
}

/** Change the written form of B's n-th word, as an editor's save would. */
async function editWord(witnessId: string, n: number, form: string): Promise<void> {
  const b = await transcriptionB(witnessId);
  const word = b.content.items.filter((i): i is Token => i.kind === 'token')[n]!;
  await saveOps(db, 'transcription', b.id, userId, b.version, [{ t: 'set', id: word.id, fields: { form } }], `word ${n}`);
}

/** Seed, write the archive as it is (ours), and return a fresh directory to write theirs into later. */
async function start() {
  await clean();
  const sample = await seedSample(db, userId);
  const base = await writeArchive(db, sample.workId, path.join(root, newId()));
  return { sample, base };
}

const outcomeOf = (report: Awaited<ReturnType<typeof importArchive>>, id: string) => report.documents.find((d) => d.id === id)!;

describe('importing a history over ours', () => {
  it('reports nothing to do when the archive holds nothing new', async () => {
    const { sample, base } = await start();
    const report = await importArchive(db, base, userId);
    expect(report.documents.every((d) => d.result === 'unchanged')).toBe(true);
    void sample;
  }, 120_000);

  it('fast-forwards when ours is behind theirs', async () => {
    const { sample, base } = await start();
    const bId = sample.witnessIds.B!;
    await editWord(bId, 2, 'ΘΕΑ');
    const theirs = await writeArchive(db, sample.workId, path.join(root, newId()));
    const ahead = toText((await transcriptionB(bId)).content, { form: 'read' });
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, base, userId);
    const report = await importArchive(db, theirs, userId);
    const b = await transcriptionB(bId);
    expect(outcomeOf(report, b.id).result).toBe('fast-forward');
    expect(toText(b.content, { form: 'read' })).toBe(ahead);
    expect(b.version).toBe(2);
  }, 120_000);

  it('merges changes to different words, as one merge changeset that names what it brings in', async () => {
    const { sample, base } = await start();
    const bId = sample.witnessIds.B!;
    await editWord(bId, 2, 'ΘΕΑ');
    const theirs = await writeArchive(db, sample.workId, path.join(root, newId()));
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, base, userId);
    await editWord(bId, 30, 'ΚΥΝΕΣΣΙΝ');
    const report = await importArchive(db, theirs, userId, { source: 'a test' });
    const b = await transcriptionB(bId);
    expect(outcomeOf(report, b.id).result).toBe('merged');
    const words = b.content.items.filter((i): i is Token => i.kind === 'token');
    expect(words[2]!.form).toBe('ΘΕΑ');
    expect(words[30]!.form).toBe('ΚΥΝΕΣΣΙΝ');
    const [merge] = await db.select().from(changesets).where(and(eq(changesets.documentId, b.id), eq(changesets.version, b.version)));
    expect(merge!.merged).toHaveLength(1);
    expect(merge!.message).toBe('merged from a test');
    // Theirs is kept, unapplied, for its provenance.
    expect(await db.select().from(changesets).where(and(eq(changesets.documentId, b.id), isNull(changesets.version)))).toHaveLength(1);
  }, 120_000);

  it('reports a conflict on the same word and leaves ours; keeps ours or takes theirs when asked', async () => {
    const { sample, base } = await start();
    const bId = sample.witnessIds.B!;
    await editWord(bId, 2, 'ΘΕΑ');
    const theirs = await writeArchive(db, sample.workId, path.join(root, newId()));
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, base, userId);
    await editWord(bId, 2, 'ΘΕΑΝ');
    const before = await transcriptionB(bId);

    // A preview is the import rolled back.
    const preview = await importArchive(db, theirs, userId, { dryRun: true, onConflict: 'take' });
    expect(outcomeOf(preview, before.id).result).toBe('taken');
    expect((await transcriptionB(bId)).version).toBe(before.version);
    const keepPreview = await importArchive(db, theirs, userId, { dryRun: true, onConflict: 'keep' });
    expect(outcomeOf(keepPreview, before.id).result).toBe('kept');
    expect(await db.select().from(changesets).where(and(eq(changesets.documentId, before.id), isNull(changesets.version)))).toEqual([]);

    const report = await importArchive(db, theirs, userId);
    const outcome = outcomeOf(report, before.id);
    expect(outcome.result).toBe('conflict');
    expect(outcome.segments).toEqual(['1.1']);
    expect((await transcriptionB(bId)).content).toEqual(before.content);

    const taken = await importArchive(db, theirs, userId, { onConflict: 'take' });
    expect(outcomeOf(taken, before.id).result).toBe('taken');
    const after = await transcriptionB(bId);
    expect(after.content.items.filter((i): i is Token => i.kind === 'token')[2]!.form).toBe('ΘΕΑ');
    const [moment] = await db.select().from(moments).where(and(eq(moments.documentId, before.id), eq(moments.version, before.version)));
    expect(moment!.name).toMatch(/^Before import, \d{4}-\d\d-\d\d$/);
  }, 120_000);
});
