/**
 * The transcription workbench. Outside the (app) group: a visitor
 * reads the latest version of a transcription that has one; only those who
 * may edit get the draft and the tools. Loads the transcription with its witness, pages, works and segment
 * labels; the actions are the imports, the settings and the deletion. The
 * text itself is saved through the documents API by the page's session.
 */
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { detectNumbering, type UnitMapping } from '@varians/core';
import { z } from 'zod';
import { VersionConflict } from '$lib/server/documents/service';
import { LanguageMissing, languageTag } from '$lib/server/import/language';
import {
  fetchTeiSource,
  importLayoutInto,
  importLeidenInto,
  importPlainTextInto,
  importTeiInto,
  type Placement,
  type TeiKind,
  layoutKind,
  loadWorkbench,
  saveSettings,
  SourceError,
  teiPreview,
  type ImportOutcome,
  type ImportTarget,
  type WorkbenchData,
} from '$lib/server/workbench';
import { workbench as t } from '$lib/strings/workbench';
import { recordActions } from '$lib/strings/record-actions';
import { registry } from '$lib/strings/registry';
import { eq, works } from '@varians/db';
import type { Actions, PageServerLoad } from './$types';
import {
  createTranscription,
  deleteTranscription as deleteRegisteredTranscription,
} from '$lib/server/registry';
import { appendSources } from '$lib/server/workbench';
import { clientData, clientPage, workbenchCrumb } from '$lib/server/workbench-client';

export const load: PageServerLoad = async ({ locals, params }) => {
  const data = await loadWorkbench(locals.db, locals.user, params.id);
  if (!data) throw error(404, t.errors.notFound);
  return { ...clientData(data), crumb: workbenchCrumb(data) };
};

/** The transcription with the right to change it, for an action; a visitor or a reader is refused. */
async function editable(event: RequestEvent<{ id: string }>) {
  const data = await loadWorkbench(event.locals.db, event.locals.user, event.params.id);
  if (!data) throw error(404, t.errors.notFound);
  if (!data.canEdit || !event.locals.user) throw error(403, t.errors.forbidden);
  return { data, user: event.locals.user };
}

const flag = (form: FormData, name: string) => form.get(name) === 'on' || form.get(name) === 'true';
const text = (form: FormData, name: string) => String(form.get(name) ?? '');

function target(data: WorkbenchData, form: FormData, userId: string): ImportTarget {
  return {
    transcriptionId: data.transcription.id,
    witnessId: data.witness.id,
    fromVersion: Number(text(form, 'fromVersion')) || 0,
    userId,
    replace: flag(form, 'replace'),
    createPages: data.canMaintainWitness,
    placement: placementOf(data, form),
    language: languageTag(form.get('language')),
  };
}

/** Where text without pages of its own goes: a page of the witness when one is named, else Staging. */
function placementOf(data: WorkbenchData, form: FormData): Placement {
  const id = text(form, 'placement');
  return data.pages.some((p) => p.id === id) ? { to: 'page', pageId: id } : { to: 'unplaced' };
}

/** What a TEI file is taken as: a text to start from, or a transcript of this witness. It must be said. */
function teiKindOf(form: FormData): TeiKind | null {
  const as = text(form, 'as');
  return as === 'text' || as === 'transcript' ? as : null;
}

/**
 * The work an import names, or none: any registered work, chosen in the
 * import window, since a transcription's works are only those its text is
 * assigned to.
 */
async function workOf(event: RequestEvent<{ id: string }>, form: FormData): Promise<string | null> {
  const id = text(form, 'workId');
  if (!id || id.length > 64) return null;
  const [found] = await event.locals.db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.id, id));
  return found?.id ?? null;
}

/** A file field read as text, or the text field of the same purpose. */
async function fileOrText(form: FormData, file: string, field: string): Promise<string> {
  const value = form.get(file);
  if (value instanceof File && value.size > 0) return value.text();
  return text(form, field);
}

