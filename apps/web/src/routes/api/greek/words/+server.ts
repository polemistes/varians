/**
 * GET /api/greek/words?w=μῆνιν&w=ἄειδε
 * The analyses of up to 300 Greek words: { words: { [word]: Analysis[] } }.
 * Open to anyone: the reader looks words up for visitors too.
 */
import { json } from '@sveltejs/kit';
import { analyseWords } from '$lib/server/lexicon';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const words = [
    ...new Set(
      url.searchParams
        .getAll('w')
        .map((w) => w.slice(0, 80))
        .filter((w) => w.trim() !== ''),
    ),
  ].slice(0, 300);
  return json(
    { words: await analyseWords(locals.db, words) },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
};
