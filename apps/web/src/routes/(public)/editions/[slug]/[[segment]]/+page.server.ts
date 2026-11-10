/**
 * /editions/[slug] and /editions/[slug]/[segment]: the edition as the
 * visitor may see it (the published version, or a draft to its editors).
 * The segment is resolved in +page.ts, so that moving between segments of
 * one edition does not load it again.
 */
import { loadReader } from '$lib/server/reader-pages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const data = await loadReader(locals.db, locals.user, params.slug, {
    draft: url.searchParams.get('draft') === '1',
  });
  return { ...data, crumb: { label: data.edition.title } };
};
