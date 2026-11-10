/**
 * The registry's forms as the server reads them: one parser per form,
 * returning the clean values or the errors by field with what was typed, so
 * that a page can show the form again. Pure; the actions call these and the
 * tests check them without a request.
 */
import { z } from 'zod';
import { SCHEME_PRESETS, type Level } from '@varians/core';
import type { WitnessHand } from '@varians/db';
import { registry as t } from '$lib/strings/registry';
import { CUSTOM_SCHEME, LANGUAGE_OTHER } from './constants';
import { parseIdentifiers, type CanonicalIdentifier } from './identifiers';
import { LANGUAGE_CODE } from './languages';
import { parseLevels, schemeProblems } from './scheme';
import type { Dependents } from './types';
import {
  CONJECTURE_KINDS,
  isMaterialKey,
  MATERIAL_OTHER,
  parseHandsJson,
  WITNESS_CATEGORIES,
  type ConjectureKind,
  WITNESS_FORMATS,
  type WitnessCategory,
} from './witness';

export type FieldErrors = Record<string, string[] | undefined>;

export type Parsed<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors; values: Record<string, string> };

/** A text field of a form; anything else (a file, nothing) is empty. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** A checkbox: present and not "off". */
export function checked(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value !== null && value !== 'off' && value !== 'false';
}

function values(form: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, field(form, name)]));
}

const optional = (max: number, message: string) => z.string().trim().max(max, message);

function run<T>(
  schema: z.ZodType<T>,
  raw: Record<string, unknown>,
  typed: Record<string, string>,
): Parsed<T> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: z.flattenError(result.error).fieldErrors as FieldErrors,
    values: typed,
  };
}

// Works

const workSchema = z.object({
  title: z.string().trim().min(1, t.work.titleRequired).max(200, t.work.titleTooLong),
  author: optional(200, t.work.tooLong),
  language: z
    .string()
    .trim()
    .min(1, t.work.languageRequired)
    .max(40, t.work.languageInvalid)
    .regex(LANGUAGE_CODE, t.work.languageInvalid),
  identifier: optional(300, t.work.tooLong),
  description: optional(5000, t.work.tooLong),
  visibility: z.enum(['public', 'private']).default('public'),
});

export type WorkForm = z.infer<typeof workSchema> & { identifiers: CanonicalIdentifier[] };

const WORK_FIELDS = [
  'title',
  'author',
  'language',
  'languageCode',
  'identifier',
  'identifiers',
  'description',
  'visibility',
] as const;

/**
 * Title, author, language (a listed code, or Other with a code typed), the
 * primary identifier, the further identifiers, description, visibility.
 */
export function parseWorkForm(form: FormData): Parsed<WorkForm> {
  const choice = field(form, 'language');
  const language = choice === LANGUAGE_OTHER ? field(form, 'languageCode') : choice;
  const identifiers = parseIdentifiers(field(form, 'identifiers'));
  const parsed = run(
    workSchema,
    {
      title: field(form, 'title'),
      author: field(form, 'author'),
      language,
      identifier: field(form, 'identifier'),
      description: field(form, 'description'),
      visibility: field(form, 'visibility') || 'public',
    },
    values(form, WORK_FIELDS),
  );
  return withIdentifiers(parsed, identifiers, values(form, WORK_FIELDS));
}

/** A parsed form with the identifiers added, or their error beside the others. */
function withIdentifiers<T>(
  parsed: Parsed<T>,
  identifiers: ReturnType<typeof parseIdentifiers>,
  typed: Record<string, string>,
): Parsed<T & { identifiers: CanonicalIdentifier[] }> {
  if (!parsed.ok) {
    if (!identifiers.ok) parsed.errors.identifiers = [identifiers.error];
    return parsed;
  }
  if (!identifiers.ok)
    return { ok: false, errors: { identifiers: [identifiers.error] }, values: typed };
  return { ok: true, data: { ...parsed.data, identifiers: identifiers.identifiers } };
}

export { CUSTOM_SCHEME, LANGUAGE_OTHER };

export type SchemeChoice = { preset: string } | { levels: Level[] };

/**
 * The scheme field: a preset by name, or custom levels sent as JSON in
 * `levels`, checked as the editor checks them.
 */
