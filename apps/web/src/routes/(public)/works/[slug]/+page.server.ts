import { error, fail, redirect } from '@sveltejs/kit';
import type { Scheme } from '@varians/core';
import { conjectures, eq, reportedReadings, witnesses } from '@varians/db';
import {
  canDeleteConjecture,
  canEditConjecture,
  editionRights,
  canMaintainWork,
  canPublishConjecture,
  canViewConjecture,
  canViewEdition,
  canViewTranscription,
  grantsFor,
  type Actor,
  type ConjectureContext,
} from '$lib/server/authz';
import {
  deleteConjecture,
  deleteReportedReading,
  registerConjecture,
  reportReading,
  updateConjecture,
} from '$lib/server/conjectures';
import { citationsByRecord, setCitations, type CitationView } from '$lib/server/bibliography';
import { requireUser } from '$lib/server/guards';
import {
  conjecturesOfWork,
  createTranscription,
  editionRowsOfWork,
  maintainersOf,
  readingsOfWork,
  RegistryError,
  transcriptionsOfWork,
  updateReportedReading,
  witnessOptions,
  workBySlug,
} from '$lib/server/registry';
import { mergesInto } from '$lib/server/registry-merge';
import { resolveSegment, segmentsOfWork } from '$lib/server/segments';
import {
  checked,
  field,
  parseCitations,
  parseConjectureForm,
  parseReadingForm,
  type CitationField,
  type FieldErrors,
  type Parsed,
} from '$lib/registry/forms';
import { languageName } from '$lib/registry/languages';
import { exampleLabel, labelRanges, schemeSentence } from '$lib/registry/scheme';
import type { Cited, RowRights, SearchHit } from '$lib/registry/types';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** The work with what authorizing against it needs; 404 when there is no such work. */
async function access(locals: App.Locals, slug: string) {
  const record = await workBySlug(locals.db, slug);
  if (!record) error(404, t.work.notFound);
  const grants = await grantsFor(locals.db, locals.user);
  const context: ConjectureContext = { workMaintainerIds: record.maintainerIds, grants };
  return { ...record, grants, context };
}

/** What a record cites, as the page shows and the picker edits it. */
function cited(views: CitationView[] | undefined): Cited[] {
  return (views ?? []).map(({ itemId, label, prenote, postnote, text }) => ({
    itemId,
    label,
    prenote,
    postnote,
    text,
  }));
}

function rights(
  user: Actor | null,
  record: { id: string; ownerId: string; workId: string },
  context: ConjectureContext,
): RowRights {
  if (!user) return { edit: false, delete: false, publish: false };
  return {
    edit: canEditConjecture(user, record, context),
    delete: canDeleteConjecture(user, record),
    publish: canPublishConjecture(user, record),
  };
}

/** The work page is public like the work; what it offers to do needs a user. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = locals.user;
  const { work, scheme, maintainerIds, grants, context } = await access(locals, params.slug);
  const db = locals.db;
  const [
    maintainers,
    editionRows,
    transcriptionRows,
    conjectureRows,
    readingRows,
    segmentRows,
    witnessList,
    merged,
  ] = await Promise.all([
    maintainersOf(db, 'work', work.id),
    editionRowsOfWork(db, work.id),
    transcriptionsOfWork(db, work.id),
    conjecturesOfWork(db, work.id),
    readingsOfWork(db, work.id),
    segmentsOfWork(db, work.id),
    user ? witnessOptions(db) : Promise.resolve([]),
    mergesInto(db, 'work', work.id),
  ]);

  // Back from registering a witness for this work: the picker opens with it.
  let pickedWitness: SearchHit | null = null;
  const picked = url.searchParams.get('witness');
  if (picked) {
    const [w] = await db
      .select({
        id: witnesses.id,
        slug: witnesses.slug,
        title: witnesses.name,
        siglum: witnesses.siglum,
        shelfmark: witnesses.shelfmark,
        settlement: witnesses.settlement,
      })
      .from(witnesses)
      .where(eq(witnesses.id, picked));
    if (w) pickedWitness = { ...w, author: null };
  }

  const visibleConjectures = conjectureRows.filter((c) => canViewConjecture(user, c, context));
  const visibleReadings = readingRows.filter((r) => canViewConjecture(user, r, context));
  const [conjectureCitations, readingCitations] = await Promise.all([
    citationsByRecord(
      db,
      'conjecture',
      visibleConjectures.map((c) => c.id),
    ),
    citationsByRecord(
      db,
      'reported',
      visibleReadings.map((r) => r.id),
    ),
  ]);

  const maintains = canMaintainWork(user, work, maintainerIds);
  return {
    crumb: { label: work.title },
    work: {
      id: work.id,
      slug: work.slug,
      title: work.title,
      author: work.author,
      language: work.language,
      languageName: languageName(work.language),
      identifier: work.identifier,
      identifiers: work.identifiers,
      description: work.description,
    },
    merged,
    scheme,
    schemeSentence: schemeSentence(scheme),
    example: segmentRows[0]?.label ?? exampleLabel(scheme),
    maintainers: maintainers.map((m) => ({ id: m.id, name: m.name })),
    editions: editionRows
      .filter((e) => canViewEdition(user, e, e.collaboratorIds))
      .map(({ collaboratorIds, ...e }) => ({
        ...e,
        can: editionRights(user, e, collaboratorIds),
      })),
    transcriptions: transcriptionRows.filter((r) => canViewTranscription(user, r, grants)),
    conjectures: visibleConjectures.map((c) => ({
      ...c,
      can: rights(user, c, context),
      citations: cited(conjectureCitations.get(c.id)),
    })),
    readings: visibleReadings.map((r) => ({
      ...r,
      can: rights(user, r, context),
      citations: cited(readingCitations.get(r.id)),
    })),
    segmentCount: segmentRows.length,
    segmentRanges: labelRanges(scheme, segmentRows),
    /** Suggestions for the segment field; left out for a long work. */
    labels: segmentRows.length <= 2000 ? segmentRows.map((s) => s.label) : [],
    witnesses: witnessList,
    pickedWitness,
    can: {
      maintain: maintains,
      newEdition: !!user,
      transcribe: !!user,
      addConjecture: !!user,
      addReading: !!user,
      archive: !!user,
    },
  };
};

