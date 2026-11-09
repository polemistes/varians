/**
 * A document (a transcription or an edition) with the current user's rights
 * on it, for the routes that serve either kind alike.
 */
import type { Database, DocumentKind } from '@varians/db';
import type { Actor } from './authz';
import { loadEditionAccess } from './edition-access';
import { loadTranscriptionAccess } from './transcription-access';

export interface DocumentAccess {
  kind: DocumentKind;
  id: string;
  version: number;
  canView: boolean;
  canEdit: boolean;
  /** The work the document belongs to, for an edition; null for a transcription. */
  workId: string | null;
}

export function isDocumentKind(value: string): value is DocumentKind {
  return value === 'transcription' || value === 'edition';
}

export async function loadDocumentAccess(db: Database, user: Actor | null, kind: DocumentKind, id: string): Promise<DocumentAccess | null> {
  if (kind === 'transcription') {
    const access = await loadTranscriptionAccess(db, user, id);
    if (!access) return null;
    return { kind, id: access.transcription.id, version: access.transcription.version, canView: access.canView, canEdit: access.canEdit, workId: null };
  }
  const access = await loadEditionAccess(db, user, id);
  if (!access) return null;
  // An edition's working state and history are its editors': readers see published versions only, through the reader.
  return { kind, id: access.edition.id, version: access.edition.version, canView: access.canEdit, canEdit: access.canEdit, workId: access.edition.workId };
}
