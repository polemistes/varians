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
import { canViewWork, grantsFor } from '$lib/server/authz';
import { segments, workMaintainers, works } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';

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
  const refused = await refusedSegments(locals, access.workId, segmentIdsIn(ops.ops));
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
 * Segment starts name segments of works: an edition's must be of its own
 * work, a transcription's of works the user may see, so that text is never
 * assigned to a private work by someone outside it.
 */
async function refusedSegments(
  locals: App.Locals,
  editionWorkId: string | null,
  ids: string[],
): Promise<string | null> {
  if (ids.length === 0) return null;
  const rows = await locals.db
    .select({
      id: segments.id,
      workId: works.id,
      visibility: works.visibility,
      createdBy: works.createdBy,
    })
    .from(segments)
    .innerJoin(works, eq(works.id, segments.workId))
    .where(inArray(segments.id, ids));
  if (rows.length !== ids.length) return 'A segment named is unknown.';
  if (editionWorkId !== null)
    return rows.every((r) => r.workId === editionWorkId)
      ? null
      : 'A segment named is not of this work.';
  const privateWorks = [
    ...new Set(rows.filter((r) => r.visibility !== 'public').map((r) => r.workId)),
  ];
  if (privateWorks.length === 0) return null;
  const grants = await grantsFor(locals.db, locals.user);
  for (const workId of privateWorks) {
    const row = rows.find((r) => r.workId === workId)!;
    const maintainerIds = (
      await locals.db
        .select({ id: workMaintainers.userId })
        .from(workMaintainers)
        .where(eq(workMaintainers.workId, workId))
    ).map((m) => m.id);
    if (
      !canViewWork(
        locals.user,
        { id: workId, visibility: row.visibility, createdBy: row.createdBy },
        maintainerIds,
        grants,
      )
    )
      return 'A segment named is not of a work you may see.';
  }
  return null;
}
