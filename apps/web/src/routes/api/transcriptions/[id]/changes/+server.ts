/**
 * GET /api/transcriptions/[id]/changes
 * For the Publish… window: the number the next version will have, and the
 * changes since the version before (or since the beginning).
 */
import { changesRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, params }) =>
  changesRequest(locals.db, locals.user, 'transcription', params.id);
