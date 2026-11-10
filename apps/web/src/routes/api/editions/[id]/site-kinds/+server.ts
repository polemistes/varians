/**
 * POST /api/editions/[id]/site-kinds        { segmentId, siteKey, kind }
 *
 * The editor's word on whether a place of variation is textual or
 * interpretative, over what the letters say; kind null goes back to the letters.
 */
import { error, json } from '@sveltejs/kit';
import { segments } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { setSiteKind } from '$lib/server/collation';
import { loadEditionAccess } from '$lib/server/edition-access';

const body = z.object({
  segmentId: z.string().min(1).max(64),
  siteKey: z.string().min(1).max(2000),
  kind: z.enum(['textual', 'interpretative']).nullable(),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'segmentId, siteKey and kind are required');
  const [segment] = await locals.db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.id, parsed.data.segmentId), eq(segments.workId, access.edition.workId)));
  if (!segment) throw error(400, 'The segment is not one of this work');
  await setSiteKind(
    locals.db,
    access.edition.id,
    parsed.data.segmentId,
    parsed.data.siteKey,
    parsed.data.kind,
    locals.user?.id ?? null,
  );
  return json({ ok: true });
};
