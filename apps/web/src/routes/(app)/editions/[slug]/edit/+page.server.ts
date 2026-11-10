import { error, fail, redirect } from '@sveltejs/kit';
import { editorNames } from '$lib/edition/editors';
import {
  editionSigla,
  editions,
  reportedReadings,
  witnesses,
  works,
  type EditionConventions,
  type WitnessHand,
} from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canDeleteEdition, canGrantOnEdition, grantsFor } from '$lib/server/authz';
import { addCollaborator, listCollaborators, removeCollaborator } from '$lib/server/collaborators';
import { offerOwnership } from '$lib/server/ownership';
import { deleteHistory } from '$lib/server/registry';
import { reviewedSites } from '$lib/server/conjectures';
import { loadEditionAccess } from '$lib/server/edition-access';
import { candidateWitnesses, setSigla, updateEditionMeta } from '$lib/server/editions';
import { requireUser } from '$lib/server/guards';
import { publishedVersions } from '$lib/server/publish';
import { editionView, type SegmentView } from '$lib/server/reader';
import { edition as s } from '$lib/strings/edition';
import type { Actions, PageServerLoad } from './$types';
import { licenceInfo } from '@varians/core';
import { dataLicence } from '$lib/server/settings';

/** Collation columns are server-side only. */
function lighten(views: Record<string, SegmentView>): Record<string, SegmentView> {
  const out: Record<string, SegmentView> = {};
  for (const [id, view] of Object.entries(views))
    out[id] = { ...view, collation: { ...view.collation, columns: [] } };
  return out;
}

async function editable(locals: App.Locals, slug: string) {
  const user = requireUser(locals);
  const access = await loadEditionAccess(locals.db, user, slug);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  return { user, access };
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requireUser(locals, url.pathname);
  const access = await loadEditionAccess(locals.db, user, params.slug);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw redirect(303, `/editions/${access.edition.slug}`);
  const edition = access.edition;
  const view = await editionView(locals.db, edition.id, null, { kind: 'editor', viewer: user });
  const [work] = await locals.db
    .select({ slug: works.slug, title: works.title })
    .from(works)
    .where(eq(works.id, edition.workId));
  const reviewed = Object.fromEntries(
    [...(await reviewedSites(locals.db, edition.id))].map(([segmentId, keys]) => [
      segmentId,
      [...keys],
    ]),
  );
  const candidates = await candidateWitnesses(
    locals.db,
    edition.workId,
    user,
    await grantsFor(locals.db, user),
  );
  const reportedWitnessIds = (
    await locals.db
      .selectDistinct({ id: reportedReadings.witnessId })
      .from(reportedReadings)
      .where(eq(reportedReadings.workId, edition.workId))
  ).map((r) => r.id);
  const reportedOnly = reportedWitnessIds.length
    ? await locals.db
        .select({ id: witnesses.id, name: witnesses.name, siglum: witnesses.siglum })
        .from(witnesses)
        .where(inArray(witnesses.id, reportedWitnessIds))
    : [];
  const sigla = await locals.db
    .select()
    .from(editionSigla)
    .where(eq(editionSigla.editionId, edition.id))
    .orderBy(editionSigla.position);
  const revision = createHash('sha1')
    .update(
      JSON.stringify([edition.title, edition.editors, edition.preface, edition.conventions, sigla]),
    )
    .digest('hex')
    .slice(0, 12);
  return {
    crumb: { label: work?.title ?? s.newTitle, href: work ? `/works/${work.slug}` : '/' },
    revision,
    // The editor lays out its own lines from the content; the reader's layout would only double the page's weight.
    view: { ...view, lines: [], segments: lighten(view.segments) },
    edition: {
      id: edition.id,
      slug: edition.slug,
      title: edition.title,
      editors: edition.editors,
      preface: edition.preface,
      sources: edition.sources,
      rightsNote: edition.rightsNote,
      licence: licenceInfo(edition.licenceId)?.name ?? null,
      installationLicence: licenceInfo(dataLicence())!.name,
      visibility: edition.visibility,
      publishedVersion: edition.publishedVersion,
      conventions: edition.conventions,
    },
    work: { slug: work?.slug ?? '', title: work?.title ?? '' },
    reviewed,
    sigla: sigla.map((x) => ({
      witnessId: x.witnessId,
      transcriptionId: x.transcriptionId,
      siglum: x.siglum,
      states: x.states,
      variantSiglum: x.variantSiglum,
    })),
    witnessHands: await handsOf(locals.db, [
      ...candidates.map((c) => c.witnessId),
      ...sigla.map((x) => x.witnessId),
      ...reportedOnly.map((w) => w.id),
    ]),
    candidates,
    reportedOnly,
    versions: await publishedVersions(locals.db, edition.id),
    collaborators: canGrantOnEdition(user, edition)
      ? await listCollaborators(locals.db, edition.id)
      : [],
    can: {
      publish: access.canPublish,
      grant: canGrantOnEdition(user, edition),
      delete: canDeleteEdition(user, edition),
    },
  };
};

