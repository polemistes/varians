/**
 * /transcriptions/[id]/v/[n]: version n of a transcription, read only, as it
 * was published; for a withdrawn version, its citation and the withdrawal,
 * and no text. One that does not exist is a 404.
 */
import { error } from '@sveltejs/kit';
import { loadWithdrawnTranscriptionVersion, loadWorkbench } from '$lib/server/workbench';
import { clientData, workbenchCrumb } from '$lib/server/workbench-client';
import { parseVersionNumber } from '$lib/server/reader-pages';
import { workbench as t } from '$lib/strings/workbench';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const number = parseVersionNumber(params.n);
  const withdrawn = await loadWithdrawnTranscriptionVersion(locals.db, params.id, number);
  if (withdrawn)
    return {
      withdrawn,
      crumb: { label: withdrawn.witness.name, href: `/witnesses/${withdrawn.witness.slug}` },
    };
  const data = await loadWorkbench(locals.db, locals.user, params.id, number);
  if (!data) throw error(404, t.errors.notFound);
  return { ...clientData(data), withdrawn: null, crumb: workbenchCrumb(data) };
};
