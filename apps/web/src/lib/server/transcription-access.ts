/**
 * Loading a transcription with what a request needs to authorize against it.
 */
import {
  transcriptions,
  witnesses,
  type Database,
  type Transcription,
  type Witness,
} from '@varians/db';
import { eq } from 'drizzle-orm';
import {
  canDeleteTranscription,
  canEditTranscription,
  canPublishTranscription,
  canViewTranscription,
  grantsFor,
  type Actor,
} from './authz';
import { hasVersionSql } from './versions';

export interface TranscriptionAccess {
  /** The transcription, with whether it has a version that is not withdrawn. */
  transcription: Transcription & { hasVersion: boolean };
  witness: Witness;
  canView: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canDelete: boolean;
}

export async function loadTranscriptionAccess(
  db: Database,
  user: Actor | null,
  id: string,
): Promise<TranscriptionAccess | null> {
  const [row] = await db
    .select({
      transcription: transcriptions,
      witness: witnesses,
      hasVersion: hasVersionSql('transcription', transcriptions.id),
    })
    .from(transcriptions)
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .where(eq(transcriptions.id, id));
  if (!row) return null;
  const transcription = { ...row.transcription, hasVersion: row.hasVersion };
  const grants = await grantsFor(db, user);
  const canEdit = canEditTranscription(user, transcription, grants);
  return {
    transcription,
    witness: row.witness,
    canView: canViewTranscription(user, transcription, grants),
    canEdit,
    canPublish: canPublishTranscription(user, transcription),
    canDelete: canDeleteTranscription(user, transcription),
  };
}
