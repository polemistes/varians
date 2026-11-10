/**
 * A printed page in the database, worked backwards: from a description of a
 * printed text and its apparatus (the lines, which witness reads what where,
 * the conjectures and the readings reported from sources that are not
 * transcribed) to what each manuscript must read, a transcript of each, an
 * edition made to read the printed text, and the records an editor would
 * enter. The apparatus Varians derives from them can then be set beside the
 * printed one (scripts/page.ts).
 *
 * Everything that is not a registry row is written through the services the
 * application itself uses, so that changesets, the segment index and the
 * adoption records are as the application makes them. Where the application
 * cannot take something as described, the nearest thing is done and
 * `deviations` in the result says so in general terms.
 *
 * The description is read in two steps: `parseDescription` checks its shape,
 * `planPage` works out the text of every witness and checks every entry
 * against it, naming the entry at fault. Neither touches the database.
 */

import {
  SCHEME_PRESETS,
  defaultProfile,
  newId,
  replaceAtSite,
  runsOfSegment,
  segmentIds as segmentIdsOf,
  trimPunctuation,
  type Collation,
  type Id,
  type Item,
  type Mark,
  type Obj,
  type Op,
  type Site,
  type Stream,
  type Token,
} from '@varians/core';
import {
  changesets,
  checkpoints,
  editions,
  moments,
  referenceSchemes,
  reviewState,
  sql,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  type ConjectureKind,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { moveLinesOps } from '../../edition/workspace.ts';
import { opsForAttachment, type SegmentForAdoption } from '../../edition/adopt-client.ts';
import { DEFAULT_SIGLA, plainLine, printLine, type EditionSigla } from '../../reader/marks.ts';
import { segmentItems } from '../../reader/export.ts';
import { editionUnits } from '../collation.ts';
import {
  adoptConjecture as recordAdoption,
  registerConjecture,
  reportReading,
} from '../conjectures.ts';
import { replaceContent, saveOps } from '../documents/service.ts';
import { createEdition, setSigla } from '../editions.ts';
import { resolveLabels, schemeOfWork } from '../segments.ts';
import { setChosenWorks } from '../transcription-works.ts';
import { DEFAULT_CONVENTIONS } from './sample.ts';
import { refuseDevelopmentDatabase } from './stress.ts';

// The description

const text = z.string().transform((s) => s.normalize('NFC'));
const optionalText = text.optional();
const line = z.string().min(1);

const descriptionSchema = z.object({
  work: z.object({
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/u, 'a slug is lower-case letters, digits, hyphens'),
    title: text,
    author: optionalText,
    language: z.string().default('grc'),
  }),
  edition: z.object({ title: text, base: text }),
  speakers: z.record(text, text).default({}),
  witnesses: z
    .array(
      z.object({
        siglum: text,
        name: text,
        transcribed: z.boolean(),
        note: optionalText,
      }),
    )
    .min(1),
  groups: z
    .array(z.object({ siglum: text, members: z.array(text), note: optionalText }))
    .default([]),
  conventions: z.object({ all: optionalText, rest: optionalText }).default({}),
  lines: z.array(z.object({ n: line, text })).min(1),
  variants: z
    .array(
      z.object({
        line,
        from: text,
        to: text,
        witnesses: z.array(text).min(1),
        assumed: z.boolean().optional(),
      }),
    )
    .default([]),
  lineOrder: z
    .array(
      z.object({
        witnesses: z.array(text).min(1),
        move: z.array(line).min(1),
        after: line,
        printed: optionalText,
      }),
    )
    .default([]),
  marginalia: z
    .array(
      z.object({
        line,
        witness: text,
        state: text,
        on: text,
        variant: text,
        note: optionalText,
      }),
    )
    .default([]),
  conjectures: z
    .array(
      z.object({
        line,
        lemma: optionalText,
        after: optionalText,
        reading: optionalText,
        for: optionalText,
        by: text,
        adopted: z.boolean(),
        kind: z
          .enum(['substitution', 'deletion', 'addition', 'lacuna', 'supplement', 'transposition'])
          .optional(),
        exempliGratia: optionalText,
        printed: optionalText,
        note: optionalText,
      }),
    )
    .default([]),
  reported: z
    .array(
      z.object({
        line,
        lines: z.array(line).optional(),
        lemma: optionalText,
        reading: text,
        source: text,
        witness: optionalText,
        withLemma: z.boolean().optional(),
        note: optionalText,
        printed: optionalText,
      }),
    )
    .default([]),
  speakerNotes: z.array(z.object({ line, printed: text, note: optionalText })).default([]),
  printed: z.record(z.string(), text).default({}),
});

export type PageDescription = z.infer<typeof descriptionSchema>;

