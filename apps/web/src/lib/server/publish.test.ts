import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEntry, newId, type Token } from '@varians/core';
import {
  collationCache,
  createDatabase,
  editions,
  moments,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
  type EditionSnapshot,
} from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';
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
  deleteVersion,
  publishEdition,
  publishTranscription,
  withdrawVersion,
} from './publish.ts';
import { editionView } from './reader.ts';
import { forgetCollations } from './passages.ts';
import { exportTei, loadWorkbench } from './workbench.ts';
import {
  changesRequest,
  deleteVersionRequest,
  publishRequest,
  versionsRequest,
  withdrawRequest,
} from './version-api.ts';
import { loadReader, readerDownload } from './reader-pages.ts';
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

  it('shows readers the latest version, each version at its address, and a withdrawn one with its text and its withdrawal', async () => {
    // A sample of its own, with no version yet.
    await db.delete(works).where(eq(works.slug, 'iliad'));
    await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
    const sample = await seedSample(db, userId);
    const slug = sample.editionSlug;
    const owner = { id: userId, role: 'member' as const };
    // No version: the edition is its editors' alone.
    await expect(loadReader(db, null, slug, {})).rejects.toMatchObject({ status: 404 });
    expect((await loadReader(db, owner, slug, {})).mode).toEqual({
      kind: 'draft',
      version: expect.any(Number),
    });
    const first = await publishEdition(db, sample.editionId, userId, 'First.');
    // The draft changes after: a reader does not see it, an editor previews it.
    await db
      .update(editions)
      .set({ title: 'Iliad 1, renamed in the draft' })
      .where(eq(editions.id, sample.editionId));
    // Nothing remembered in the process: what is collated is read from, and written to, the cache.
    forgetCollations();
    const shown = await loadReader(db, null, slug, {});
    expect(shown.mode).toMatchObject({ kind: 'published', number: 1, note: 'First.' });
    expect(shown.edition.title).toBe('Iliad 1, a working edition');
    expect(shown.versions.map((v) => [v.number, v.note, v.current, v.withdrawn])).toEqual([
      [1, 'First.', true, null],
    ]);
    expect(shown.versions[0]!.changes.added).toBeGreaterThan(0);
    const preview = await loadReader(db, owner, slug, { draft: true });
    expect(preview.mode).toMatchObject({ kind: 'preview', publishedNumber: 1 });
    expect(preview.edition.title).toBe('Iliad 1, renamed in the draft');
    // The version and the draft are collated apart: the cache keeps rows of each.
    const kept = await db
      .selectDistinct({ number: collationCache.versionNumber })
      .from(collationCache)
      .where(eq(collationCache.editionId, sample.editionId));
    expect(kept.map((r) => r.number).sort()).toEqual([0, 1]);

    const second = await publishEdition(db, sample.editionId, userId, 'Renamed.');
    expect((await loadReader(db, null, slug, {})).edition.title).toBe(
      'Iliad 1, renamed in the draft',
    );
    const old = await loadReader(db, null, slug, { version: first.number });
    expect(old.mode).toMatchObject({ kind: 'version', number: 1, isCurrent: false });
    expect(old.edition.title).toBe('Iliad 1, a working edition');
    // The plain text of a version is the version's.
    const text = await (await readerDownload(db, null, slug, { version: 1 }, 'text')).text();
    expect(text).toContain('Iliad 1, a working edition');

    await withdrawVersion(db, 'edition', sample.editionId, second.number, userId, 'Too soon.');
    expect((await loadReader(db, null, slug, {})).mode).toMatchObject({ number: 1 });
    // The withdrawn version is still read at its address, and says that it is withdrawn and which version stands.
    const withdrawn = await loadReader(db, null, slug, { version: 2 });
    expect(withdrawn.mode).toMatchObject({
      kind: 'version',
      number: 2,
      note: 'Renamed.',
      isCurrent: false,
      withdrawn: { note: 'Too soon.' },
      latest: 1,
    });
    expect(withdrawn.edition.title).toBe('Iliad 1, renamed in the draft');
    expect(withdrawn.lines.length).toBeGreaterThan(0);
    expect(await (await readerDownload(db, null, slug, { version: 2 }, 'text')).text()).toMatch(
      /Version 2, published \d{4}-\d\d-\d\d, withdrawn \d{4}-\d\d-\d\d/,
    );
    expect((await loadReader(db, null, slug, { version: 1 })).mode).toMatchObject({
      withdrawn: null,
      latest: 1,
    });
    // Every version withdrawn: no public page, and each version is still read at its address.
    await withdrawVersion(db, 'edition', sample.editionId, 1, userId, null);
    await expect(loadReader(db, null, slug, {})).rejects.toMatchObject({ status: 404 });
    expect((await loadReader(db, null, slug, { version: 1 })).mode).toMatchObject({
      withdrawn: { note: null },
      latest: null,
    });
  });

  it('answers the editors through the API: the changes since the version before, publishing with a note, the versions, withdrawing', async () => {
    const [edition] = await db
      .select()
      .from(editions)
      .where(eq(editions.slug, 'iliad-1-working-edition'));
    const owner = { id: userId, role: 'member' as const };
    const post = (body: unknown) =>
      new Request('http://x/', { method: 'POST', body: JSON.stringify(body) });
    const read = async (response: Response) => [response.status, await response.json()];
    // Someone who may not see the edition, whose every version is withdrawn, does not learn of it.
    const stranger = { id: newId(), role: 'member' as const };
    await expect(changesRequest(db, stranger, 'edition', edition!.id)).rejects.toMatchObject({
      status: 404,
    });
    const [, before] = await read(await changesRequest(db, owner, 'edition', edition!.id));
    const [status, made] = await read(
      await publishRequest(db, owner, 'edition', edition!.id, post({ note: 'Through the API.' })),
    );
    expect(status).toBe(200);
    expect(made.number).toBe(before.number);
    const [, listed] = await read(await versionsRequest(db, owner, 'edition', edition!.id));
    expect(listed.versions[0]).toMatchObject({
      number: made.number,
      note: 'Through the API.',
      withdrawn: null,
      changes: { to: made.version },
    });
    const [, after] = await read(await changesRequest(db, owner, 'edition', edition!.id));
    expect(after).toMatchObject({ number: made.number + 1, changes: { segments: [] } });
    const [withdrawn] = await read(
      await withdrawRequest(
        db,
        owner,
        'edition',
        edition!.id,
        post({ number: made.number, note: 'Not this one.' }),
      ),
    );
    expect(withdrawn).toBe(200);
    // One who may see the edition but does not own it is refused.
    await publishEdition(db, edition!.id, userId);
    await expect(changesRequest(db, stranger, 'edition', edition!.id)).rejects.toMatchObject({
      status: 403,
    });
    const [again, refused] = await read(
      await withdrawRequest(db, owner, 'edition', edition!.id, post({ number: made.number })),
    );
    expect(again).toBe(409);
    expect(refused.message).toBe('That version is withdrawn already.');
    await expect(
      withdrawRequest(db, owner, 'edition', edition!.id, post({ number: 'one' })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('shows a reader of a transcript its latest version, read only, and its draft to its editors', async () => {
    const [b] = await db
      .select()
      .from(transcriptions)
      .where(
        eq(
          transcriptions.witnessId,
          (await db.select().from(witnesses).where(eq(witnesses.slug, 'venetus-b')))[0]!.id,
        ),
      );
    const owner = { id: userId, role: 'member' as const };
    const made = await publishTranscription(db, b!.id, userId, 'As read.');
    const word = b!.content.items.find((i): i is Token => i.kind === 'token')!;
    await saveOps(db, 'transcription', b!.id, userId, b!.version, [
      { t: 'set', id: word.id, fields: { form: 'ΔΡΑΦΤ' } },
    ]);
    const formOf = (data: Awaited<ReturnType<typeof loadWorkbench>>) =>
      data!.transcription.content.items.find((i) => i.id === word.id)!;
    const reader = await loadWorkbench(db, null, b!.id);
    expect(reader!.transcription).toMatchObject({
      shownVersion: made.number,
      latestVersion: made.number,
    });
    expect(reader!.canEdit).toBe(false);
    expect(formOf(reader)).toMatchObject({ form: word.form });
    const editor = await loadWorkbench(db, owner, b!.id);
    expect(editor!.transcription.shownVersion).toBeNull();
    expect(formOf(editor)).toMatchObject({ form: 'ΔΡΑΦΤ' });
    // A version at its address is read only, to its editors too.
    const atVersion = await loadWorkbench(db, owner, b!.id, made.number);
    expect(atVersion!.canEdit).toBe(false);
    expect(formOf(atVersion)).toMatchObject({ form: word.form });
    // Its downloads for a reader are the version's.
    expect((await exportTei(db, b!.id, 'http://x', false))!.xml).not.toContain('ΔΡΑΦΤ');
    expect((await exportTei(db, b!.id, 'http://x', true))!.xml).toContain('ΔΡΑΦΤ');

    expect(atVersion!.transcription.shown).toMatchObject({ note: 'As read.', withdrawn: null });

    // A withdrawn version is still read at its address, read only, and says that it is withdrawn.
    await withdrawVersion(db, 'transcription', b!.id, made.number, userId, 'Misread.');
    const withdrawn = await loadWorkbench(db, null, b!.id, made.number);
    expect(withdrawn!.transcription).toMatchObject({
      shownVersion: made.number,
      shown: { note: 'As read.', personName: 'Publisher', withdrawn: { note: 'Misread.' } },
    });
    expect(withdrawn!.canEdit).toBe(false);
    expect(formOf(withdrawn)).toMatchObject({ form: word.form });
    expect(await loadWorkbench(db, null, b!.id, made.number + 50)).toBeNull();
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

  it('lets an administrator alone delete a version, with its moment and its collation, and nothing is left at its address', async () => {
    await db.delete(works).where(eq(works.slug, 'iliad'));
    await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
    const sample = await seedSample(db, userId);
    const slug = sample.editionSlug;
    const owner = { id: userId, role: 'member' as const };
    const administrator = { id: entererId, role: 'administrator' as const };
    const first = await publishEdition(db, sample.editionId, userId, 'First.');
    const second = await publishEdition(db, sample.editionId, userId, 'Second.');
    // Read once, so that its collation is kept.
    forgetCollations();
    await loadReader(db, null, slug, { version: first.number });
    const cached = async () =>
      (
        await db
          .selectDistinct({ number: collationCache.versionNumber })
          .from(collationCache)
          .where(eq(collationCache.editionId, sample.editionId))
      )
        .map((r) => r.number)
        .sort();
    expect(await cached()).toContain(first.number);
    const publishedMoments = async () =>
      (
        await db
          .select({ id: moments.id })
          .from(moments)
          .where(
            and(
              eq(moments.documentKind, 'edition'),
              eq(moments.documentId, sample.editionId),
              eq(moments.kind, 'published'),
            ),
          )
      ).map((m) => m.id);
    expect(await publishedMoments()).toContain(first.momentId);

    // The owner may not; an administrator may.
    await expect(
      deleteVersionRequest(db, owner, 'edition', sample.editionId, String(first.number)),
    ).rejects.toMatchObject({ status: 403 });
    const done = await deleteVersionRequest(
      db,
      administrator,
      'edition',
      sample.editionId,
      String(first.number),
    );
    expect(done.status).toBe(200);
    expect((await versionsOf(db, 'edition', sample.editionId)).map((v) => v.number)).toEqual([
      second.number,
    ]);
    expect(await cached()).not.toContain(first.number);
    expect(await publishedMoments()).not.toContain(first.momentId);
    await expect(loadReader(db, null, slug, { version: first.number })).rejects.toMatchObject({
      status: 404,
    });
    expect((await loadReader(db, null, slug, {})).mode).toMatchObject({ number: second.number });
    // One that is not there is not found.
    const missing = await deleteVersionRequest(
      db,
      administrator,
      'edition',
      sample.editionId,
      String(first.number),
    );
    expect(missing.status).toBe(404);

    // A transcript's version that a version of an edition compares stays until that version is deleted.
    const [transcriptId, compared] = Object.entries(second.witnessVersions)[0]!;
    const refusal = await deleteVersion(db, 'transcription', transcriptId, compared).catch(
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(PublishRefused);
    expect((refusal as Error).message).toBe(
      'Version 2 of Iliad 1, a working edition compares this version of the transcript. Delete that version first.',
    );
    // A withdrawn version is deleted like any other; the last one gone, the edition is its editors' alone again.
    await withdrawVersion(db, 'edition', sample.editionId, second.number, userId, null);
    await deleteVersion(db, 'edition', sample.editionId, second.number);
    expect(await hasVersion(db, 'edition', sample.editionId)).toBe(false);
    await expect(loadReader(db, null, slug, {})).rejects.toMatchObject({ status: 404 });
    await deleteVersion(db, 'transcription', transcriptId, compared);
    expect(
      (await versionsOf(db, 'transcription', transcriptId)).map((v) => v.number),
    ).not.toContain(compared);
    // The next version takes the number after the last there is.
    expect((await publishEdition(db, sample.editionId, userId)).number).toBe(1);
  });
});
