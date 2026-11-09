/**
 * GET /works/[slug]/archive.zip
 * The work's archive (PLAN 4.12) as a zip, for anyone signed in who sees the
 * work. Administrators get the server's archive itself, with its git history.
 * Everyone else gets the archive written afresh with only what they may see:
 * the server's archive holds every draft, other people's included. A route of
 * its own, because a form action cannot answer with a file.
 */
import { error, redirect } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { filteredArchiveZip, type ArchiveFilter } from '$lib/server/archive/archive';
import { canViewWork, grantsFor, isAdministrator } from '$lib/server/authz';
import { viewerFilter } from '$lib/server/archive/viewer';
import { loginUrl } from '$lib/server/guards';
import { limits } from '$lib/server/rate-limit';
import { archiveZip, workBySlug } from '$lib/server/registry';
import { archiveRoot, storageRoot } from '$lib/server/startup';
import { registry as t } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) redirect(303, loginUrl(`/works/${params.slug}`));
  const record = await workBySlug(locals.db, params.slug);
  if (!record) error(404, t.work.notFound);
  const grants = await grantsFor(locals.db, user);
  if (!canViewWork(user, record.work, record.maintainerIds, grants)) error(404, t.work.notFound);
  // Writing an archive is heavy work: a few downloads an hour per person.
  if (!limits.archiveByUser.take(user.id)) error(429, t.work.archiveTooOften);

  let zip: Readable;
  try {
    if (isAdministrator(user)) {
      zip = await archiveZip(locals.db, record.work, archiveRoot(), storageRoot());
    } else {
      const only: ArchiveFilter = await viewerFilter(locals.db, user, record.maintainerIds);
      zip = await filteredArchiveZip(locals.db, record.work, only, storageRoot());
    }
  } catch (e) {
    console.error('archive for download failed', e);
    error(500, t.work.archiveFailed);
  }
  return new Response(Readable.toWeb(zip) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${record.work.slug}-archive.zip"`,
      'cache-control': 'private, no-store',
    },
  });
};
