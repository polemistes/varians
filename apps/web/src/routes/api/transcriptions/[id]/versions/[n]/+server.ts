/**
 * DELETE /api/transcriptions/[id]/versions/[n]
 * Deletes version n of the transcript. An administrator's alone; refused
 * while a version of an edition compares it.
 */
import { deleteVersionRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) =>
  deleteVersionRequest(locals.db, locals.user, 'transcription', params.id, params.n);
