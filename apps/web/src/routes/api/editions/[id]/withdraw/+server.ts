/**
 * POST /api/editions/[id]/withdraw  { number, note }
 * Withdraws a version of the edition, with the note readers see.
 */
import { withdrawRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params, request }) =>
  withdrawRequest(locals.db, locals.user, 'edition', params.id, request);
