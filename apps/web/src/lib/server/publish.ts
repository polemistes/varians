/**
 * Publishing, withdrawing and deleting versions (docs/design.md, section
 * 3.11). A version is the record as it stands at the publication, written
 * once as a snapshot with the editors' note and the list of changes since the
 * version before. Its owner withdraws it, and it is read on under a warning;
 * only an administrator deletes it. Publishing an edition publishes the
 * owner's transcripts it compares as versions of their own, and is refused
 * while it compares another person's transcript at a text they have not
 * published. Conjectures and reported readings are public from the moment
 * they are entered; a version keeps them as they stand.
 */

import {
  collationCache,
  editionSigla,
  editions,
  moments,
  persons,
  transcriptions,
  versions,
  witnesses,
  type Database,
  type DocumentKind,
} from '@varians/db';
import { newId } from '@varians/core';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { nameMoment } from './documents/service.ts';
import { dataLicence } from './settings.ts';
import {
  changesSince,
  editionSnapshot,
  forgetSnapshot,
  transcriptionSnapshot,
} from './versions.ts';
import { versionStrings as v } from '../strings/versions.ts';

export {
  versionsOf,
  latestVersion,
  changesSinceLatest,
  hasVersion,
  type VersionSummary,
} from './versions.ts';

/** The longest note on a version or a withdrawal. */
export const MAX_NOTE = 4000;

export interface PublishResult {
  /** The changeset version published. */
  version: number;
  /** The number of the version made. */
  number: number;
  momentId: string;
  /** For an edition: the number of the version of each transcription it compares, those it published with it among them. */
  witnessVersions: Record<string, number>;
}

/** Publishing or withdrawing is refused, with a message for the person and the status a route answers with. */
export class PublishRefused extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 409 = 409,
  ) {
    super(message);
    this.name = 'PublishRefused';
  }
}

/** A note as stored: trimmed, null when empty. */
function cleanNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** The latest version of a record by number, withdrawn or not, and the latest that is not. */
async function versionsAt(
  db: Database,
  kind: DocumentKind,
  documentId: string,
): Promise<{
  last: { number: number; version: number } | null;
  live: { number: number; version: number } | null;
}> {
  const rows = await db
    .select({
      number: versions.number,
      version: versions.version,
      withdrawnAt: versions.withdrawnAt,
    })
    .from(versions)
    .where(and(eq(versions.documentKind, kind), eq(versions.documentId, documentId)))
    .orderBy(desc(versions.number));
  const live = rows.find((r) => !r.withdrawnAt);
  return {
    last: rows[0] ? { number: rows[0].number, version: rows[0].version } : null,
    live: live ? { number: live.number, version: live.version } : null,
  };
}

/**
 * Make a version of a transcription inside a transaction that holds its row:
 * fix its licence, name the published moment, list the changes since the
 * version before and write the snapshot.
 */
async function publishTranscriptionIn(
  tx: Database,
  transcriptionId: string,
  userId: string | null,
  note: string | null,
): Promise<{ number: number; version: number; momentId: string }> {
  const [t] = await tx
    .select({ id: transcriptions.id, version: transcriptions.version })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId))
    .for('update');
  if (!t) throw new Error(`no transcription ${transcriptionId}`);
  const { last } = await versionsAt(tx, 'transcription', transcriptionId);
  const number = (last?.number ?? 0) + 1;
  // The licence is fixed at the first publication, from the installation's data licence, and never changes after.
  await tx
    .update(transcriptions)
    .set({ licenceId: sql`coalesce(${transcriptions.licenceId}, ${dataLicence()})` })
    .where(eq(transcriptions.id, transcriptionId));
  const momentId = await nameMoment(
    tx,
    'transcription',
    transcriptionId,
    t.version,
    v.momentName(number, new Date().toISOString().slice(0, 10)),
    userId,
    'published',
  );
  const changes = await changesSince(
    tx,
    'transcription',
    transcriptionId,
    last?.version ?? 0,
    t.version,
  );
  await tx.insert(versions).values({
    id: newId(),
    documentKind: 'transcription',
    documentId: transcriptionId,
    number,
    version: t.version,
    momentId,
    note,
    createdBy: userId,
    snapshot: await transcriptionSnapshot(tx, transcriptionId),
    changes,
  });
  return { number, version: t.version, momentId };
}

/** Publish a transcription as it stands, as a new version with the editors' note. */
export async function publishTranscription(
  db: Database,
  transcriptionId: string,
  userId: string | null,
  note: string | null = null,
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const made = await publishTranscriptionIn(tx, transcriptionId, userId, cleanNote(note));
    return { ...made, witnessVersions: {} };
  });
}

/**
 * Publish the edition as it stands, as a new version with the editors' note.
 * Each of the owner's transcriptions in the conspectus whose text has changed
 * since its latest version (or that has none) is published with it, with a
 * note that says so; another person's transcription must have a version at
 * the text compared, or publishing is refused and names the witness.
 */
