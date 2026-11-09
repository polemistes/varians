/**
 * GET /api/transcriptions/[id]/sources
 * The texts whose normalized forms this transcription can take where the
 * letters agree: transcriptions and editions of its works the user may see.
 */
import { error, json } from '@sveltejs/kit';
import { loadTranscriptionAccess } from '$lib/server/transcription-access';
import { normalizationSources } from '$lib/server/workbench';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canEdit) throw error(404, 'No such transcription');
  return json({ sources: await normalizationSources(locals.db, locals.user, params.id) });
};
