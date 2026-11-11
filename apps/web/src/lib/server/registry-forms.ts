/**
 * The registry's forms as actions carry them out: a work, a witness or a
 * transcript made from a form's fields, or the errors by field with what was
 * typed. The full pages (New Work, New Witness, a witness's New Transcript)
 * and the windows over Make New Edition and Edition Settings share these, so
 * that a record is checked and made the same way wherever it is made.
 */
import { transcriptions, works, type Transcription, type Witness, type Work } from '@varians/db';
import { eq } from 'drizzle-orm';
import {
  field,
  parseSchemeChoice,
  parseTranscriptionForm,
  parseWitnessForm,
  parseWorkForm,
  WITNESS_FIELDS,
  type FieldErrors,
} from '$lib/registry/forms';
import { registry as t } from '$lib/strings/registry';
import {
  canCreateRegistryEntry,
  canViewTranscription,
  canViewWork,
  grantsFor,
  type Actor,
} from './authz.ts';
import { createTranscription, createWitness, createWork, RegistryError } from './registry.ts';
import type { Database } from '@varians/db';

const WORK_FIELDS = [
  'title',
  'author',
  'language',
  'languageCode',
  'identifier',
  'identifiers',
  'description',
  'visibility',
  'scheme',
  'levels',
];

export type Made<T> =
  | { ok: true; record: T }
  | {
      ok: false;
      status: 400 | 403 | 404;
      errors?: FieldErrors;
      /** A refusal that belongs to no field. */
      error?: string;
      values?: Record<string, string>;
    };

/** A work registered from the fields of the New Work form, with its reference scheme. */
export async function workFromForm(db: Database, user: Actor, form: FormData): Promise<Made<Work>> {
  if (!canCreateRegistryEntry(user)) return { ok: false, status: 403, error: t.common.forbidden };
  const values = Object.fromEntries(WORK_FIELDS.map((name) => [name, field(form, name)]));
  const parsed = parseWorkForm(form);
  const scheme = parseSchemeChoice(form);
  if (!parsed.ok || !scheme.ok) {
    return {
      ok: false,
      status: 400,
      errors: {
        ...(parsed.ok ? {} : parsed.errors),
        ...(scheme.ok ? {} : { scheme: scheme.errors }),
      },
      values,
    };
  }
  try {
    const work = await createWork(db, { ...parsed.data, scheme: scheme.scheme }, user.id);
    return { ok: true, record: work };
  } catch (e) {
    if (e instanceof RegistryError && (e.code === 'invalid-scheme' || e.code === 'unknown-preset'))
      return {
        ok: false,
        status: 400,
        errors: { scheme: e.problems.length ? e.problems : [t.scheme.invalid] },
        values,
      };
    throw e;
  }
}

/** A witness registered from the fields of the New Witness form. */
export async function witnessFromForm(
  db: Database,
  user: Actor,
  form: FormData,
): Promise<Made<Witness>> {
  if (!canCreateRegistryEntry(user)) return { ok: false, status: 403, error: t.common.forbidden };
  const parsed = parseWitnessForm(form);
  if (!parsed.ok)
    return {
      ok: false,
      status: 400,
      errors: parsed.errors,
      values: Object.fromEntries(WITNESS_FIELDS.map((name) => [name, field(form, name)])),
    };
  return { ok: true, record: await createWitness(db, parsed.data, user.id) };
}

/**
 * A transcript of a witness made from the fields of the New Transcript form:
 * its name, its work, whether it keeps a diplomatic form, and the transcript
 * it starts from, which must be one the person may view.
 */
export async function transcriptionFromForm(
  db: Database,
  user: Actor,
  witnessId: string,
  form: FormData,
): Promise<Made<Transcription>> {
  const parsed = parseTranscriptionForm(form);
  if (!parsed.ok) return { ok: false, status: 400, errors: parsed.errors, values: parsed.values };
  const d = parsed.data;
  const grants = await grantsFor(db, user);
  if (d.fromTranscriptionId) {
    const [source] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, d.fromTranscriptionId));
    if (!source || !canViewTranscription(user, source, grants))
      return {
        ok: false,
        status: 403,
        errors: { fromTranscriptionId: [t.transcription.sourceNotAllowed] },
      };
  }
  if (d.workId) {
    const [work] = await db.select().from(works).where(eq(works.id, d.workId));
    if (!work || !canViewWork(user, work, [], grants))
      return { ok: false, status: 400, errors: { workId: [t.work.notFound] } };
  }
  try {
    const created = await createTranscription(
      db,
      {
        witnessId,
        workIds: d.workId ? [d.workId] : undefined,
        name: d.name,
        keepsWrittenForm: d.keepsWrittenForm,
        fromTranscriptionId: d.fromTranscriptionId,
      },
      user.id,
    );
    return { ok: true, record: created };
  } catch (e) {
    if (e instanceof RegistryError && e.code === 'not-found')
      return { ok: false, status: 404, error: t.witness.notFound };
    throw e;
  }
}