/** The description as the application reads it, or an error that names each entry whose shape is wrong. */
export function parseDescription(json: unknown): PageDescription {
  const parsed = descriptionSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const where = (path: PropertyKey[]) =>
    path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`));
  throw new PageDescriptionError(
    parsed.error.issues.map((issue) => `${where(issue.path).join('')}: ${issue.message}`),
  );
}

export class PageDescriptionError extends Error {
  constructor(public readonly problems: string[]) {
    super(`the description cannot be used:\n  ${problems.join('\n  ')}`);
    this.name = 'PageDescriptionError';
  }
}

// The plan: what every witness reads, and every entry checked against it

/** A piece of a printed line: a word, a speaker's label, or the edition's lacuna mark. */
export type Piece =
  | { kind: 'word'; text: string }
  | { kind: 'speaker'; label: string }
  | { kind: 'lacuna' };

/** The pieces of a line as printed: `{Αρ.}`-style braces are a speaker, `{lacuna}` the lacuna mark. */
export function piecesOf(printed: string): Piece[] | string {
  const pieces: Piece[] = [];
  for (const match of printed.matchAll(/\{([^{}]*)\}|([^\s{}]+)|([{}])/gu)) {
    if (match[3] !== undefined) return 'a brace with no partner';
    if (match[2] !== undefined) pieces.push({ kind: 'word', text: match[2] });
    else if (match[1]!.trim() === 'lacuna') pieces.push({ kind: 'lacuna' });
    else if (match[1]!.trim() === '') return 'empty braces';
    else pieces.push({ kind: 'speaker', label: match[1]!.trim() });
  }
  return pieces;
}

export interface PlanLine {
  n: string;
  pieces: Piece[];
  /** The words of the printed line, without the speakers and the lacuna mark. */
  words: string[];
}

interface Marginal {
  line: string;
  /** The words the margin's variant is noted on: word indexes, end exclusive. */
  from: number;
  to: number;
  reading: string;
}

export interface PlanWitness {
  siglum: string;
  name: string;
  note: string | undefined;
  transcribed: boolean;
  /** The lines in the order this witness has them. */
  order: string[];
  /** What the witness reads at each line. */
  words: Map<string, string[]>;
  marginalia: Marginal[];
  /** The siglum of the variants the witness notes in its margin, when it has any. */
  variantSiglum: string | null;
}

export interface PlanConjecture {
  /** Position in the description; those made from an `exempliGratia` follow the description's own. */
  index: number;
  line: string;
  kind: ConjectureKind;
  adopted: boolean;
  proposer: string;
  /** The words the record is registered on. */
  lemma: string;
  reading: string;
  /** The base's words the conjecture replaces, where it is adopted by replacing words. */
  forWords: string[];
  after: string | null;
  /** The plan index of the lacuna a supplement offers to fill. */
  supplements: number | null;
}

export interface PlanReported {
  /** Position in the description. */
  index: number;
  line: string;
  lemma: string;
  reading: string;
  /** The source as printed, where the application is to print it after the witness. */
  source: string | null;
  /** The described witness the reading is reported for, or null for a source that is no witness of the description. */
  witness: string | null;
  /** For a source that is no witness of the description: the source, as the name of an indirect witness. */
  indirect: string | null;
  /** What the print says of the reading beside it ("but elsewhere otherwise"). */
  note: string | null;
}

export interface Plan {
  description: PageDescription;
  lines: PlanLine[];
  lineByN: Map<string, PlanLine>;
  witnesses: PlanWitness[];
  base: PlanWitness;
  conjectures: PlanConjecture[];
  reported: PlanReported[];
  /** What the application cannot take as described, in general terms, once each. */
  deviations: string[];
}

/** How many times `needle` occurs in `hay`, the occurrences allowed to overlap. */
export function occurrences(hay: string, needle: string): number {
  if (needle === '') return 0;
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) n++;
  return n;
}

/** A word as lemmas and conjectures name it: without the punctuation that stands at its edges, but with its elision marks. */
export const wordKey = (word: string | undefined): string =>
  word === undefined ? '' : trimPunctuation(word).normalize('NFC');

/**
 * Where a run of words begins in a list of words, optionally only after a
 * given word. Words are compared as lemmas name them, without the sentence
 * punctuation the printed word carries.
 */
export function findWords(
  words: readonly string[],
  run: readonly string[],
  after?: string,
): number[] {
  const found: number[] = [];
  if (run.length === 0) return found;
  for (let i = 0; i + run.length <= words.length; i++) {
    if (!run.every((w, k) => wordKey(words[i + k]) === wordKey(w))) continue;
    if (after !== undefined && wordKey(words[i - 1]) !== wordKey(after)) continue;
    found.push(i);
  }
  return found;
}

/**
 * Where in the words of the base an adopted conjecture's words stand. Where
 * they stand more than once and no "after" tells the places apart, the one
 * whose neighbours are the neighbours of the conjecture's reading in the
 * printed line.
 */
export function placesOfFor(
  words: readonly string[],
  c: Pick<PlanConjecture, 'forWords' | 'after' | 'reading'>,
  printed: readonly string[],
): number[] {
  const found = findWords(words, c.forWords, c.after ?? undefined);
  if (found.length <= 1) return found;
  const reading = wordsOfText(c.reading);
  const there = findWords(printed, reading);
  const narrowed = found.filter((i) =>
    there.some(
      (p) =>
        wordKey(words[i - 1]) === wordKey(printed[p - 1]) &&
        wordKey(words[i + c.forWords.length]) === wordKey(printed[p + reading.length]),
    ),
  );
  return narrowed.length > 0 ? narrowed : found;
}

/** The reading of a conjecture as it stands in the line: it takes over the punctuation that ended the words it replaces. */
export function readingInPlace(replacedLast: string | undefined, reading: string): string {
  const edge = /[,.;:!?··;…\-–—)\]»”"]+$/u;
  const trailing = replacedLast === undefined ? null : edge.exec(replacedLast)?.[0];
  return trailing && !edge.test(reading) ? reading + trailing : reading;
}

const wordsOfText = (s: string) => s.split(/\s+/u).filter((w) => w !== '');
const sameWords = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((w, i) => w === b[i]);

/** Work out what every witness reads, and check every entry of the description against that. */
export function planPage(d: PageDescription): Plan {
  const problems: string[] = [];
  const bad = (where: string, what: string) => problems.push(`${where}: ${what}`);
  const deviations = new Set<string>();

  // The lines
  const lines: PlanLine[] = [];
  const lineByN = new Map<string, PlanLine>();
  d.lines.forEach((entry, i) => {
    const where = `lines[${i}] (n ${entry.n})`;
    const pieces = piecesOf(entry.text);
    if (typeof pieces === 'string') return bad(where, pieces);
    const words = pieces.flatMap((p) => (p.kind === 'word' ? [p.text] : []));
    if (words.length === 0) return bad(where, 'the line has no words');
    if (lineByN.has(entry.n)) return bad(where, 'the number is used by an earlier line');
    for (const p of pieces)
      if (p.kind === 'speaker' && d.speakers[p.label] === undefined)
        bad(where, `the speaker {${p.label}} is not among the speakers`);
    const planned = { n: entry.n, pieces, words };
    lines.push(planned);
    lineByN.set(entry.n, planned);
  });
  const lineOf = (n: string, where: string): PlanLine | null => {
    const found = lineByN.get(n);
    if (!found) bad(where, `there is no line ${n}`);
    return found ?? null;
  };

  // The witnesses
  const witnessesBySiglum = new Map<string, PlanWitness>();
  const texts = new Map<string, Map<string, string>>();
  d.witnesses.forEach((w, i) => {
    if (witnessesBySiglum.has(w.siglum))
      return bad(`witnesses[${i}]`, `the siglum ${w.siglum} is used twice`);
    witnessesBySiglum.set(w.siglum, {
      siglum: w.siglum,
      name: w.name,
      note: w.note,
      transcribed: w.transcribed,
      order: lines.map((l) => l.n),
      words: new Map(),
      marginalia: [],
      variantSiglum: null,
    });
    texts.set(w.siglum, new Map(lines.map((l) => [l.n, l.words.join(' ')] as const)));
  });
  const witness = (siglum: string, where: string, transcribedOnly = true): PlanWitness | null => {
    const found = witnessesBySiglum.get(siglum);
    if (!found) bad(where, `the siglum ${siglum} is not among the witnesses`);
    else if (transcribedOnly && !found.transcribed)
      bad(where, `${siglum} is not transcribed, so it has no text to read otherwise`);
    return found && (!transcribedOnly || found.transcribed) ? found : null;
  };
  const base = witnessesBySiglum.get(d.edition.base);
  if (!base) bad('edition.base', `the siglum ${d.edition.base} is not among the witnesses`);
  else if (!base.transcribed) bad('edition.base', `${d.edition.base} is not transcribed`);
  d.groups.forEach((g, i) =>
    g.members.forEach((m) => {
      if (!witnessesBySiglum.has(m))
        bad(`groups[${i}] (${g.siglum})`, `the member ${m} is not among the witnesses`);
    }),
  );

  // Where the witnesses read otherwise: each variant, in the order given, on the text the witness has by then
  d.variants.forEach((v, i) => {
    const here = `variants[${i}] (line ${v.line}, from "${v.from}")`;
    if (!lineOf(v.line, here)) return;
    if (v.from === '') return bad(here, '"from" is empty');
    for (const siglum of v.witnesses) {
      const w = witness(siglum, here);
      if (!w) continue;
      const current = texts.get(siglum)!.get(v.line)!;
      const count = occurrences(current, v.from);
      if (count !== 1) {
        bad(
          here,
          `"from" occurs ${count} times in the line as ${siglum} has it by this point (it must occur once)`,
        );
        continue;
      }
      const at = current.indexOf(v.from);
      texts
        .get(siglum)!
        .set(v.line, current.slice(0, at) + v.to + current.slice(at + v.from.length));
    }
  });
  for (const w of witnessesBySiglum.values())
    for (const l of lines) {
      const words = wordsOfText(texts.get(w.siglum)!.get(l.n)!);
      if (words.length === 0 && w.transcribed)
        bad(`witness ${w.siglum}`, `the variants leave line ${l.n} without a word`);
      w.words.set(l.n, words);
    }

  // Lines a witness has elsewhere
  d.lineOrder.forEach((entry, i) => {
    const here = `lineOrder[${i}] (move ${entry.move.join(', ')} after ${entry.after})`;
    const known = [...entry.move, entry.after].every((n) => lineOf(n, here));
    if (entry.move.includes(entry.after)) return bad(here, 'a line cannot be moved after itself');
    if (!known) return;
    for (const siglum of entry.witnesses) {
      const w = witness(siglum, here);
      if (!w) continue;
      const rest = w.order.filter((n) => !entry.move.includes(n));
      rest.splice(rest.indexOf(entry.after) + 1, 0, ...entry.move);
      w.order = rest;
    }
  });

  // Variants noted in a margin
  d.marginalia.forEach((m, i) => {
    const here = `marginalia[${i}] (line ${m.line}, witness ${m.witness})`;
    const w = witness(m.witness, here);
    if (!w || !lineOf(m.line, here)) return;
    const own = w.words.get(m.line)!;
    const joined = own.join(' ');
    const count = occurrences(joined, m.on);
    if (count !== 1)
      return bad(here, `"on" occurs ${count} times in the witness's line (it must occur once)`);
    const run = wordsOfText(m.on);
    const starts = findWords(own, run);
    if (starts.length !== 1) return bad(here, '"on" does not stand on word boundaries');
    if (w.variantSiglum !== null && w.variantSiglum !== w.siglum + m.state)
      return bad(here, `${w.siglum} notes variants under two states`);
    w.variantSiglum = w.siglum + m.state;
    w.marginalia.push({
      line: m.line,
      from: starts[0]!,
      to: starts[0]! + run.length,
      reading: m.variant,
    });
  });

  // Conjectures
  const conjectures: PlanConjecture[] = [];
  const baseWords = (n: string) => base?.words.get(n) ?? [];
  d.conjectures.forEach((c, i) => {
    const here = `conjectures[${i}] (line ${c.line}, by ${c.by})`;
    const target = lineOf(c.line, here);
    if (!target) return;
    const after = c.after ?? null;
    const reading = c.reading ?? '';
    if (c.kind === 'lacuna') {
      if (after === null) return bad(here, 'a lacuna needs "after", the word it follows');
      const at = findWords(target.words, [after]);
      if (at.length !== 1)
        return bad(here, `"after" (${after}) stands ${at.length} times in the line`);
      if (c.adopted) {
        const marked = target.pieces.some(
          (p, k) =>
            p.kind === 'lacuna' &&
            target.pieces[k - 1]?.kind === 'word' &&
            wordKey((target.pieces[k - 1] as { text: string }).text) === wordKey(after),
        );
        if (!marked) return bad(here, `the line has no lacuna mark after ${after}`);
      }
      conjectures.push({
        index: i,
        line: c.line,
        kind: 'lacuna',
        adopted: c.adopted,
        proposer: c.by,
        lemma: after,
        reading: '',
        forWords: [],
        after,
        supplements: null,
      });
      return;
    }
    const forWords = wordsOfText(c.for ?? c.lemma ?? '');
    const lemma = (c.adopted ? forWords : wordsOfText(c.lemma ?? '')).join(' ');
    const kind: ConjectureKind =
      c.kind ??
      (reading === ''
        ? 'deletion'
        : lemma === '' && forWords.length === 0
          ? 'addition'
          : 'substitution');
    if (c.adopted && kind === 'deletion')
      return bad(here, 'an adopted deletion is not made by this seeder');
    if (c.adopted && kind === 'transposition')
      return bad(here, 'an adopted transposition of lines is not described by this format');
    if (c.adopted && forWords.length > 0) {
      const found = placesOfFor(baseWords(c.line), { forWords, after, reading }, target.words);
      if (found.length !== 1)
        return bad(
          here,
          `${d.edition.base}, the base, has the words "${forWords.join(' ')}" ${found.length} times in the line${after === null ? '' : ` after ${after}`} (they must stand once: give "after" to tell places apart)`,
        );
      const replaced = new Set(forWords.map(wordKey));
      const proposed = wordsOfText(reading);
      if (
        proposed.length === forWords.length &&
        !sameWords(forWords.map(wordKey), proposed.map(wordKey)) &&
        proposed.every((w) => replaced.has(wordKey(w)))
      )
        deviations.add(
          'a conjecture that only changes the order of words in a line is registered as a substitution: the application has no kind for a transposition of words within a segment',
        );
      if (kind === 'supplement')
        deviations.add(
          'a supplement that completes a word is adopted as the whole word, supplied: the application supplies whole words only',
        );
    } else if (c.adopted && after === null)
      return bad(here, 'an adopted conjecture that adds words needs "after", the word it follows');
    else if (c.adopted && findWords(baseWords(c.line), [after!]).length !== 1)
      return bad(here, `"after" (${after}) does not stand once in the line`);
    if (!c.adopted && lemma !== '') {
      const found = findWords(target.words, wordsOfText(lemma), after ?? undefined);
      if (found.length === 0)
        return bad(
          here,
          `the lemma "${lemma}" is not in the printed line${after === null ? '' : ` after ${after}`}`,
        );
      if (found.length > 1)
        return bad(
          here,
          `the lemma "${lemma}" stands ${found.length} times in the printed line (give "after" to tell places apart)`,
        );
    }
    conjectures.push({
      index: i,
      line: c.line,
      kind,
      adopted: c.adopted,
      proposer: c.by,
      lemma,
      reading,
      forWords,
      after,
      supplements: null,
    });
  });
  // What a lacuna's conjecturer offers to put there, as a supplement that names the lacuna it fills.
  d.conjectures.forEach((c, i) => {
    if (c.kind !== 'lacuna' || !c.exempliGratia) return;
    const lacuna = conjectures.find((x) => x.index === i);
    if (!lacuna) return;
    conjectures.push({
      index: d.conjectures.length + conjectures.length,
      line: c.line,
      kind: 'supplement',
      adopted: false,
      proposer: c.by,
      lemma: lacuna.lemma,
      reading: c.exempliGratia.replace(/[⟨⟩]/gu, '').trim(),
      forWords: [],
      after: lacuna.after,
      supplements: lacuna.index,
    });
  });

  // Readings reported for sources that are not transcribed
  const reported: PlanReported[] = [];
  d.reported.forEach((r, i) => {
    const here = `reported[${i}] (line ${r.line}, source ${r.source})`;
    const known = (r.lines ?? [r.line]).map((n) => lineOf(n, here));
    if (known.some((l) => l === null)) return;
    if (r.witness !== undefined && !witness(r.witness, here, false)) return;
    for (const target of known as PlanLine[]) {
      const lemma = r.lemma !== undefined ? r.lemma : target.words.join(' ');
      if (r.withLemma && r.reading !== lemma)
        return bad(
          here,
          'the source is said to support the lemma, but its reading is not the lemma',
        );
      if (lemma !== '' && findWords(target.words, wordsOfText(lemma)).length === 0)
        return bad(here, `the lemma "${lemma}" is not in the printed line ${target.n}`);
      reported.push({
        index: i,
        line: target.n,
        lemma,
        reading: r.reading,
        source: r.witness === undefined || r.source === r.witness ? null : r.source,
        witness: r.witness ?? null,
        indirect: r.witness === undefined ? r.source : null,
        note: r.note ?? null,
      });
    }
  });
  if (reported.some((r) => r.indirect !== null))
    deviations.add(
      'a reading reported for a source that is none of the witnesses has a witness made for the source (category indirect, the source as its siglum): a reported reading needs a witness, and the application prints the siglum and then the source in brackets',
    );
  if (reported.some((r) => r.lemma !== '' && r.reading === ''))
    deviations.add(
      'an omission reported for a source is a reported reading with an empty reading, placed by its lemma',
    );
  if (d.conjectures.some((c) => c.kind === 'lacuna' && c.exempliGratia))
    deviations.add(
      'what the one who posits a lacuna offers to put there is a second conjecture, a supplement that names the lacuna and is not adopted',
    );
  if (Object.keys(d.speakers).length > 0)
    deviations.add(
      'a speaker is an object of the edition with the label as its text and the full name in its `who`: the application neither shows nor edits a speaker’s full name',
    );

  for (const l of lines)
    l.pieces.forEach((p, k) => {
      const before = l.pieces[k - 1];
      if (p.kind !== 'lacuna') return;
      const posited =
        before?.kind === 'word' &&
        conjectures.some(
          (c) =>
            c.line === l.n &&
            c.kind === 'lacuna' &&
            c.adopted &&
            wordKey(c.after ?? undefined) === wordKey(before.text),
        );
      if (!posited)
        deviations.add(
          'a lacuna mark of the edition that no adopted lacuna conjecture stands behind is put in the text as a bare lacuna object',
        );
    });

  if (problems.length > 0) throw new PageDescriptionError(problems);
  return {
    description: d,
    lines,
    lineByN,
    witnesses: [...witnessesBySiglum.values()],
    base: base!,
    conjectures,
    reported,
    deviations: [...deviations],
  };
}

