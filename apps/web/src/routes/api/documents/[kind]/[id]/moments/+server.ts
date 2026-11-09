/**
 * Named moments of a document.
 *
 *   POST { version, name }   201 { moment }
 *
 * Needs edit: 403 when the user may only view.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { addMoment, historyErrorResponse, requireDocument } from '$lib/server/history';

const body = z.object({
  version: z.number().int().min(0),
  name: z.string().trim().min(1).max(200),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await requireDocument(locals, params, 'edit');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'version and name are required');
  try {
    const moment = await addMoment(locals.db, access.kind, access.id, locals.user?.id ?? null, parsed.data.version, parsed.data.name);
    return json({ moment }, { status: 201 });
  } catch (cause) {
    return historyErrorResponse(cause);
  }
};
