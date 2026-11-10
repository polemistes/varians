/**
 * Editorial notes of an edition: free text about a segment or some of its
 * words. The reader prints them with the apparatus.
 */
import { newId } from '@varians/core';
import { notes, users, type Database } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { setCitations, type CitationInput } from './bibliography.ts';

export interface NoteView {
  id: string;
  segmentId: string;
  tokenIds: string[];
  text: string;
  author: string | null;
  authorId: string | null;
}

export async function notesOf(db: Database, editionId: string): Promise<NoteView[]> {
  return db
    .select({ id: notes.id, segmentId: notes.segmentId, tokenIds: notes.tokenIds, text: notes.text, author: users.name, authorId: notes.authorId })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(eq(notes.editionId, editionId))
    .orderBy(notes.createdAt);
}

export async function addNote(
  db: Database,
  editionId: string,
  input: { segmentId: string; tokenIds?: string[]; text: string; citations?: CitationInput[] },
  authorId: string,
): Promise<NoteView> {
  const id = newId();
  await db.insert(notes).values({ id, editionId, segmentId: input.segmentId, tokenIds: input.tokenIds ?? [], text: input.text.trim(), authorId });
  if (input.citations?.length) await setCitations(db, { noteId: id, editionId }, input.citations);
  const [row] = (await notesOf(db, editionId)).filter((n) => n.id === id);
  return row!;
}

export async function updateNote(db: Database, editionId: string, noteId: string, text: string): Promise<boolean> {
  const rows = await db
    .update(notes)
    .set({ text: text.trim() })
    .where(and(eq(notes.id, noteId), eq(notes.editionId, editionId)))
    .returning({ id: notes.id });
  return rows.length > 0;
}

export async function deleteNote(db: Database, editionId: string, noteId: string): Promise<boolean> {
  const rows = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.editionId, editionId)))
    .returning({ id: notes.id });
  return rows.length > 0;
}
