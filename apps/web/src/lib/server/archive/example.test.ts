import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import {
  changesets,
  createDatabase,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { formatsDir } from './archive.ts';
import { exampleWorks } from './example.ts';
import { openPackageZip } from './package.ts';
import { importArchive, removeWorkCompletely } from './import.ts';
import { hasXmllint, validateArchiveDir, validateTeiFiles } from './validate.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const importer = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const example = path.join(formatsDir()!, 'example');

async function clean(): Promise<void> {
  for (const w of await db.select({ id: works.id }).from(works).where(eq(works.slug, 'iliad')))
    await removeWorkCompletely(db, w.id);
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  // Changesets have no foreign key: those of an earlier run of this test are removed by the ids the example names.
  const [dir] = await exampleWorks(example);
  const ids = await documentIds(dir!);
  if (ids.length) await db.delete(changesets).where(inArray(changesets.documentId, ids));
  await db
    .insert(users)
    .values({ id: importer, email: `${importer}@test`, name: 'Importer', passwordHash: 'x' });
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, importer));
  await db.delete(users).where(eq(users.id, importer));
  await pool.end();
});

/** The ids of the example's transcriptions and editions. */
async function documentIds(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const w of await readdir(path.join(dir, 'witnesses'))) {
    for (const t of await readdir(path.join(dir, 'witnesses', w, 'transcriptions')).catch(
      () => [] as string[],
    )) {
      out.push(
        JSON.parse(
          await readFile(
            path.join(dir, 'witnesses', w, 'transcriptions', t, 'transcription.json'),
            'utf8',
          ),
        ).id,
      );
    }
  }
  for (const e of await readdir(path.join(dir, 'editions')))
    out.push(JSON.parse(await readFile(path.join(dir, 'editions', e, 'edition.json'), 'utf8')).id);
  return out;
}

describe('the example archive of the format', () => {
  it('is valid: every JSON file against its schema, every TEI file against the RelaxNG', async () => {
    const [dir] = await exampleWorks(example);
    expect(dir).toBeDefined();
    expect(await validateArchiveDir(dir!)).toEqual([]);
    if (hasXmllint()) expect(await validateTeiFiles(dir!)).toEqual([]);
    const pagesFile = JSON.parse(
      await readFile(path.join(dir!, 'witnesses', 'venetus-a', 'pages.json'), 'utf8'),
    ) as { pages: { image: { file: string | null } | null }[] };
    const withImage = pagesFile.pages.find((p) => p.image?.file);
    expect(withImage).toBeDefined();
    expect(existsSync(path.join(dir!, 'witnesses', 'venetus-a', withImage!.image!.file!))).toBe(
      true,
    );
  });

  it('is read back by the import', async () => {
    const [dir] = await exampleWorks(example);
    const report = await importArchive(db, dir!, importer);
    expect(report.witnesses).toBe(4);
    expect(report.transcriptions).toBe(3);
    expect(report.editions).toBe(1);
    expect(report.changesets).toBeGreaterThan(3);
    expect(report.documents.map((d) => d.result)).toEqual([
      'created',
      'created',
      'created',
      'created',
    ]);
    await clean();
  }, 120_000);

  it('holds the same work as a package, whose checksums are right', async () => {
    const opened = await openPackageZip(path.join(example, 'iliad.zip'));
    try {
      expect(opened.bag).toBe(true);
      expect(opened.info['Varians-Format-Version']).toBe('2');
      expect(opened.workDirs.map((d) => path.basename(d))).toEqual(['iliad']);
      expect(await validateArchiveDir(opened.workDirs[0]!)).toEqual([]);
    } finally {
      await rm(opened.dir, { recursive: true, force: true });
    }
  });
});
