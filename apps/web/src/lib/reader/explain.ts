/**
 * A variant place explained in plain sentences, for the screen: what the
 * edition prints and on what authority, then one sentence per alternative
 * (a witness's reading, a reported reading, a conjecture), and the editor's
 * notes on the words. Built from the
 * collation site itself, not from the print apparatus, so that it carries
 * witness names rather than sigla and no Latin abbreviations. The popover
 * on a word and the list of variants both read it, so they never disagree.
 *
 * Sentences are lists of parts: plain text, a witness (its name, with the
 * siglum beside it), words of the text (set in the text's face). The wording
 * is in `reader.explain` in the strings.
 */
import {
  printedTextIds,
  trimPunctuation,
  type Attachment,
  type Reading,
  type Site,
  type VariantRelation,
} from '@varians/core';
import { reader as r } from '$lib/strings/reader';
import { editionTokensAt, siteKey, siteOf } from './sites';
import type { ReaderNote, ReaderSegment, ReaderSiglum } from './types';

export type Part =
  | { kind: 'text'; text: string }
  /** `atStart`: the name as it opens a sentence, where it differs ("A variant noted in …"). */
  | { kind: 'witness'; name: string; siglum: string; atStart?: string }
  | { kind: 'words'; text: string };

export type Sentence = Part[];

export interface ExplainLine {
  kind:
    | 'reads'
    | 'omits'
    | 'adds'
    | 'lost'
    | 'damaged'
    | 'order'
    | 'place'
    | 'reported'
    | 'conjecture'
    | 'absent';
  sentence: Sentence;
  /** What the line rests on, printed after it: "West 1998, 45". */
  references: string[];
}

export interface SiteExplanation {
  key: string;
  segmentId: string;
  siteIndex: number;
  label: string;
  /** The edition's words at the place, edge punctuation trimmed; empty where the edition has nothing (an addition). */
  words: string;
  /** For a place where the edition has nothing: the edition's word beside it. */
  place: { side: 'after' | 'before'; word: string } | null;
  /** What the edition prints and on what authority: one sentence, or two for a reported reading. */
  authority: Sentence[];
  /** The works an adopted conjecture or report rests on. */
  authorityReferences: string[];
  /** One line per substantive alternative, in the order of the site. */
  lines: ExplainLine[];
  /** The witnesses without this passage at all. */
  absent: ExplainLine | null;
  /** The editor's notes on these words. */
  notes: ReaderNote[];
}

export interface ExplainContext {
  /** The conspectus: siglum, witness name, transcription. */
  sigla: ReaderSiglum[];
}

/** The name the server gives a conjecture without a proposer. */
const EDITOR_NAME = 'this edition';

type Plural = { one: string; many: string };
type Witness = Extract<Part, { kind: 'witness' }>;

/** A template's placeholders filled with parts; neighbouring text runs are joined. */
export function fill(template: string, values: Record<string, Part[]>): Sentence {
  const out: Sentence = [];
  const push = (part: Part) => {
    const last = out[out.length - 1];
    if (part.kind === 'witness' && part.atStart !== undefined && out.length === 0) {
      out.push({ ...part, name: part.atStart });
      return;
    }
    if (part.kind === 'text') {
      if (part.text === '') return;
      if (last?.kind === 'text') {
        last.text += part.text;
        return;
      }
    }
    out.push({ ...part });
  };
  let at = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    push({ kind: 'text', text: template.slice(at, match.index) });
    for (const part of values[match[1]!] ?? [{ kind: 'text', text: match[0] } as Part]) push(part);
    at = match.index! + match[0].length;
  }
  push({ kind: 'text', text: template.slice(at) });
  return out;
}

/** Names joined as a sentence joins them: "A", "A and B", "A, B and C". */
export function listOf(items: Part[][]): Part[] {
  const out: Part[] = [];
  items.forEach((item, i) => {
    if (i > 0)
      out.push({ kind: 'text', text: i === items.length - 1 ? ` ${r.explain.and} ` : ', ' });
    out.push(...item);
  });
  return out;
}

/** The sentence as plain text, for labels and tests. */
export function plainSentence(sentence: Sentence): string {
  return sentence.map((part) => (part.kind === 'witness' ? part.name : part.text)).join('');
}

function text(value: string): Part[] {
  return [{ kind: 'text', text: value }];
}

