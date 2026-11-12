/**
 * GET /transcriptions/[id]/tei: the transcription as a TEI document, with
 * the witness description, the pages and zones as a facsimile, and the
 * segment starts as milestones carrying their labels.
 */
import { error } from '@sveltejs/kit';
import { loadTranscriptionAccess } from '$lib/server/transcription-access';
import { exportTei } from '$lib/server/workbench';
import { workbench as t } from '$lib/strings/workbench';
import type { RequestHandler } from './$types';

/** A file name from the transcription's name: letters, digits and dashes. */
function fileName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base || 'transcription'}.xml`;
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, t.errors.notFound);
  // Those who may not edit the transcription download its latest version.
  const exported = await exportTei(locals.db, access.transcription.id, url.origin, access.canEdit);
  if (!exported) throw error(404, t.errors.notFound);
  const name = fileName(exported.name);
  return new Response(exported.xml, {
    headers: {
      'content-type': 'application/tei+xml; charset=utf-8',
      'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
    },
  });
};
