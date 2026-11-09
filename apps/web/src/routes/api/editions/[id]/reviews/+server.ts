/**
 * GET  /api/editions/[id]/reviews            the reviewed site keys by segment
 * POST /api/editions/[id]/reviews            { segmentId, siteKey, reviewed }
 */
import { error, json } from '@sveltejs/kit';
import { segments } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { reviewSite, reviewedSites, unreviewSite } from '$lib/server/conjectures';
import { loadEditionAccess } from '$lib/server/edition-access';

const body = z.object({ segmentId: z.string().min(1).max(64), siteKey: z.string().min(1).max(2000), reviewed: z.boolean() });

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  const reviewed = await reviewedSites(locals.db, access.edition.id);
  return json({ reviewed: Object.fromEntries([...reviewed].map(([segmentId, keys]) => [segmentId, [...keys]])) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'segmentId, siteKey and reviewed are required');
  const [segment] = await locals.db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.id, parsed.data.segmentId), eq(segments.workId, access.edition.workId)));
  if (!segment) throw error(400, 'The segment is not one of this work');
  if (parsed.data.reviewed) await reviewSite(locals.db, access.edition.id, parsed.data.segmentId, parsed.data.siteKey, locals.user?.id ?? null);
  else await unreviewSite(locals.db, access.edition.id, parsed.data.segmentId, parsed.data.siteKey);
  return json({ ok: true });
};
