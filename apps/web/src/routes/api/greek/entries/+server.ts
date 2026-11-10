/**
 * GET /api/greek/entries?lemma=μῆνις
 * The dictionary entries of a lemma, each with its dictionary and licence.
 */
import { json } from '@sveltejs/kit';
import { entriesFor } from '$lib/server/lexicon';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const lemma = (url.searchParams.get('lemma') ?? '').slice(0, 80);
  return json(
    { entries: await entriesFor(locals.db, lemma) },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
};
