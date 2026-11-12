/**
 * DELETE /api/editions/[id]/versions/[n]
 * Deletes version n of the edition. An administrator's alone.
 */
import { deleteVersionRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) =>
  deleteVersionRequest(locals.db, locals.user, 'edition', params.id, params.n);
