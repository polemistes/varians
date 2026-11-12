/**
 * GET /api/transcriptions/[id]/versions
 * The transcription's versions, newest first, with their notes, withdrawals and changes.
 */
import { versionsRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, params }) =>
  versionsRequest(locals.db, locals.user, 'transcription', params.id);
