/**
 * GET /api/editions/[id]/versions
 * The edition's versions, newest first, with their notes, withdrawals and changes.
 */
import { versionsRequest } from '$lib/server/version-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, params }) =>
  versionsRequest(locals.db, locals.user, 'edition', params.id);
