/**
 * Commits of the archive at the moments that matter: a named
 * moment and a publication are committed in every work the document belongs
 * to, authored by the person who named or published it. The rest is
 * committed by the nightly pass, authored by Varians.
 */

import { editionSigla, editions, users, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import { worksOfTranscription } from '../transcription-works.ts';
import { archiveWork, personAuthor, VARIANS_AUTHOR, type ArchiveWriters } from './archive.ts';

/** The works whose archives hold a document. */
export async function worksOfDocument(
  db: Database,
  kind: 'transcription' | 'edition',
  documentId: string,
): Promise<string[]> {
  if (kind === 'edition') {
    const [row] = await db
      .select({ workId: editions.workId })
      .from(editions)
      .where(eq(editions.id, documentId));
    return row ? [row.workId] : [];
  }
  const viaSigla = await db
    .selectDistinct({ workId: editions.workId })
    .from(editionSigla)
    .innerJoin(editions, eq(editions.id, editionSigla.editionId))
    .where(eq(editionSigla.transcriptionId, documentId));
  return [
    ...new Set([...(await worksOfTranscription(db, documentId)), ...viaSigla.map((r) => r.workId)]),
  ];
}

/** Write and commit the archives of a document's works, authored by the person. Returns the commit hashes made. */
export async function commitDocument(
  db: Database,
  kind: 'transcription' | 'edition',
  documentId: string,
  reason: string,
  userId: string | null,
  root: string,
  writers: ArchiveWriters = {},
): Promise<string[]> {
  let author = VARIANS_AUTHOR;
  if (userId) {
    const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    if (user) author = personAuthor(user.name, userId);
  }
  const hashes: string[] = [];
  for (const workId of await worksOfDocument(db, kind, documentId)) {
    const hash = await archiveWork(db, workId, root, reason, writers, author);
    if (hash) hashes.push(hash);
  }
  return hashes;
}
