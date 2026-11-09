/**
 * Undoing one earlier change, as a new changeset.
 *
 *   POST { changesetId, force?, reviewed? }   { ok: true, version, changesetId, skipped }
 *                                             409 { ok: false, conflicts, words } when later changes
 *                                             touched the same items and force is not set
 *
 * `reviewed` also marks the change reviewed by the user: a rejection in review.
 * Needs edit; 404 for a change that is not this document's.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { historyErrorResponse, requireDocument, undoChangeset } from '$lib/server/history';

const body = z.object({
  changesetId: z.string().min(1).max(100),
  force: z.boolean().optional(),
  reviewed: z.boolean().optional(),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await requireDocument(locals, params, 'edit');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'changesetId is required');
  try {
    const result = await undoChangeset(
      locals.db,
      access.kind,
      access.id,
      locals.user?.id ?? null,
      parsed.data.changesetId,
      parsed.data.force ?? false,
      { reviewed: parsed.data.reviewed ?? false },
    );
    return json(result, { status: result.ok ? 200 : 409 });
  } catch (cause) {
    return historyErrorResponse(cause);
  }
};