// Words compared

/** The pairs of equal words that a longest common subsequence of two lists pairs up. */
export function matchedPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const longest = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      longest[i]![j] =
        a[i] === b[j]
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/** Where two lists of words differ: each stretch of the first and the stretch of the second that stands in its place. */
export function hunksOf(
  a: readonly string[],
  b: readonly string[],
): { a0: number; a1: number; b0: number; b1: number }[] {
  const hunks: { a0: number; a1: number; b0: number; b1: number }[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...matchedPairs(a, b), [a.length, b.length] as [number, number]]) {
    if (pi > i || pj > j) hunks.push({ a0: i, a1: pi, b0: j, b1: pj });
    i = pi + 1;
    j = pj + 1;
  }
  return hunks;
}

// The seeder

export const PAGE_REASON = 'reconstructed from the printed page';

export interface PageSeedOptions {
  /** Where to say what is being done; nothing is printed when absent. */
  log?: (message: string) => void;
}

export interface PageSeedResult {
  workId: string;
  slug: string;
  editionId: string;
  editionSlug: string;
  /** Witness ids by siglum, the sources made witnesses by their source as printed. */
  witnessIds: Record<string, string>;
  /** Transcript ids by siglum; none for a witness that is only cited. */
  transcriptionIds: Record<string, string>;
  /** Segment ids by the line's number. */
  segmentIds: Record<string, string>;
  /** Conjecture ids in the plan's order: the description's own, then those made from an exempli gratia. */
  conjectureIds: string[];
  /** Reported reading ids in the plan's order. */
  reportedIds: string[];
  /** The groups and the conventions of the description, which the edition cannot hold yet. */
  groups: PageDescription['groups'];
  conventions: PageDescription['conventions'];
  /** What the application cannot take as described, and what was done instead. */
  deviations: string[];
  /** What was done, in numbers; empty when the work existed already. */
  done: Record<string, number>;
  /** Whether the work was there already and nothing was written. */
  existed: boolean;
}

