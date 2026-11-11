import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NOT_TRANSCRIBED_ATTRS,
  isObj,
  isToken,
  newId,
  siteKey,
  toText,
  type Obj,
} from '@varians/core';
import * as schema from '@varians/db/schema';
import {
  createDatabase,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, getTableColumns, getTableName, inArray, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { seedSample } from '../seed/sample.ts';
import { setSiteKind, setSiteMinor } from '../collation.ts';
import { saveOps } from '../documents/service.ts';
import { adoptConjecture } from '../conjectures.ts';
import { publishEdition } from '../publish.ts';
import { editionView } from '../reader.ts';
import { conjectures, editions, registryMerges } from '@varians/db';
import { writeArchive } from './archive.ts';
import { ARCHIVED_TABLES } from './coverage.ts';
import { importArchive, removeWorkCompletely } from './import.ts';
import { validateArchiveDir } from './validate.ts';

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

/** A place of a segment where some witness has these words, as the editor's view has it, with the key a mark on it goes by. */
async function placeOf(editionId: string, label: string, reading: string) {
  const view = await editionView(db, editionId, null);
  const segment = Object.values(view.segments).find((s) => s.label === label)!;
  const site = segment.collation.sites.find((s) => s.readings.some((r) => r.text === reading))!;
  return {
    segmentId: segment.segmentId,
    index: site.index,
    key: siteKey(site, segment.baseUnits),
  };
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
    const before = await readFile(
      path.join(dir, 'editions', sample.editionSlug, 'edition.txt'),
      'utf8',
    );
    const [a] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
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
    const after = await readFile(
      path.join(again, 'editions', sample.editionSlug, 'edition.txt'),
      'utf8',
    );
    expect(after).toBe(before);
    await db
      .insert(users)
      .values({ id: userId, email: `${userId}@test`, name: 'Exporter', passwordHash: 'x' });
    await clean();
  });

  it('keeps a stretch marked as not transcribed in a transcript, with its reason', async () => {
    const sample = await seedSample(db, userId);
    const [before] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.B!));
    const words = before!.content.items.filter(isToken);
    const marked: Obj = {
      kind: 'object',
      id: newId(),
      type: 'gap',
      attrs: { ...NOT_TRANSCRIBED_ATTRS },
    };
    const quantified: Obj = {
      kind: 'object',
      id: newId(),
      type: 'gap',
      attrs: { ...NOT_TRANSCRIBED_ATTRS, quantity: 2, unit: 'line' },
    };
    await saveOps(
      db,
      'transcription',
      before!.id,
      userId,
      before!.version,
      [
        { t: 'insert', after: words[2]!.id, items: [marked] },
        { t: 'insert', after: words[5]!.id, items: [quantified] },
      ],
      'stretches not transcribed',
    );
    const [saved] = await db.select().from(transcriptions).where(eq(transcriptions.id, before!.id));

    const dir = await writeArchive(db, sample.workId, root);
    expect(await validateArchiveDir(dir)).toEqual([]);
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, dir, userId);

    const [restored] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, before!.id));
    const gaps = restored!.content.items.filter((i): i is Obj => isObj(i) && i.type === 'gap');
    expect(gaps.filter((g) => g.attrs?.reason === 'ellipsis').map((g) => [g.id, g.attrs])).toEqual([
      [marked.id, marked.attrs],
      [quantified.id, quantified.attrs],
    ]);
    // Nothing else of the text moved, and it is told as it was told before.
    expect(restored!.content).toEqual(saved!.content);
    expect(toText(restored!.content)).toContain('(not transcribed)');
    await clean();
  }, 60_000);

  it('writes no setting for Latin abbreviations, and reads an archive that has one with the member ignored', async () => {
    const sample = await seedSample(db, userId);
    // An edition made before the setting went still has it in its row.
    const [edition] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    const old = { ...edition!.conventions, latin: true };
    await db.update(editions).set({ conventions: old }).where(eq(editions.id, sample.editionId));
    const dir = await writeArchive(db, sample.workId, root);
    const editionDir = path.join(dir, 'editions', sample.editionSlug);
    const file = path.join(editionDir, 'edition.json');
    const written = JSON.parse(await readFile(file, 'utf8'));
    expect(written.conventions).not.toHaveProperty('latin');
    expect(written.conventions).toMatchObject({ apparatus: 'positive', numberEvery: 5 });
    // The plain text says its words in English, as the print apparatus does.
    expect(await readFile(path.join(editionDir, 'edition.txt'), 'utf8')).toContain(': not in B C');
    // An archive written before the setting went has it: it is read, and the member is not kept.
    written.conventions.latin = false;
    await writeFile(file, JSON.stringify(written));
    await removeWorkCompletely(db, sample.workId);
    await importArchive(db, dir, userId);
    const [back] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    expect(back!.conventions).not.toHaveProperty('latin');
    expect(back!.conventions).toMatchObject({ apparatus: 'positive', numberEvery: 5 });
    await clean();
  }, 60_000);

  it('brings back every archived row, column by column', async () => {
    const sample = await seedSample(db, userId, { collaboratorId: collaborator });
    // What the seed leaves out because it would change the sample's text: an adoption and a publication.
    const [conjecture] = await db
      .select()
      .from(conjectures)
      .where(eq(conjectures.workId, sample.workId))
      .limit(1);
    await adoptConjecture(db, sample.editionId, conjecture!.id);
    // The words for the other witnesses and for all of them, and a group of sigla, are in the edition's conventions.
    const [edition] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    await db
      .update(editions)
      .set({
        conventions: {
          ...edition!.conventions,
          rest: 'cett.',
          all: 'codd.',
          groups: [{ siglum: 'p', members: ['B', 'C'], note: 'consensus codicum BC' }],
        },
      })
      .where(eq(editions.id, sample.editionId));
    // A variant the editor gives a kind and judges minor: both words are archived as data, and so is the basis of the publication that fixes them.
    const eight = await placeOf(sample.editionId, '1.8', 'συνέηκε');
    await setSiteKind(db, sample.editionId, eight.segmentId, eight.key, 'textual', userId);
    await setSiteMinor(db, sample.editionId, eight.segmentId, eight.key, true, userId);
    await publishEdition(db, sample.editionId, userId);
    // A witness that was merged into A here: the merged id travels with A.
    await db.insert(registryMerges).values({
      oldId: newId(),
      kind: 'witness',
      survivorId: sample.witnessIds.A!,
      label: 'Venetus A (registered twice)',
      mergedBy: userId,
    });

    const original = await snapshot();
    for (const name of ARCHIVED_TABLES) {
      expect(original[name]!.length, `the sample has no row in ${name}`).toBeGreaterThan(0);
    }
    const dir = await writeArchive(db, sample.workId, root);
    const editionDir = path.join(dir, 'editions', sample.editionSlug);
    const written = JSON.parse(await readFile(path.join(editionDir, 'edition.json'), 'utf8'));
    expect(written.siteKinds).toContainEqual(
      expect.objectContaining({ segmentId: eight.segmentId, kind: 'textual', minor: true }),
    );
    const moment = JSON.parse(await readFile(path.join(editionDir, 'moments.json'), 'utf8'));
    expect(
      moment.moments.find((m: { kind: string }) => m.kind === 'published').basis.siteKinds,
    ).toContainEqual(
      expect.objectContaining({ segmentId: eight.segmentId, kind: 'textual', minor: true }),
    );
    expect(await validateArchiveDir(dir)).toEqual([]);
    // The plain text leaves the variant out, as a printed edition does; the TEI has it, as a minor one.
    expect(await readFile(path.join(editionDir, 'edition.txt'), 'utf8')).not.toContain('συνέηκε');
    expect(await readFile(path.join(editionDir, 'edition.tei.xml'), 'utf8')).toMatch(
      /<app type="textual" subtype="minor">.*συνέηκε/u,
    );
    await removeWorkCompletely(db, sample.workId);
    const removed = await snapshot();
    // The removal took the work's rows out of every table (entries and schemes others share may stay), so the import has to bring each back.
    for (const name of ARCHIVED_TABLES) {
      // Persons outlive a work: they are matched by id on the way back.
      if (name === 'bibliography_items' || name === 'reference_schemes' || name === 'persons')
        continue;
      expect(removed[name]!.length, `nothing of the work was removed from ${name}`).toBeLessThan(
        original[name]!.length,
      );
    }

    await importArchive(db, dir, userId);
    const restored = await snapshot();
    for (const name of ARCHIVED_TABLES) expect(restored[name], name).toEqual(original[name]);
    // The marks are read back as marks: the editor's view has the place, flagged.
    const back = await editionView(db, sample.editionId, null);
    expect(
      back.segments[eight.segmentId]!.collation.sites.find((s) => s.index === eight.index),
    ).toMatchObject({ kind: 'textual', minor: true });
    await clean();
  }, 120_000);
});
