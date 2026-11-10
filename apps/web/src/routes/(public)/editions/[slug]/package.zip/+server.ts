/**
 * GET /editions/[slug]/package.zip: the edition as a package:
 * the work's own files, the witnesses and transcriptions of its conspectus
 * at the versions its apparatus needs, as the visitor may see them.
 */
import { error } from '@sveltejs/kit';
import { buildPackage } from '$lib/server/archive/package';
import { loadEditionAccess } from '$lib/server/edition-access';
import { PACKAGE_AGENT, packageOrigin, packageResponse } from '$lib/server/package-response';
import { limits } from '$lib/server/rate-limit';
import { storageRoot } from '$lib/server/startup';
import { registry as t } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url, getClientAddress }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.slug);
  if (!access || !access.canView) error(404, 'Not found');
  if (!limits.archiveByUser.take(locals.user?.id ?? `address:${getClientAddress()}`)) error(429, t.work.archiveTooOften);
  try {
    return packageResponse(await buildPackage(locals.db, locals.user, [{ kind: 'edition', editionId: access.edition.id }], { storageRoot: storageRoot(), origin: packageOrigin(url.origin), agent: PACKAGE_AGENT }));
  } catch (e) {
    console.error('package for download failed', e);
    error(500, t.work.archiveFailed);
  }
};
