/**
 * GET /api/witnesses?q=...
 * The registry's witnesses to choose from: up to fifty by name, all of them
 * when nothing is asked for, otherwise those with the query in their name,
 * siglum or shelfmark or as one of their identifiers. Answers { witnesses },
 * each as a search hit. The registry is public, so anyone may ask.
 */
import { json } from '@sveltejs/kit';
import { searchWitnesses } from '$lib/server/library';
import type { SearchHit } from '$lib/registry/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const rows = await searchWitnesses(locals.db, q);
  const witnesses: SearchHit[] = rows.map((w) => ({
    id: w.id,
    slug: w.slug,
    title: w.name,
    author: null,
    siglum: w.siglum,
    shelfmark: w.shelfmark,
    settlement: w.settlement,
  }));
  return json({ witnesses }, { headers: { 'cache-control': 'private, no-store' } });
};