interface Seeding {
  db: Database;
  ownerId: string;
  plan: Plan;
  log: (message: string) => void;
  workId: string;
  segmentOf: Map<string, string>;
  witnessId: Map<string, string>;
  transcriptionId: Map<string, string>;
  /** The ids of the tokens of each transcript's lines, by siglum and line, one per word. */
  tokenIds: Map<string, Map<string, string[]>>;
  editionId: string;
  version: number;
  content: Stream;
  /** The sources made witnesses, in the order made. */
  indirect: string[];
  conjectureId: Map<number, string>;
  reportedId: string[];
  done: Record<string, number>;
}

const count = (s: Seeding, what: string, n = 1) => (s.done[what] = (s.done[what] ?? 0) + n);

/** Seed what the description describes, owned by the given user. Idempotent by the work's slug. */
export async function seedPage(
  db: Database,
  ownerId: string,
  description: PageDescription,
  options: PageSeedOptions = {},
): Promise<PageSeedResult> {
  await refuseDevelopmentDatabase(db);
  const plan = planPage(description);
  const slug = description.work.slug;
  const existing = await db.select({ id: works.id }).from(works).where(eq(works.slug, slug));
  if (existing.length) return describeExisting(db, plan, existing[0]!.id);

  const s: Seeding = {
    db,
    ownerId,
    plan,
    log: options.log ?? (() => {}),
    workId: newId(),
    segmentOf: new Map(),
    witnessId: new Map(),
    transcriptionId: new Map(),
    tokenIds: new Map(),
    editionId: '',
    version: 0,
    content: { items: [] },
    indirect: [],
    conjectureId: new Map(),
    reportedId: [],
    done: {},
  };
  await makeWork(s);
  await makeWitnesses(s);
  await makeTranscripts(s);
  await makeEdition(s);
  await putLinesInOrder(s);
  s.log('lines in order');
  for (const l of plan.lines) await readPrintedLine(s, l);
  s.log('the edition reads the printed text');
  await placeObjects(s);
  await registerTheRest(s);
  verify(s);
  await writeGroupsAndConventions(s.db, s.editionId, description.groups, description.conventions);
  const [edition] = await db
    .select({ slug: editions.slug })
    .from(editions)
    .where(eq(editions.id, s.editionId));
  return {
    workId: s.workId,
    slug,
    editionId: s.editionId,
    editionSlug: edition!.slug,
    witnessIds: Object.fromEntries(s.witnessId),
    transcriptionIds: Object.fromEntries(s.transcriptionId),
    segmentIds: Object.fromEntries(s.segmentOf),
    conjectureIds: plan.conjectures.map((c) => s.conjectureId.get(c.index)!),
    reportedIds: s.reportedId,
    groups: description.groups,
    conventions: description.conventions,
    deviations: plan.deviations,
    done: s.done,
    existed: false,
  };
}

