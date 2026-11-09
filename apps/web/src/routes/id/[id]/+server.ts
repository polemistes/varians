/**
 * GET /id/<id>: the address of every record (PLAN-2 C9, Data Format 2,
 * section 8). Redirects to the record's page; with `Accept:
 * application/json`, or at /id/<id>.json, answers the record as the archive
 * represents it. A record the visitor may not see is not found.
 */
import { error, json, redirect } from '@sveltejs/kit';
import { limits } from '$lib/server/rate-limit';
import { recordJson } from '$lib/server/record-json';
import { pageOf, resolveId, visibilityOf } from '$lib/server/resolver';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
  if (!limits.recordsByAddress.take(getClientAddress())) error(429, 'Too many requests');
  const asJson = params.id.endsWith('.json') || (request.headers.get('accept') ?? '').split(',').some((t) => t.trim().startsWith('application/json'));
  const id = params.id.replace(/\.json$/u, '');
  const resolved = await resolveId(locals.db, id);
  if (!resolved) error(404, 'Not found');
  const visibility = await visibilityOf(locals.db, locals.user, resolved);
  if (!visibility.visible) error(404, 'Not found');
  if (!asJson) redirect(303, await pageOf(locals.db, resolved, visibility));
  const record = await recordJson(locals.db, locals.user, resolved, visibility);
  if (record === null) error(404, 'Not found');
  return json(record, {
    headers: {
      // The record as it stands now, as this visitor may see it.
      'cache-control': locals.user ? 'private, no-store' : 'public, max-age=60',
      vary: 'accept, cookie',
      ...(resolved.id !== id ? { 'content-location': `/id/${resolved.id}.json` } : {}),
    },
  });
};
