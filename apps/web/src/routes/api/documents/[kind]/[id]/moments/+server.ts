/**
 * Named moments of a document.
 *
 *   POST { version, name }   201 { moment }
 *
 * Needs edit: 403 when the user may only view.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { addMoment, historyErrorResponse, requireDocument } from '$lib/server/history';
import { commitDocument } from '$lib/server/archive/commits';
import { archiveRoot, storageRoot } from '$lib/server/startup';

const body = z.object({
  version: z.number().int().min(0),
  name: z.string().trim().min(1).max(200),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await requireDocument(locals, params, 'edit');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'version and name are required');
  try {
    const moment = await addMoment(locals.db, access.kind, access.id, locals.user?.id ?? null, parsed.data.version, parsed.data.name);
    // A named moment is a commit in the archive, by the person; it is written after the answer, and a failure there does not undo the moment.
    void commitDocument(locals.db, access.kind, access.id, `moment: ${parsed.data.name}`, locals.user?.id ?? null, archiveRoot(), { storageRoot: storageRoot() }).catch((cause) =>
      console.error('archive after naming a moment failed', cause),
    );
    return json({ moment }, { status: 201 });
  } catch (cause) {
    return historyErrorResponse(cause);
  }
};
