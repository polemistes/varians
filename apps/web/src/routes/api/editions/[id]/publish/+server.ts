/**
 * POST /api/editions/[id]/publish  { note }
 * Publishes the edition as a new version with the editors' note, and the
 * owner's transcripts it compares with it; answers the version's number.
 * Writes the work's archive after.
 */
import { publishRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params, request }) =>
  publishRequest(locals.db, locals.user, 'edition', params.id, request);
