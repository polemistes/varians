/**
 * GET /api/editions/[id]/view?segments=a,b,c
 * For the editor: the apparatus views of some segments (at most a hundred,
 * of the edition's work), collated from the current content, with the drafts
 * the editor may see, and how the edition's segments stand to the witnesses'
 * (their order, and the segments the edition does not print). Without
 * `segments`, the whole edition view. Readers
 * see published versions through the reader, not here.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEditionAccess } from '$lib/server/edition-access';
import { editionView, refreshView, type SegmentView } from '$lib/server/reader';

/** Collation columns hold Maps, which JSON cannot carry, and no client needs them. */
function forJson(views: Record<string, SegmentView>): Record<string, SegmentView> {
  const out: Record<string, SegmentView> = {};
  for (const [id, view] of Object.entries(views))
    out[id] = { ...view, collation: { ...view.collation, columns: [] } };
  return out;
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit || !locals.user) throw error(403, 'You may not edit this edition');
  const audience = { kind: 'editor' as const, viewer: locals.user };
  const wanted = url.searchParams.get('segments');
  if (wanted) {
    const ids = wanted.split(',').filter((s) => s.length > 0 && s.length <= 64);
    const fresh = await refreshView(locals.db, access.edition.id, ids, audience);
    return json({
      segments: forJson(fresh.segments),
      order: fresh.order,
      orderVariants: fresh.orderVariants,
      unprinted: fresh.unprinted,
    });
  }
  const view = await editionView(locals.db, access.edition.id, null, audience);
  return json({ ...view, segments: forJson(view.segments) });
};
