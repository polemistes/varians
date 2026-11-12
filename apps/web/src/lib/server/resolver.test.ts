import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type Token } from '@varians/core';
import {
  bibliographyItems,
  changesets,
  conjectures,
  createDatabase,
  editions,
  pages,
  referenceSchemes,
  registryMerges,
  segments,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { seedSample } from './seed/sample.ts';
import { publishEdition } from './publish.ts';
import { recordJson } from './record-json.ts';
import { pageOf, resolveId, visibilityOf } from './resolver.ts';
import { removeWorkCompletely } from './archive/import.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const owner = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const ownerActor = () => ({ id: owner, role: 'member' as const });

async function clean(): Promise<void> {
  for (const w of await db.select({ id: works.id }).from(works).where(eq(works.slug, 'iliad')))
    await removeWorkCompletely(db, w.id);
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db
    .insert(users)
    .values({ id: owner, email: `${owner}@test`, name: 'Resolver', passwordHash: 'x' });
});

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, owner));
  await db.delete(users).where(eq(users.id, owner));
  await pool.end();
});

describe('record addresses', () => {
  it('find every kind of record and lead to its page', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const [a] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.witnessId, sample.witnessIds.A!))
      .limit(1);
    const [segment] = await db
      .select()
      .from(segments)
      .where(eq(segments.workId, sample.workId))
      .limit(1);
    const [conjecture] = await db
      .select()
      .from(conjectures)
      .where(eq(conjectures.workId, sample.workId))
      .limit(1);
    const [item] = await db
      .select()
      .from(bibliographyItems)
      .where(eq(bibliographyItems.citationKey, 'allen1931'));
    const [change] = await db
      .select()
      .from(changesets)
      .where(eq(changesets.documentId, a!.id))
      .limit(1);
    const token = a!.content.items.find((i): i is Token => i.kind === 'token')!;
    const viewer = ownerActor();
    const go = async (id: string) => {
      const r = await resolveId(db, id);
      return r ? pageOf(db, r, await visibilityOf(db, viewer, r)) : null;
    };
    expect(await go(sample.workId)).toBe('/works/iliad');
    expect(await go(sample.witnessIds.A!)).toBe('/witnesses/venetus-a');
    expect(await go(page!.id)).toBe('/witnesses/venetus-a/pages');
    expect(await go(a!.id)).toBe(`/transcriptions/${a!.id}`);
    expect(await go(sample.editionId)).toBe(`/editions/${sample.editionSlug}/edit`);
    expect(await go(segment!.id)).toBe('/works/iliad');
    expect(await go(conjecture!.id)).toBe('/works/iliad');
    expect(await go(item!.id)).toBe('/bibliography?q=allen1931');
    expect(await go(owner)).toBe(`/people/${owner}`);
    expect(await go(change!.id)).toBe(`/transcriptions/${a!.id}`);
    expect(await go(token.id)).toBe(`/transcriptions/${a!.id}?word=${token.id}`);
    expect(await resolveId(db, 'NOSUCHID0000000000000000000')).toBeNull();
    expect(await resolveId(db, '../etc')).toBeNull();
    // An id merged away leads to its survivor.
    const old = newId();
    await db
      .insert(registryMerges)
      .values({ oldId: old, kind: 'witness', survivorId: sample.witnessIds.A!, label: 'A twice' });
    expect(await go(old)).toBe('/witnesses/venetus-a');
  }, 60_000);

  it('hide a draft from those who may not see it, and give the published version to those who do not edit it', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const resolved = (await resolveId(db, sample.editionId))!;
    expect((await visibilityOf(db, null, resolved)).visible).toBe(false);
    const published = await publishEdition(db, sample.editionId, owner);
    // What the editors do afterwards is not what the public is given.
    await db.update(editions).set({ title: 'Renamed' }).where(eq(editions.id, sample.editionId));
    const anonymous = await visibilityOf(db, null, resolved);
    expect(anonymous).toEqual({ visible: true, edits: false });
    expect(await pageOf(db, resolved, anonymous)).toBe(`/editions/${sample.editionSlug}`);
    const [segment] = await db
      .select()
      .from(segments)
      .where(eq(segments.workId, sample.workId))
      .orderBy(segments.sortKey)
      .limit(1);
    expect(await pageOf(db, (await resolveId(db, segment!.id))!, anonymous)).toBe(
      `/editions/${sample.editionSlug}/${segment!.label}`,
    );
    const record = (await recordJson(db, null, resolved, anonymous)) as {
      $schema: string;
      id: string;
      title: string;
      version: number;
      licence: string;
      reviews?: unknown;
    };
    expect(record.$schema).toBe('https://varians.eu/formats/2/edition.schema.json');
    expect(record.id).toBe(sample.editionId);
    expect(record.licence).toBe('CC-BY-SA-4.0');
    // The latest version, as it was published.
    expect(record.version).toBe(published.version);
    expect(record.title).toBe('Iliad 1, a working edition');
  }, 60_000);

  it('answer records as the archive represents them', async () => {
    await clean();
    const sample = await seedSample(db, owner);
    const viewer = ownerActor();
    const json = async (id: string) => {
      const r = (await resolveId(db, id))!;
      return recordJson(db, viewer, r, await visibilityOf(db, viewer, r));
    };
    expect(
      ((await json(sample.workId)) as { $schema: string; formatVersion: number }).formatVersion,
    ).toBe(2);
    const [a] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    expect(((await json(a!.id)) as { $schema: string }).$schema).toBe(
      'https://varians.eu/formats/2/transcription.schema.json',
    );
    expect(((await json(sample.witnessIds.A!)) as { $schema: string; slug: string }).slug).toBe(
      'venetus-a',
    );
    const [segment] = await db
      .select()
      .from(segments)
      .where(eq(segments.workId, sample.workId))
      .orderBy(segments.sortKey)
      .limit(1);
    expect(((await json(segment!.id)) as { urn: string }).urn).toBe(
      `urn:cts:greekLit:tlg0012.tlg001:${segment!.label}`,
    );
    expect(await json(owner)).toEqual({ id: owner, name: 'Resolver', orcid: null });
    const token = a!.content.items.find((i): i is Token => i.kind === 'token')!;
    expect(await json(token.id)).toEqual({
      document: { kind: 'transcription', id: a!.id },
      item: token,
    });
  }, 60_000);
});
