/**
 * Publishing an edition: a numbered, named moment readers link to; the
 * transcriptions of its conspectus become public with it. Unpublishing takes
 * them back unless another published edition still needs them. Conjectures
 * and reported readings are public from the moment they are entered, so
 * publishing has nothing to do with them.
 */

import {
  editionSigla,
  editions,
  moments,
  transcriptions,
  witnesses,
  type Database,
  type MomentBasis,
} from '@varians/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { nameMoment } from './documents/service.ts';
import { siteKindsOf } from './collation.ts';
import { marksForBasis } from './site-marks.ts';
import { dataLicence } from './settings.ts';

export interface PublishResult {
  version: number;
  number: number;
  momentId: string;
}

/** Publishing would make public what is not the owner's to publish. */
export class PublishRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishRefused';
  }
}

/**
 * Publish the edition at its current version. What it rests on becomes
 * public with it, as far as it is the owner's: their transcriptions in the
 * conspectus. A conspectus naming another person's unpublished transcription
 * is refused, since only that person may publish it.
 */
export async function publishEdition(
  db: Database,
  editionId: string,
  userId: string | null,
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [edition] = await tx
      .select()
      .from(editions)
      .where(eq(editions.id, editionId))
      .for('update');
    if (!edition) throw new Error(`no edition ${editionId}`);
    const compared = await tx
      .select({
        siglum: editionSigla.siglum,
        visibility: transcriptions.visibility,
        ownerId: transcriptions.ownerId,
        witness: witnesses.name,
      })
      .from(editionSigla)
      .innerJoin(transcriptions, eq(transcriptions.id, editionSigla.transcriptionId))
      .innerJoin(witnesses, eq(witnesses.id, editionSigla.witnessId))
      .where(eq(editionSigla.editionId, editionId));
    const othersDrafts = compared.filter(
      (n) => n.visibility !== 'published' && n.ownerId !== edition.ownerId,
    );
    if (othersDrafts.length) {
      throw new PublishRefused(
        `${othersDrafts.map((n) => `${n.siglum} (${n.witness})`).join(', ')} ${othersDrafts.length === 1 ? 'is' : 'are'} another person's unpublished transcription. Ask them to publish it, or take it out of the witnesses.`,
      );
    }
    const [last] = await tx
      .select({ number: moments.number })
      .from(moments)
      .where(
        and(
          eq(moments.documentKind, 'edition'),
          eq(moments.documentId, editionId),
          eq(moments.kind, 'published'),
        ),
      )
      .orderBy(desc(moments.number))
      .limit(1);
    const number = (last?.number ?? 0) + 1;
    const date = new Date().toISOString().slice(0, 10);
    const momentId = await nameMoment(
      tx,
      'edition',
      editionId,
      edition.version,
      `Version ${number} (${date})`,
      userId,
      'published',
      number,
    );
    // What the apparatus is collated against, so that this version reads the same however the witnesses change later.
    const conspectus = await tx
      .select({
        siglum: editionSigla.siglum,
        witnessId: editionSigla.witnessId,
        transcriptionId: editionSigla.transcriptionId,
        states: editionSigla.states,
        variantSiglum: editionSigla.variantSiglum,
      })
      .from(editionSigla)
      .where(eq(editionSigla.editionId, editionId))
      .orderBy(editionSigla.position);
    const named = conspectus
      .map((s) => s.transcriptionId)
      .filter((id): id is string => id !== null);
    const versions = named.length
      ? Object.fromEntries(
          (
            await tx
              .select({ id: transcriptions.id, version: transcriptions.version })
              .from(transcriptions)
              .where(inArray(transcriptions.id, named))
          ).map((t) => [t.id, t.version]),
        )
      : {};
    // The editors' word on places is part of what the version fixes.
    const siteKinds = marksForBasis(await siteKindsOf(tx, editionId));
    const basis: MomentBasis = { sigla: conspectus, versions, siteKinds };
    await tx.update(moments).set({ basis }).where(eq(moments.id, momentId));
    // The licence is fixed at the first publication, from the installation's data licence, and never changes after.
    const licence = dataLicence();
    await tx
      .update(editions)
      .set({
        visibility: 'published',
        publishedVersion: edition.version,
        licenceId: sql`coalesce(${editions.licenceId}, ${licence})`,
      })
      .where(eq(editions.id, editionId));
    // What the edition rests on becomes public with it.
    const sigla = await tx
      .select({ transcriptionId: editionSigla.transcriptionId })
      .from(editionSigla)
      .where(eq(editionSigla.editionId, editionId));
    const transcriptionIds = sigla
      .map((s) => s.transcriptionId)
      .filter((id): id is string => id !== null);
    if (transcriptionIds.length) {
      await tx
        .update(transcriptions)
        .set({
          visibility: 'published',
          licenceId: sql`coalesce(${transcriptions.licenceId}, ${licence})`,
        })
        .where(
          and(
            inArray(transcriptions.id, transcriptionIds),
            eq(transcriptions.ownerId, edition.ownerId),
          ),
        );
    }
    return { version: edition.version, number, momentId };
  });
}

/** Take an edition back to a draft. Readers keep the published moments in the history, but the public page is gone. */
export async function unpublishEdition(db: Database, editionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [edition] = await tx
      .select()
      .from(editions)
      .where(eq(editions.id, editionId))
      .for('update');
    if (!edition) throw new Error(`no edition ${editionId}`);
    await tx
      .update(editions)
      .set({ visibility: 'draft', publishedVersion: null })
      .where(eq(editions.id, editionId));
    // The owner's transcriptions go back to drafts, unless another published edition still names them; no one else's are touched.
    const sigla = await tx
      .select({ transcriptionId: editionSigla.transcriptionId })
      .from(editionSigla)
      .innerJoin(transcriptions, eq(transcriptions.id, editionSigla.transcriptionId))
      .where(
        and(eq(editionSigla.editionId, editionId), eq(transcriptions.ownerId, edition.ownerId)),
      );
    for (const s of sigla) {
      if (!s.transcriptionId) continue;
      const [other] = await tx
        .select({ id: editions.id })
        .from(editionSigla)
        .innerJoin(editions, eq(editions.id, editionSigla.editionId))
        .where(
          and(
            eq(editionSigla.transcriptionId, s.transcriptionId),
            eq(editions.visibility, 'published'),
            ne(editions.id, editionId),
          ),
        )
        .limit(1);
      if (!other)
        await tx
          .update(transcriptions)
          .set({ visibility: 'draft' })
          .where(eq(transcriptions.id, s.transcriptionId));
    }
  });
}

/** The published moments of an edition, newest first. */
export async function publishedVersions(
  db: Database,
  editionId: string,
): Promise<{ number: number; version: number; name: string; at: Date }[]> {
  const rows = await db
    .select({
      number: moments.number,
      version: moments.version,
      name: moments.name,
      at: moments.at,
    })
    .from(moments)
    .where(
      and(
        eq(moments.documentKind, 'edition'),
        eq(moments.documentId, editionId),
        eq(moments.kind, 'published'),
      ),
    )
    .orderBy(desc(moments.number));
  return rows.map((r) => ({ number: r.number ?? 0, version: r.version, name: r.name, at: r.at }));
}
