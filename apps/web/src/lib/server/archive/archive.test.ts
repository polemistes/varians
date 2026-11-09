import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import { conjectures, createDatabase, referenceSchemes, users, witnesses, works, type Database } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { archiveWork, commitArchive, filteredArchiveZip, writeArchive } from './archive.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let root: string;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.insert(users).values({ id: userId, email: `${userId}@test`, name: 'Archivist', passwordHash: 'x' });
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-archive-'));
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe('archive', () => {
  it('writes the work as files and commits them', async () => {
    const sample = await seedSample(db, userId);
    const dir = await writeArchive(db, sample.workId, root);
    const top = (await readdir(dir)).sort();
    expect(top).toEqual(expect.arrayContaining(['README.md', 'work.json', 'segments.tsv', 'conjectures.json', 'reported-readings.json', 'witnesses', 'editions', 'schemas', 'bibliography.json']));
    expect((await readdir(path.join(dir, 'schemas'))).length).toBeGreaterThanOrEqual(9);
    const work = JSON.parse(await readFile(path.join(dir, 'work.json'), 'utf8'));
    expect(work.title).toBe('Iliad');
    expect(work.scheme.levels).toHaveLength(2);
    const segmentsTsv = await readFile(path.join(dir, 'segments.tsv'), 'utf8');
    expect(segmentsTsv.split('\n').filter((l) => l).length).toBe(11);
    const a = JSON.parse(await readFile(path.join(dir, 'witnesses', 'venetus-a', 'transcriptions', 'iliad-1', 'transcription.json'), 'utf8'));
    expect(a.content.items.length).toBeGreaterThan(60);
    const history = await readFile(path.join(dir, 'witnesses', 'venetus-a', 'transcriptions', 'iliad-1', 'history.ndjson'), 'utf8');
    expect(history.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(history.trim()).version).toBe(1);
    const text = await readFile(path.join(dir, 'editions', sample.editionSlug, 'edition.txt'), 'utf8');
    expect(text).toContain('1.1  μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος');
    expect(text).toContain('1.2 μυρί᾽ A C : μυρία B');
    const tei = await readFile(path.join(dir, 'editions', sample.editionSlug, 'edition.tei.xml'), 'utf8');
    expect(tei).toContain('<witness xml:id="wit-A" n="A">Venetus A</witness>');
    expect(tei).toContain('<app><lem wit="#wit-A #wit-C">μυρί᾽</lem><rdg wit="#wit-B">μυρία</rdg></app>');
    const transcriptionTei = await readFile(path.join(dir, 'witnesses', 'venetus-a', 'transcriptions', 'iliad-1', 'transcription.tei.xml'), 'utf8');
    expect(transcriptionTei).toContain('<msIdentifier>');
    expect(transcriptionTei).toContain('<milestone unit="segment" n="1.1"/>');
    const hash = await commitArchive(dir, 'first export');
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await commitArchive(dir, 'nothing changed')).toBeNull();
    const again = await archiveWork(db, sample.workId, root, 'nightly');
    expect(again).toBeNull();
  });

  it('keeps its own repository when the storage sits inside another', async () => {
    const outer = await mkdtemp(path.join(os.tmpdir(), 'varians-outer-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: outer });
      const dir = path.join(outer, 'storage', 'archives', 'work');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'work.json'), '{}');
      const hash = await commitArchive(dir, 'test');
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
      expect(existsSync(path.join(dir, '.git'))).toBe(true);
      // The enclosing repository still has no commit.
      expect(() => execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: outer, stdio: 'ignore' })).toThrow();
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  it('writes for one person only what they may see, as a zip', async () => {
    const sample = await seedSample(db, userId);
    const [first] = await db.select().from(conjectures).where(eq(conjectures.workId, sample.workId)).limit(1);
    const only = {
      transcription: () => true,
      edition: () => false,
      conjecture: (c: { id: string }) => c.id !== first!.id,
      reported: () => true,
      editionWorking: () => true,
    };
    const dir = await writeArchive(db, sample.workId, root, { only });
    const written = JSON.parse(await readFile(path.join(dir, 'conjectures.json'), 'utf8')) as { id: string }[];
    expect(written.map((c) => c.id)).not.toContain(first!.id);
    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, 'editions'))).toBe(false);
    const zip = await filteredArchiveZip(db, { id: sample.workId, slug: 'iliad' }, only, root);
    const chunks: Buffer[] = [];
    for await (const chunk of zip) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
