/**
 * What one person may see of a work's archive: the filter a download and
 * the record addresses (/id/) write with, by the same rules as the pages.
 */

import {
  canEditEdition,
  canViewConjecture,
  canViewEdition,
  canViewTranscription,
  grantsFor,
  type Actor,
} from '../authz.ts';
import type { ArchiveFilter } from './archive.ts';
import type { Database } from '@varians/db';

export async function viewerFilter(
  db: Database,
  user: Actor | null,
  maintainerIds: string[],
): Promise<ArchiveFilter> {
  const grants = await grantsFor(db, user);
  const context = { workMaintainerIds: maintainerIds, grants };
  const collaborators = (id: string) =>
    user && grants.collaboratingEditionIds.has(id) ? [user.id] : [];
  return {
    transcription: (row) => canViewTranscription(user, row, grants),
    edition: (row) => canViewEdition(user, row, collaborators(row.id)),
    editionWorking: (row) => canEditEdition(user, row, collaborators(row.id)),
    conjecture: (row) => canViewConjecture(user, row, context),
    reported: (row) => canViewConjecture(user, row, context),
  };
}
