/**
 * /transcriptions/[id]/v/[n]: version n of a transcription, read only, as it
 * was published; a withdrawn version, or one that does not exist, is a 404.
 */
import { error } from '@sveltejs/kit';
import { loadWorkbench } from '$lib/server/workbench';
import { clientData, workbenchCrumb } from '$lib/server/workbench-client';
import { parseVersionNumber } from '$lib/server/reader-pages';
import { workbench as t } from '$lib/strings/workbench';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const data = await loadWorkbench(locals.db, locals.user, params.id, parseVersionNumber(params.n));
  if (!data) throw error(404, t.errors.notFound);
  return { ...clientData(data), crumb: workbenchCrumb(data) };
};
