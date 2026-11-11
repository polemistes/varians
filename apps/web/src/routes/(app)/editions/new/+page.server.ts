import { error, fail, redirect } from '@sveltejs/kit';
import { compareAddresses, parseLabel } from '@varians/core';
import { referenceSchemes, segments, workMaintainers, works } from '@varians/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { editorNames } from '$lib/edition/editors';
import { grantsFor } from '$lib/server/authz';
import { candidateWitnesses, createEdition } from '$lib/server/editions';
import { requireUser } from '$lib/server/guards';
import { edition as s } from '$lib/strings/edition';
import type { Actions, PageServerLoad } from './$types';

async function loadWork(db: App.Locals['db'], slug: string) {
  const [work] = await db.select().from(works).where(eq(works.slug, slug));
  if (!work) return null;
  const [scheme] = await db
    .select()
    .from(referenceSchemes)
    .where(eq(referenceSchemes.id, work.schemeId));
  const maintainerIds = (
    await db
      .select({ userId: workMaintainers.userId })
      .from(workMaintainers)
      .where(eq(workMaintainers.workId, work.id))
  ).map((m) => m.userId);
  return { work, scheme: scheme ?? null, maintainerIds };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals, url.pathname + url.search);
  const slug = url.searchParams.get('work');
  if (!slug) throw error(400, s.errors.workMissing);
  const loaded = await loadWork(locals.db, slug);
  if (!loaded) throw error(404, 'No such work');
  const grants = await grantsFor(locals.db, user);
  const candidates = await candidateWitnesses(locals.db, loaded.work.id, user, grants);
  return {
    crumb: { label: loaded.work.title, href: `/works/${loaded.work.slug}` },
    work: {
      id: loaded.work.id,
      slug: loaded.work.slug,
      title: loaded.work.title,
      author: loaded.work.author,
    },
    candidates,
  };
};

const schema = z.object({
  title: z.string().trim().min(1, s.errors.titleRequired).max(200),
  editors: z.array(z.string().max(200, s.errors.editorTooLong)).max(20, s.errors.editorsTooMany),
  base: z.string().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  lineation: z.enum(['verse', 'prose']).default('verse'),
  numberEvery: z.coerce.number().int().min(1).max(100).default(5),
  apparatus: z.enum(['positive', 'negative']).default('positive'),
  latin: z.boolean().default(true),
});

export const actions: Actions = {
  default: async ({ locals, request, url }) => {
    const user = requireUser(locals);
    const slug = url.searchParams.get('work');
    if (!slug) throw error(400, s.errors.workMissing);
    const loaded = await loadWork(locals.db, slug);
    if (!loaded || !loaded.scheme) throw error(404, 'No such work');
    const grants = await grantsFor(locals.db, user);
    const form = await request.formData();
    const text = (name: string) => String(form.get(name) ?? '');
    const editors = editorNames(form.getAll('editors'));
    const parsed = schema.safeParse({
      title: text('title'),
      editors,
      base: text('base'),
      from: text('from'),
      to: text('to'),
      lineation: text('lineation') || 'verse',
      numberEvery: text('numberEvery') || '5',
      apparatus: text('apparatus') || 'positive',
      latin: form.get('latin') === 'on',
    });
    const values = {
      title: text('title'),
      editors,
      base: text('base'),
      from: text('from'),
      to: text('to'),
    };
    if (!parsed.success)
      return fail(400, { errors: z.flattenError(parsed.error).fieldErrors, values });
    const data = parsed.data;

    // The conspectus: every candidate ticked, with its siglum. Only what this person may see can be named.
    const candidates = await candidateWitnesses(locals.db, loaded.work.id, user, grants);
    if (data.base && !candidates.some((c) => c.transcriptionId === data.base))
      return fail(400, { errors: { base: [s.errors.baseUnknown] }, values });
    const sigla: { witnessId: string; transcriptionId: string | null; siglum: string }[] = [];
    const seen = new Set<string>();
    for (const c of candidates) {
      if (form.get(`include:${c.transcriptionId}`) !== 'on') continue;
      const siglum = text(`siglum:${c.transcriptionId}`).trim() || c.siglum;
      if (seen.has(siglum))
        return fail(400, { errors: { sigla: [s.errors.duplicateSiglum(siglum)] }, values });
      seen.add(siglum);
      sigla.push({ witnessId: c.witnessId, transcriptionId: c.transcriptionId, siglum });
    }

    // The range, as labels of the scheme.
    let segmentIds: string[] | undefined;
    if (data.from || data.to) {
      const scheme = { levels: loaded.scheme.levels };
      const fromAddress = data.from ? parseLabel(scheme, data.from) : null;
      const toAddress = data.to ? parseLabel(scheme, data.to) : null;
      if (data.from && !fromAddress)
        return fail(400, { errors: { from: [s.errors.rangeUnknown(data.from)] }, values });
      if (data.to && !toAddress)
        return fail(400, { errors: { to: [s.errors.rangeUnknown(data.to)] }, values });
      const all = await locals.db
        .select()
        .from(segments)
        .where(eq(segments.workId, loaded.work.id));
      segmentIds = all
        .filter(
          (seg) =>
            (!fromAddress || compareAddresses(scheme, seg.address, fromAddress) >= 0) &&
            (!toAddress || compareAddresses(scheme, seg.address, toAddress) <= 0),
        )
        .map((seg) => seg.id);
    }

    const created = await createEdition(
      locals.db,
      {
        workId: loaded.work.id,
        title: data.title,
        editors: data.editors,
        baseTranscriptionId: data.base || null,
        ...(segmentIds ? { segmentIds } : {}),
        sigla,
        conventions: {
          lineation: data.lineation,
          numberEvery: data.numberEvery,
          apparatus: data.apparatus,
          latin: data.latin,
        },
      },
      user.id,
    );
    throw redirect(303, `/editions/${created.slug}/edit`);
  },
};