const settingsSchema = z.object({
  title: z.string().trim().min(1, s.errors.titleRequired).max(200),
  editors: z.array(z.string().max(200, s.errors.editorTooLong)).max(20, s.errors.editorsTooMany),
  preface: z.string().max(50000),
  sources: z.string().max(5000),
  rightsNote: z.string().trim().max(300),
  lineation: z.enum(['verse', 'prose']),
  numberEvery: z.coerce.number().int().min(1).max(100),
  apparatus: z.enum(['positive', 'negative']),
  latin: z.boolean(),
  interpretative: z.enum(['apparatus', 'separate', 'none']),
  speakerDisplay: z.enum(['inline', 'margin', 'own-line']),
});

const siglumText = z.string().trim().min(1).max(20);
const stateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('original'), siglum: siglumText }),
  z.object({ kind: z.literal('stage'), stage: z.number().int().min(1).max(9), siglum: siglumText }),
  z.object({ kind: z.literal('hand'), hand: z.string().trim().min(1).max(64), siglum: siglumText }),
]);
const siglaSchema = z
  .array(
    z.object({
      witnessId: z.string().min(1).max(64),
      transcriptionId: z.string().min(1).max(64).nullable(),
      siglum: siglumText,
      states: z.array(stateSchema).max(10).optional(),
      variantSiglum: z.string().trim().max(20).nullable().optional(),
    }),
  )
  .max(200);

/** The hands of some witnesses, by id, for the states of the conspectus. */
async function handsOf(
  db: App.Locals['db'],
  ids: string[],
): Promise<Record<string, WitnessHand[]>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  const rows = await db
    .select({ id: witnesses.id, hands: witnesses.hands })
    .from(witnesses)
    .where(inArray(witnesses.id, unique));
  return Object.fromEntries(rows.map((r) => [r.id, r.hands]));
}