export function parseSchemeChoice(
  form: FormData,
): { ok: true; scheme: SchemeChoice } | { ok: false; errors: string[] } {
  const choice = field(form, 'scheme');
  if (!choice) return { ok: false, errors: [t.scheme.required] };
  if (choice === CUSTOM_SCHEME) {
    const levels = parseLevels(field(form, 'levels'));
    if (!levels || levels.length === 0) return { ok: false, errors: [t.scheme.invalid] };
    const problems = schemeProblems(levels);
    if (problems.length) return { ok: false, errors: problems };
    return { ok: true, scheme: { levels } };
  }
  if (!SCHEME_PRESETS.some((p) => p.name === choice))
    return { ok: false, errors: [t.scheme.unknownPreset] };
  return { ok: true, scheme: { preset: choice } };
}

// Witnesses

const witnessSchema = z.object({
  siglum: z.string().trim().min(1, t.witness.siglumRequired).max(40, t.witness.tooLong),
  name: z.string().trim().min(1, t.witness.nameRequired).max(200, t.witness.tooLong),
  category: z.enum(WITNESS_CATEGORIES).default('manuscript'),
  format: z.enum(WITNESS_FORMATS).nullable(),
  sourceAuthor: optional(300, t.witness.tooLong),
  sourceWork: optional(300, t.witness.tooLong),
  repository: optional(300, t.witness.tooLong),
  settlement: optional(200, t.witness.tooLong),
  shelfmark: optional(200, t.witness.tooLong),
  identifier: optional(300, t.witness.tooLong),
  dateText: optional(200, t.witness.tooLong),
  material: optional(200, t.witness.tooLong),
  extent: optional(300, t.witness.tooLong),
  provenance: optional(5000, t.witness.tooLong),
  description: optional(5000, t.witness.tooLong),
});

export type WitnessForm = z.infer<typeof witnessSchema> & {
  category: WitnessCategory;
  hands: WitnessHand[];
  identifiers: CanonicalIdentifier[];
};

export const WITNESS_FIELDS = [
  'siglum',
  'name',
  'category',
  'format',
  'sourceAuthor',
  'sourceWork',
  'repository',
  'settlement',
  'shelfmark',
  'identifier',
  'identifiers',
  'dateText',
  'material',
  'materialOther',
  'extent',
  'hands',
  'provenance',
  'description',
] as const;

export function parseWitnessForm(form: FormData): Parsed<WitnessForm> {
  const typed = values(form, WITNESS_FIELDS);
  const category = typed.category || 'manuscript';
  // The material is a listed key, or the free text given under Other.
  const materialChoice = typed.material.trim();
  if (materialChoice !== '' && materialChoice !== MATERIAL_OTHER && !isMaterialKey(materialChoice))
    return { ok: false, errors: { material: [t.witness.materialInvalid] }, values: typed };
  const parsed = run(
    witnessSchema,
    {
      ...typed,
      category,
      // The format is a manuscript's; the quoting author and work an indirect source's.
      format: category === 'manuscript' ? typed.format || 'unknown' : null,
      material: materialChoice === MATERIAL_OTHER ? typed.materialOther : materialChoice,
      sourceAuthor: category === 'indirect' ? typed.sourceAuthor : '',
      sourceWork: category === 'indirect' ? typed.sourceWork : '',
    },
    typed,
  );
  const hands = parseHands(typed.hands);
  const identifiers = parseIdentifiers(typed.identifiers);
  if (!parsed.ok) {
    if (!hands.ok) parsed.errors.hands = [hands.error];
    if (!identifiers.ok) parsed.errors.identifiers = [identifiers.error];
    return parsed;
  }
  if (!hands.ok || !identifiers.ok) {
    return {
      ok: false,
      errors: {
        ...(hands.ok ? {} : { hands: [hands.error] }),
        ...(identifiers.ok ? {} : { identifiers: [identifiers.error] }),
      },
      values: typed,
    };
  }
  const {
    materialOther: _other,
    identifiers: _typed,
    ...data
  } = parsed.data as z.infer<typeof witnessSchema> & {
    materialOther?: string;
    identifiers?: unknown;
  };
  void _other;
  void _typed;
  return { ok: true, data: { ...data, hands: hands.hands, identifiers: identifiers.identifiers } };
}