/**
 * Take a seeded page out of the database again, with everything made for it:
 * the work, its witnesses and their transcripts, the edition, the histories
 * and the scheme. For a seeding that was interrupted, or to seed again.
 */
export async function removePage(db: Database, slug: string): Promise<void> {
  await refuseDevelopmentDatabase(db);
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const workRows = await db.select({ id: works.id }).from(works).where(eq(works.slug, slug));
  const workIds = workRows.map((w) => w.id);
  const witnessRows = await db
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(sql`${witnesses.slug} ~ ${`^${escaped}-[wr][0-9]+$`}`);
  const witnessIds = witnessRows.map((w) => w.id);
  const editionRows = workIds.length
    ? await db.select({ id: editions.id }).from(editions).where(inArray(editions.workId, workIds))
    : [];
  const transcriptionRows = witnessIds.length
    ? await db
        .select({ id: transcriptions.id })
        .from(transcriptions)
        .where(inArray(transcriptions.witnessId, witnessIds))
    : [];
  const documentIds = [...editionRows, ...transcriptionRows].map((d) => d.id);
  // History and the rest that points at documents by id alone, with no key to follow.
  if (documentIds.length) {
    await db.delete(changesets).where(inArray(changesets.documentId, documentIds));
    await db.delete(checkpoints).where(inArray(checkpoints.documentId, documentIds));
    await db.delete(moments).where(inArray(moments.documentId, documentIds));
    await db.delete(reviewState).where(inArray(reviewState.documentId, documentIds));
  }
  if (workIds.length) await db.delete(works).where(inArray(works.id, workIds));
  if (witnessIds.length) await db.delete(witnesses).where(inArray(witnesses.id, witnessIds));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.name, schemeName(slug)));
}

const schemeName = (slug: string) => `${SCHEME_PRESETS[1]!.name} (${slug})`;

async function describeExisting(db: Database, plan: Plan, workId: string): Promise<PageSeedResult> {
  const slug = plan.description.work.slug;
  const [edition] = await db
    .select({ id: editions.id, slug: editions.slug })
    .from(editions)
    .where(eq(editions.workId, workId));
  const witnessRows = await db
    .select({ id: witnesses.id, siglum: witnesses.siglum })
    .from(witnesses)
    .where(sql`${witnesses.slug} like ${`${slug}-w%`}`);
  const transcriptionRows = witnessRows.length
    ? await db
        .select({ id: transcriptions.id, witnessId: transcriptions.witnessId })
        .from(transcriptions)
        .where(
          inArray(
            transcriptions.witnessId,
            witnessRows.map((w) => w.id),
          ),
        )
    : [];
  const siglumOf = new Map(witnessRows.map((w) => [w.id, w.siglum] as const));
  return {
    workId,
    slug,
    editionId: edition?.id ?? '',
    editionSlug: edition?.slug ?? '',
    witnessIds: Object.fromEntries(witnessRows.map((w) => [w.siglum, w.id])),
    transcriptionIds: Object.fromEntries(
      transcriptionRows.map((t) => [siglumOf.get(t.witnessId)!, t.id]),
    ),
    segmentIds: {},
    conjectureIds: [],
    reportedIds: [],
    groups: plan.description.groups,
    conventions: plan.description.conventions,
    deviations: plan.deviations,
    done: {},
    existed: true,
  };
}

// The work, its segments and its witnesses

async function makeWork(s: Seeding): Promise<void> {
  const { db, ownerId, plan } = s;
  const d = plan.description;
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: schemeName(d.work.slug),
    levels: SCHEME_PRESETS[1]!.scheme.levels,
    createdBy: ownerId,
  });
  await db.insert(works).values({
    id: s.workId,
    slug: d.work.slug,
    title: d.work.title,
    author: d.work.author ?? null,
    language: d.work.language,
    schemeId,
    profile: defaultProfile(d.work.language),
    createdBy: ownerId,
  });
  await db.insert(workMaintainers).values({ workId: s.workId, userId: ownerId });
  const labels = plan.lines.map((l) => l.n);
  const map = await resolveLabels(db, await schemeOfWork(db, s.workId), labels);
  for (const n of labels) {
    const segment = map.get(n);
    if (!segment)
      throw new PageDescriptionError([`lines: the number ${n} is not a label of the scheme`]);
    s.segmentOf.set(n, segment.id);
  }
  count(s, 'segments', map.size);
}

