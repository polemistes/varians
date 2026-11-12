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
  type EditionSnapshot,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import {
  adoptConjecture,
  adoptionsOf,
  registerConjecture,
  reportReading,
  reviewSite,
  reviewedSites,
} from './conjectures.ts';
import { saveOps } from './documents/service.ts';
import {
  PublishRefused,
  publishEdition,
  publishTranscription,
  withdrawVersion,
} from './publish.ts';
import { editionView } from './reader.ts';
import { seedSample } from './seed/sample.ts';
import { hasVersion, latestVersion, versionByNumber, versionsOf } from './versions.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
/** Someone else, who enters conjectures and reported readings on the work. */
const entererId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Publisher', passwordHash: 'x' },
    { id: entererId, email: `${entererId}@test`, name: 'Enterer', passwordHash: 'x' },
  ]);
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(inArray(users.id, [userId, entererId]));
  await pool.end();
});

describe('publishing and conjectures', () => {
  it('publishes a numbered version with its note and the transcripts it compares, and withdraws one without deleting it', async () => {
    const sample = await seedSample(db, userId);
    expect(await hasVersion(db, 'edition', sample.editionId)).toBe(false);
    // A's draft is later than the version of it the sample published.
    const [a] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.A!));
    const first = a!.content.items.find((i): i is Token => i.kind === 'token')!;
    await saveOps(db, 'transcription', a!.id, userId, a!.version, [
      { t: 'set', id: first.id, fields: { norm: 'μῆνιν' } },
    ]);
    const result = await publishEdition(db, sample.editionId, userId, '  The first version.  ');
    expect(result.number).toBe(1);
    const [edition] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    expect(result.version).toBe(edition!.version);
    expect(edition!.licenceId).not.toBeNull();
    const versions = await versionsOf(db, 'edition', sample.editionId);
    expect(versions.map((v) => [v.number, v.note, v.withdrawn])).toEqual([
      [1, 'The first version.', null],
    ]);
    // The owner's transcript changed since its version is published with the edition, with a note that says so; the others are compared at the versions they have.
    const aVersions = await versionsOf(db, 'transcription', a!.id);
    expect(aVersions.map((v) => [v.number, v.note])).toEqual([
      [2, 'Published with the edition Iliad 1, a working edition, version 1'],
      [1, null],
    ]);
    expect(result.witnessVersions[a!.id]).toBe(2);
    expect(Object.values(result.witnessVersions).filter((n) => n === 1)).toHaveLength(2);
    // The first version lists every word as added.
    expect(versions[0]!.changes.added).toBeGreaterThan(0);
    expect(versions[0]!.changes.from).toBe(0);

    const second = await publishEdition(db, sample.editionId, userId);
    expect(second.number).toBe(2);
    // Nothing of A changed since: it is compared at the version it has.
    expect(second.witnessVersions[a!.id]).toBe(2);
    expect((await latestVersion(db, 'edition', sample.editionId))!.number).toBe(2);

    await withdrawVersion(db, 'edition', sample.editionId, 2, userId, 'A slip.');
    const after = await versionsOf(db, 'edition', sample.editionId);
    expect(after.map((v) => v.number)).toEqual([2, 1]);
    expect(after[0]!.withdrawn).toMatchObject({ note: 'A slip.', personName: 'Publisher' });
    expect((await latestVersion(db, 'edition', sample.editionId))!.number).toBe(1);
    await expect(
      withdrawVersion(db, 'edition', sample.editionId, 2, userId, null),
    ).rejects.toBeInstanceOf(PublishRefused);
    await expect(
      withdrawVersion(db, 'edition', sample.editionId, 9, userId, null),
    ).rejects.toMatchObject({ status: 404 });
    await withdrawVersion(db, 'edition', sample.editionId, 1, userId, null);
    // Every version withdrawn: the edition is no longer public, and its versions are kept.
    expect(await hasVersion(db, 'edition', sample.editionId)).toBe(false);
    expect(await versionsOf(db, 'edition', sample.editionId)).toHaveLength(2);
    // A new version is published instead, numbered after the withdrawn ones.
    expect((await publishEdition(db, sample.editionId, userId)).number).toBe(3);
  });

  it('fixes in the snapshot what a reader of the version needs', async () => {
    const [edition] = await db
      .select()
      .from(editions)
      .where(eq(editions.slug, 'iliad-1-working-edition'));
    const published = await publishEdition(db, edition!.id, userId, null);
    const version = await versionByNumber(db, 'edition', edition!.id, published.number);
    const snapshot = version!.snapshot as EditionSnapshot;
    expect(snapshot.title).toBe(edition!.title);
    expect(snapshot.content).toEqual(edition!.content);
    expect(snapshot.sigla.map((x) => x.siglum)).toEqual(['A', 'B', 'C', 'T']);
    expect(Object.keys(snapshot.witnessVersions).sort()).toEqual(
      snapshot.sigla
        .map((x) => x.transcriptionId)
        .filter((id): id is string => id !== null)
        .sort(),
    );
    expect(snapshot.siteKinds.some((k) => k.kind === 'textual')).toBe(true);
    expect(snapshot.constraints).toHaveLength(1);
    expect(snapshot.conjectures.length).toBeGreaterThan(0);
    expect(snapshot.notes.length).toBeGreaterThan(0);
    // Nothing changed since the version before: the list of changes is empty.
    expect(version!.changes.segments).toEqual([]);
    expect(version!.changes.from).toBe(version!.changes.to);
  });

  it('registers, adopts and reviews', async () => {
    const [edition] = await db
      .select()
      .from(editions)
      .where(eq(editions.slug, 'iliad-1-working-edition'));
    const view = await editionView(db, edition!.id, null);
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
    const again = await editionView(db, edition!.id, null);
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
    // Readers see the published version; the editor, the current text.
    const printed = async (number: number | null) => {
      const view = await editionView(db, edition!.id, number);
      const one = Object.values(view.segments).find((x) => x.label === '1.1')!;
      return one.entries.map((e) => formatEntry(e, view.apparatus)).join(' | ');
    };
    const before = await printed(published.number);
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
    const view = await editionView(db, edition!.id, null);
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
    expect(await printed(published.number)).toBe(before);
  });

  it('shows a published version every conjecture and reported reading entered before it, whoever entered them, and none entered after', async () => {
    const sample = await seedSample(db, userId);
    const [edition] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    const view = await editionView(db, edition!.id, null);
    const segment = Object.values(view.segments).find((x) => x.label === '1.1')!;
    const [reported] = await db.select().from(witnesses).where(eq(witnesses.slug, 'townleianus-t'));
    const names = async (number: number | null) => {
      const shown = await editionView(db, edition!.id, number);
      const one = Object.values(shown.segments).find((x) => x.label === '1.1')!;
      return [
        ...one.entries.flatMap((e) => e.variants.map((v) => v.attachment?.name)),
        ...one.unplaced.map((u) => u.name),
      ];
    };
    const enter = async (name: string) => {
      await registerConjecture(
        db,
        {
          workId: edition!.workId,
          segmentId: segment.segmentId,
          kind: 'substitution',
          lemma: 'μῆνιν',
          reading: `μῆνις ${name}`,
          proposer: name,
        },
        entererId,
      );
      await reportReading(
        db,
        {
          workId: edition!.workId,
          segmentId: segment.segmentId,
          witnessId: reported!.id,
          lemma: 'μῆνιν',
          reading: `μῆνιν ${name}`,
        },
        entererId,
      );
    };
    // Entered by someone else, with nothing done to publish it, before the edition is published.
    await enter('Before');
    const published = await publishEdition(db, edition!.id, userId);
    // Entered after: the draft has it at once, and the published version does not.
    await new Promise((done) => setTimeout(done, 20));
    await enter('After');
    expect(await names(null)).toEqual(expect.arrayContaining(['Before', 'After']));
    const then = await names(published.number);
    expect(then).toContain('Before');
    expect(then).not.toContain('After');
    // A reported reading takes part in the variants as a witness that is there: the one entered before does, the one after does not.
    const words = async (number: number | null) =>
      JSON.stringify((await editionView(db, edition!.id, number)).segments);
    expect(await words(published.number)).toContain('μῆνιν Before');
    expect(await words(published.number)).not.toContain('μῆνιν After');
    expect(await words(null)).toContain('μῆνιν After');
  });

  it('reads a version published while the edition still had the setting for Latin abbreviations in English words', async () => {
    const [edition] = await db
      .select()
      .from(editions)
      .where(eq(editions.slug, 'iliad-1-working-edition'));
    const old = { ...edition!.conventions, latin: true };
    await db.update(editions).set({ conventions: old }).where(eq(editions.id, edition!.id));
    const published = await publishEdition(db, edition!.id, userId);
    const view = await editionView(db, edition!.id, published.number);
    expect(view.apparatus).not.toHaveProperty('latin');
    const six = Object.values(view.segments)
      .flatMap((p) => p.entries)
      .filter((e) => e.label === '1.6');
    expect(six.map((e) => formatEntry(e, view.apparatus))).toEqual([
      '1.6 ἐξ … ἐρίσαντε A : not in B C',
    ]);
    // The version keeps the conventions without the setting no longer had.
    const version = await versionByNumber(db, 'edition', edition!.id, published.number);
    expect((version!.snapshot as EditionSnapshot).conventions).not.toHaveProperty('latin');
  });

  it("refuses to publish another person's transcription at a text they have not published, and names the witness", async () => {
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
        .set({ ownerId: strangerId })
        .where(eq(transcriptions.id, b!.id));
      // Its latest version is at the text compared: publishing goes ahead.
      await publishTranscription(db, b!.id, strangerId, null);
      const allowed = await publishEdition(db, edition!.id, userId);
      const bVersions = await versionsOf(db, 'transcription', b!.id);
      expect(allowed.witnessVersions[b!.id]).toBe(bVersions[0]!.number);
      // Its owner changes the draft: the edition would compare a text they have not published.
      const [now] = await db.select().from(transcriptions).where(eq(transcriptions.id, b!.id));
      const word = now!.content.items.find((i): i is Token => i.kind === 'token')!;
      await saveOps(db, 'transcription', b!.id, strangerId, now!.version, [
        { t: 'set', id: word.id, fields: { norm: 'μῆνιν' } },
      ]);
      const refusal = await publishEdition(db, edition!.id, userId).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(PublishRefused);
      expect((refusal as Error).message).toContain('B (');
      // Nothing of theirs was published by it.
      expect(await versionsOf(db, 'transcription', b!.id)).toHaveLength(bVersions.length);
      // Every version of theirs withdrawn: refused as well.
      for (const v of bVersions)
        if (!v.withdrawn) await withdrawVersion(db, 'transcription', b!.id, v.number, strangerId);
      await publishTranscription(db, b!.id, strangerId);
      await withdrawVersion(
        db,
        'transcription',
        b!.id,
        (await versionsOf(db, 'transcription', b!.id))[0]!.number,
        strangerId,
      );
      await expect(publishEdition(db, edition!.id, userId)).rejects.toBeInstanceOf(PublishRefused);
    } finally {
      await db.update(transcriptions).set({ ownerId: userId }).where(eq(transcriptions.id, b!.id));
      await db.delete(users).where(eq(users.id, strangerId));
    }
  });
});
