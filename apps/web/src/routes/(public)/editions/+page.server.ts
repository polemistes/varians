import { publishedEditions } from '$lib/server/library';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
  crumb: { label: site.editions.title },
  editions: await publishedEditions(locals.db, locals.user),
});