export const actions: Actions = {
  settings: async ({ locals, params, request }) => {
    const { access } = await editable(locals, params.slug);
    const form = await request.formData();
    const text = (name: string) => String(form.get(name) ?? '');
    const parsed = settingsSchema.safeParse({
      title: text('title'),
      editors: editorNames(form.getAll('editors')),
      preface: text('preface'),
      sources: text('sources'),
      rightsNote: text('rightsNote'),
      lineation: text('lineation') || 'verse',
      numberEvery: text('numberEvery') || '5',
      apparatus: text('apparatus') || 'positive',
      latin: form.get('latin') === 'on',
      interpretative: text('interpretative') || 'separate',
      speakerDisplay: text('speakerDisplay') || 'margin',
    });
    if (!parsed.success)
      return fail(400, {
        form: 'settings' as const,
        errors: z.flattenError(parsed.error).fieldErrors,
      });
    const data = parsed.data;
    const conventions: EditionConventions = {
      ...access.edition.conventions,
      lineation: data.lineation,
      numberEvery: data.numberEvery,
      apparatus: data.apparatus,
      latin: data.latin,
      interpretative: data.interpretative,
      speakerDisplay: data.speakerDisplay,
    };
    await updateEditionMeta(locals.db, access.edition.id, {
      title: data.title,
      editors: data.editors,
      preface: data.preface.trim() || null,
      sources: data.sources.trim() || null,
      rightsNote: data.rightsNote || null,
      conventions,
    });
    return { form: 'settings' as const, ok: true };
  },

  sigla: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    const form = await request.formData();
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get('sigla') ?? '[]'));
    } catch {
      return fail(400, {
        form: 'sigla' as const,
        message: 'The list of witnesses could not be read.',
      });
    }
    const parsed = siglaSchema.safeParse(raw);
    if (!parsed.success)
      return fail(400, { form: 'sigla' as const, message: 'Every witness needs a siglum.' });
    const seen = new Set<string>();
    for (const entry of parsed.data) {
      for (const siglum of [
        entry.siglum,
        ...(entry.states ?? []).map((s) => s.siglum),
        entry.variantSiglum,
      ].filter((x): x is string => !!x)) {
        if (seen.has(siglum))
          return fail(400, { form: 'sigla' as const, message: s.errors.duplicateSiglum(siglum) });
        seen.add(siglum);
      }
    }
    // Only witnesses and transcriptions that belong together.
    const ids = parsed.data.map((e) => e.witnessId);
    const known = new Set(
      (ids.length
        ? await locals.db
            .select({ id: witnesses.id })
            .from(witnesses)
            .where(inArray(witnesses.id, ids))
        : []
      ).map((w) => w.id),
    );
    if (parsed.data.some((e) => !known.has(e.witnessId)))
      return fail(400, { form: 'sigla' as const, message: 'An unknown witness was named.' });
    const candidates = await candidateWitnesses(
      locals.db,
      access.edition.workId,
      user,
      await grantsFor(locals.db, user),
    );
    const current = await locals.db
      .select()
      .from(editionSigla)
      .where(eq(editionSigla.editionId, access.edition.id));
    const pairs = new Set(
      [...candidates, ...current].map((c) => `${c.witnessId}|${c.transcriptionId}`),
    );
    if (
      parsed.data.some(
        (e) => e.transcriptionId && !pairs.has(`${e.witnessId}|${e.transcriptionId}`),
      )
    ) {
      return fail(400, {
        form: 'sigla' as const,
        message: 'A transcription does not belong to its witness or to this work.',
      });
    }
    await setSigla(
      locals.db,
      access.edition.id,
      parsed.data.map((e) => ({
        witnessId: e.witnessId,
        transcriptionId: e.transcriptionId,
        siglum: e.siglum,
        states: e.transcriptionId ? (e.states ?? []) : [],
        variantSiglum: e.variantSiglum || null,
      })),
    );
    return { form: 'sigla' as const, ok: true };
  },

  addCollaborator: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canGrantOnEdition(user, access.edition))
      throw error(403, 'Only the owner may invite collaborators');
    const email = String((await request.formData()).get('email') ?? '').trim();
    if (!email)
      return fail(400, { form: 'collaborators' as const, message: 'Give an email address.' });
    const result = await addCollaborator(locals.db, access.edition.id, email, user.id);
    if (!result.ok) {
      const message =
        result.error === 'no-user'
          ? 'Nobody with that address has an account.'
          : result.error === 'owner'
            ? 'That is the owner.'
            : 'Already a collaborator.';
      return fail(400, { form: 'collaborators' as const, message });
    }
    return { form: 'collaborators' as const, ok: true, added: result.collaborator.name };
  },

  removeCollaborator: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canGrantOnEdition(user, access.edition))
      throw error(403, 'Only the owner may remove collaborators');
    const userId = String((await request.formData()).get('userId') ?? '');
    await removeCollaborator(locals.db, access.edition.id, userId);
    return { form: 'collaborators' as const, ok: true };
  },

  offerOwnership: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canGrantOnEdition(user, access.edition))
      throw error(403, 'Only the owner may hand the edition on');
    const email = String((await request.formData()).get('email') ?? '').trim();
    const result = await offerOwnership(
      locals.db,
      'edition',
      access.edition.id,
      access.edition.ownerId,
      email,
    );
    if (!result.ok) {
      const message = {
        'no-user': 'Nobody with that address has an account.',
        self: 'You own it already.',
        'open-offer': 'An offer is already open; withdraw it on your account page first.',
        'not-owner': 'Only the owner may hand the edition on.',
      }[result.error];
      return fail(400, { form: 'ownership' as const, message });
    }
    return { form: 'ownership' as const, ok: true };
  },

  delete: async ({ locals, params }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canDeleteEdition(user, access.edition))
      throw error(403, 'Only the owner may delete the edition');
    const [work] = await locals.db
      .select({ slug: works.slug })
      .from(works)
      .where(eq(works.id, access.edition.workId));
    // The edition goes with its history, its moments and any open offer of it.
    await locals.db.transaction(async (tx) => {
      await deleteHistory(tx, 'edition', [access.edition.id]);
      await tx.delete(editions).where(eq(editions.id, access.edition.id));
    });
    throw redirect(303, work ? `/works/${work.slug}` : '/');
  },
};
