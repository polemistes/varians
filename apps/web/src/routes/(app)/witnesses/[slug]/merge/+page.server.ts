import { loadMergePage, runMerge } from '$lib/server/merge-page';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) =>
  loadMergePage(locals, 'witness', params.slug, url);

export const actions: Actions = {
  merge: ({ locals, params, request }) => runMerge(locals, 'witness', params.slug, request),
};
