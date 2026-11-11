/**
 * Copying text from a transcript of the conspectus into the edition.
 *
 *   GET  ?transcription=&from=&to=                    { segments, replaced }
 *   POST { transcriptionId, from?, to?, fromVersion }  { version, changesetId, segments, replaced }
 *                                                     409 { message } when the edition changed since fromVersion
 *
 * `from` and `to` are segment labels in the work's scheme; an empty one is
 * the first or the last segment the transcript has of the work. The GET
 * says how many segments a copy would bring and how many of them the
 * edition has text for, which it would replace; it changes nothing. The
 * POST copies them as one change in the edition's history. Both need the
 * right to edit the edition, and a transcript in its conspectus that the
 * person may see.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { VersionConflict } from '$lib/server/documents/service';
import { loadEditionAccess } from '$lib/server/edition-access';
import { CopyRefused, copyText, previewCopy } from '$lib/server/text-copy';
import { editor as s } from '$lib/strings/editor';

const label = z.string().max(100).nullish();
const body = z.object({
  transcriptionId: z.string().min(1).max(64),
  from: label,
  to: label,
  fromVersion: z.number().int().min(0),
});

async function editable(locals: App.Locals, id: string) {
  const access = await loadEditionAccess(locals.db, locals.user, id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit || !locals.user) throw error(403, 'You may not edit this edition');
  return { edition: access.edition, user: locals.user };
}

function refused(cause: unknown): Response {
  if (cause instanceof CopyRefused)
    return json({ message: cause.message }, { status: cause.status });
  if (cause instanceof VersionConflict)
    return json({ message: s.dialogs.copyText.changed }, { status: 409 });
  throw cause;
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const { edition, user } = await editable(locals, params.id);
  const transcriptionId = url.searchParams.get('transcription') ?? '';
  if (!transcriptionId || transcriptionId.length > 64)
    throw error(400, 'transcription is required');
  try {
    return json(
      await previewCopy(locals.db, edition, user, {
        transcriptionId,
        from: url.searchParams.get('from')?.slice(0, 100) ?? null,
        to: url.searchParams.get('to')?.slice(0, 100) ?? null,
      }),
    );
  } catch (cause) {
    return refused(cause);
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const { edition, user } = await editable(locals, params.id);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'transcriptionId and fromVersion are required');
  try {
    return json(await copyText(locals.db, edition, user, parsed.data, parsed.data.fromVersion));
  } catch (cause) {
    return refused(cause);
  }
};
