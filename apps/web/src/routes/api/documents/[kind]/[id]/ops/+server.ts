/**
 * The save endpoint of both editors.
 *
 *   GET                                  { version, content }
 *   POST { fromVersion, ops, message? }  { version, changesetId, adjusted? }
 *                                        409 { current: { version, content }, since: Changeset[] } when the document moved on
 *
 * A transcript's save may be followed by a changeset that puts its pages
 * back in shape (see the documents service); the answer then carries
 * `adjusted: { content, since }`, the content as it now stands and that
 * changeset, for the client to take up as it takes up a conflict.
 *
 * Operations name items by id; the server applies them through the core,
 * which refuses anything malformed (a missing id, a duplicate id, a split
 * outside a word), answered as 400.
 */
import { error, json } from '@sveltejs/kit';
import { StreamError } from '@varians/core';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { isDocumentKind, loadDocumentAccess } from '$lib/server/document-access';
import { VersionConflict, loadDocument, saveOps } from '$lib/server/documents/service';
import { parseOps, segmentIdsIn } from '$lib/server/ops-schema';
import { segments } from '@varians/db';
import { inArray } from 'drizzle-orm';

const body = z.object({
  fromVersion: z.number().int().min(0),
  ops: z.array(z.unknown()),
  message: z.string().max(500).optional(),
});

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!isDocumentKind(params.kind)) throw error(404, 'No such document');
  const access = await loadDocumentAccess(locals.db, locals.user, params.kind, params.id);
  if (!access || !access.canView) throw error(404, 'No such document');
  const document = await loadDocument(locals.db, params.kind, access.id);
  return json(document);
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!isDocumentKind(params.kind)) throw error(404, 'No such document');
  const access = await loadDocumentAccess(locals.db, locals.user, params.kind, params.id);
  if (!access || !access.canView) throw error(404, 'No such document');
  if (!access.canEdit || !locals.user) throw error(403, 'You may not edit this document');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'fromVersion and ops are required');
  const ops = parseOps(parsed.data.ops);
  if (!ops.ok) return json({ message: ops.message }, { status: 400 });
  const refused = await refusedSegments(locals.db, access.workId, segmentIdsIn(ops.ops));
  if (refused) return json({ message: refused }, { status: 400 });
  try {
    const saved = await saveOps(
      locals.db,
      params.kind,
      access.id,
      locals.user.id,
      parsed.data.fromVersion,
      ops.ops,
      parsed.data.message,
    );
    return json({
      version: saved.version,
      changesetId: saved.changesetId,
      ...(saved.conformed
        ? { adjusted: { content: saved.content, since: [saved.conformed] } }
        : {}),
    });
  } catch (cause) {
    if (cause instanceof VersionConflict) {
      return json({ current: cause.current, since: cause.since }, { status: 409 });
    }
    if (cause instanceof StreamError) {
      return json(
        { message: cause.message, reason: cause.reason, ids: cause.ids },
        { status: 400 },
      );
    }
    throw cause;
  }
};

/**
 * Segment starts name segments that exist: an edition's must be of its own
 * work, a transcription's may be of any.
 */
async function refusedSegments(
  db: App.Locals['db'],
  editionWorkId: string | null,
  ids: string[],
): Promise<string | null> {
  if (ids.length === 0) return null;
  const rows = await db
    .select({ id: segments.id, workId: segments.workId })
    .from(segments)
    .where(inArray(segments.id, ids));
  if (rows.length !== ids.length) return 'A segment named is unknown.';
  if (editionWorkId !== null && !rows.every((r) => r.workId === editionWorkId))
    return 'A segment named is not of this work.';
  return null;
}
