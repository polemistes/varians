/**
 * The text of a document as it stood at a version, with what changed since.
 *
 *   GET ?since=N   DocumentAtVersion: { version, since, currentVersion, stream, diff, authors, people, labels }
 *                  since defaults to the version before; 404 for a version the document never had
 *
 * Needs view.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { documentWithChanges, historyErrorResponse, requireDocument } from '$lib/server/history';

/** A version number from a path or query string: undefined when absent, null when not a whole number. */
function versionOf(value: string | null | undefined): number | null | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const access = await requireDocument(locals, params, 'view');
  const version = versionOf(params.version);
  const since = versionOf(url.searchParams.get('since'));
  if (version === null || version === undefined) error(400, 'The version must be a whole number');
  if (since === null) error(400, 'since must be a whole number');
  try {
    return json(await documentWithChanges(locals.db, access.kind, access.id, version, since));
  } catch (cause) {
    return historyErrorResponse(cause);
  }
};