async function makeWitnesses(s: Seeding): Promise<void> {
  const { db, ownerId, plan } = s;
  const slug = plan.description.work.slug;
  let k = 0;
  const make = async (
    siglum: string,
    name: string,
    fields: { category: 'manuscript' | 'indirect'; description?: string },
    prefix: 'w' | 'r',
  ) => {
    const id = newId();
    await db.insert(witnesses).values({
      id,
      slug: `${slug}-${prefix}${++k}`,
      siglum,
      name,
      category: fields.category,
      description: fields.description ?? null,
      createdBy: ownerId,
    });
    await db.insert(witnessMaintainers).values({ witnessId: id, userId: ownerId });
    s.witnessId.set(siglum, id);
    count(s, 'witnesses');
  };
  for (const w of plan.witnesses)
    await make(
      w.siglum,
      w.name,
      { category: 'manuscript', ...(w.note ? { description: w.note } : {}) },
      'w',
    );
  // A source that is none of the witnesses, and so has none: a witness made for it, named as it is printed.
  for (const source of new Set(plan.reported.flatMap((r) => (r.indirect ? [r.indirect] : [])))) {
    await make(source, source, { category: 'indirect' }, 'r');
    s.indirect.push(source);
  }
}

/** The siglum a reported reading is printed under: the witness's own, or the source made a witness. */
function reportedFor(r: PlanReported): string {
  return r.witness ?? r.indirect!;
}

// The transcripts

async function makeTranscripts(s: Seeding): Promise<void> {
  const { db, ownerId, plan } = s;
  let group = 0;
  for (const w of plan.witnesses) {
    if (!w.transcribed) continue;
    const ids = new Map<string, string[]>();
    const items: Item[] = [];
    for (const n of w.order) {
      if (items.length > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
      const words = w.words.get(n)!;
      const tokens: Token[] = words.map((form) => ({ kind: 'token', id: newId(), form }));
      tokens[0]!.segment = { segmentId: s.segmentOf.get(n)! };
      ids.set(
        n,
        tokens.map((t) => t.id),
      );
      for (const m of w.marginalia.filter((m) => m.line === n)) {
        const mark: Mark = {
          kind: 'variant',
          attrs: { group: `v${++group}`, reading: m.reading, place: 'margin' },
        };
        for (const t of tokens.slice(m.from, m.to)) t.marks = [...(t.marks ?? []), { ...mark }];
        count(s, 'variants noted in a margin');
      }
      items.push(...tokens);
    }
    s.tokenIds.set(w.siglum, ids);
    const id = newId();
    s.transcriptionId.set(w.siglum, id);
    await db.insert(transcriptions).values({
      id,
      witnessId: s.witnessId.get(w.siglum)!,
      name: `${w.name}, as the printed page implies`,
      description:
        'Reconstructed from a printed text and its apparatus; not read from the witness.',
      ownerId,
      visibility: 'draft',
    });
    await setChosenWorks(db, id, [s.workId]);
    await replaceContent(db, 'transcription', id, ownerId, 0, { items }, PAGE_REASON);
    count(s, 'transcripts');
    count(s, 'words in transcripts', items.filter((i) => i.kind === 'token').length);
  }
}

// The edition

async function makeEdition(s: Seeding): Promise<void> {
  const { db, ownerId, plan } = s;
  const d = plan.description;
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, ownerId));
  const edition = await createEdition(
    db,
    {
      workId: s.workId,
      title: d.edition.title,
      slug: `${d.work.slug}-edition`,
      editors: [owner?.name ?? 'Editor'],
      preface: 'Made to read a printed text, to be set beside its apparatus. Not a text.',
      baseTranscriptionId: s.transcriptionId.get(d.edition.base)!,
      sigla: [],
      // A negative apparatus names the witnesses that differ; the printed ones that agree are not listed. Interpretative variants stay among the others, as the printed page has them.
      conventions: { ...DEFAULT_CONVENTIONS, apparatus: 'negative', interpretative: 'apparatus' },
    },
    ownerId,
  );
  s.editionId = edition.id;
  // The conspectus names every witness, those only cited and the sources made witnesses too: a reported reading is printed under the siglum the conspectus gives its witness.
  const conspectus = [
    ...plan.witnesses.map((w) => ({ siglum: w.siglum, variantSiglum: w.variantSiglum })),
    ...s.indirect.map((siglum) => ({ siglum, variantSiglum: null })),
  ];
  await setSigla(
    db,
    edition.id,
    conspectus.map((w) => ({
      witnessId: s.witnessId.get(w.siglum)!,
      transcriptionId: s.transcriptionId.get(w.siglum) ?? null,
      siglum: w.siglum,
      states: [],
      variantSiglum: w.variantSiglum,
    })),
  );
  count(s, 'sigla', conspectus.length);
  const loaded = await loadEdition(s);
  s.content = loaded.content;
  s.version = loaded.version;
}

async function loadEdition(s: Seeding): Promise<{ content: Stream; version: number }> {
  const [row] = await s.db
    .select({ content: editions.content, version: editions.version })
    .from(editions)
    .where(eq(editions.id, s.editionId));
  return { content: row!.content, version: row!.version };
}

async function saveEdition(s: Seeding, ops: Op[], message: string): Promise<void> {
  if (ops.length === 0) return;
  const result = await saveOps(s.db, 'edition', s.editionId, s.ownerId, s.version, ops, message);
  s.version = result.version;
  s.content = result.content;
  count(s, 'edition changesets');
}

/** The lines of the edition's text in the order they stand, by number. */
function editionOrder(s: Seeding): string[] {
  const byId = new Map([...s.segmentOf].map(([n, id]) => [id, n] as const));
  return segmentIdsOf(s.content).map((id) => byId.get(id)!);
}

/** The first token of a line of the edition. */
function firstTokenOf(s: Seeding, n: string): Token {
  const run = runsOfSegment(s.content, s.segmentOf.get(n)!)[0]!;
  return s.content.items.slice(run.from, run.to).find((i): i is Token => i.kind === 'token')!;
}

/** The edition starts in the order of the base witness; the printed order is the order of the lines, and lines are moved to it as an editor moves them. */
async function putLinesInOrder(s: Seeding): Promise<void> {
  const wanted = s.plan.lines.map((l) => l.n);
  for (let i = 0; i < wanted.length; i++) {
    let at = editionOrder(s).indexOf(wanted[i]!);
    while (at > i) {
      const moved = moveLinesOps(s.content, [firstTokenOf(s, wanted[i]!).id], -1);
      await saveEdition(s, moved, `line ${wanted[i]} moved up`);
      count(s, 'lines moved');
      at--;
    }
  }
}

// Making the base read the printed text

