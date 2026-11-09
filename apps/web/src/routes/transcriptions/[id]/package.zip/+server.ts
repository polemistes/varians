/**
 * GET /transcriptions/[id]/package.zip: the transcription as a package
 * (PLAN-2 E3), with its works' own files, its witness, pages and images.
 */
import { error } from '@sveltejs/kit';
import { transcriptions } from '@varians/db';
import { eq } from 'drizzle-orm';
import { buildPackage } from '$lib/server/archive/package';
import { canViewTranscription, grantsFor } from '$lib/server/authz';
import { PACKAGE_AGENT, packageOrigin, packageResponse } from '$lib/server/package-response';
import { limits } from '$lib/server/rate-limit';
import { storageRoot } from '$lib/server/startup';
import { registry as t } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url, getClientAddress }) => {
  const [row] = await locals.db.select({ id: transcriptions.id, ownerId: transcriptions.ownerId, visibility: transcriptions.visibility }).from(transcriptions).where(eq(transcriptions.id, params.id));
  if (!row || !canViewTranscription(locals.user, row, await grantsFor(locals.db, locals.user))) error(404, 'Not found');
  if (!limits.archiveByUser.take(locals.user?.id ?? `address:${getClientAddress()}`)) error(429, t.work.archiveTooOften);
  try {
    return packageResponse(await buildPackage(locals.db, locals.user, [{ kind: 'transcription', transcriptionId: row.id }], { storageRoot: storageRoot(), origin: packageOrigin(url.origin), agent: PACKAGE_AGENT }));
  } catch (e) {
    console.error('package for download failed', e);
    error(e instanceof Error && e.message === 'nothing to package' ? 404 : 500, t.work.archiveFailed);
  }
};
