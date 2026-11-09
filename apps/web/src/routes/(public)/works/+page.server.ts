import { searchWorks } from '$lib/server/library';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
  crumb: { label: site.works.title },
  works: await searchWorks(locals.db, locals.user, ''),
});