function words(value: string): Part[] {
  return [{ kind: 'words', text: value }];
}

function plural(template: Plural, count: number): string {
  return count === 1 ? template.one : template.many;
}

/** "(Allen's apparatus (1931))" as a sentence quotes it: without the brackets round the whole. */
function unbracket(source: string | undefined): string {
  const value = (source ?? '').trim();
  const inner = /^\((.*)\)$/s.exec(value)?.[1];
  if (inner === undefined) return value;
  // Only brackets that enclose the whole: "(a) and (b)" keeps its own.
  let depth = 0;
  for (const char of inner) {
    if (char === '(') depth++;
    else if (char === ')' && --depth < 0) return value;
  }
  return depth === 0 ? inner.trim() : value;
}

/**
 * A state of a witness collated as a text of its own: as it stood before
 * correction (text id `<transcription>:original`), or the variants it notes
 * in its margins or between its lines (`<transcription>:variant`).
 */
/** A second text of a witness: the variants it notes, or one of its states by its place in the list. */
type State = { kind: 'variant' } | { kind: 'state'; k: number };

/** Witnesses by transcription id and by siglum, in the order of the conspectus. */
class Witnesses {
  private byText = new Map<string, number>();
  private bySiglum = new Map<string, { index: number; state?: State }>();

  constructor(private sigla: ReaderSiglum[]) {
    sigla.forEach((s, i) => {
      if (s.transcriptionId) this.byText.set(s.transcriptionId, i);
      this.bySiglum.set(s.siglum, { index: i });
      (s.states ?? []).forEach((state, k) => {
        if (!this.bySiglum.has(state.siglum))
          this.bySiglum.set(state.siglum, { index: i, state: { kind: 'state', k } });
      });
      if (s.variantSiglum && !this.bySiglum.has(s.variantSiglum))
        this.bySiglum.set(s.variantSiglum, { index: i, state: { kind: 'variant' } });
    });
  }

  private part(
    index: number | undefined,
    siglum: string,
    state?: State,
  ): { rank: number; part: Witness } {
    const entry = index === undefined ? undefined : this.sigla[index];
    if (!entry)
      return {
        rank: Number.MAX_SAFE_INTEGER,
        part: { kind: 'witness', name: r.explain.unknownWitness(siglum), siglum: '' },
      };
    const name = entry.witnessName.trim() || r.explain.unknownWitness(entry.siglum);
    if (state?.kind === 'state') {
      const found = entry.states?.[state.k];
      const shown = found?.siglum || siglum;
      const named =
        found?.kind === 'stage'
          ? r.explain.afterStage(name, found.stage ?? 1)
          : found?.kind === 'hand'
            ? r.explain.correctedBy(name, found.hand ?? r.explain.anotherHand)
            : r.explain.beforeCorrection(name);
      return {
        rank: index! + 0.3 + state.k * 0.01,
        part: { kind: 'witness', name: named, siglum: shown },
      };
    }
    if (state?.kind === 'variant') {
      const shown = entry.variantSiglum || siglum;
      return {
        rank: index! + 0.6,
        part: {
          kind: 'witness',
          name: r.explain.variantNoted(name),
          siglum: shown,
          atStart: r.explain.variantNotedStart(name),
        },
      };
    }
    return { rank: index!, part: { kind: 'witness', name, siglum: entry.siglum } };
  }

  /** A text of the collation by its id, else by the siglum it was collated under. */
  private ofText(id: string, siglum: string): { rank: number; part: Witness } {
    const second = /^(.*):(variant|s(\d+))$/u.exec(id);
    if (second) {
      const index = this.byText.get(second[1]!);
      const state: State =
        second[2] === 'variant' ? { kind: 'variant' } : { kind: 'state', k: Number(second[3]) };
      // A text named only by its id has its siglum from the conspectus, when the conspectus gives it.
      if (index !== undefined) return this.part(index, siglum === id ? '' : siglum, state);
    }
    const index = this.byText.get(id);
    if (index !== undefined) return this.part(index, siglum);
    const bySiglum = this.bySiglum.get(siglum);
    return this.part(bySiglum?.index, siglum, bySiglum?.state);
  }