export async function publishEdition(
  db: Database,
  editionId: string,
  userId: string | null,
  note: string | null = null,
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [edition] = await tx
      .select({
        id: editions.id,
        title: editions.title,
        ownerId: editions.ownerId,
        version: editions.version,
      })
      .from(editions)
      .where(eq(editions.id, editionId))
      .for('update');
    if (!edition) throw new Error(`no edition ${editionId}`);
    const compared = await tx
      .select({
        siglum: editionSigla.siglum,
        transcriptionId: transcriptions.id,
        ownerId: transcriptions.ownerId,
        version: transcriptions.version,
        witness: witnesses.name,
      })
      .from(editionSigla)
      .innerJoin(transcriptions, eq(transcriptions.id, editionSigla.transcriptionId))
      .innerJoin(witnesses, eq(witnesses.id, editionSigla.witnessId))
      .where(eq(editionSigla.editionId, editionId))
      .orderBy(asc(editionSigla.position));
    const { last } = await versionsAt(tx, 'edition', editionId);
    const number = (last?.number ?? 0) + 1;
    const witnessVersions: Record<string, number> = {};
    const refused: string[] = [];
    const toPublish: string[] = [];
    for (const t of compared) {
      const { live } = await versionsAt(tx, 'transcription', t.transcriptionId);
      const current = live !== null && live.version >= t.version;
      if (current) witnessVersions[t.transcriptionId] = live.number;
      else if (t.ownerId === edition.ownerId) toPublish.push(t.transcriptionId);
      else refused.push(v.witnessNamed(t.siglum, t.witness));
    }
    if (refused.length) throw new PublishRefused(v.othersNotPublished(refused));
    for (const id of toPublish) {
      const made = await publishTranscriptionIn(
        tx,
        id,
        userId,
        v.publishedWith(edition.title, number),
      );
      witnessVersions[id] = made.number;
    }
    await tx
      .update(editions)
      .set({ licenceId: sql`coalesce(${editions.licenceId}, ${dataLicence()})` })
      .where(eq(editions.id, editionId));
    const momentId = await nameMoment(
      tx,
      'edition',
      editionId,
      edition.version,
      v.momentName(number, new Date().toISOString().slice(0, 10)),
      userId,
      'published',
    );
    const changes = await changesSince(
      tx,
      'edition',
      editionId,
      last?.version ?? 0,
      edition.version,
    );
    await tx.insert(versions).values({
      id: newId(),
      documentKind: 'edition',
      documentId: editionId,
      number,
      version: edition.version,
      momentId,
      note: cleanNote(note),
      createdBy: userId,
      snapshot: await editionSnapshot(tx, editionId, witnessVersions),
      changes,
    });
    return { version: edition.version, number, momentId, witnessVersions };
  });
}

/**
 * Withdraw a version: it keeps its address, its text and its files, and says
 * from now on that it is withdrawn, with the date, the person and the note
 * readers see. A version withdrawn already is refused; nothing brings one back.
 */
export async function withdrawVersion(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  number: number,
  userId: string | null,
  note: string | null = null,
): Promise<void> {
  const [person] = userId
    ? await db.select({ id: persons.id }).from(persons).where(eq(persons.userId, userId))
    : [];
  const where = and(
    eq(versions.documentKind, kind),
    eq(versions.documentId, documentId),
    eq(versions.number, number),
  );
  const done = await db
    .update(versions)
    .set({
      withdrawnAt: new Date(),
      withdrawnBy: person?.id ?? null,
      withdrawalNote: cleanNote(note),
    })
    .where(and(where, isNull(versions.withdrawnAt)))
    .returning({ id: versions.id });
  if (done.length) return;
  const [exists] = await db.select({ id: versions.id }).from(versions).where(where);
  throw exists
    ? new PublishRefused(v.alreadyWithdrawn, 409)
    : new PublishRefused(v.noSuchVersion, 404);
}

/**
 * Delete a version, withdrawn or not: its snapshot, the moment that marks it
 * in the history and the collation kept for it. Nothing is left at its
 * address, and its number is free again if it was the last. The caller sees
 * to it that only an administrator does this. A version of a transcript is
 * not deleted while a version of an edition compares it, which would be left
 * without that witness's text: the refusal names those versions.
 */
export async function deleteVersion(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  number: number,
): Promise<void> {
  const [row] = await db
    .select({ id: versions.id, momentId: versions.momentId })
    .from(versions)
    .where(
      and(
        eq(versions.documentKind, kind),
        eq(versions.documentId, documentId),
        eq(versions.number, number),
      ),
    );
  if (!row) throw new PublishRefused(v.noSuchVersion, 404);
  if (kind === 'transcription') {
    const comparing = await db
      .select({ number: versions.number, title: editions.title })
      .from(versions)
      .innerJoin(editions, eq(editions.id, versions.documentId))
      .where(
        and(
          eq(versions.documentKind, 'edition'),
          sql`(${versions.snapshot} -> 'witnessVersions' ->> ${documentId})::int = ${number}`,
        ),
      )
      .orderBy(asc(editions.title), asc(versions.number));
    if (comparing.length)
      throw new PublishRefused(v.compared(comparing.map((c) => v.versionOf(c.number, c.title))));
  }
  await db.transaction(async (tx) => {
    await tx.delete(versions).where(eq(versions.id, row.id));
    if (row.momentId)
      await tx
        .delete(moments)
        .where(and(eq(moments.id, row.momentId), eq(moments.kind, 'published')));
    if (kind === 'edition')
      await tx
        .delete(collationCache)
        .where(
          and(eq(collationCache.editionId, documentId), eq(collationCache.versionNumber, number)),
        );
  });
  forgetSnapshot(row.id);
}
