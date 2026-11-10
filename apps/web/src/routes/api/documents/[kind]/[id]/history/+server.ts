/**
 * The history of a document.
 *
 *   GET   DocumentHistory: { kind, id, currentVersion, sessions, moments, people, truncated },
 *         sessions and named moments newest first
 *
 * Needs view: 404 for an unknown document or one the user may not see.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { historyOf, requireDocument } from '$lib/server/history';

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await requireDocument(locals, params, 'view');
  return json(await historyOf(locals.db, access.kind, access.id));
};
