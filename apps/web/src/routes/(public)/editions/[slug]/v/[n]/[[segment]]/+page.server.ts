/**
 * /editions/[slug]/v/[n] and /editions/[slug]/v/[n]/[segment]: the edition
 * as published in version n, which says so and links to the latest; or, for
 * a withdrawn version, its citation and the withdrawal, and no text.
 */
import { loadReader, loadWithdrawnVersion, parseVersionNumber } from '$lib/server/reader-pages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const number = parseVersionNumber(params.n);
  const withdrawn = await loadWithdrawnVersion(locals.db, locals.user, params.slug, number);
  if (withdrawn) return { withdrawn, crumb: { label: withdrawn.edition.title } };
  const data = await loadReader(locals.db, locals.user, params.slug, {
    version: number,
    ...(params.segment ? { focus: params.segment } : {}),
  });
  return { ...data, withdrawn: null, crumb: { label: data.edition.title } };
};
