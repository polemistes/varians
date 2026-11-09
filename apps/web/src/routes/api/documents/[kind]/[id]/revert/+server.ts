/**
 * Bringing a document back as it stood at a version, as a new changeset.
 *
 *   POST { version, currentVersion? }   { version, changesetId, unchanged }
 *                                       409 { message, currentVersion } when currentVersion is given
 *                                       and the document has moved on since
 *
 * Needs edit.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { historyErrorResponse, requireDocument, revertTo } from '$lib/server/history';

const body = z.object({
  version: z.number().int().min(0),
  currentVersion: z.number().int().min(0).optional(),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await requireDocument(locals, params, 'edit');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'version is required');
  try {
    const result = await revertTo(locals.db, access.kind, access.id, locals.user?.id ?? null, parsed.data.version, {
      expectedVersion: parsed.data.currentVersion,
    });
    return json(result);
  } catch (cause) {
    return historyErrorResponse(cause);
  }
};
