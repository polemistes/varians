/**
 * GET /api/bibliography/search?q=  { items: [{ id, key, label, reference }] }
 * The citation picker's lookup; the bibliography is public like the rest of the registry.
 */
import { json } from '@sveltejs/kit';
import { referenceText } from '$lib/bibliography/format';
import { entryOf, listBibliography } from '$lib/server/bibliography';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const { items } = await listBibliography(locals.db, { q, limit: 10 });
  return json({ items: items.map((i) => ({ id: i.id, key: i.citationKey, label: i.label, reference: referenceText(entryOf(i)) })) });
};
