import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, toText } from '@varians/core';
import { createDatabase, referenceSchemes, transcriptions, users, witnesses, works, type Database } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { writeArchive } from './archive.ts';
import { importArchive, removeWorkCompletely } from './import.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let root: string;
const userId = newId();
const importer = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Exporter', passwordHash: 'x' },
    { id: importer, email: `${importer}@test`, name: 'Importer', passwordHash: 'x' },
  ]);
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-roundtrip-'));
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, importer));
  await db.delete(users).where(inArray(users.id, [userId, importer]));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe('archive round trip', () => {
  it('imports an exported work back, same ids and texts, after it was removed', async () => {
    const sample = await seedSample(db, userId);
    const dir = await writeArchive(db, sample.workId, root);
    const before = await readFile(path.join(dir, 'editions', sample.editionSlug, 'edition.txt'), 'utf8');
    const [a] = await db.select().from(transcriptions).where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    const aText = toText(a!.content, { form: 'read' });

    await removeWorkCompletely(db, sample.workId);
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(works).where(eq(works.id, sample.workId))).toEqual([]);

    const report = await importArchive(db, dir, importer);
    expect(report.workId).toBe(sample.workId);
    expect(report.witnesses).toBe(4);
    expect(report.transcriptions).toBe(3);
    expect(report.editions).toBe(1);
    expect(report.changesets).toBeGreaterThanOrEqual(4);
    const [restored] = await db.select().from(transcriptions).where(eq(transcriptions.id, a!.id));
    expect(restored?.ownerId).toBe(importer);
    expect(toText(restored!.content, { form: 'read' })).toBe(aText);

    const again = await writeArchive(db, sample.workId, root);
    const after = await readFile(path.join(again, 'editions', sample.editionSlug, 'edition.txt'), 'utf8');
    expect(after).toBe(before);
    await db.insert(users).values({ id: userId, email: `${userId}@test`, name: 'Exporter', passwordHash: 'x' });
  });
});
