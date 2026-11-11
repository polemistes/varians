/**
 * GET /works/[slug]/sync.json: what this installation holds of a work, for
 * another to compare with (Data Format 2 section 11). A work answers anyone
 * with its published transcripts and editions; their drafts answer the
 * accounts that may see them, by session or by bearer token.
 */
import { error, json } from '@sveltejs/kit';
import { workBySlug } from '$lib/server/registry';
import { packageOrigin } from '$lib/server/package-response';
import { syncState } from '$lib/server/sync';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const record = await workBySlug(locals.db, params.slug);
  if (!record) error(404, 'Not found');
  const state = await syncState(locals.db, locals.user, record.work.id, packageOrigin(url.origin));
  if (!state) error(404, 'Not found');
  return json(state, { headers: { 'cache-control': 'private, no-store' } });
};
