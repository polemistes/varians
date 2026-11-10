/**
 * GET /editions/[slug]/sites.json?segments=a,b,c: the places of some
 * segments, as the reader's page is sent them, for the segments it was not
 * sent when it opened (`pending`), for the state of the edition the visitor
 * sees (`?v=n`, `?draft=1` as for the downloads).
 */
import { json } from '@sveltejs/kit';
import { readerRequestFromUrl, readerSites } from '$lib/server/reader-pages';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const request = readerRequestFromUrl(url);
  const ids = (url.searchParams.get('segments') ?? '')
    .split(',')
    .filter((id) => id.length > 0 && id.length <= 64);
  const sites = ids.length
    ? await readerSites(locals.db, locals.user, params.slug, request, ids)
    : { segments: {}, texts: [] };
  // A draft must never be kept by a shared cache.
  return json(sites, request.draft ? { headers: { 'cache-control': 'private, no-store' } } : {});
};