const freeSite = (baseFrom: number, baseTo: number): Site => ({
  index: -1,
  columnFrom: 0,
  columnTo: 0,
  baseFrom,
  baseTo,
  readings: [],
  kind: 'textual',
});

/** What adopting at a line needs: its words as the edition has them now. There is no collation to consult for that. */
function adoptionOf(s: Seeding, n: string): SegmentForAdoption {
  return {
    segmentId: s.segmentOf.get(n)!,
    collation: { sites: [] } as unknown as Collation,
    baseUnits: editionUnits(s.content, s.segmentOf.get(n)!),
    attachments: {},
  };
}

/**
 * A line of the edition made to read the printed one: first the conjectures
 * the edition adopts, each registered where the words stand and put in the
 * text as the editor puts one, then every other difference taken from a
 * witness that reads the printed words there, or typed where none does.
 */
async function readPrintedLine(s: Seeding, line: PlanLine): Promise<void> {
  for (const c of s.plan.conjectures.filter(
    (c) => c.line === line.n && c.adopted && c.kind !== 'lacuna',
  ))
    await adoptByConjecture(s, c);
  for (let guard = 0; guard < 100; guard++) {
    const adoption = adoptionOf(s, line.n);
    const hunks = hunksOf(
      adoption.baseUnits.map((u) => u.text),
      line.words,
    );
    if (hunks.length === 0) return;
    const { a0, b0 } = hunks[0]!;
    let { a1, b1 } = hunks[0]!;
    // Words put in at the very start would stand outside the line's run; the line's first word is replaced with them.
    if (a0 === 0 && a1 === 0) {
      a1 = 1;
      b1 = b1 + 1;
    }
    const wanted = line.words.slice(b0, b1);
    const source = wanted.length > 0 ? witnessWith(s, line, b0, b1) : null;
    const items: Item[] = wanted.map((form, k) => ({
      kind: 'token',
      id: newId(),
      form,
      source: source
        ? {
            kind: 'witness',
            transcriptionId: s.transcriptionId.get(source.siglum)!,
            tokenIds: [source.ids[k]!],
          }
        : { kind: 'editor' },
    }));
    await saveEdition(
      s,
      replaceAtSite(s.content, freeSite(a0, a1), adoption.baseUnits, items),
      `line ${line.n} read as printed`,
    );
    count(s, source ? 'words taken from a witness' : 'words typed by the editor', wanted.length);
  }
  throw new Error(`line ${line.n} could not be made to read the printed text`);
}

/** The first witness, other than the base, that reads the printed words b0 to b1 of a line at that place, with the ids of its tokens. */
function witnessWith(
  s: Seeding,
  line: PlanLine,
  b0: number,
  b1: number,
): { siglum: string; ids: string[] } | null {
  for (const w of s.plan.witnesses) {
    if (!w.transcribed || w.siglum === s.plan.base.siglum) continue;
    const there = new Map(matchedPairs(line.words, w.words.get(line.n)!));
    const picked: number[] = [];
    for (let k = b0; k < b1; k++) {
      const j = there.get(k);
      if (j === undefined) break;
      picked.push(j);
    }
    if (picked.length !== b1 - b0 || picked.some((j, k) => j !== picked[0]! + k)) continue;
    // At the same place: a neighbour of the words is the neighbour in the witness too.
    const anchored =
      b0 === 0 ||
      there.get(b0 - 1) === picked[0]! - 1 ||
      b1 === line.words.length ||
      there.get(b1) === picked[picked.length - 1]! + 1;
    if (!anchored) continue;
    const ids = s.tokenIds.get(w.siglum)!.get(line.n)!;
    return { siglum: w.siglum, ids: picked.map((j) => ids[j]!) };
  }
  return null;
}

/** An adopted conjecture: registered anchored at the words it concerns, put in the text as the editor's adopt does, and recorded as adopted. */
async function adoptByConjecture(s: Seeding, c: PlanConjecture): Promise<void> {
  const adoption = adoptionOf(s, c.line);
  const words = adoption.baseUnits.map((u) => u.text);
  let from: number;
  let to: number;
  let anchor: Id[];
  if (c.forWords.length > 0) {
    const found = placesOfFor(words, c, s.plan.lineByN.get(c.line)!.words);
    if (found.length !== 1) throw new Error(`conjecture ${c.index}: its words are not in the text`);
    from = found[0]!;
    to = from + c.forWords.length;
    anchor = adoption.baseUnits.slice(from, to).flatMap((u) => u.tokenIds);
  } else {
    // Words added stand after the word named.
    const at = findWords(words, [c.after!]);
    if (at.length !== 1)
      throw new Error(`conjecture ${c.index}: the word it follows is not in the text`);
    from = to = at[0]! + 1;
    anchor = adoption.baseUnits[at[0]!]!.tokenIds;
  }
  const row = await registerConjecture(
    s.db,
    {
      workId: s.workId,
      segmentId: adoption.segmentId,
      kind: c.kind,
      lemma: c.lemma,
      reading: c.reading,
      proposer: c.proposer,
      anchor: { editionId: s.editionId, tokenIds: anchor },
    },
    s.ownerId,
  );
  s.conjectureId.set(c.index, row.id);
  const ops = opsForAttachment(s.content, adoption, freeSite(from, to), {
    kind: 'conjecture',
    id: row.id,
    text: c.forWords.length > 0 ? readingInPlace(words[to - 1], c.reading) : c.reading,
    name: c.proposer,
    conjectureKind: c.kind,
  });
  await saveEdition(s, ops, `line ${c.line}: a conjecture adopted`);
  await recordAdoption(s.db, s.editionId, row.id);
  count(s, `conjectures adopted (${c.kind})`);
}

// Speakers and lacunae: objects of the edition, put in last so that adopting never meets them

