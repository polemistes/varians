/**
 * GET /api/registry/search?kind=work|witness&q=...
 * Search-before-create: up to eight works (title or author) or witnesses
 * (name, siglum or shelfmark) containing the query, or with the query as
 * one of their identifiers, among those the user may see. Answers
 * { kind, q, results }.
 */
import { error, json } from '@sveltejs/kit';
import { grantsFor } from '$lib/server/authz';
import { searchRegistry } from '$lib/server/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const kind = url.searchParams.get('kind');
  if (kind !== 'work' && kind !== 'witness') error(400, 'kind must be work or witness');
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const grants = await grantsFor(locals.db, locals.user);
  const results = await searchRegistry(locals.db, kind, q, locals.user, grants);
  return json({ kind, q, results }, { headers: { 'cache-control': 'private, no-store' } });
};
