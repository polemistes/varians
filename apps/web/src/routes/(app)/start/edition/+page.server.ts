import { searchWorks } from '$lib/server/library';
import { requireUser } from '$lib/server/guards';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireUser(locals, url.pathname + url.search);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  return { crumb: { label: site.start.edition.title }, q, works: await searchWorks(locals.db, locals.user, q) };
};
