/**
 * GET /transcriptions/[id]/leiden: the transcription as Leiden+, the
 * notation of papyri.info, with the witness's pages as its divisions.
 */
import { error } from '@sveltejs/kit';
import { loadTranscriptionAccess } from '$lib/server/transcription-access';
import { exportLeidenPlus } from '$lib/server/workbench';
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
  return `${base || 'transcription'}.leiden.txt`;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, t.errors.notFound);
  // Those who may not edit the transcription download its latest version.
  const exported = await exportLeidenPlus(locals.db, access.transcription.id, access.canEdit);
  if (!exported) throw error(404, t.errors.notFound);
  const name = fileName(exported.name);
  return new Response(exported.text, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
    },
  });
};