/** After an import: what changed and what the page must now know (pages may have been added, segments named). */
/**
 * An import run, with what the page needs after it. A transcript of the
 * witness made elsewhere has a source, which is added to the transcription's
 * sources when it is named. A text to start from has none: where it came
 * from is of no account once it is corrected against the witness.
 */
async function imported(
  event: RequestEvent<{ id: string }>,
  form: FormData,
  run: () => Promise<ImportOutcome>,
  transcript = true,
) {
  try {
    const outcome = await run();
    const source = transcript ? text(form, 'source').trim().slice(0, 1000) : '';
    if (source) await appendSources(event.locals.db, event.params.id, source);
    const fresh = await loadWorkbench(event.locals.db, event.locals.user, event.params.id);
    return {
      imported: {
        outcome,
        pages: fresh ? fresh.pages.map(clientPage) : [],
        segments: fresh?.segments ?? {},
        works: fresh?.works ?? [],
      },
    };
  } catch (cause) {
    if (cause instanceof VersionConflict)
      return fail(409, { message: t.importer.conflict, conflict: true });
    if (cause instanceof SourceError) return fail(400, { message: cause.message });
    if (cause instanceof LanguageMissing)
      return fail(400, { message: t.importer.languageRequired });
    // What went wrong in detail is for the log; the message says what to check.
    console.warn('import failed', cause);
    return fail(400, { message: t.importer.failed(t.importer.unreadable) });
  }
}

async function teiText(form: FormData): Promise<string> {
  const file = form.get('file');
  if (file instanceof File && file.size > 0) return file.text();
  const source = text(form, 'source').trim();
  if (!source) throw new SourceError(t.importer.tei.needSource);
  return fetchTeiSource(source);
}

function mappingOf(form: FormData): UnitMapping | undefined {
  const raw = text(form, 'mapping');
  if (!raw) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = z.record(z.string(), z.string()).safeParse(json);
  // A mapping with no unit at all is no choice: the importer proposes one.
  if (!parsed.success || Object.keys(parsed.data).length === 0) return undefined;
  return Object.fromEntries(Object.entries(parsed.data).filter(([, level]) => level !== ''));
}

const settingsSchema = z.object({
  name: z.string().trim().min(1, t.settings.nameRequired).max(200),
});