const HAND_ID = /^[A-Za-z0-9_-]{1,32}$/u;
const MAX_HANDS = 20;

function newHandId(): string {
  return crypto.randomUUID().replace(/-/gu, '').slice(0, 8);
}

/**
 * The hands of a witness as the form sends them: a JSON list of label,
 * description and whether it is the main hand. Hands keep their ids, so that
 * the corrections in transcripts that name them stay attached; new ones get
 * an id here. Exactly one hand is the main hand when there are any.
 */
export function parseHands(
  raw: string,
): { ok: true; hands: WitnessHand[] } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, hands: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: t.witness.handsInvalid };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: t.witness.handsInvalid };
  if (parsed.length > MAX_HANDS) return { ok: false, error: t.witness.handsTooMany(MAX_HANDS) };
  const seen = new Set<string>();
  const hands: WitnessHand[] = [];
  for (const entry of parseHandsJson(raw)) {
    const label = entry.label.trim().replace(/\s+/gu, ' ');
    const description = entry.description?.trim() || null;
    if (!label) {
      if (!description) continue;
      return { ok: false, error: t.witness.handLabelRequired };
    }
    if (label.length > 40 || (description?.length ?? 0) > 500)
      return { ok: false, error: t.witness.tooLong };
    let id = HAND_ID.test(entry.id) && !seen.has(entry.id) ? entry.id : newHandId();
    while (seen.has(id)) id = newHandId();
    seen.add(id);
    hands.push({ id, label, description, main: entry.main });
  }
  const mains = hands.filter((h) => h.main);
  if (hands.length && mains.length !== 1) {
    const chosen = mains[0] ?? hands[0]!;
    for (const hand of hands) hand.main = hand === chosen;
  }
  return { ok: true, hands };
}

// Transcriptions

const transcriptionSchema = z.object({
  name: z.string().trim().min(1, t.transcription.nameRequired).max(200, t.witness.tooLong),
  workId: z.string().trim().max(64),
  keepsWrittenForm: z.boolean(),
  fromTranscriptionId: z.string().trim().max(64),
});

export interface TranscriptionForm {
  name: string;
  workId: string | null;
  keepsWrittenForm: boolean;
  fromTranscriptionId: string | null;
}

export function parseTranscriptionForm(form: FormData): Parsed<TranscriptionForm> {
  const typed = values(form, ['name', 'workId', 'fromTranscriptionId']);
  const parsed = run(
    transcriptionSchema,
    { ...typed, keepsWrittenForm: checked(form, 'keepsWrittenForm') },
    typed,
  );
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    data: {
      name: parsed.data.name,
      workId: parsed.data.workId || null,
      keepsWrittenForm: parsed.data.keepsWrittenForm,
      fromTranscriptionId: parsed.data.fromTranscriptionId || null,
    },
  };
}

export function parseName(form: FormData): Parsed<{ name: string }> {
  return run(
    z.object({
      name: z.string().trim().min(1, t.transcription.nameRequired).max(200, t.witness.tooLong),
    }),
    { name: field(form, 'name') },
    values(form, ['name']),
  );
}

// Conjectures and reported readings

const conjectureSchema = z
  .object({
    segment: z.string().trim().min(1, t.common.required).max(100, t.common.tooLong),
    kind: z.enum(CONJECTURE_KINDS),
    lemma: optional(500, t.common.tooLong),
    reading: optional(500, t.common.tooLong),
    proposer: optional(200, t.common.tooLong),
    note: optional(4000, t.common.tooLong),
    extent: optional(200, t.common.tooLong),
    published: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const needsLemma =
      value.kind === 'substitution' || value.kind === 'deletion' || value.kind === 'transposition';
    const needsReading =
      value.kind === 'substitution' || value.kind === 'addition' || value.kind === 'supplement';
    if (needsLemma && !value.lemma)
      ctx.addIssue({ code: 'custom', path: ['lemma'], message: t.conjecture.lemmaRequired });
    if (needsReading && !value.reading)
      ctx.addIssue({ code: 'custom', path: ['reading'], message: t.conjecture.readingRequired });
  });

