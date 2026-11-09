/**
 * Notes of an edition.
 *   GET                                   every note
 *   POST   { segmentId, tokenIds?, text } a new note
 *   PATCH  { id, text }
 *   DELETE { id }
 */
import { error, json } from '@sveltejs/kit';
import { segments } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { loadEditionAccess } from '$lib/server/edition-access';
import { addNote, deleteNote, notesOf, updateNote } from '$lib/server/notes';

const create = z.object({
  segmentId: z.string().min(1).max(64),
  tokenIds: z.array(z.string().max(64)).max(500).optional(),
  text: z.string().trim().min(1).max(10000),
  citations: z
    .array(z.object({ itemId: z.string().min(1).max(64), prenote: z.string().max(100).nullable().optional(), postnote: z.string().max(100).nullable().optional() }))
    .max(20)
    .optional(),
});
const patch = z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(10000) });
const remove = z.object({ id: z.string().min(1) });

async function access(locals: App.Locals, id: string, edit: boolean) {
  const result = await loadEditionAccess(locals.db, locals.user, id);
  if (!result || !result.canView) throw error(404, 'No such edition');
  if (edit && (!result.canEdit || !locals.user)) throw error(403, 'You may not edit this edition');
  return result;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  // The notes as they stand now are the editors'; readers get those of the published version through the reader.
  const { edition } = await access(locals, params.id, true);
  return json({ notes: await notesOf(locals.db, edition.id) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const { edition } = await access(locals, params.id, true);
  const parsed = create.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'segmentId and text are required');
  const [segment] = await locals.db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.id, parsed.data.segmentId), eq(segments.workId, edition.workId)));
  if (!segment) throw error(400, 'The segment is not one of this work');
  const input = {
    segmentId: parsed.data.segmentId,
    text: parsed.data.text,
    ...(parsed.data.tokenIds ? { tokenIds: parsed.data.tokenIds } : {}),
    ...(parsed.data.citations ? { citations: parsed.data.citations } : {}),
  };
  return json({ note: await addNote(locals.db, edition.id, input, locals.user!.id) }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const { edition } = await access(locals, params.id, true);
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'id and text are required');
  if (!(await updateNote(locals.db, edition.id, parsed.data.id, parsed.data.text))) throw error(404, 'No such note');
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  const { edition } = await access(locals, params.id, true);
  const parsed = remove.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'id is required');
  if (!(await deleteNote(locals.db, edition.id, parsed.data.id))) throw error(404, 'No such note');
  return json({ ok: true });
};
