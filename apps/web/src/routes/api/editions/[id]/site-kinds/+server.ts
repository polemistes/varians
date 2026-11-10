/**
 * POST /api/editions/[id]/site-kinds        { segmentId, siteKey, kind?, minor? }
 *
 * The editor's word on a place of variation. `kind` is textual or
 * interpretative, over what the letters say, and null goes back to the
 * letters; `minor` says whether the editor judges the place minor. The two
 * are separate words: one that the request leaves out stays as it is, and at
 * least one must be given.
 */
import { error, json } from '@sveltejs/kit';
import { SITE_KINDS, segments } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { setSiteMark } from '$lib/server/collation';
import { loadEditionAccess } from '$lib/server/edition-access';

const body = z
  .object({
    segmentId: z.string().min(1).max(64),
    siteKey: z.string().min(1).max(2000),
    kind: z.enum(SITE_KINDS).nullable().optional(),
    minor: z.boolean().optional(),
  })
  .refine((b) => b.kind !== undefined || b.minor !== undefined);

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'segmentId, siteKey and a kind or minor are required');
  const [segment] = await locals.db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.id, parsed.data.segmentId), eq(segments.workId, access.edition.workId)));
  if (!segment) throw error(400, 'The segment is not one of this work');
  await setSiteMark(
    locals.db,
    access.edition.id,
    parsed.data.segmentId,
    parsed.data.siteKey,
    { kind: parsed.data.kind, minor: parsed.data.minor },
    locals.user?.id ?? null,
  );
  return json({ ok: true });
};
