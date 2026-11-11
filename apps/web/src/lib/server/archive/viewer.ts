/**
 * What one person may see of a work's archive: the filter a download and
 * the record addresses (/id/) write with, by the same rules as the pages.
 * Transcripts and editions are drafts for those who may not see them; the
 * conjectures and reported readings are every person's.
 */

import {
  canEditEdition,
  canViewEdition,
  canViewTranscription,
  grantsFor,
  type Actor,
} from '../authz.ts';
import type { ArchiveFilter } from './archive.ts';
import type { Database } from '@varians/db';

export async function viewerFilter(db: Database, user: Actor | null): Promise<ArchiveFilter> {
  const grants = await grantsFor(db, user);
  const collaborators = (id: string) =>
    user && grants.collaboratingEditionIds.has(id) ? [user.id] : [];
  return {
    transcription: (row) => canViewTranscription(user, row, grants),
    edition: (row) => canViewEdition(user, row, collaborators(row.id)),
    editionWorking: (row) => canEditEdition(user, row, collaborators(row.id)),
    records: true,
  };
}
