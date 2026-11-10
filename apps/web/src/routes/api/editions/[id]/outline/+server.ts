/**
 * GET /api/editions/[id]/outline
 * For the editor: where the places of variation stand in every segment of the
 * current text and which words have drifted from their source, the part of
 * the apparatus the editor needs of the whole text at once. The apparatus of
 * the segments itself is asked of `view?segments=`.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEditionAccess } from '$lib/server/edition-access';
import { editionOutline } from '$lib/server/reader';

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit || !locals.user) throw error(403, 'You may not edit this edition');
  return json(
    await editionOutline(locals.db, access.edition.id, { kind: 'editor', viewer: locals.user }),
  );
};
