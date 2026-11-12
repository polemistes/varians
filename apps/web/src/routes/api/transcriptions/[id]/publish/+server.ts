/**
 * POST /api/transcriptions/[id]/publish  { note }
 * Publishes the transcription as a new version with the note; answers the
 * version's number. Writes the work's archive after.
 */
import { publishRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params, request }) =>
  publishRequest(locals.db, locals.user, 'transcription', params.id, request);