export interface ConjectureForm {
  segment: string;
  kind: ConjectureKind;
  lemma: string;
  reading: string;
  proposer: string | null;
  note: string | null;
  /** Only for a lacuna. */
  extent: string | null;
  published: boolean;
}

const CONJECTURE_FIELDS = [
  'segment',
  'kind',
  'lemma',
  'reading',
  'proposer',
  'note',
  'extent',
] as const;

export function parseConjectureForm(form: FormData): Parsed<ConjectureForm> {
  const typed = values(form, CONJECTURE_FIELDS);
  const parsed = run(conjectureSchema, { ...typed, published: checked(form, 'published') }, typed);
  if (!parsed.ok) return parsed;
  const d = parsed.data;
  return {
    ok: true,
    data: {
      segment: d.segment,
      kind: d.kind,
      lemma: d.lemma,
      reading: d.kind === 'deletion' || d.kind === 'lacuna' ? '' : d.reading,
      proposer: d.proposer || null,
      note: d.note || null,
      extent: d.kind === 'lacuna' ? d.extent || null : null,
      published: d.published,
    },
  };
}

const readingSchema = z
  .object({
    segment: z.string().trim().min(1, t.common.required).max(100, t.common.tooLong),
    witnessId: z.string().trim().min(1, t.reading.witnessRequired).max(64),
    lemma: optional(500, t.common.tooLong),
    reading: optional(500, t.common.tooLong),
    source: optional(500, t.common.tooLong),
    note: optional(4000, t.common.tooLong),
    published: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.lemma && !value.reading) {
      ctx.addIssue({ code: 'custom', path: ['lemma'], message: t.reading.lemmaOrReading });
    }
  });

export interface ReadingForm {
  segment: string;
  witnessId: string;
  lemma: string;
  reading: string;
  source: string | null;
  note: string | null;
  published: boolean;
}

const READING_FIELDS = ['segment', 'witnessId', 'lemma', 'reading', 'source', 'note'] as const;

export function parseReadingForm(form: FormData): Parsed<ReadingForm> {
  const typed = values(form, READING_FIELDS);
  const parsed = run(readingSchema, { ...typed, published: checked(form, 'published') }, typed);
  if (!parsed.ok) return parsed;
  const d = parsed.data;
  return {
    ok: true,
    data: { ...d, source: d.source || null, note: d.note || null },
  };
}

// Citations

const citationsSchema = z
  .array(
    z.object({
      itemId: z.string().min(1).max(64),
      prenote: z.string().max(100).nullable().optional(),
      postnote: z.string().max(100).nullable().optional(),
    }),
  )
  .max(20);

export interface CitationField {
  itemId: string;
  prenote: string | null;
  postnote: string | null;
}

/**
 * The works a conjecture or reported reading cites, sent by the picker as
 * JSON in one hidden field `citations`. A form without the field cites
 * nothing.
 */
export function parseCitations(
  form: FormData,
): { ok: true; data: CitationField[] } | { ok: false; error: string } {
  const raw = field(form, 'citations').trim();
  if (!raw) return { ok: true, data: [] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: t.common.invalidCitations };
  }
  const parsed = citationsSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: t.common.invalidCitations };
  return {
    ok: true,
    data: parsed.data.map((c) => ({
      itemId: c.itemId,
      prenote: c.prenote?.trim() || null,
      postnote: c.postnote?.trim() || null,
    })),
  };
}

// Maintainers

export function parseEmail(form: FormData): Parsed<{ email: string }> {
  return run(
    z.object({ email: z.email(t.maintainers.invalidEmail).max(254, t.common.tooLong) }),
    { email: field(form, 'email').trim() },
    values(form, ['email']),
  );
}

// Refusals

/** What depends on an entry, in words: "the edition X, 2 transcriptions and a reported reading". */
export function describeDependents(d: Dependents, recordsName: 'conjectures' | 'readings'): string {
  return t.common.dependents({
    editions: d.editions.map((e) => e.title),
    transcriptions: d.transcriptions,
    records: d.records,
    recordsName,
  });
}

/** A local path with one query parameter set: /works/iliad?witness=01J... */
export function withParam(target: string, key: string, value: string): string {
  const url = new URL(target, 'http://local');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
