/**
 * GET /api/version: the running version and where its source is.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { COMMIT, PACKAGE_VERSION, VERSION, sourceUrl } from '$lib/version';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
  json(
    {
      version: VERSION,
      release: PACKAGE_VERSION,
      commit: COMMIT,
      source: sourceUrl(COMMIT, env.SOURCE_URL),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
