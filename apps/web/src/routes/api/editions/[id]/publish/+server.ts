/**
 * POST /api/editions/[id]/publish  { action: 'publish' | 'unpublish' }
 * Publishing names a numbered moment, makes the edition public with what it
 * rests on, and writes the work's archive.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { commitDocument } from '$lib/server/archive/commits';
import { loadEditionAccess } from '$lib/server/edition-access';
import { archiveRoot, storageRoot } from '$lib/server/startup';
import {
  PublishRefused,
  publishEdition,
  publishedVersions,
  unpublishEdition,
} from '$lib/server/publish';

const body = z.object({ action: z.enum(['publish', 'unpublish']) });

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  return json({ versions: await publishedVersions(locals.db, access.edition.id) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canPublish) throw error(403, 'Only the owner may publish');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'action is required');
  if (parsed.data.action === 'unpublish') {
    await unpublishEdition(locals.db, access.edition.id);
    return json({ ok: true, published: false });
  }
  let result;
  try {
    result = await publishEdition(locals.db, access.edition.id, locals.user?.id ?? null);
  } catch (cause) {
    if (cause instanceof PublishRefused) return json({ message: cause.message }, { status: 409 });
    throw cause;
  }
  // The archive follows a publication; a failure there must not undo the publication.
  try {
    await commitDocument(
      locals.db,
      'edition',
      access.edition.id,
      `published version ${result.number}`,
      locals.user?.id ?? null,
      archiveRoot(),
      { storageRoot: storageRoot() },
    );
  } catch (cause) {
    console.error('archive after publishing failed', cause);
  }
  return json({ ok: true, published: true, ...result });
};
