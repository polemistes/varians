/**
 * GET /health: whether this installation can serve, for a container's health
 * check, a proxy or a monitor. 200 when the database answers and is level
 * with this release (or ahead of it), 503 otherwise. Says nothing more than
 * the version and the database's state.
 */
import { json } from '@sveltejs/kit';
import { databaseState, healthOf } from '$lib/server/health';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const health = healthOf(await databaseState(locals.db));
  return json(health, {
    status: health.status === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
};
