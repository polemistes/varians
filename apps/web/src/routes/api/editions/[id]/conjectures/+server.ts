/**
 * POST /api/editions/[id]/conjectures
 * Register a conjecture on the edition's work from inside the editor, and
 * adopt it in the same step when asked. The text change travels separately
 * as operations.
 */
import { error, json } from '@sveltejs/kit';
import { segments } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { setCitations } from '$lib/server/bibliography';
import { adoptConjecture, registerConjecture } from '$lib/server/conjectures';
import { loadEditionAccess } from '$lib/server/edition-access';

const body = z.object({
  segmentId: z.string().min(1).max(64),
  kind: z.enum(['substitution', 'deletion', 'addition', 'lacuna', 'supplement', 'transposition']).default('substitution'),
  lemma: z.string().max(2000).default(''),
  reading: z.string().max(2000).default(''),
  proposer: z.string().max(300).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  extent: z.string().max(300).nullable().optional(),
  anchorTokenIds: z.array(z.string().max(64)).max(200).optional(),
  citations: z
    .array(z.object({ itemId: z.string().min(1).max(64), prenote: z.string().max(100).nullable().optional(), postnote: z.string().max(100).nullable().optional() }))
    .max(20)
    .optional(),
  adopt: z.boolean().default(false),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit || !locals.user) throw error(403, 'You may not edit this edition');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, parsed.error.issues.map((i) => i.message).join('; '));
  const input = parsed.data;
  const [segment] = await locals.db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.id, input.segmentId), eq(segments.workId, access.edition.workId)));
  if (!segment) throw error(400, 'The segment is not one of this work');
  const conjecture = await registerConjecture(
    locals.db,
    {
      workId: access.edition.workId,
      segmentId: input.segmentId,
      kind: input.kind,
      lemma: input.lemma,
      reading: input.reading,
      proposer: input.proposer ?? locals.user.name,
      note: input.note ?? null,
      extent: input.extent ?? null,
      anchor: input.anchorTokenIds?.length ? { editionId: access.edition.id, tokenIds: input.anchorTokenIds } : null,
      visibility: access.edition.visibility === 'published' ? 'published' : 'draft',
    },
    // A conjecture entered in an edition is the edition's, like its text: its owner and collaborators see it, and publishing publishes it.
    access.edition.ownerId,
  );
  if (input.citations?.length) await setCitations(locals.db, { conjectureId: conjecture.id }, input.citations);
  if (input.adopt) await adoptConjecture(locals.db, access.edition.id, conjecture.id);
  return json({ conjecture, adopted: input.adopt }, { status: 201 });
};
