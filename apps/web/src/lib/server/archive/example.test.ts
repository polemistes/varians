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

  it('gives in the files of its edition the segments by their milestones, and the conjectures and the reported reading it holds', async () => {
    const [dir] = await exampleWorks(example);
    const edition = path.join(dir!, 'editions', 'iliad-1-working-edition');
    const tei = await readFile(path.join(edition, 'edition.tei.xml'), 'utf8');
    expect(tei).toMatch(
      /<milestone unit="segment" n="1\.1" xml:id="seg-[0-9A-Z]+" corresp="urn:cts:[^"]+"\/>/u,
    );
    expect(tei).not.toContain('<ab n=');
    // A conjecture that is not adopted, one whose word the edition prints, and a reading reported for a witness.
    // Each points at the entry of the header's list that names the scholar or the source, and a conjecture at its record.
    expect(tei).toMatch(
      /<rdg type="conjecture" resp="#resp-[^"]+" source="conj:[0-9A-Z]+">ἑλώριον<\/rdg>/u,
    );
    expect(tei).toMatch(
      /<lem resp="#resp-Zenodotus" source="conj:[0-9A-Z]+[^"]*"><w [^>]*source="conj:[0-9A-Z]+">δαῖτα<\/w>/u,
    );
    expect(tei).toContain('<bibl><author xml:id="resp-Zenodotus">Zenodotus</author></bibl>');
    // The work the adopted conjecture cites is a structured entry, and its citation, with the place cited, one of the sources.
    const work =
      /<biblStruct xml:id="(bib-[0-9A-Z]+)" type="book" n="Allen 1931"><monogr><author>/u.exec(tei);
    expect(work).not.toBeNull();
    const citation = new RegExp(
      `<bibl xml:id="(src-\\d+)"><ref target="#${work![1]}">Allen 1931</ref>, <citedRange>ad 1\\.5</citedRange></bibl>`,
      'u',
    ).exec(tei);
    expect(citation).not.toBeNull();
    expect(tei).toMatch(
      new RegExp(`<lem resp="#resp-Zenodotus" source="conj:[0-9A-Z]+ #${citation![1]}">`, 'u'),
    );
    const source = /<bibl xml:id="(src-\d+)">Allen's apparatus \(1931\)<\/bibl>/u.exec(tei);
    expect(source).not.toBeNull();
    expect(tei).toContain(`<rdg type="reported" wit="#wit-T" source="#${source![1]}">θεά</rdg>`);
    const text = await readFile(path.join(edition, 'edition.txt'), 'utf8');
    expect(text).toMatch(/1\.4 ἑλώρια A C : ἕλωρα B : ἑλώριον \S+ \(conjectured\)/u);
    expect(text).toContain('Zenodotus');
    expect(text).toContain('θεά T');
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
