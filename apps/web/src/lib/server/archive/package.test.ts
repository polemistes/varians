import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, siteKey, type Token } from '@varians/core';
import {
  createDatabase,
  editionSiteKinds,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { ZipArchive } from 'archiver';
import { createWriteStream, existsSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { setSiteMinor } from '../collation.ts';
import { saveOps } from '../documents/service.ts';
import { publishEdition } from '../publish.ts';
import { editionView } from '../reader.ts';
import { removeWorkCompletely } from './import.ts';
import { importPackage } from './import-package.ts';
import { buildPackage, extractZip, openPackage, PackageError } from './package.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let tmp: string;
const owner = newId();
const stranger = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const operator = { id: owner, role: 'administrator' as const };

async function clean(): Promise<void> {
  for (const w of await db.select({ id: works.id }).from(works).where(eq(works.slug, 'iliad')))
    await removeWorkCompletely(db, w.id);
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values([
    { id: owner, email: `${owner}@test`, name: 'Packer', passwordHash: 'x' },
    { id: stranger, email: `${stranger}@test`, name: 'Stranger', passwordHash: 'x' },
  ]);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-packages-'));
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, owner));
  await db.delete(users).where(inArray(users.id, [owner, stranger]));
  await pool.end();
  await rm(tmp, { recursive: true, force: true });
});

async function unpack(file: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmp, 'open-'));
  await extractZip(file, dir);
  return dir;
}

async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await filesUnder(dir, rel)));
    else out.push(rel);
  }
  return out;
}

