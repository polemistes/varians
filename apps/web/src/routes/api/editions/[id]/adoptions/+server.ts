/**
 * POST /api/editions/[id]/adoptions  { conjectureId, adopted }
 * Record or withdraw that the edition prints a conjecture.
 */
import { error, json } from '@sveltejs/kit';
import { conjectures } from '@varians/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
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
    // Any conjecture of this work may be adopted: they are the work's, whoever entered them.
    const [conjecture] = await locals.db
      .select({ workId: conjectures.workId })
      .from(conjectures)
      .where(eq(conjectures.id, parsed.data.conjectureId));
    if (!conjecture || conjecture.workId !== access.edition.workId)
      throw error(404, 'No such conjecture on this work');
  }
  if (parsed.data.adopted)
    await adoptConjecture(locals.db, access.edition.id, parsed.data.conjectureId);
  else await withdrawAdoption(locals.db, access.edition.id, parsed.data.conjectureId);
  return json({ ok: true });
};
