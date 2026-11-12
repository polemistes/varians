/**
 * Zones of a transcription.
 *   GET    ?page=ID | ?tokens=a,b,c [&v=N]   the zones of a page, or of some tokens (with each page's image source):
 *          of the draft for those who may edit it, else of the latest version; of version N when asked
 *   POST   { zones: [{ id?, pageId, geometry, tokenIds, feature? }] }   (an id brings back a zone an undo restores)
 *   PATCH  { id, geometry?, tokenIds?, feature? } | { zones: [{ id, geometry }] }   (several shapes at once, all or none)
 *   DELETE { ids: [...] }
 */
import { error, json } from '@sveltejs/kit';
import { pages, type TranscriptionSnapshot } from '@varians/db';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { loadTranscriptionAccess } from '$lib/server/transcription-access';
import { pageSource } from '$lib/server/page-source';
import { latestVersionWithSnapshot, versionByNumber } from '$lib/server/versions';
import {
  createZones,
  deleteZones,
  updateZone,
  updateZoneGeometries,
  zonesOf,
  zonesOfTokens,
} from '$lib/server/zones';

/** Coordinates in image pixels: finite, and within any image Varians takes. */
const coordinate = z.number().finite().min(-1e6).max(1e6);
const id = z.string().min(1).max(64);
const geometry = z.object({
  rect: z.object({ x: coordinate, y: coordinate, w: coordinate, h: coordinate }).optional(),
  polygon: z
    .array(z.tuple([coordinate, coordinate]))
    .max(2000)
    .optional(),
  /** Degrees clockwise a rectangle is turned about its centre. */
  rotate: z.number().finite().min(-360).max(360).optional(),
});
const feature = z
  .object({ kind: z.string().min(1).max(64), description: z.string().max(2000).optional() })
  .nullable()
  .optional();
const tokenIds = z.array(id).max(5000);
const createBody = z.object({
  zones: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[0-9A-Za-z_-]{8,64}$/)
          .optional(),
        pageId: id,
        geometry,
        tokenIds: tokenIds.default([]),
        feature,
      }),
    )
    .min(1)
    .max(5000),
});
const patchBody = z.object({
  id,
  geometry: geometry.optional(),
  tokenIds: tokenIds.optional(),
  feature,
});
const patchManyBody = z.object({ zones: z.array(z.object({ id, geometry })).min(1).max(5000) });
const deleteBody = z.object({ ids: z.array(id).min(1).max(5000) });

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access) throw error(404, 'No such transcription');
  const pageId = url.searchParams.get('page');
  const tokens = url.searchParams.get('tokens');
  const asked = url.searchParams.get('v');
  // A version's zones are those of its snapshot: version N when asked, the latest for one who may not edit the draft.
  const number = asked !== null ? Number(asked) : null;
  if (number !== null && !(Number.isInteger(number) && number > 0))
    throw error(404, 'No such version');
  if (number === null && !access.canView) throw error(404, 'No such transcription');
  const version =
    number !== null
      ? await versionByNumber(locals.db, 'transcription', params.id, number)
      : access.canEdit
        ? null
        : await latestVersionWithSnapshot(locals.db, 'transcription', params.id);
  if ((number !== null || !access.canEdit) && (!version || version.withdrawnAt))
    throw error(404, 'No such version');
  let rows: {
    id: string;
    pageId: string;
    geometry: unknown;
    tokenIds: string[];
    feature: unknown;
  }[];
  if (version) {
    const all = (version.snapshot as TranscriptionSnapshot).zones;
    const wanted = tokens ? new Set(tokens.split(',').filter((s) => s)) : null;
    rows = all.filter((z) =>
      wanted ? z.tokenIds.some((t) => wanted.has(t)) : !pageId || z.pageId === pageId,
    );
  } else
    rows = tokens
      ? await zonesOfTokens(
          locals.db,
          params.id,
          tokens.split(',').filter((s) => s),
        )
      : await zonesOf(locals.db, params.id, pageId ?? undefined);
  const pageIds = [...new Set(rows.map((z) => z.pageId).concat(pageId ? [pageId] : []))];
  const pageRows = pageIds.length
    ? await locals.db.select().from(pages).where(inArray(pages.id, pageIds))
    : [];
  return json({
    zones: rows.map((z) => ({
      id: z.id,
      pageId: z.pageId,
      geometry: z.geometry,
      tokenIds: z.tokenIds,
      feature: z.feature,
    })),
    pages: pageRows.map((p) => ({
      id: p.id,
      label: p.label,
      width: p.imageWidth,
      height: p.imageHeight,
      source: pageSource(p),
      rights: p.rights,
      attribution: p.attribution,
    })),
  });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such transcription');
  if (!access.canEdit) throw error(403, 'You may not edit this transcription');
  const parsed = createBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'zones are required');
  try {
    const created = await createZones(
      locals.db,
      params.id,
      access.witness.id,
      parsed.data.zones.map((z) => ({ ...z, feature: z.feature ?? null })),
    );
    return json(
      {
        zones: created.map((z) => ({
          id: z.id,
          pageId: z.pageId,
          geometry: z.geometry,
          tokenIds: z.tokenIds,
          feature: z.feature,
        })),
      },
      { status: 201 },
    );
  } catch (cause) {
    // The reason stays in the log: database messages are not for the browser.
    console.warn('zones not created', cause);
    throw error(
      400,
      'The zones could not be made: a page is not of this witness, or a word is unknown.',
    );
  }
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such transcription');
  if (!access.canEdit) throw error(403, 'You may not edit this transcription');
  const body: unknown = await request.json().catch(() => null);
  const many = patchManyBody.safeParse(body);
  if (many.success) {
    const updated = await updateZoneGeometries(locals.db, params.id, many.data.zones);
    return json({
      zones: updated.map((z) => ({
        id: z.id,
        pageId: z.pageId,
        geometry: z.geometry,
        tokenIds: z.tokenIds,
        feature: z.feature,
      })),
    });
  }
  const parsed = patchBody.safeParse(body);
  if (!parsed.success) throw error(400, 'id is required');
  const { id, ...fields } = parsed.data;
  const updated = await updateZone(locals.db, params.id, id, fields);
  if (!updated) throw error(404, 'No such zone');
  return json({
    zone: {
      id: updated.id,
      pageId: updated.pageId,
      geometry: updated.geometry,
      tokenIds: updated.tokenIds,
      feature: updated.feature,
    },
  });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such transcription');
  if (!access.canEdit) throw error(403, 'You may not edit this transcription');
  const parsed = deleteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'ids are required');
  return json({ removed: await deleteZones(locals.db, params.id, parsed.data.ids) });
};
