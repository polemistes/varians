/**
 * GET /api/transcriptions/[id]/segments?ids=a,b,c
 * The items of a transcription for some segments: every run in content
 * order with its page, for the witness pane and the facsimile coupling.
 * Without `ids`, the list of segments the transcription has.
 */
import { error, json } from '@sveltejs/kit';
import { isBreak, runsOfSegment, segmentIds, toText, units, type Item } from '@varians/core';
import type { RequestHandler } from './$types';
import { loadTranscriptionAccess } from '$lib/server/transcription-access';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such transcription');
  const content = access.transcription.content;
  const wanted = url.searchParams.get('ids');
  if (!wanted)
    return json({ segmentIds: segmentIds(content), version: access.transcription.version });
  const out: Record<
    string,
    {
      runs: { items: Item[]; pageId: string | null; read: string; written: string }[];
      units: ReturnType<typeof units>;
    }
  > = {};
  // The page each item stands on: the last page break before it.
  const pageAt: (string | null)[] = [];
  let current: string | null = null;
  for (const item of content.items) {
    if (isBreak(item) && item.type === 'page') current = item.pageId ?? null;
    pageAt.push(current);
  }
  for (const id of wanted.split(',').filter((s) => s)) {
    const runs = runsOfSegment(content, id);
    out[id] = {
      runs: runs.map((run) => {
        const items = content.items.slice(run.from, run.to);
        return {
          items,
          pageId: pageAt[run.from] ?? null,
          read: toText({ items }, { form: 'read' }),
          written: toText({ items }, { form: 'written' }),
        };
      }),
      units: runs.flatMap((run) => units(content, run.from, run.to)),
    };
  }
  return json({
    segments: out,
    version: access.transcription.version,
    keepsWrittenForm: access.transcription.keepsWrittenForm,
  });
};
