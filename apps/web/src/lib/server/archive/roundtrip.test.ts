import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, toText } from '@varians/core';
import * as schema from '@varians/db/schema';
import { createDatabase, referenceSchemes, transcriptions, users, witnesses, works, type Database } from '@varians/db';
import { eq, getTableColumns, getTableName, inArray, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { adoptConjecture } from '../conjectures.ts';
import { publishEdition } from '../publish.ts';
import { conjectures, registryMerges } from '@varians/db';
import { writeArchive } from './archive.ts';
import { ARCHIVED_TABLES } from './coverage.ts';
import { importArchive, removeWorkCompletely } from './import.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let root: string;
const userId = newId();
const importer = newId();
const collaborator = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

/** Columns that change on every write, and so are not part of the record. */
const VOLATILE = new Set(['updatedAt']);

const tableByName = new Map(
  (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => [getTableName(table), table] as const),
);

/** Every row of every archived table, volatile columns left out, in a stable order. */
async function snapshot(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of ARCHIVED_TABLES) {
    const table = tableByName.get(name)!;
    const keys = Object.keys(getTableColumns(table)).filter((k) => !VOLATILE.has(k));
    const rows = (await db.select().from(table)) as Record<string, unknown>[];
    out[name] = rows
      .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}

async function clean(): Promise<void> {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Exporter', passwordHash: 'x' },
    { id: importer, email: `${importer}@test`, name: 'Importer', passwordHash: 'x' },
    { id: collaborator, email: `${collaborator}@test`, name: 'Collaborator', passwordHash: 'x' },
  ]);
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-roundtrip-'));
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(inArray(referenceSchemes.createdBy, [userId, importer]));
  await db.delete(users).where(inArray(users.id, [userId, importer, collaborator]));
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
    await clean();
  });

  it('brings back every archived row, column by column', async () => {
    const sample = await seedSample(db, userId, { collaboratorId: collaborator });
    // What the seed leaves out because it would change the sample's text: an adoption and a publication.
    const [conjecture] = await db.select().from(conjectures).where(eq(conjectures.workId, sample.workId)).limit(1);
    await adoptConjecture(db, sample.editionId, conjecture!.id);
    await publishEdition(db, sample.editionId, userId);
    // A witness that was merged into A here: the merged id travels with A.
    await db.insert(registryMerges).values({ oldId: newId(), kind: 'witness', survivorId: sample.witnessIds.A!, label: 'Venetus A (registered twice)', mergedBy: userId });

    const original = await snapshot();
    for (const name of ARCHIVED_TABLES) {
      expect(original[name]!.length, `the sample has no row in ${name}`).toBeGreaterThan(0);
    }
    const dir = await writeArchive(db, sample.workId, root);
    await removeWorkCompletely(db, sample.workId);
    const removed = await snapshot();
    // The removal took the work's rows out of every table (entries and schemes others share may stay), so the import has to bring each back.
    for (const name of ARCHIVED_TABLES) {
      // Persons outlive a work: they are matched by id on the way back.
      if (name === 'bibliography_items' || name === 'reference_schemes' || name === 'persons') continue;
      expect(removed[name]!.length, `nothing of the work was removed from ${name}`).toBeLessThan(original[name]!.length);
    }

    await importArchive(db, dir, userId);
    const restored = await snapshot();
    for (const name of ARCHIVED_TABLES) expect(restored[name], name).toEqual(original[name]);
    await clean();
  }, 120_000);
});
