/**
 * The files of the data format: schemas at their `$id`, the ODD and RelaxNG,
 * the changelog, the example archive. Read-only, and open to other sites, so
 * that validators elsewhere can fetch the schemas.
 */
import { error, redirect } from '@sveltejs/kit';
import { isCurrentVersion, readFormatFile, resolveFormatFile } from '$lib/server/formats';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!isCurrentVersion(params.version)) error(404, 'Not found');
  // The address packages name in conformsTo: the specification's section on packages.
  if (params.file === 'package') redirect(303, `/formats/${params.version}#9-packages`);
  const file = resolveFormatFile(params.file);
  const found = file ? await readFormatFile(file) : null;
  if (!found) error(404, 'Not found');
  return new Response(new Uint8Array(found.body), {
    headers: {
      'content-type': found.type,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
};