  /** The witnesses of a reading, the edition's own text left out, in the order of the conspectus. */
  ofReading(reading: Reading, baseId: string | undefined): Witness[] {
    const found: { rank: number; part: Witness }[] = [];
    // A witness whose second state agrees with it is named once: "Venetus A", not also "a variant noted in Venetus A".
    const named = new Set(printedTextIds(reading));
    reading.textIds.forEach((id, i) => {
      if (id === baseId || (baseId === undefined && reading.base && i === 0)) return;
      if (!named.has(id)) return;
      found.push(this.ofText(id, reading.sigla[i] ?? id));
    });
    return sorted(found);
  }

  ofTexts(ids: string[]): Witness[] {
    return sorted(ids.map((id) => this.ofText(id, id)));
  }

  ofSigla(sigla: string[]): Witness[] {
    return sorted(
      sigla.map((siglum) => {
        const found = this.bySiglum.get(siglum);
        return this.part(found?.index, siglum, found?.state);
      }),
    );
  }
}

function sorted(found: { rank: number; part: Witness }[]): Witness[] {
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.rank - b.rank)
    .map((f) => f.part)
    .filter((p) => {
      const id = `${p.name}\u0000${p.siglum}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function who(witnesses: Witness[]): Part[] {
  return listOf(witnesses.map((w) => [w]));
}

function proposer(name: string): Part[] {
  return text(name === EDITOR_NAME ? r.explain.theEditor : name);
}

function referencesOf(
  attachment: Attachment,
  cites: Record<string, string[]>,
  withSource: boolean,
): string[] {
  const out: string[] = [];
  const source = unbracket(attachment.source);
  if (withSource && source) out.push(source);
  for (const cite of cites[attachment.id] ?? []) if (cite && !out.includes(cite)) out.push(cite);
  return out;
}

/** One conjecture or reported reading as a sentence, with what it rests on. */
export function explainAttachment(
  attachment: Attachment,
  context: ExplainContext,
  cites: Record<string, string[]> = {},
): ExplainLine {
  const reading = trimPunctuation(attachment.text);
  if (attachment.kind === 'reported') {
    const witness = new Witnesses(context.sigla).ofSigla([attachment.name]);
    const source = unbracket(attachment.source);
    const template =
      attachment.text === ''
        ? source
          ? r.explain.reportedOmitsFrom
          : r.explain.reportedOmits
        : source
          ? r.explain.reportedReadsFrom
          : r.explain.reportedReads;
    return {
      kind: 'reported',
      sentence: fill(template, { who: who(witness), words: words(reading), source: text(source) }),
      references: referencesOf(attachment, cites, false),
    };
  }
  const name = proposer(attachment.name);
  let template: string;
  switch (attachment.conjectureKind) {
    case 'deletion':
      template = r.explain.proposedDeletion;
      break;
    case 'lacuna':
      template = r.explain.proposedLacuna;
      break;
    case 'addition':
    case 'supplement':
      template = reading ? r.explain.proposedAddition : r.explain.proposedLacuna;
      break;
    case 'transposition':
      template = reading ? r.explain.proposedOrder : r.explain.proposedMove;
      break;
    default:
      template = reading ? r.explain.proposed : r.explain.proposedDeletion;
  }
  return {
    kind: 'conjecture',
    sentence: fill(template, { name, words: words(reading) }),
    references: referencesOf(attachment, cites, true),
  };
}

/** What the edition prints at a site and on what authority. */
function authorityOf(
  site: Site,
  base: Reading | undefined,
  agreeing: Witness[],
  present: Witness[],
  adopted: Attachment | undefined,
  witnesses: Witnesses,
  cites: Record<string, string[]>,
): { sentences: Sentence[]; references: string[] } {
  if (adopted?.kind === 'conjecture') {
    const name = proposer(adopted.name);
    const references = referencesOf(adopted, cites, true);
    if (
      adopted.conjectureKind === 'deletion' ||
      (adopted.text === '' && adopted.conjectureKind !== 'lacuna')
    ) {
      return { sentences: [fill(r.explain.conjectureDeletion, { name })], references };
    }
    if (adopted.conjectureKind === 'lacuna')
      return { sentences: [fill(r.explain.conjectureLacuna, { name })], references };
    if (agreeing.length)
      return {
        sentences: [
          fill(plural(r.explain.conjectureAlso, agreeing.length), { name, who: who(agreeing) }),
        ],
        references,
      };
    if (adopted.name === EDITOR_NAME)
      return { sentences: [fill(r.explain.conjectureOwn, {})], references };
    return { sentences: [fill(r.explain.conjecture, { name })], references };
  }
  if (adopted?.kind === 'reported') {
    const reported = witnesses.ofSigla([adopted.name]);
    const followers = [
      ...agreeing,
      ...reported.filter((w) => !agreeing.some((a) => a.siglum === w.siglum && a.name === w.name)),
    ];
    const source = unbracket(adopted.source);
    return {
      sentences: [
        fill(r.explain.follows, { who: who(followers) }),
        source
          ? fill(r.explain.reportedFrom, { who: who(reported), source: text(source) })
          : fill(r.explain.reportedOnly, { who: who(reported) }),
      ],
      references: referencesOf(adopted, cites, false),
    };
  }
  if (agreeing.length) {
    const every = agreeing.length >= 3 && agreeing.length === present.length;
    return {
      sentences: [
        every ? fill(r.explain.followsEvery, {}) : fill(r.explain.follows, { who: who(agreeing) }),
      ],
      references: [],
    };
  }
  if (!base || base.text === '')
    return { sentences: present.length ? [fill(r.explain.editorLeftOut, {})] : [], references: [] };
  const othersHaveWords = site.readings.some((reading) => !reading.base && reading.text !== '');
  return {
    sentences: [fill(othersHaveWords ? r.explain.editorReading : r.explain.editorAdded, {})],
    references: [],
  };
}

/** The line of one witness reading. */
function readingLine(
  reading: Reading,
  base: Reading | undefined,
  group: Witness[],
  site: Site,
  transposed: Set<string>,
  relation: VariantRelation | null = null,
): ExplainLine {
  const count = group.length;
  // Where the difference may be a punctuation mark, the reading keeps its punctuation.
  const said = site.kind === 'interpretative' ? reading.text : trimPunctuation(reading.text);
  const values = { who: who(group), words: words(said) };
  if (reading.lacunose && reading.text === '')
    return { kind: 'lost', sentence: fill(plural(r.explain.lost, count), values), references: [] };
  if (reading.lacunose)
    return {
      kind: 'damaged',
      sentence: fill(plural(r.explain.damaged, count), values),
      references: [],
    };
  if (reading.omission || reading.text === '')
    return {
      kind: 'omits',
      sentence: fill(plural(r.explain.omits, count), values),
      references: [],
    };
  if (base && base.text === '')
    return { kind: 'adds', sentence: fill(plural(r.explain.adds, count), values), references: [] };
  const sameSite = site.transposition && site.transposition.withSite === site.index;
  if (sameSite && reading.textIds.every((id) => transposed.has(id))) {
    return {
      kind: 'order',
      sentence: fill(plural(r.explain.otherOrder, count), values),
      references: [],
    };
  }
  if (relation === 'order')
    return {
      kind: 'order',
      sentence: fill(plural(r.explain.otherOrder, count), values),
      references: [],
    };
  const template =
    site.kind === 'interpretative'
      ? r.explain.readsInterpretative
      : relation === 'form'
        ? r.explain.readsForm
        : r.explain.reads;
  return { kind: 'reads', sentence: fill(plural(template, count), values), references: [] };
}

/** The edition's notes on the words of a site. */
export function notesAt(segment: ReaderSegment, siteIndex: number): ReaderNote[] {
  const words = new Set(editionTokensAt(segment, siteIndex));
  return (segment.notes ?? []).filter((note) => note.tokenIds.some((id) => words.has(id)));
}

/** A site explained, or null when the segment has no such site. */
export function explainSite(
  segment: ReaderSegment,
  siteIndex: number,
  context: ExplainContext,
): SiteExplanation | null {
  const site = siteOf(segment, siteIndex);
  if (!site) return null;
  const witnesses = new Witnesses(context.sigla);
  const baseId = segment.collation.baseId;
  const base = site.readings.find((reading) => reading.base);
  const others = site.readings.filter((reading) => !reading.base);
  const attached = segment.attachments[siteIndex] ?? [];
  const adopted = attached.find((a) => a.adopted);
  const cites = segment.cites ?? {};

  const agreeing = base ? witnesses.ofReading(base, baseId) : [];
  const present = [
    ...agreeing,
    ...others.flatMap((reading) => witnesses.ofReading(reading, baseId)),
  ];
  const authority = authorityOf(site, base, agreeing, present, adopted, witnesses, cites);

  const transposed = new Set(site.transposition?.textIds ?? []);
  const lines: ExplainLine[] = [];
  const relations = segment.relations?.[siteIndex];
  for (const reading of others) {
    const group = witnesses.ofReading(reading, baseId);
    if (group.length)
      lines.push(
        readingLine(
          reading,
          base,
          group,
          site,
          transposed,
          relations?.[site.readings.indexOf(reading)] ?? null,
        ),
      );
  }
  if (site.transposition && transposed.size) {
    const sameSite = site.transposition.withSite === site.index;
    const covered = sameSite && lines.some((line) => line.kind === 'order');
    if (!covered) {
      const group = witnesses.ofTexts([...transposed]);
      lines.push({
        kind: sameSite ? 'order' : 'place',
        sentence: fill(
          plural(sameSite ? r.explain.otherOrderPlain : r.explain.otherPlace, group.length),
          { who: who(group) },
        ),
        references: [],
      });
    }
  }
  for (const attachment of attached) {
    if (attachment.adopted) continue;
    lines.push(explainAttachment(attachment, context, cites));
  }

  const absentWitnesses = witnesses.ofSigla(segment.absent ?? []);
  const absent: ExplainLine | null = absentWitnesses.length
    ? {
        kind: 'absent',
        sentence: fill(plural(r.explain.absent, absentWitnesses.length), {
          who: who(absentWitnesses),
        }),
        references: [],
      }
    : null;

  let place: SiteExplanation['place'] = null;
  if (site.baseFrom === site.baseTo) {
    const before = segment.baseUnits[site.baseFrom - 1];
    const after = segment.baseUnits[site.baseFrom];
    if (before) place = { side: 'after', word: trimPunctuation(before.text) };
    else if (after) place = { side: 'before', word: trimPunctuation(after.text) };
  }

  return {
    key: siteKey(segment.segmentId, siteIndex),
    segmentId: segment.segmentId,
    siteIndex,
    label: segment.label,
    words: base && base.text !== '' ? trimPunctuation(base.text) : '',
    place,
    authority: authority.sentences,
    authorityReferences: authority.references,
    lines,
    absent,
    notes: notesAt(segment, siteIndex),
  };
}

/** The variant places of one segment, explained, with what belongs to the segment as a whole. */
export interface SegmentVariants {
  segmentId: string;
  label: string;
  places: SiteExplanation[];
  /** Conjectures and reported readings no site took. */
  unplaced: ExplainLine[];
  /** Notes on words that are at none of the places listed. */
  notes: ReaderNote[];
}

/** Where a site stands in its segment's text: an addition before the word it precedes. */
function textOrder(site: Site): number {
  return site.baseFrom * 2 - (site.baseFrom === site.baseTo ? 1 : 0);
}

/**
 * The variant places of some segments in the order of the text: the sites
 * `shown` names (by site key; the words the reader marks), explained, with
 * the segment's unplaced conjectures and its other notes. Segments with none
 * of these are left out.
 */
export function variantsOf(
  segmentIds: string[],
  segments: Record<string, ReaderSegment | undefined>,
  shown: { has(key: string): boolean },
  context: ExplainContext,
): SegmentVariants[] {
  const out: SegmentVariants[] = [];
  for (const segmentId of segmentIds) {
    const segment = segments[segmentId];
    if (!segment) continue;
    const sites = segment.collation.sites
      .filter((site) => shown.has(siteKey(segmentId, site.index)))
      .sort((a, b) => textOrder(a) - textOrder(b) || a.baseTo - b.baseTo || a.index - b.index);
    const places = sites.flatMap((site) => explainSite(segment, site.index, context) ?? []);
    const placed = new Set(places.flatMap((place) => place.notes.map((note) => note.id)));
    const notes = (segment.notes ?? []).filter((note) => !placed.has(note.id));
    const unplaced = (segment.unplaced ?? []).map((a) =>
      explainAttachment(a, context, segment.cites ?? {}),
    );
    if (places.length || notes.length || unplaced.length)
      out.push({ segmentId, label: segment.label, places, unplaced, notes });
  }
  return out;
}
