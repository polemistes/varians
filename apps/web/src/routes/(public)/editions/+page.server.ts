import { grantsFor } from '$lib/server/authz';
import { publishedEditions, withEditionRights } from '$lib/server/library';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
  crumb: { label: site.editions.title },
  editions: withEditionRights(
    await publishedEditions(locals.db),
    locals.user,
    await grantsFor(locals.db, locals.user),
  ),
});
