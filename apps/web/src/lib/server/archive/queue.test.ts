import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type Token } from '@varians/core';
import { archiveQueue, conjectures, createDatabase, editionSigla, referenceSchemes, transcriptions, users, witnesses, works, zones, type Database } from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { replaceContent } from '../documents/service.ts';
import { addNote } from '../notes.ts';
import { archiveWork } from './archive.ts';
import { checkArchive, isClean } from './check.ts';
import { flushArchiveQueue } from './queue.ts';
import { commitDocument } from './commits.ts';
import { execFileSync } from 'node:child_process';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let root: string;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

async function clean(): Promise<void> {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values({ id: userId, email: `${userId}@test`, name: 'Writer', passwordHash: 'x' });
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-queue-'));
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe('archive write-through', () => {
  it('records changes on the queue and writes only once they are quiet', async () => {
    const sample = await seedSample(db, userId);
    await archiveWork(db, sample.workId, root, 'first');
    const queued = await db.select().from(archiveQueue).where(and(eq(archiveQueue.kind, 'edition'), eq(archiveQueue.recordId, sample.editionId)));
    expect(queued).toHaveLength(1);
    // Not quiet for an hour yet: nothing is taken.
    await flushArchiveQueue(db, { root, delaySeconds: 3600 });
    expect(await db.select().from(archiveQueue).where(eq(archiveQueue.recordId, sample.editionId))).toHaveLength(1);
    await clean();
  });

  it('after a sequence of saves, the files are those a full write gives', async () => {
    const sample = await seedSample(db, userId);
    const dir = await archiveWork(db, sample.workId, root, 'first').then(() => path.join(root, 'iliad'));
    await flushArchiveQueue(db, { root, delaySeconds: 0 });

    // A save to B's text: one word changed.
    const [b] = await db.select().from(transcriptions).where(eq(transcriptions.witnessId, sample.witnessIds.B!));
    const content = structuredClone(b!.content);
    const word = content.items.find((i): i is Token => i.kind === 'token' && i.form === 'κύνεσσιν')!;
    word.form = 'κυσίν';
    await replaceContent(db, 'transcription', b!.id, userId, b!.version, content, 'a word');
    // A note, a renamed transcription, a renamed witness, a zone gone, a new conjecture, a siglum gone.
    await addNote(db, sample.editionId, { segmentId: content.items.find((i): i is Token => i.kind === 'token' && !!i.segment)!.segment!.segmentId!, text: 'A second note.' }, userId);
    const [c] = await db.select().from(transcriptions).where(eq(transcriptions.witnessId, sample.witnessIds.C!));
    await db.update(transcriptions).set({ name: 'Iliad 1, collated' }).where(eq(transcriptions.id, c!.id));
    await db.update(witnesses).set({ name: 'Venetus B (Marc. gr. 453)' }).where(eq(witnesses.id, sample.witnessIds.B!));
    await db.delete(zones).where(inArray(zones.transcriptionId, [b!.id, c!.id]));
    const [any] = await db.select().from(conjectures).where(eq(conjectures.workId, sample.workId)).limit(1);
    await db.insert(conjectures).values({ id: newId(), workId: sample.workId, segmentId: any!.segmentId, lemma: 'πᾶσι', reading: 'πάντα', proposer: 'Anon.', ownerId: userId });
    await db.delete(editionSigla).where(and(eq(editionSigla.editionId, sample.editionId), eq(editionSigla.witnessId, sample.witnessIds.T!)));

    const written = await flushArchiveQueue(db, { root, delaySeconds: 0 });
    expect(written).toContain(sample.workId);
    expect(await readFile(path.join(dir, 'witnesses', 'venetus-b', 'witness.json'), 'utf8')).toContain('Venetus B (Marc. gr. 453)');
    expect(existsSync(path.join(dir, 'witnesses', 'laurentianus-c', 'transcriptions', 'iliad-1-collated', 'transcription.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'witnesses', 'laurentianus-c', 'transcriptions', 'iliad-1'))).toBe(false);
    // T entered only through the conspectus and a reported reading; the reading keeps it in the archive.
    expect(existsSync(path.join(dir, 'witnesses', 'townleianus-t', 'witness.json'))).toBe(true);
    const differences = await checkArchive(db, { id: sample.workId, slug: 'iliad' }, root);
    expect(differences).toEqual({ missing: [], extra: [], changed: [] });
    expect(isClean(differences)).toBe(true);
    await clean();
  }, 120_000);

  it('commits a named moment in the work of the document, authored by the person without their address', async () => {
    const sample = await seedSample(db, userId);
    await archiveWork(db, sample.workId, root, 'first');
    await addNote(db, sample.editionId, { segmentId: (await db.select().from(conjectures).where(eq(conjectures.workId, sample.workId)).limit(1))[0]!.segmentId, text: 'Before the moment.' }, userId);
    const hashes = await commitDocument(db, 'edition', sample.editionId, 'moment: checked', userId, root);
    expect(hashes).toHaveLength(1);
    const author = execFileSync('git', ['log', '-1', '--format=%an <%ae>|%s'], { cwd: path.join(root, 'iliad') }).toString().trim();
    expect(author).toBe(`Writer <${userId.toLowerCase()}@persons.invalid>|moment: checked`);
    await clean();
  }, 120_000);
});
