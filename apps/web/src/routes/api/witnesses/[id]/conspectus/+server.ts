/**
 * A witness as a row of a conspectus needs it.
 *   GET ?work=<work id>  its name, siglum and hands, and the transcripts of it
 *                        the person may put in a conspectus, with the segments
 *                        of the work each has text of
 *
 * Make New Edition, Edition Settings and the editor's Witnesses and Sigla
 * window ask for it when a witness is added from the registry.
 */
import { error, json } from '@sveltejs/kit';
import { grantsFor } from '$lib/server/authz';
import { conspectusWitnesses } from '$lib/server/edition-form';
import { registry } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.user) throw error(401, registry.common.signIn);
  const workId = url.searchParams.get('work') || null;
  const found = await conspectusWitnesses(
    locals.db,
    locals.user,
    await grantsFor(locals.db, locals.user),
    [params.id],
    workId,
  );
  const witness = found[params.id];
  if (!witness) throw error(404, registry.witness.notFound);
  return json(witness);
};