export const actions: Actions = {
  settings: async (event) => {
    const { data, user } = await editable(event);
    const form = await event.request.formData();
    const parsed = settingsSchema.safeParse({ name: text(form, 'name') });
    if (!parsed.success)
      return fail(400, { message: parsed.error.issues[0]?.message ?? t.settings.nameRequired });
    try {
      const settings = await saveSettings(event.locals.db, data.transcription.id, {
        name: parsed.data.name,
        keepsWrittenForm: flag(form, 'keepsWrittenForm'),
        displayAsWritten: flag(form, 'displayAsWritten'),
        fromVersion: Number(text(form, 'fromVersion')) || 0,
        userId: user.id,
        sources: text(form, 'sources').trim().slice(0, 5000) || null,
        rightsNote: text(form, 'rightsNote').trim().slice(0, 300) || null,
      });
      return { settings };
    } catch (cause) {
      if (cause instanceof VersionConflict)
        return fail(409, { message: t.importer.conflict, conflict: true });
      throw cause;
    }
  },

  /** A copy of one's own: the text, settings and boxes; the history starts afresh. */
  copy: async (event) => {
    const user = event.locals.user;
    if (!user) throw error(403, t.errors.forbidden);
    const data = await loadWorkbench(event.locals.db, user, event.params.id);
    if (!data) throw error(404, t.errors.notFound);
    const form = await event.request.formData();
    const name = text(form, 'name').trim().slice(0, 200);
    if (!name) return fail(400, { copyError: t.settings.nameRequired });
    const copy = await createTranscription(
      event.locals.db,
      {
        witnessId: data.witness.id,
        name,
        fromTranscriptionId: data.transcription.id,
        // One who reads the transcript's latest version copies that.
        fromLatestVersion: data.transcription.shownVersion !== null,
      },
      user.id,
    );
    throw redirect(303, `/transcriptions/${copy.id}`);
  },

  /**
   * Delete the transcript, from wherever its menu stands. From the workbench
   * this leads to the witness's page; from a list (`stay`) the list stays,
   * and is told.
   */
  delete: async (event) => {
    const data = await loadWorkbench(event.locals.db, event.locals.user, event.params.id);
    if (!data) throw error(404, t.errors.notFound);
    if (!data.canDelete) throw error(403, t.errors.forbidden);
    const stay = (await event.request.formData()).get('stay') === '1';
    // The registry's rule: not while an edition compares it, for that edition would lose a witness.
    const result = await deleteRegisteredTranscription(
      event.locals.db,
      data.transcription.id,
      event.locals.user,
    );
    if (!result.ok) {
      if (result.error === 'in-conspectus')
        return fail(409, {
          error: registry.transcription.inConspectus({
            editions: result.editions.map((e) => e.title),
            hiddenEditions: result.hiddenEditions,
          }),
        });
      throw error(
        result.error === 'forbidden' ? 403 : 404,
        result.error === 'forbidden' ? t.errors.forbidden : t.errors.notFound,
      );
    }
    if (stay) return { message: recordActions.transcription.deleted };
    throw redirect(303, `/witnesses/${data.witness.slug}`);
  },

  teiPreview: async (event) => {
    const { data } = await editable(event);
    const form = await event.request.formData();
    try {
      const as = teiKindOf(form);
      if (!as) return fail(400, { message: t.importer.tei.needKind });
      const xml = await teiText(form);
      const preview = await teiPreview(
        event.locals.db,
        await workOf(event, form),
        xml,
        mappingOf(form),
        as,
      );
      return { teiPreview: preview };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return fail(400, {
        message: cause instanceof SourceError ? message : t.importer.failed(message),
      });
    }
  },

  importTei: async (event) => {
    const { data, user } = await editable(event);
    const form = await event.request.formData();
    const as = teiKindOf(form);
    if (!as) return fail(400, { message: t.importer.tei.needKind });
    return imported(
      event,
      form,
      async () => {
        const xml = await teiText(form);
        return importTeiInto(event.locals.db, target(data, form, user.id), {
          xml,
          workId: await workOf(event, form),
          mapping: mappingOf(form) ?? {},
          as,
        });
      },
      as === 'transcript',
    );
  },

  importText: async (event) => {
    const { data, user } = await editable(event);
    const form = await event.request.formData();
    const body = await fileOrText(form, 'file', 'text');
    if (!body.trim()) return fail(400, { message: t.importer.emptyText });
    // The pattern is chosen by kind and found again here: no expression from the browser is run.
    const kind = text(form, 'pattern');
    const pattern = kind ? (detectNumbering(body).find((p) => p.kind === kind) ?? null) : null;
    const startLabel = text(form, 'startLabel').trim();
    const workId = await workOf(event, form);
    // Plain text is a text to start from: it has no source to record.
    return imported(
      event,
      form,
      () =>
        importPlainTextInto(event.locals.db, target(data, form, user.id), {
          text: body,
          pattern,
          workId,
          paragraphs: flag(form, 'paragraphs'),
          hyphenJoins: flag(form, 'hyphenJoins'),
          ...(startLabel ? { startLabel } : {}),
        }),
      false,
    );
  },

  importLeiden: async (event) => {
    const { data, user } = await editable(event);
    const form = await event.request.formData();
    const body = await fileOrText(form, 'file', 'text');
    if (!body.trim()) return fail(400, { message: t.importer.emptyText });
    return imported(event, form, () =>
      importLeidenInto(event.locals.db, target(data, form, user.id), body),
    );
  },

  importLayout: async (event) => {
    const { data, user } = await editable(event);
    const form = await event.request.formData();
    const xml = await fileOrText(form, 'file', 'xml');
    if (!xml.trim()) return fail(400, { message: t.importer.emptyText });
    const kind = layoutKind(xml) ?? undefined;
    return imported(event, form, () =>
      importLayoutInto(event.locals.db, target(data, form, user.id), xml, kind),
    );
  },
};
