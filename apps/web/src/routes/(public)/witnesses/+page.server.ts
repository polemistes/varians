import { grantsFor } from '$lib/server/authz';
import { searchWitnesses, withWitnessRights } from '$lib/server/library';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
  crumb: { label: site.witnesses.title },
  witnesses: withWitnessRights(
    await searchWitnesses(locals.db, ''),
    locals.user,
    await grantsFor(locals.db, locals.user),
  ),
});
