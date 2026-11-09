import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import { createDatabase, referenceSchemes, users, witnesses, works, type Database } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { publishEdition } from '../publish.ts';
import { writeArchive } from './archive.ts';
import { validateArchiveDir } from './validate.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let root: string;
const userId = newId();
const collaborator = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

async function clean(): Promise<void> {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Validator', passwordHash: 'x' },
    { id: collaborator, email: `${collaborator}@test`, name: 'Collaborator', passwordHash: 'x' },
  ]);
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-validate-'));
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(inArray(users.id, [userId, collaborator]));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe('archive validation', () => {
  it('finds every file of a written archive valid against its schema', async () => {
    const sample = await seedSample(db, userId, { collaboratorId: collaborator });
    await publishEdition(db, sample.editionId, userId);
    const dir = await writeArchive(db, sample.workId, root);
    expect(await validateArchiveDir(dir)).toEqual([]);
    // The first member of every JSON file is its schema's address.
    const work = await readFile(path.join(dir, 'work.json'), 'utf8');
    expect(work).toMatch(/^\{\n {2}"\$schema": "https:\/\/varians\.eu\/formats\/2\/work\.schema\.json",/);
    const segments = await readFile(path.join(dir, 'segments.tsv'), 'utf8');
    expect(segments.split('\n')[0]).toBe('id\tlabel\tsort_key\taddress\turn\tcreated_at');
    expect(segments).toContain('\turn:cts:greekLit:tlg0012.tlg001:1.5\t');
    await clean();
  }, 120_000);

  it('reports a file that breaks its schema, and one that names none', async () => {
    const sample = await seedSample(db, userId);
    const dir = await writeArchive(db, sample.workId, root);
    const file = path.join(dir, 'work.json');
    const work = JSON.parse(await readFile(file, 'utf8'));
    delete work.title;
    await writeFile(file, JSON.stringify(work));
    await writeFile(path.join(dir, 'stray.json'), '{"a": 1}');
    const problems = await validateArchiveDir(dir);
    expect(problems.map((p) => p.file).sort()).toEqual(['stray.json', 'work.json']);
    await clean();
  }, 120_000);
});
