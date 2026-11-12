/**
 * What a crafted archive must not do (the review of the import):
 * name a file of the server as an image, a folder outside the archive as a
 * slug, move or rewrite records of others by their ids, publish or grant on
 * someone else's edition, or credit its records to another account.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import {
  conjectures,
  createDatabase,
  editionCollaborators,
  editions,
  notes,
  pages,
  referenceSchemes,
  reportedReadings,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { publishEdition } from '../publish.ts';
import { hasVersion } from '../versions.ts';
import { createTranscription } from '../registry.ts';
import { worksOfTranscription } from '../transcription-works.ts';
import { folderName, writeArchive } from './archive.ts';
import { importArchive, removeWorkCompletely } from './import.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let tmp: string;
const owner = newId();
const attacker = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const asAttacker = { actor: { id: attacker, role: 'member' as const } };

async function clean(): Promise<void> {
  for (const w of await db
    .select({ id: works.id })
    .from(works)
    .where(inArray(works.slug, ['iliad', 'stolen'])))
    await removeWorkCompletely(db, w.id);
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

async function json(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values([
    { id: owner, email: `${owner}@test`, name: 'Owner', passwordHash: 'x' },
    { id: attacker, email: `${attacker}@test`, name: 'Attacker', passwordHash: 'x' },
  ]);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-crafted-'));
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(inArray(referenceSchemes.createdBy, [owner, attacker]));
  await db.delete(users).where(inArray(users.id, [owner, attacker]));
  await pool.end();
  await rm(tmp, { recursive: true, force: true });
});

describe('a crafted archive', () => {
  it('cannot name a file of the server as an image, nor a folder outside the archive as a slug', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const dir = await writeArchive(db, sample.workId, path.join(tmp, newId()));
    await removeWorkCompletely(db, sample.workId);
    const pagesFile = path.join(dir, 'witnesses', 'venetus-a', 'pages.json');
    const list = await json(pagesFile);
    const first = (list.pages as { id: string; image: unknown }[])[0]!;
    first.image = {
      kind: 'upload',
      path: '../../../../etc/passwd',
      iiif: null,
      width: 1,
      height: 1,
      tiles: '/etc/shadow',
      rights: 'https://creativecommons.org/publicdomain/zero/1.0/',
    };
    await writeFile(pagesFile, JSON.stringify(list));
    const editionDir = path.join(dir, 'editions', (await readdir(path.join(dir, 'editions')))[0]!);
    const edition = await json(path.join(editionDir, 'edition.json'));
    edition.slug = '../../../../tmp/evil';
    await writeFile(path.join(editionDir, 'edition.json'), JSON.stringify(edition));
    // A version of it, as if its owner had published one.
    await mkdir(path.join(editionDir, 'versions', '1'), { recursive: true });
    await writeFile(
      path.join(editionDir, 'versions', '1', 'edition.json'),
      JSON.stringify(edition),
    );
    await writeFile(
      path.join(editionDir, 'versions.json'),
      JSON.stringify({
        versions: [
          { id: newId(), number: 1, version: 1, at: new Date().toISOString(), withdrawn: null },
        ],
      }),
    );
    await importArchive(db, dir, attacker, asAttacker);
    const [page] = await db.select().from(pages).where(eq(pages.id, first.id));
    expect(page!.imagePath).toBeNull();
    expect(page!.tilesPath).toBeNull();
    const [e] = await db
      .select({ slug: editions.slug })
      .from(editions)
      .where(eq(editions.id, sample.editionId));
    expect(e!.slug).toMatch(/^[a-z0-9-]+$/);
    expect(folderName('../../x', 'ID')).toBe('id');
  }, 120_000);

  it('cannot move or rewrite records of others by their ids, nor publish or grant on an edition it only collaborates on', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    await db
      .insert(editionCollaborators)
      .values({ editionId: sample.editionId, userId: attacker, grantedBy: owner });
    const [note] = await db.select().from(notes).where(eq(notes.editionId, sample.editionId));
    const [pageOfB] = await db
      .select()
      .from(pages)
      .where(eq(pages.witnessId, sample.witnessIds.A!))
      .limit(1);
    const dir = await writeArchive(db, sample.workId, path.join(tmp, newId()));

    // The edition: published, its collaborators replaced by the attacker's friend, another's page id under witness B, the scheme renamed.
    const editionDir = path.join(dir, 'editions', (await readdir(path.join(dir, 'editions')))[0]!);
    const edition = await json(path.join(editionDir, 'edition.json'));
    edition.collaborators = [];
    (edition.notes as { id: string; text: string }[])[0]!.text = 'rewritten by the attacker';
    await writeFile(path.join(editionDir, 'edition.json'), JSON.stringify(edition));
    const bPages = path.join(dir, 'witnesses', 'venetus-b', 'pages.json');
    const list = await json(bPages);
    (list.pages as unknown[]).push({ id: pageOfB!.id, label: 'taken', position: 99, image: null });
    await writeFile(bPages, JSON.stringify(list));
    const workFile = path.join(dir, 'work.json');
    const work = await json(workFile);
    (work.scheme as { name: string }).name = 'Renamed by the attacker';
    await writeFile(workFile, JSON.stringify(work));

    await importArchive(db, dir, attacker, asAttacker);
    const [e] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    // A restricted import publishes nothing.
    expect(await hasVersion(db, 'edition', sample.editionId)).toBe(false);
    expect(e!.ownerId).toBe(owner);
    expect(
      await db
        .select()
        .from(editionCollaborators)
        .where(
          and(
            eq(editionCollaborators.editionId, sample.editionId),
            eq(editionCollaborators.userId, attacker),
          ),
        ),
    ).toHaveLength(1);
    const [p] = await db.select().from(pages).where(eq(pages.id, pageOfB!.id));
    expect(p!.witnessId).toBe(sample.witnessIds.A);
    expect(p!.label).toBe(pageOfB!.label);
    const [scheme] = await db
      .select()
      .from(referenceSchemes)
      .where(eq(referenceSchemes.id, (work.scheme as { id: string }).id));
    expect(scheme!.name).not.toBe('Renamed by the attacker');
    // The note is in an edition the attacker edits, so its text may change; its edition may not.
    const [n] = await db.select().from(notes).where(eq(notes.id, note!.id));
    expect(n!.editionId).toBe(sample.editionId);
  }, 120_000);

  it('takes a work that an archive calls private as any other work, and no more than any other', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    await publishEdition(db, sample.editionId, owner);
    const dir = await writeArchive(db, sample.workId, path.join(tmp, newId()));
    const workFile = path.join(dir, 'work.json');
    const work = await json(workFile);
    // The format no longer has the member; an archive written before it went still may.
    expect(work).not.toHaveProperty('visibility');
    work.visibility = 'private';
    work.title = 'Renamed by the attacker';
    await writeFile(workFile, JSON.stringify(work));
    // The work is here, and the attacker does not maintain it: not refused, and its details are left.
    const report = await importArchive(db, dir, attacker, asAttacker);
    expect(report.warnings.join(' ')).toMatch(/maintained by others here/);
    const [kept] = await db.select().from(works).where(eq(works.id, sample.workId));
    expect(kept!.title).toBe('Iliad');
    // Where the work is not here, it is registered, with no trace of a private state.
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, dir, attacker, asAttacker);
    const [made] = await db.select().from(works).where(eq(works.id, sample.workId));
    expect(made!.title).toBe('Renamed by the attacker');
    expect(made).not.toHaveProperty('visibility');
  }, 120_000);

  it('reads the state of publication that an archive still gives a conjecture or a reported reading, and registers the records as they are, public', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const dir = await writeArchive(db, sample.workId, path.join(tmp, newId()));
    const conjecturesFile = path.join(dir, 'conjectures.json');
    const readingsFile = path.join(dir, 'reported-readings.json');
    const conjectureList = await json(conjecturesFile);
    const readingList = await json(readingsFile);
    // The format no longer has the member; an archive written before it went has it, `draft` on every record here.
    for (const record of conjectureList.conjectures as Record<string, unknown>[]) {
      expect(record).not.toHaveProperty('visibility');
      record.visibility = 'draft';
    }
    for (const record of readingList.readings as Record<string, unknown>[]) {
      expect(record).not.toHaveProperty('visibility');
      record.visibility = 'draft';
    }
    await writeFile(conjecturesFile, JSON.stringify(conjectureList));
    await writeFile(readingsFile, JSON.stringify(readingList));
    const ids = (conjectureList.conjectures as { id: string }[]).map((c) => c.id);
    const readingIds = (readingList.readings as { id: string }[]).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    // Imported by an operator, and again, the work being gone, by an account in a restricted import: the records are there either way.
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, dir, owner);
    expect((await db.select().from(conjectures).where(inArray(conjectures.id, ids))).length).toBe(
      ids.length,
    );
    expect(
      (await db.select().from(reportedReadings).where(inArray(reportedReadings.id, readingIds)))
        .length,
    ).toBe(readingIds.length);
    for (const row of await db.select().from(conjectures).where(inArray(conjectures.id, ids)))
      expect(row).not.toHaveProperty('visibility');
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, dir, attacker, asAttacker);
    expect((await db.select().from(conjectures).where(inArray(conjectures.id, ids))).length).toBe(
      ids.length,
    );
  }, 120_000);

  it('reads the works that an archive still gives a transcription without them, and holds no transcription with no text of the work', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    // A transcript of a witness of the work with nothing assigned to it is no transcript of the work.
    const empty = await createTranscription(
      db,
      { witnessId: sample.witnessIds.A!, name: 'Nothing assigned' },
      owner,
    );
    const dir = await writeArchive(db, sample.workId, path.join(tmp, newId()));
    const files: string[] = [];
    for (const witness of await readdir(path.join(dir, 'witnesses')))
      for (const t of await readdir(path.join(dir, 'witnesses', witness, 'transcriptions')).catch(
        () => [],
      ))
        files.push(path.join(dir, 'witnesses', witness, 'transcriptions', t, 'transcription.json'));
    expect(files.length).toBeGreaterThan(0);
    const written = await Promise.all(files.map((f) => json(f)));
    expect(written.map((t) => t.id)).not.toContain(empty.id);
    await db.delete(transcriptions).where(eq(transcriptions.id, empty.id));
    // The format no longer has the member; an archive written before it went has it.
    for (const [i, file] of files.entries()) {
      expect(written[i]).not.toHaveProperty('workIds');
      await writeFile(file, JSON.stringify({ ...written[i], workIds: [sample.workId, newId()] }));
    }
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, dir, owner);
    for (const t of written)
      expect(await worksOfTranscription(db, t.id as string)).toEqual([sample.workId]);
  }, 120_000);
});
