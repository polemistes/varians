/**
 * Reviewing the changes others made to a document.
 *
 *   GET                  ReviewChanges: { fromVersion, currentVersion, items, remaining, people, labels, truncated },
 *                        the changes by others since the user's review point, in the order of the text
 *   POST { accept: [] }  ReviewState: { fromVersion, accepted }, the changesets marked reviewed
 *   POST { from: N }     ReviewState, reviewing from version N on
 *
 * GET needs view and a signed-in user (401 otherwise); POST needs edit.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { acceptChangesets, historyErrorResponse, requireDocument, reviewChanges, setReviewFrom } from '$lib/server/history';

const body = z.union([
  z.object({ accept: z.array(z.string().min(1).max(100)).min(1).max(1000) }),
  z.object({ from: z.number().int().min(0) }),
]);

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await requireDocument(locals, params, 'view');
  if (!locals.user) error(401, 'Log in to review');
  return json(await reviewChanges(locals.db, access.kind, access.id, locals.user.id));
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await requireDocument(locals, params, 'edit');
  const user = locals.user;
  if (!user) error(401, 'Log in to review');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'accept or from is required');
  try {
    const state =
      'accept' in parsed.data
        ? await acceptChangesets(locals.db, access.kind, access.id, user.id, parsed.data.accept)
        : await setReviewFrom(locals.db, access.kind, access.id, user.id, parsed.data.from);
    return json(state);
  } catch (cause) {
    return historyErrorResponse(cause);
  }
};
