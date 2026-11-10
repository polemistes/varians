/**
 * POST /api/editions/[id]/adoptions  { conjectureId, adopted }
 * Record or withdraw that the edition prints a conjecture.
 */
import { error, json } from '@sveltejs/kit';
import { conjectures, workMaintainers } from '@varians/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { canViewConjecture, grantsFor } from '$lib/server/authz';
import { adoptConjecture, adoptionsOf, withdrawAdoption } from '$lib/server/conjectures';
import { loadEditionAccess } from '$lib/server/edition-access';

const body = z.object({ conjectureId: z.string().min(1).max(64), adopted: z.boolean() });

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  return json({ adopted: [...(await adoptionsOf(locals.db, access.edition.id))] });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'conjectureId and adopted are required');
  if (parsed.data.adopted) {
    // A conjecture of this work that the editor may see, and that publishing the edition may show:
    // a published one, or one of the edition owner's own.
    const [conjecture] = await locals.db
      .select()
      .from(conjectures)
      .where(eq(conjectures.id, parsed.data.conjectureId));
    if (!conjecture || conjecture.workId !== access.edition.workId)
      throw error(404, 'No such conjecture on this work');
    const maintainerIds = (
      await locals.db
        .select({ id: workMaintainers.userId })
        .from(workMaintainers)
        .where(eq(workMaintainers.workId, conjecture.workId))
    ).map((m) => m.id);
    const grants = await grantsFor(locals.db, locals.user);
    if (!canViewConjecture(locals.user, conjecture, { workMaintainerIds: maintainerIds, grants }))
      throw error(404, 'No such conjecture on this work');
    if (conjecture.visibility !== 'published' && conjecture.ownerId !== access.edition.ownerId) {
      throw error(
        403,
        'This conjecture is another person’s draft; it can be adopted once they publish it.',
      );
    }
  }
  if (parsed.data.adopted)
    await adoptConjecture(locals.db, access.edition.id, parsed.data.conjectureId);
  else await withdrawAdoption(locals.db, access.edition.id, parsed.data.conjectureId);
  return json({ ok: true });
};
