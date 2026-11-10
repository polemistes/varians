/**
 * Segments of a work.
 *   GET                 every segment in order: id, label, sort key
 *   POST { label }      the segment with this label, created when the label fits the scheme (for setting a segment start)
 *   POST { labels: [] } several at once
 */
import { error, json } from '@sveltejs/kit';
import { nextLabel, parseLabel } from '@varians/core';
import { workMaintainers, works } from '@varians/db';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { canViewWork, grantsFor } from '$lib/server/authz';
import { resolveLabels, schemeOfWork, segmentsOfWork } from '$lib/server/segments';

async function loadWork(db: App.Locals['db'], user: App.Locals['user'], idOrSlug: string) {
  const [work] = await db
    .select()
    .from(works)
    .where(or(eq(works.id, idOrSlug), eq(works.slug, idOrSlug)))
    .limit(1);
  if (!work) return null;
  const maintainerIds = (
    await db
      .select({ userId: workMaintainers.userId })
      .from(workMaintainers)
      .where(eq(workMaintainers.workId, work.id))
  ).map((m) => m.userId);
  const grants = await grantsFor(db, user);
  return canViewWork(user, work, maintainerIds, grants) ? work : null;
}

const label = z.string().trim().min(1).max(100);
const body = z.union([z.object({ label }), z.object({ labels: z.array(label).min(1).max(500) })]);

export const GET: RequestHandler = async ({ locals, params }) => {
  const work = await loadWork(locals.db, locals.user, params.id);
  if (!work) throw error(404, 'No such work');
  const rows = await segmentsOfWork(locals.db, work.id);
  const scheme = await schemeOfWork(locals.db, work.id);
  return json({
    scheme: scheme.scheme,
    segments: rows.map((s) => ({ id: s.id, label: s.label, sortKey: s.sortKey })),
  });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) throw error(401, 'Log in to name segments');
  const work = await loadWork(locals.db, locals.user, params.id);
  if (!work) throw error(404, 'No such work');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'label or labels are required');
  const scheme = await schemeOfWork(locals.db, work.id);
  const labels = 'label' in parsed.data ? [parsed.data.label] : parsed.data.labels;
  const invalid = labels.filter((l) => !parseLabel(scheme.scheme, l));
  if (invalid.length) throw error(400, `Not a label of this work's scheme: ${invalid.join(', ')}`);
  const resolved = await resolveLabels(locals.db, scheme, labels);
  return json({
    segments: labels.map((label) => {
      const seg = resolved.get(label)!;
      return {
        id: seg.id,
        label: seg.label,
        sortKey: seg.sortKey,
        next: nextLabel(scheme.scheme, seg.label),
      };
    }),
  });
};
