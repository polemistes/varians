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
  canViewTranscription,
  grantsFor,
  type Actor,
} from './authz';

export interface TranscriptionAccess {
  transcription: Transcription;
  witness: Witness;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export async function loadTranscriptionAccess(
  db: Database,
  user: Actor | null,
  id: string,
): Promise<TranscriptionAccess | null> {
  const [row] = await db
    .select({ transcription: transcriptions, witness: witnesses })
    .from(transcriptions)
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .where(eq(transcriptions.id, id));
  if (!row) return null;
  const grants = await grantsFor(db, user);
  const canEdit = canEditTranscription(user, row.transcription, grants);
  return {
    transcription: row.transcription,
    witness: row.witness,
    canView: canViewTranscription(user, row.transcription, grants),
    canEdit,
    canDelete: canDeleteTranscription(user, row.transcription),
  };
}
