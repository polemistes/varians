/**
 * Loading a transcription with what a request needs to authorize against it.
 */
import { transcriptions, witnesses, type Database, type Transcription, type Witness } from '@varians/db';
import { eq } from 'drizzle-orm';
import { canDeleteTranscription, canEditTranscription, canViewTranscription, grantsFor, type Actor } from './authz';
import { seesWork } from './edition-access';
import { worksOfTranscription } from './transcription-works';

export interface TranscriptionAccess {
  transcription: Transcription;
  witness: Witness;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export async function loadTranscriptionAccess(db: Database, user: Actor | null, id: string): Promise<TranscriptionAccess | null> {
  const [row] = await db
    .select({ transcription: transcriptions, witness: witnesses })
    .from(transcriptions)
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .where(eq(transcriptions.id, id));
  if (!row) return null;
  const grants = await grantsFor(db, user);
  const canEdit = canEditTranscription(user, row.transcription, grants);
  let canView = canViewTranscription(user, row.transcription, grants);
  // A transcription of a private work, chosen for it or with text assigned to it, is seen only by those who see the work.
  if (canView && !canEdit) {
    for (const workId of await worksOfTranscription(db, row.transcription.id)) {
      if (!(await seesWork(db, user, workId))) {
        canView = false;
        break;
      }
    }
  }
  return {
    transcription: row.transcription,
    witness: row.witness,
    canView,
    canEdit,
    canDelete: canDeleteTranscription(user, row.transcription),
  };
}
