/**
 * POST /api/transcriptions/[id]/withdraw  { number, note }
 * Withdraws a version of the transcription, with the note readers see.
 */
import { withdrawRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params, request }) =>
  withdrawRequest(locals.db, locals.user, 'transcription', params.id, request);
