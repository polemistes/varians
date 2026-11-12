import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conformPages, newId, segmentIds } from '@varians/core';
import {
  changesets,
  createDatabase,
  editions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray, like } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { writeArchive } from '../archive/archive.ts';
import { hasVersion, latestVersion } from '../versions.ts';
import { hasXmllint, validateArchiveDir, validateTeiFiles } from '../archive/validate.ts';
import { transcriptionPageOrder } from '../conform.ts';
import { loadDocument } from '../documents/service.ts';
import { editionView } from '../reader.ts';
import { removeStress, seedStress, streamOf, type StressSeedResult } from './stress.ts';
import { generateStress } from './stress-text.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const SLUG = 'stress-test';
let db: Database;
let pool: pg.Pool;
let root: string;
const ownerId = newId();
let result: StressSeedResult;

const clean = () => removeStress(db, SLUG);

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db
    .insert(users)
    .values({ id: ownerId, email: `${ownerId}@test`, name: 'Stress Seeder', passwordHash: 'x' });
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-stress-'));
  result = await seedStress(db, ownerId, {
    lines: 40,
    witnesses: 8,
    seed: 11,
    slug: SLUG,
    longHistory: 30,
  });
}, 120_000);

afterAll(async () => {
  await clean();
  await db.delete(users).where(eq(users.id, ownerId));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe('seedStress at a small size', () => {
  it('writes the work, the witnesses and a transcript of each but the one only reported', () => {
    expect(result.existed).toBe(false);
    expect(Object.keys(result.witnessIds)).toHaveLength(8);
    expect(Object.keys(result.transcriptionIds)).toHaveLength(7);
    expect(result.transcriptionIds.rep1).toBeUndefined();
    expect(result.scholiaWorkId).not.toBeNull();
    expect(result.done.segments).toBe(40);
    expect(result.done['reported readings']).toBeGreaterThan(0);
  });

  it('keeps the shape of the pages in every transcript', async () => {
    for (const [key, id] of Object.entries(result.transcriptionIds)) {
      const { content } = await loadDocument(db, 'transcription', id);
      const order = await transcriptionPageOrder(db, id);
      expect(conformPages(content, order), key).toEqual([]);
    }
  });

  it('gives the transcripts their text as the generator made it', async () => {
    const text = generateStress({ lines: 40, witnesses: 8, seed: 11 });
    for (const w of text.witnesses.filter((w) => w.type !== 'reported')) {
      const { content } = await loadDocument(db, 'transcription', result.transcriptionIds[w.key]!);
      const plan = streamOf(w, () => 'x', []);
      const tokens = content.items.filter((i) => i.kind === 'token').length;
      expect(tokens, w.key).toBe(plan.tokens);
      expect(segmentIds(content).length, w.key).toBeGreaterThan(0);
    }
  });

  it('has an edition whose view runs and finds places of variation', async () => {
    const view = await editionView(db, result.editionId, null);
    const sites = Object.values(view.segments).flatMap((s) => s.collation.sites);
    expect(Object.keys(view.segments).length).toBeGreaterThan(30);
    expect(sites.length).toBeGreaterThan(10);
    expect(sites.some((s) => s.kind === 'textual')).toBe(true);
    expect(view.sigla).toHaveLength(8);
    expect(view.sigla.some((s) => s.states.length > 0)).toBe(true);
    expect(view.sigla.some((s) => s.variantSiglum)).toBe(true);
    expect(view.sigla.find((s) => s.transcriptionId === null)).toBeDefined();
  });

  it('has a version published half-way and more work after it', async () => {
    const [edition] = await db.select().from(editions).where(eq(editions.id, result.editionId));
    const latest = await latestVersion(db, 'edition', result.editionId);
    expect(latest).not.toBeNull();
    expect(edition!.version).toBeGreaterThan(latest!.version);
    // The transcripts it compares were published with it.
    for (const id of Object.values(result.transcriptionIds))
      expect(await hasVersion(db, 'transcription', id)).toBe(true);
  });

  it('makes the editors work through the application, of every kind', () => {
    for (const what of [
      'edition changesets',
      'speaker labels',
      'notes',
      'places reviewed',
      'collaborators',
      'publications',
      'conjectures adopted (supplement)',
    ])
      expect(result.done[what], what).toBeGreaterThan(0);
  });

  it('does nothing again for a work that exists', async () => {
    const again = await seedStress(db, ownerId, { lines: 40, witnesses: 8, seed: 11, slug: SLUG });
    expect(again.existed).toBe(true);
    expect(again.workId).toBe(result.workId);
    expect(again.editionId).toBe(result.editionId);
  });

  it('is an archive that the application writes and validates, the TEI too', async () => {
    const dir = await writeArchive(db, result.workId, root);
    expect(await validateArchiveDir(dir)).toEqual([]);
    if (hasXmllint()) expect(await validateTeiFiles(dir)).toEqual([]);
    else console.warn('xmllint is not installed: the archive TEI is NOT validated.');
  }, 120_000);

  it('is taken out again with everything made for it, history and collaborator too', async () => {
    await removeStress(db, SLUG);
    expect(
      await db
        .select({ id: works.id })
        .from(works)
        .where(like(works.slug, `${SLUG}%`)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: witnesses.id })
        .from(witnesses)
        .where(like(witnesses.slug, `${SLUG}-%`)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: changesets.id })
        .from(changesets)
        .where(
          inArray(changesets.documentId, [
            result.editionId,
            ...Object.values(result.transcriptionIds),
          ]),
        ),
    ).toEqual([]);
    expect(
      await db.select({ id: users.id }).from(users).where(eq(users.id, result.collaboratorId!)),
    ).toEqual([]);
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId))).toHaveLength(
      1,
    );
    // And it can be seeded again.
    const again = await seedStress(db, ownerId, {
      lines: 12,
      witnesses: 3,
      seed: 2,
      slug: SLUG,
      longHistory: 3,
    });
    expect(again.existed).toBe(false);
  }, 120_000);
});
