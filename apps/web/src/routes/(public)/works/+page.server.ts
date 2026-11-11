import { grantsFor } from '$lib/server/authz';
import { searchWorks, withWorkRights } from '$lib/server/library';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
  crumb: { label: site.works.title },
  works: withWorkRights(
    await searchWorks(locals.db, ''),
    locals.user,
    await grantsFor(locals.db, locals.user),
  ),
});
