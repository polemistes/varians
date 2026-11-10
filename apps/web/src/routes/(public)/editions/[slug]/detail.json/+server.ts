/**
 * GET /editions/[slug]/detail.json?segments=a,b,c: what the reader's page
 * was not sent of some segments (the words each text has at each place, and
 * where each stands against the edition's words), for the state of the
 * edition the visitor sees (`?v=n`, `?draft=1` as for the downloads).
 */
import { json } from '@sveltejs/kit';
import { readerDetail, readerRequestFromUrl } from '$lib/server/reader-pages';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const request = readerRequestFromUrl(url);
  const ids = (url.searchParams.get('segments') ?? '')
    .split(',')
    .filter((id) => id.length > 0 && id.length <= 64);
  const detail = ids.length
    ? await readerDetail(locals.db, locals.user, params.slug, request, ids)
    : {};
  // A draft must never be kept by a shared cache.
  return json(detail, request.draft ? { headers: { 'cache-control': 'private, no-store' } } : {});
};
