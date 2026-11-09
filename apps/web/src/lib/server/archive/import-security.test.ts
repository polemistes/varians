/**
 * What a crafted archive must not do (PLAN-2 F9, the review of the import):
 * name a file of the server as an image, a folder outside the archive as a
 * slug, move or rewrite records of others by their ids, publish or grant on
 * someone else's edition, reach a private work, or credit its records to
 * another account.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import {
  createDatabase,
  editionCollaborators,
  editions,
  notes,
  pages,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { publishEdition } from '../publish.ts';
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
  for (const w of await db.select({ id: works.id }).from(works).where(inArray(works.slug, ['iliad', 'stolen']))) await removeWorkCompletely(db, w.id);
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
    first.image = { kind: 'upload', path: '../../../../etc/passwd', iiif: null, width: 1, height: 1, tiles: '/etc/shadow', rights: 'https://creativecommons.org/publicdomain/zero/1.0/' };
    await writeFile(pagesFile, JSON.stringify(list));
    const editionDir = path.join(dir, 'editions', (await readdir(path.join(dir, 'editions')))[0]!);
    const edition = await json(path.join(editionDir, 'edition.json'));
    edition.slug = '../../../../tmp/evil';
    await writeFile(path.join(editionDir, 'edition.json'), JSON.stringify(edition));
    await importArchive(db, dir, attacker, asAttacker);
    const [page] = await db.select().from(pages).where(eq(pages.id, first.id));
    expect(page!.imagePath).toBeNull();
    expect(page!.tilesPath).toBeNull();
    const [e] = await db.select({ slug: editions.slug }).from(editions).where(eq(editions.id, sample.editionId));
    expect(e!.slug).toMatch(/^[a-z0-9-]+$/);
    expect(folderName('../../x', 'ID')).toBe('id');
  }, 120_000);

  it('cannot move or rewrite records of others by their ids, nor publish or grant on an edition it only collaborates on', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    await db.insert(editionCollaborators).values({ editionId: sample.editionId, userId: attacker, grantedBy: owner });
    const [note] = await db.select().from(notes).where(eq(notes.editionId, sample.editionId));
    const [pageOfB] = await db.select().from(pages).where(eq(pages.witnessId, sample.witnessIds.A!)).limit(1);
    const dir = await writeArchive(db, sample.workId, path.join(tmp, newId()));

    // The edition: published, its collaborators replaced by the attacker's friend, another's page id under witness B, the scheme renamed.
    const editionDir = path.join(dir, 'editions', (await readdir(path.join(dir, 'editions')))[0]!);
    const edition = await json(path.join(editionDir, 'edition.json'));
    edition.visibility = 'published';
    edition.publishedVersion = 1;
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
    expect(e!.visibility).toBe('draft');
    expect(e!.publishedVersion).toBeNull();
    expect(e!.ownerId).toBe(owner);
    expect(await db.select().from(editionCollaborators).where(and(eq(editionCollaborators.editionId, sample.editionId), eq(editionCollaborators.userId, attacker)))).toHaveLength(1);
    const [p] = await db.select().from(pages).where(eq(pages.id, pageOfB!.id));
    expect(p!.witnessId).toBe(sample.witnessIds.A);
    expect(p!.label).toBe(pageOfB!.label);
    const [scheme] = await db.select().from(referenceSchemes).where(eq(referenceSchemes.id, (work.scheme as { id: string }).id));
    expect(scheme!.name).not.toBe('Renamed by the attacker');
    // The note is in an edition the attacker edits, so its text may change; its edition may not.
    const [n] = await db.select().from(notes).where(eq(notes.id, note!.id));
    expect(n!.editionId).toBe(sample.editionId);
  }, 120_000);

  it('cannot reach a private work it may not see', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    await publishEdition(db, sample.editionId, owner);
    const dir = await writeArchive(db, sample.workId, path.join(tmp, newId()));
    await db.update(works).set({ visibility: 'private' }).where(eq(works.id, sample.workId));
    await expect(importArchive(db, dir, attacker, asAttacker)).rejects.toThrow(/not open to you/);
    // By its identifier under another id, it is not matched: a new work is made instead.
    const workFile = path.join(dir, 'work.json');
    const work = await json(workFile);
    work.id = newId();
    work.slug = 'stolen';
    await writeFile(workFile, JSON.stringify(work));
    const report = await importArchive(db, dir, attacker, { ...asAttacker, dryRun: true });
    expect(report.matches.filter((m) => m.kind === 'work')).toEqual([]);
  }, 120_000);
});