async function placeObjects(s: Seeding): Promise<void> {
  const { plan } = s;
  for (const line of plan.lines) {
    if (line.pieces.every((p) => p.kind === 'word')) continue;
    const segmentId = s.segmentOf.get(line.n)!;
    const adoption = adoptionOf(s, line.n);
    const run = runsOfSegment(s.content, segmentId)[0]!;
    const first = s.content.items[run.from]!;
    const ops: Op[] = [];
    let wordsBefore = 0;
    let waiting: Item[] = [];
    const flush = async () => {
      if (waiting.length === 0) return;
      if (wordsBefore === 0) {
        // Before the first word: the object opens the line, so it takes the line's segment start.
        const start = first.kind === 'token' || first.kind === 'object' ? first.segment : undefined;
        if (start) {
          const lead = waiting[0] as Obj;
          lead.segment = { ...start };
          ops.push({ t: 'set', id: first.id, fields: { segment: null } });
        }
        ops.push({
          t: 'insert',
          after: run.from > 0 ? s.content.items[run.from - 1]!.id : null,
          items: waiting,
        });
      } else {
        ops.push({
          t: 'insert',
          after: adoption.baseUnits[wordsBefore - 1]!.tokenIds.at(-1)!,
          items: waiting,
        });
      }
      waiting = [];
    };
    const lacunae: string[] = [];
    for (const piece of line.pieces) {
      if (piece.kind === 'word') {
        await flush();
        wordsBefore++;
        continue;
      }
      if (piece.kind === 'speaker') {
        waiting.push({
          kind: 'object',
          id: newId(),
          type: 'paratext',
          attrs: { type: 'speaker', who: s.plan.description.speakers[piece.label]! },
          text: piece.label,
        });
        count(s, 'speaker labels');
        continue;
      }
      // The lacuna mark: the adopted lacuna of the line that follows the word before it, or a bare mark.
      const before = line.words[wordsBefore - 1];
      const posited = plan.conjectures.find(
        (c) =>
          c.line === line.n &&
          c.kind === 'lacuna' &&
          c.adopted &&
          wordKey(c.after ?? undefined) === wordKey(before) &&
          before !== undefined,
      );
      const object: Obj = { kind: 'object', id: newId(), type: 'lacuna' };
      if (posited) {
        const row = await registerConjecture(
          s.db,
          {
            workId: s.workId,
            segmentId,
            kind: 'lacuna',
            lemma: posited.lemma,
            reading: '',
            proposer: posited.proposer,
            anchor: {
              editionId: s.editionId,
              tokenIds: adoption.baseUnits[wordsBefore - 1]!.tokenIds,
            },
          },
          s.ownerId,
        );
        s.conjectureId.set(posited.index, row.id);
        object.attrs = { conjectureId: row.id };
        lacunae.push(row.id);
      }
      waiting.push(object);
      count(s, posited ? 'lacunae posited' : 'lacuna marks');
    }
    await flush();
    await saveEdition(s, ops, `line ${line.n}: speakers and lacunae`);
    for (const id of lacunae) await recordAdoption(s.db, s.editionId, id);
  }
}

// What is not in the text: the conjectures the edition does not adopt, and the readings reported

async function registerTheRest(s: Seeding): Promise<void> {
  const { db, ownerId, plan } = s;
  const printed = (n: string) => plan.lineByN.get(n)!;
  const register = async (c: PlanConjecture) => {
    const line = printed(c.line);
    const run = c.kind === 'lacuna' || c.lemma === '' ? [] : wordsOfText(c.lemma);
    const units = editionUnits(s.content, s.segmentOf.get(c.line)!);
    let anchor: Id[] | null = null;
    if (c.after !== null) {
      const at =
        run.length > 0
          ? findWords(
              units.map((u) => u.text),
              run,
              c.after,
            )[0]
          : findWords(line.words, [c.after])[0];
      if (at !== undefined) {
        anchor =
          run.length > 0
            ? units.slice(at, at + run.length).flatMap((u) => u.tokenIds)
            : units[at]!.tokenIds;
      }
    }
    const row = await registerConjecture(
      db,
      {
        workId: s.workId,
        segmentId: s.segmentOf.get(c.line)!,
        kind: c.kind,
        lemma: c.lemma,
        reading: c.reading,
        proposer: c.proposer,
        supplementsId: c.supplements !== null ? (s.conjectureId.get(c.supplements) ?? null) : null,
        anchor: anchor ? { editionId: s.editionId, tokenIds: anchor } : null,
      },
      ownerId,
    );
    s.conjectureId.set(c.index, row.id);
    count(s, `conjectures not adopted (${c.kind})`);
  };
  // A supplement names the lacuna it fills, so the lacunae come first.
  const rest = plan.conjectures.filter((c) => !s.conjectureId.has(c.index));
  for (const c of rest.filter((c) => c.kind === 'lacuna')) await register(c);
  for (const c of rest.filter((c) => c.kind !== 'lacuna')) await register(c);
  for (const r of plan.reported) {
    const row = await reportReading(
      db,
      {
        workId: s.workId,
        segmentId: s.segmentOf.get(r.line)!,
        witnessId: s.witnessId.get(reportedFor(r))!,
        lemma: r.lemma,
        reading: r.reading,
        source: r.source,
        note: r.note,
      },
      ownerId,
    );
    s.reportedId.push(row.id);
    count(s, 'reported readings');
  }
}

// The text as a reader gets it, and the check that it is the printed text

/** A line of the edition as a reader gets it: its words, speakers and lacuna marks, in the edition's sigla. */
export function readerLine(
  content: Stream,
  segmentId: string,
  sigla: EditionSigla = DEFAULT_SIGLA,
): string {
  const items = segmentItems(content).find((x) => x.segmentId === segmentId)?.items ?? [];
  const printedLines: Item[][] = [[]];
  for (const item of items) {
    if (item.kind === 'break') printedLines.push([]);
    else printedLines[printedLines.length - 1]!.push(item);
  }
  return printedLines
    .map((l) => plainLine(printLine(l, sigla)))
    .filter((l) => l.trim() !== '')
    .join(' ');
}

/** The line as printed, as a reader of the edition gets it: the speakers' labels and the lacuna mark stand, and a supplement is not bracketed. */
export function expectedLine(line: PlanLine, sigla: EditionSigla = DEFAULT_SIGLA): string {
  return line.pieces
    .map((p) => (p.kind === 'word' ? p.text : p.kind === 'speaker' ? p.label : sigla.lacuna))
    .join(' ');
}

function verify(s: Seeding): void {
  for (const line of s.plan.lines) {
    const segmentId = s.segmentOf.get(line.n)!;
    const read = readerLine(s.content, segmentId).replace(/[⟨⟩]/gu, '').replace(/\s+/gu, ' ');
    if (read !== expectedLine(line))
      throw new Error(`line ${line.n}: the edition reads "${read}", not the printed text`);
  }
  const order = editionOrder(s);
  const wanted = s.plan.lines.map((l) => l.n);
  if (order.join(' ') !== wanted.join(' '))
    throw new Error('the edition does not have the lines in the printed order');
}

// The conventions

/**
 * NOT YET. The conventions of an edition cannot hold a family siglum (the
 * description's `groups`) or the words for "all the manuscripts" and "the
 * rest" (`conventions`): that is being built in the core and the schema. This
 * is the one place where they will be written to the edition; until then it
 * does nothing, and the seeder returns both in its result.
 */
export async function writeGroupsAndConventions(
  db: Database,
  editionId: string,
  groups: PageDescription['groups'],
  conventions: PageDescription['conventions'],
): Promise<void> {
  void [db, editionId, groups, conventions];
}