describe('packages', () => {
  it('carry a work as a bag with RO-Crate metadata that names every file, and come back by import', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const pkg = await buildPackage(db, operator, [{ kind: 'work', workId: sample.workId }], {
      origin: 'https://varians.example',
    });
    try {
      const dir = await unpack(pkg.file);
      const opened = await openPackage(dir);
      expect(opened.bag).toBe(true);
      expect(opened.info['Varians-Format-Version']).toBe('2');
      expect(opened.info['External-Identifier']).toBe(
        `https://varians.example/id/${sample.workId}`,
      );
      expect(opened.workDirs.map((d) => path.basename(d))).toEqual(['iliad']);
      const data = path.join(dir, 'iliad', 'data');
      const crate = JSON.parse(
        await readFile(path.join(data, 'ro-crate-metadata.json'), 'utf8'),
      ) as {
        '@context': string;
        '@graph': {
          '@id': string;
          hasPart?: { '@id': string }[];
          conformsTo?: { '@id': string };
        }[];
      };
      expect(crate['@context']).toBe('https://w3id.org/ro/crate/1.2/context');
      const root = crate['@graph'].find((e) => e['@id'] === './')!;
      expect(root.conformsTo).toEqual({ '@id': 'https://varians.eu/formats/2/package' });
      const named = new Set(root.hasPart!.map((p) => p['@id']));
      const files = (await filesUnder(data)).filter((f) => f !== 'ro-crate-metadata.json');
      expect(files.filter((f) => !named.has(f))).toEqual([]);
      expect(crate['@graph'].find((e) => e['@id'] === 'iliad/work.json')!.conformsTo).toEqual({
        '@id': 'https://varians.eu/formats/2/work.schema.json',
      });

      await removeWorkCompletely(db, sample.workId);
      const report = await importPackage(db, pkg.file, owner);
      expect(report.refused).toBeNull();
      expect(report.bag).toBe(true);
      expect(report.works[0]!.documents.map((d) => d.result)).toEqual([
        'created',
        'created',
        'created',
        'created',
      ]);
    } finally {
      await pkg.cleanup();
    }
  }, 120_000);

  it('carry a published edition with the transcriptions at the versions its apparatus was collated against', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    await publishEdition(db, sample.editionId, owner);
    const [b] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.B!));
    const word = b!.content.items.find((i): i is Token => i.kind === 'token')!;
    await saveOps(db, 'transcription', b!.id, owner, b!.version, [
      { t: 'set', id: word.id, fields: { form: 'later' } },
    ]);
    const pkg = await buildPackage(db, null, [{ kind: 'edition', editionId: sample.editionId }]);
    try {
      const dir = await unpack(pkg.file);
      const data = path.join(dir, 'iliad-1-working-edition', 'data', 'iliad');
      const bJson = JSON.parse(
        await readFile(
          path.join(
            data,
            'witnesses',
            'venetus-b',
            'transcriptions',
            'iliad-1',
            'transcription.json',
          ),
          'utf8',
        ),
      ) as { version: number; content: { items: Token[] } };
      expect(bJson.version).toBe(b!.version);
      expect(bJson.content.items.find((i) => i.id === word.id)!.form).toBe(word.form);
      expect(await readdir(path.join(data, 'editions'))).toEqual(['iliad-1-working-edition']);
      // Review positions stay with the installation.
      expect(
        existsSync(path.join(data, 'editions', 'iliad-1-working-edition', 'reviews.json')),
      ).toBe(false);
    } finally {
      await pkg.cleanup();
    }
  }, 120_000);

  it('carry the variants a published edition judges minor as it judged them, and come back by import with them', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const view = await editionView(db, sample.editionId, null, {
      kind: 'editor',
      viewer: { id: owner, role: 'member' },
    });
    const segment = Object.values(view.segments).find((s) => s.label === '1.8')!;
    const site = segment.collation.sites.find((s) => s.readings.some((r) => r.text === 'συνέηκε'))!;
    const key = siteKey(site, segment.baseUnits);
    await setSiteMinor(db, sample.editionId, segment.segmentId, key, true, owner);
    await publishEdition(db, sample.editionId, owner);
    // Not minor in the draft again: the published version, and so its package, still has it so.
    await setSiteMinor(db, sample.editionId, segment.segmentId, key, false, owner);
    const pkg = await buildPackage(db, null, [{ kind: 'edition', editionId: sample.editionId }]);
    try {
      const dir = await unpack(pkg.file);
      const data = path.join(dir, 'iliad-1-working-edition', 'data', 'iliad');
      const edition = JSON.parse(
        await readFile(
          path.join(data, 'editions', 'iliad-1-working-edition', 'edition.json'),
          'utf8',
        ),
      ) as { siteKinds: { segmentId: string; siteKey: string; kind?: string; minor?: boolean }[] };
      expect(edition.siteKinds).toContainEqual(
        expect.objectContaining({ segmentId: segment.segmentId, siteKey: key, minor: true }),
      );
      const text = await readFile(
        path.join(data, 'editions', 'iliad-1-working-edition', 'edition.txt'),
        'utf8',
      );
      expect(text).not.toContain('συνέηκε');

      await removeWorkCompletely(db, sample.workId);
      const report = await importPackage(db, pkg.file, owner);
      expect(report.refused).toBeNull();
      const kinds = await db
        .select()
        .from(editionSiteKinds)
        .where(eq(editionSiteKinds.editionId, sample.editionId));
      expect(kinds).toContainEqual(
        expect.objectContaining({
          segmentId: segment.segmentId,
          siteKey: key,
          kind: null,
          minor: true,
        }),
      );
    } finally {
      await pkg.cleanup();
    }
  }, 120_000);

  it('carry a transcription with its work, witness and pages, and nothing else', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const [a] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    const pkg = await buildPackage(db, operator, [
      { kind: 'transcription', transcriptionId: a!.id },
    ]);
    try {
      const dir = await unpack(pkg.file);
      const data = path.join(dir, pkg.name, 'data', 'iliad');
      expect(await readdir(path.join(data, 'witnesses'))).toEqual(['venetus-a']);
      expect(existsSync(path.join(data, 'editions'))).toBe(false);
      expect(
        (
          JSON.parse(await readFile(path.join(data, 'conjectures.json'), 'utf8')) as {
            conjectures: unknown[];
          }
        ).conjectures,
      ).toEqual([]);
    } finally {
      await pkg.cleanup();
    }
  }, 120_000);

  it('are refused when a file does not match its checksum, or when the zip reaches outside itself', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const pkg = await buildPackage(db, operator, [{ kind: 'work', workId: sample.workId }]);
    try {
      const dir = await unpack(pkg.file);
      await appendFile(path.join(dir, 'iliad', 'data', 'iliad', 'work.json'), ' ');
      await expect(openPackage(dir)).rejects.toBeInstanceOf(PackageError);
      const report = await importPackage(db, dir, owner);
      expect(report.refused).toMatch(/does not match its checksum/);
    } finally {
      await pkg.cleanup();
    }
    const evil = path.join(tmp, 'evil.zip');
    const archive = new ZipArchive();
    const done = pipeline(archive, createWriteStream(evil));
    // archiver cleans names; a placeholder of the same length is put back as `..` in the bytes, where names stand uncompressed.
    archive.append('x', { name: '__/escaped.txt' });
    await archive.finalize();
    await done;
    const bytes = await readFile(evil);
    await writeFile(
      evil,
      Buffer.from(
        bytes.toString('latin1').split('__/escaped.txt').join('../escaped.txt'),
        'latin1',
      ),
    );
    await expect(extractZip(evil, await mkdtemp(path.join(tmp, 'evil-')))).rejects.toBeInstanceOf(
      PackageError,
    );
    expect(existsSync(path.join(tmp, 'escaped.txt'))).toBe(false);
  }, 120_000);

  it('do not let an account change what it may not edit here, and refuse licences that do not go together', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    await publishEdition(db, sample.editionId, owner);
    const [b] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.B!));
    const word = b!.content.items.find((i): i is Token => i.kind === 'token')!;
    await saveOps(db, 'transcription', b!.id, owner, b!.version, [
      { t: 'set', id: word.id, fields: { form: 'mine' } },
    ]);
    const pkg = await buildPackage(db, operator, [{ kind: 'work', workId: sample.workId }]);
    try {
      // The owner's text moves on; a stranger then imports the package made before: nothing of the owner's changes.
      const after = (
        await db.select().from(transcriptions).where(eq(transcriptions.id, b!.id))
      )[0]!;
      await saveOps(db, 'transcription', b!.id, owner, after.version, [
        { t: 'set', id: word.id, fields: { form: 'mine again' } },
      ]);
      const report = await importPackage(db, pkg.file, stranger, {
        actor: { id: stranger, role: 'member' },
      });
      expect(report.refused).toBeNull();
      expect(report.works[0]!.documents.find((d) => d.id === b!.id)!.result).toBe('refused');
      const [still] = await db.select().from(transcriptions).where(eq(transcriptions.id, b!.id));
      expect(still!.content.items.find((i) => i.id === word.id) as Token).toMatchObject({
        form: 'mine again',
      });
      expect(still!.ownerId).toBe(owner);

      const before = process.env.DATA_LICENCE;
      process.env.DATA_LICENCE = 'CC-BY-4.0';
      try {
        const refused = await importPackage(db, pkg.file, owner);
        expect(refused.refused).toBe(
          'Records licensed under CC BY-SA 4.0 cannot be published under CC BY 4.0, the licence of this installation.',
        );
      } finally {
        if (before === undefined) delete process.env.DATA_LICENCE;
        else process.env.DATA_LICENCE = before;
      }
    } finally {
      await pkg.cleanup();
    }
  }, 120_000);
});
