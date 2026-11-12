/**
 * /editions/[slug]/v/[n] and /editions/[slug]/v/[n]/[segment]: the edition
 * as published in version n, which says so and links to the latest. A
 * withdrawn version is read here too, under the warning that it is withdrawn.
 */
import { loadReader, parseVersionNumber } from '$lib/server/reader-pages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const data = await loadReader(locals.db, locals.user, params.slug, {
    version: parseVersionNumber(params.n),
    ...(params.segment ? { focus: params.segment } : {}),
  });
  return { ...data, crumb: { label: data.edition.title } };
};
