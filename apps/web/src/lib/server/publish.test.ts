import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId, type Token } from '@varians/core';
import {
  createDatabase,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import {
  adoptConjecture,
  adoptionsOf,
  registerConjecture,
  reviewSite,
  reviewedSites,
} from './conjectures.ts';
import { saveOps } from './documents/service.ts';
import { PublishRefused, publishEdition, publishedVersions, unpublishEdition } from './publish.ts';
import { PUBLIC, editionView, type Audience } from './reader.ts';
import { seedSample } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const owner: Audience = { kind: 'editor', viewer: { id: userId, role: 'member' } };
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Publisher', passwordHash: 'x' });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('publishing and conjectures', () => {
  it('publishes with a numbered moment, makes the witnesses public, and unpublishes again', async () => {
    const sample = await seedSample(db, userId);
    await db
      .update(transcriptions)
      .set({ visibility: 'draft' })
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    const result = await publishEdition(db, sample.editionId, userId);
    expect(result.number).toBe(1);
    const [edition] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    expect(edition!.visibility).toBe('published');
    expect(edition!.publishedVersion).toBe(edition!.version);
    const [a] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    expect(a!.visibility).toBe('published');
    const versions = await publishedVersions(db, sample.editionId);
    expect(versions.map((v) => v.number)).toEqual([1]);
    const second = await publishEdition(db, sample.editionId, userId);
    expect(second.number).toBe(2);
    await unpublishEdition(db, sample.editionId);
    const [after] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    expect(after!.visibility).toBe('draft');
    const [aAfter] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    expect(aAfter!.visibility).toBe('draft');
  });

  it('registers, adopts and reviews', async () => {
    const [edition] = await db
      .select()
      .from(editions)
      .where(eq(editions.slug, 'iliad-1-working-edition'));
    const view = await editionView(db, edition!.id, null, owner);
    const segment = Object.values(view.segments).find((s) => s.label === '1.1')!;
    const conjecture = await registerConjecture(
      db,
      {
        workId: edition!.workId,
        segmentId: segment.segmentId,
        kind: 'substitution',
        lemma: 'ἄειδε',
        reading: 'ἄειδε,',
        proposer: 'Tester',
      },
      userId,
    );
    await adoptConjecture(db, edition!.id, conjecture.id);
    expect((await adoptionsOf(db, edition!.id)).has(conjecture.id)).toBe(true);
    await reviewSite(db, edition!.id, segment.segmentId, 'e1,e2', userId);
    await reviewSite(db, edition!.id, segment.segmentId, 'e1,e2', userId);
    const reviewed = await reviewedSites(db, edition!.id);
    expect(reviewed.get(segment.segmentId)?.has('e1,e2')).toBe(true);
    const again = await editionView(db, edition!.id, null, owner);
    const one = Object.values(again.segments).find((s) => s.label === '1.1')!;
    expect(
      one.entries.some(
        (e) =>
          e.variants.some((v) => v.attachment?.name === 'Tester') || e.adopted?.name === 'Tester',
      ),
    ).toBe(true);
  });

  it('keeps a published version as it was published when a witness changes later', async () => {
    const [edition] = await db
      .select()
      .from(editions)
      .where(eq(editions.slug, 'iliad-1-working-edition'));
    const published = await publishEdition(db, edition!.id, userId);
    // Readers see the published version; the editor, the current text with their drafts.
    const printed = async (atVersion: number | null) => {
      const view = await editionView(
        db,
        edition!.id,
        atVersion,
        atVersion === null ? owner : PUBLIC,
      );
      const one = Object.values(view.segments).find((x) => x.label === '1.1')!;
      return one.entries.map((e) => formatEntry(e, view.apparatus)).join(' | ');
    };
    const before = await printed(published.version);
    // B's transcriber changes a word of 1.1 after the publication; a conjecture is registered too.
    const [b] = await db
      .select()
      .from(transcriptions)
      .where(
        eq(
          transcriptions.witnessId,
          (await db.select().from(witnesses).where(eq(witnesses.slug, 'venetus-b')))[0]!.id,
        ),
      );
    const word = b!.content.items.find(
      (i): i is Token => i.kind === 'token' && (i.norm ?? i.form) === 'θεὰ',
    )!;
    await saveOps(db, 'transcription', b!.id, userId, b!.version, [
      { t: 'set', id: word.id, fields: { form: 'ΘΕΟΣ', norm: 'θεός' } },
    ]);
    const view = await editionView(db, edition!.id, null, owner);
    const segment = Object.values(view.segments).find((x) => x.label === '1.1')!;
    await registerConjecture(
      db,
      {
        workId: edition!.workId,
        segmentId: segment.segmentId,
        kind: 'substitution',
        lemma: 'μῆνιν',
        reading: 'μῆνις',
        proposer: 'Later',
      },
      userId,
    );
    expect(await printed(null)).toContain('θεός');
    expect(await printed(null)).toContain('Later');
    expect(await printed(published.version)).toBe(before);
  });

  it("refuses to publish another person's unpublished transcription", async () => {
    const [edition] = await db
      .select()
      .from(editions)
      .where(eq(editions.slug, 'iliad-1-working-edition'));
    const strangerId = newId();
    await db
      .insert(users)
      .values({ id: strangerId, email: `${strangerId}@test`, name: 'Stranger', passwordHash: 'x' });
    const [b] = await db
      .select()
      .from(transcriptions)
      .where(
        eq(
          transcriptions.witnessId,
          (await db.select().from(witnesses).where(eq(witnesses.slug, 'venetus-b')))[0]!.id,
        ),
      );
    try {
      await db
        .update(transcriptions)
        .set({ ownerId: strangerId, visibility: 'draft' })
        .where(eq(transcriptions.id, b!.id));
      await expect(publishEdition(db, edition!.id, userId)).rejects.toBeInstanceOf(PublishRefused);
      const [after] = await db.select().from(transcriptions).where(eq(transcriptions.id, b!.id));
      expect(after!.visibility).toBe('draft');
    } finally {
      await db
        .update(transcriptions)
        .set({ ownerId: userId, visibility: b!.visibility })
        .where(eq(transcriptions.id, b!.id));
      await db.delete(users).where(eq(users.id, strangerId));
    }
  });
});