/** The segment a form names, created on the way when the label fits the scheme. */
function segmentFor(event: RequestEvent, workId: string, scheme: Scheme, label: string) {
  return resolveSegment(event.locals.db, { workId, scheme }, label);
}

/** A record's fields and the works it cites, read together so that every error shows at once. */
function readRecord<T>(
  form: FormData,
  parse: (form: FormData) => Parsed<T>,
):
  | { ok: true; data: T; citations: CitationField[] }
  | { ok: false; errors: FieldErrors; values?: Record<string, string> } {
  const parsed = parse(form);
  const cites = parseCitations(form);
  if (parsed.ok && cites.ok) return { ok: true, data: parsed.data, citations: cites.data };
  return {
    ok: false,
    errors: {
      ...(parsed.ok ? {} : parsed.errors),
      ...(cites.ok ? {} : { citations: [cites.error] }),
    },
    ...(parsed.ok ? {} : { values: parsed.values }),
  };
}

export const actions: Actions = {
  transcribe: async (event) => {
    const user = requireUser(event.locals);
    const { work } = await access(event.locals, event.params.slug);
    const form = await event.request.formData();
    const witnessId = field(form, 'witnessId');
    if (!witnessId) return fail(400, { error: t.reading.witnessRequired });
    let id: string;
    try {
      const created = await createTranscription(
        event.locals.db,
        {
          witnessId,
          workIds: [work.id],
          name: work.title,
          keepsWrittenForm: checked(form, 'keepsWrittenForm'),
        },
        user.id,
      );
      id = created.id;
    } catch (e) {
      if (e instanceof RegistryError && e.code === 'not-found')
        return fail(404, { error: t.witness.notFound });
      throw e;
    }
    redirect(303, `/transcriptions/${id}`);
  },

  addConjecture: async (event) => {
    const user = requireUser(event.locals);
    const { work, scheme } = await access(event.locals, event.params.slug);
    const read = readRecord(await event.request.formData(), parseConjectureForm);
    if (!read.ok) return fail(400, { errors: read.errors, values: read.values });
    const d = read.data;
    const segment = await segmentFor(event, work.id, scheme, d.segment);
    if (!segment) return fail(400, { errors: { segment: [t.conjecture.segmentInvalid] } });
    const conjecture = await registerConjecture(
      event.locals.db,
      {
        workId: work.id,
        segmentId: segment.id,
        kind: d.kind,
        lemma: d.lemma,
        reading: d.reading,
        proposer: d.proposer,
        note: d.note,
        extent: d.extent,
        visibility: d.published ? 'published' : 'draft',
      },
      user.id,
    );
    await setCitations(event.locals.db, { conjectureId: conjecture.id }, read.citations);
    return { message: t.conjecture.added };
  },

  editConjecture: async (event) => {
    const user = requireUser(event.locals);
    const { work, scheme, context } = await access(event.locals, event.params.slug);
    const form = await event.request.formData();
    const [row] = await event.locals.db
      .select()
      .from(conjectures)
      .where(eq(conjectures.id, field(form, 'id')));
    if (!row || row.workId !== work.id) return fail(404, { error: t.conjecture.notFound });
    if (!canEditConjecture(user, row, context)) return fail(403, { error: t.common.forbidden });
    const read = readRecord(form, parseConjectureForm);
    if (!read.ok) return fail(400, { errors: read.errors, values: read.values });
    const d = read.data;
    const segment = await segmentFor(event, work.id, scheme, d.segment);
    if (!segment) return fail(400, { errors: { segment: [t.conjecture.segmentInvalid] } });
    await updateConjecture(event.locals.db, row.id, {
      segmentId: segment.id,
      kind: d.kind,
      lemma: d.lemma,
      reading: d.reading,
      proposer: d.proposer,
      note: d.note,
      extent: d.extent,
      ...(canPublishConjecture(user, row)
        ? { visibility: d.published ? ('published' as const) : ('draft' as const) }
        : {}),
    });
    await setCitations(event.locals.db, { conjectureId: row.id }, read.citations);
    return { message: t.conjecture.updated };
  },

  deleteConjecture: async (event) => {
    const user = requireUser(event.locals);
    const { work } = await access(event.locals, event.params.slug);
    const form = await event.request.formData();
    const [row] = await event.locals.db
      .select()
      .from(conjectures)
      .where(eq(conjectures.id, field(form, 'id')));
    if (!row || row.workId !== work.id) return fail(404, { error: t.conjecture.notFound });
    if (!canDeleteConjecture(user, row)) return fail(403, { error: t.common.forbidden });
    await deleteConjecture(event.locals.db, row.id);
    return { message: t.conjecture.deleted };
  },

  addReading: async (event) => {
    const user = requireUser(event.locals);
    const { work, scheme } = await access(event.locals, event.params.slug);
    const read = readRecord(await event.request.formData(), parseReadingForm);
    if (!read.ok) return fail(400, { errors: read.errors, values: read.values });
    const d = read.data;
    const [witness] = await event.locals.db
      .select({ id: witnesses.id })
      .from(witnesses)
      .where(eq(witnesses.id, d.witnessId));
    if (!witness) return fail(400, { errors: { witnessId: [t.reading.witnessRequired] } });
    const segment = await segmentFor(event, work.id, scheme, d.segment);
    if (!segment) return fail(400, { errors: { segment: [t.conjecture.segmentInvalid] } });
    const reading = await reportReading(
      event.locals.db,
      {
        workId: work.id,
        segmentId: segment.id,
        witnessId: witness.id,
        lemma: d.lemma,
        reading: d.reading,
        source: d.source,
        note: d.note,
        visibility: d.published ? 'published' : 'draft',
      },
      user.id,
    );
    await setCitations(event.locals.db, { reportedReadingId: reading.id }, read.citations);
    return { message: t.reading.added };
  },

  editReading: async (event) => {
    const user = requireUser(event.locals);
    const { work, scheme, context } = await access(event.locals, event.params.slug);
    const form = await event.request.formData();
    const [row] = await event.locals.db
      .select()
      .from(reportedReadings)
      .where(eq(reportedReadings.id, field(form, 'id')));
    if (!row || row.workId !== work.id) return fail(404, { error: t.reading.notFound });
    if (!canEditConjecture(user, row, context)) return fail(403, { error: t.common.forbidden });
    const read = readRecord(form, parseReadingForm);
    if (!read.ok) return fail(400, { errors: read.errors, values: read.values });
    const d = read.data;
    const [witness] = await event.locals.db
      .select({ id: witnesses.id })
      .from(witnesses)
      .where(eq(witnesses.id, d.witnessId));
    if (!witness) return fail(400, { errors: { witnessId: [t.reading.witnessRequired] } });
    const segment = await segmentFor(event, work.id, scheme, d.segment);
    if (!segment) return fail(400, { errors: { segment: [t.conjecture.segmentInvalid] } });
    await updateReportedReading(event.locals.db, row.id, {
      segmentId: segment.id,
      witnessId: witness.id,
      lemma: d.lemma,
      reading: d.reading,
      source: d.source,
      note: d.note,
      ...(canPublishConjecture(user, row)
        ? { visibility: d.published ? ('published' as const) : ('draft' as const) }
        : {}),
    });
    await setCitations(event.locals.db, { reportedReadingId: row.id }, read.citations);
    return { message: t.reading.updated };
  },

  deleteReading: async (event) => {
    const user = requireUser(event.locals);
    const { work } = await access(event.locals, event.params.slug);
    const form = await event.request.formData();
    const [row] = await event.locals.db
      .select()
      .from(reportedReadings)
      .where(eq(reportedReadings.id, field(form, 'id')));
    if (!row || row.workId !== work.id) return fail(404, { error: t.reading.notFound });
    if (!canDeleteConjecture(user, row)) return fail(403, { error: t.common.forbidden });
    await deleteReportedReading(event.locals.db, row.id);
    return { message: t.reading.deleted };
  },
};
