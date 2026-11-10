/**
 * A variant as the variant window lists it: the witnesses that are there,
 * then one row for each reading (the edition's first), with the witnesses
 * that have it and what the edition's reading rests on; the readings that
 * are only reported, and the conjectures, after those. Built from the
 * collation site itself, not from the print apparatus, so that the popover
 * on a word, the list of variants and the editor read one structure and
 * cannot disagree.
 *
 * It says what each witness has and what follows from the text the edition
 * prints, and nothing of what a reading means or how it is formed. A witness
 * that is not there is not named. The wording is in `reader.variant`.
 */
import {
  additionIn,
  printedKind,
  printedTextIds,
  siteTokenIds,
  trimPunctuation,
  witnessesAt,
  type Attachment,
  type Reading,
  type Site,
} from '@varians/core';
import { reader as r } from '$lib/strings/reader';
import { DEFAULT_SIGLA } from './marks';
import type { EditionPrint } from './edition-text';
import { editionTokensAt, siteKey, siteOf } from './sites';
import type { ReaderNote, ReaderSegment, ReaderSiglum } from './types';

/** A witness shown by its siglum, which opens the witness. */
export interface WitnessChip {
  kind: 'witness';
  /** The siglum as printed: a state of the witness has its own (A¹, A v.l.). */
  siglum: string;
  /** The witness's name: the siglum's accessible name and its title. */
  name: string;
  /** The siglum of the conspectus the Witnesses panel opens on; null for a witness the conspectus does not list. */
  witness: string | null;
  /** A state of the witness collated under a siglum of its own. */
  state: boolean;
  /** Only a report gives the witness this reading, from this source (empty when none is named). */
  reported?: { source: string };
}

/** A group's siglum with its members beside it; the members are never left out. */
export interface GroupChip {
  kind: 'group';
  siglum: string;
  note: string | null;
  members: WitnessChip[];
}

export type Chip = WitnessChip | GroupChip;

/** What stands in place of a reading's words where they are not there to be quoted. */
export type Lead = 'notIn' | 'delete' | 'lacuna' | 'add' | 'move';

/** What a row's reading rests on, after its sigla. */
export type Rest =
  | { kind: 'conjecture'; name: string; what: 'conjecture' | 'delete' | 'lacuna' }
  | { kind: 'editor' };

/**
 * Where a variant stands: its words, or the word a point between two words
 * follows or precedes. In a link, only the word it follows or precedes.
 */
export interface Where {
  words: string;
  place: { side: 'after' | 'before'; word: string } | null;
}

/** A link from a row to the variant where the same witnesses have the words in another place. */
export interface RowLink {
  key: string;
  where: Where;
}

export interface Row {
  kind: 'edition' | 'witnesses' | 'reported' | 'conjecture';
  /** Said before the words, or in their place when there are none. */
  lead: Lead | null;
  /** The reading's words; the edition's with its critical signs. */
  words: string;
  /** The witnesses that have it: groups gathered, the reported ones last. */
  chips: Chip[];
  rests: Rest[];
  /** What the row rests on, printed after it: "West 1998, 45". */
  references: string[];
  links: RowLink[];
}

export interface Variant extends Where {
  key: string;
  segmentId: string;
  siteIndex: number;
  /** The segment's label. */
  label: string;
  /** The editor judges it minor: it is in the window only when the reader asks for the minor variants. */
  minor: boolean;
  interpretative: boolean;
  /** The witnesses that are there; null when none is. */
  there: { count: number; total: number; all: boolean; chips: Chip[] } | null;
  /** The witnesses in which the words are an addition. */
  addition: Chip[] | null;
  rows: Row[];
  /** The editor's notes on these words. */
  notes: ReaderNote[];
}

export interface EditionGroup {
  siglum: string;
  members: readonly string[];
  note?: string;
}

export interface VariantContext {
  /** The conspectus: siglum, witness name, transcription. */
  sigla: readonly ReaderSiglum[];
  /** The edition's groups of sigla. */
  groups?: readonly EditionGroup[];
  /** How the edition prints its words; without it the words are the collation's. */
  edition?: EditionPrint;
}

/** The name the server gives a conjecture without a proposer. */
const EDITOR_NAME = 'this edition';

/** "(Allen's apparatus (1931))" as a row quotes it: without the brackets round the whole. */
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

/** A second text of a witness: the variants it notes, or one of its states by its place in the list. */
type State = { kind: 'variant' } | { kind: 'original' } | { kind: 'state'; k: number };

/** A chip with the place it stands in the conspectus, for putting chips in its order. */
interface Ranked {
  rank: number;
  chip: WitnessChip;
}

/** The conspectus read for chips: witnesses by transcription id and by siglum. */
class Conspectus {
  private byText = new Map<string, number>();
  private bySiglum = new Map<string, { index: number; state?: State }>();
  /** The witnesses with a transcript. */
  readonly total: number;

  constructor(private sigla: readonly ReaderSiglum[]) {
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
    this.total = sigla.filter((s) => s.transcriptionId).length;
  }

  /** Whether this text is the transcript of a witness of the conspectus, and no state of one. */
  isWitnessText(id: string): boolean {
    return this.byText.has(id);
  }

  private chip(index: number | undefined, siglum: string, state?: State): Ranked {
    const entry = index === undefined ? undefined : this.sigla[index];
    if (!entry)
      return {
        rank: Number.MAX_SAFE_INTEGER,
        chip: {
          kind: 'witness',
          siglum,
          name: r.variant.unknownWitness(siglum),
          witness: null,
          state: false,
        },
      };
    const name = entry.witnessName.trim() || r.variant.unknownWitness(entry.siglum);
    if (state?.kind === 'state' || state?.kind === 'original') {
      const k =
        state.kind === 'state'
          ? state.k
          : (entry.states ?? []).findIndex((s) => s.kind === 'original');
      const found = k >= 0 ? entry.states?.[k] : undefined;
      const named =
        found?.kind === 'stage'
          ? r.variant.afterStage(name, found.stage ?? 1)
          : found?.kind === 'hand'
            ? r.variant.correctedBy(name, found.hand ?? r.variant.anotherHand)
            : r.variant.beforeCorrection(name);
      return {
        rank: index! + 0.3 + Math.max(k, 0) * 0.01,
        chip: {
          kind: 'witness',
          siglum: found?.siglum || siglum || entry.siglum,
          name: named,
          witness: entry.siglum,
          state: true,
        },
      };
    }
    if (state?.kind === 'variant')
      return {
        rank: index! + 0.6,
        chip: {
          kind: 'witness',
          siglum: entry.variantSiglum || siglum || `${entry.siglum} v.l.`,
          name: r.variant.variantNoted(name),
          witness: entry.siglum,
          state: true,
        },
      };
    return {
      rank: index!,
      chip: { kind: 'witness', siglum: entry.siglum, name, witness: entry.siglum, state: false },
    };
  }

  /** A text of the collation by its id, else by the siglum it was collated under. */
  private ofText(id: string, siglum: string): Ranked {
    const second = /^(.*):(original|variant|s(\d+))$/u.exec(id);
    if (second) {
      const index = this.byText.get(second[1]!);
      const state: State =
        second[2] === 'variant'
          ? { kind: 'variant' }
          : second[2] === 'original'
            ? { kind: 'original' }
            : { kind: 'state', k: Number(second[3]) };
      // A text named only by its id has its siglum from the conspectus, when the conspectus gives it.
      if (index !== undefined) return this.chip(index, siglum === id ? '' : siglum, state);
    }
    const index = this.byText.get(id);
    if (index !== undefined) return this.chip(index, siglum);
    const bySiglum = this.bySiglum.get(siglum);
    return this.chip(bySiglum?.index, siglum, bySiglum?.state);
  }

  /** The witnesses of a reading, the edition's own text left out, in the order of the conspectus. */
  ofReading(reading: Reading, baseId: string): WitnessChip[] {
    // A witness whose second state agrees with it is named once: "A", not also "A v.l.".
    const named = new Set(printedTextIds(reading));
    const found: Ranked[] = [];
    reading.textIds.forEach((id, i) => {
      if (id === baseId || !named.has(id)) return;
      found.push(this.ofText(id, reading.sigla[i] ?? id));
    });
    return sorted(found);
  }

  ofTexts(ids: readonly string[]): WitnessChip[] {
    return sorted(ids.map((id) => this.ofText(id, id)));
  }

  /** A witness by the siglum a report names it by. */
  ofSiglum(siglum: string): WitnessChip {
    const found = this.bySiglum.get(siglum);
    return this.chip(found?.index, siglum, found?.state).chip;
  }
}

function sorted(found: Ranked[]): WitnessChip[] {
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.rank - b.rank)
    .map((f) => f.chip)
    .filter((chip) => {
      const id = `${chip.name}\u0000${chip.siglum}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

/**
 * The witnesses with each group's members gathered under its siglum, where
 * all the members are there: the group stands where its first member stood,
 * the members in the order of the conspectus.
 */
export function gather(
  chips: readonly WitnessChip[],
  groups: readonly EditionGroup[] = [],
): Chip[] {
  const plain = new Set<string>();
  for (const chip of chips)
    if (!chip.state && !chip.reported && chip.witness) plain.add(chip.witness);
  const taken = new Set<string>();
  const formed = new Map<string, EditionGroup>();
  // The widest group first, so that a witness is gathered once.
  for (const group of [...groups].sort((a, b) => b.members.length - a.members.length)) {
    if (group.members.length < 2) continue;
    if (!group.members.every((m) => plain.has(m) && !taken.has(m))) continue;
    for (const member of group.members) {
      taken.add(member);
      formed.set(member, group);
    }
  }
  const out: Chip[] = [];
  const placed = new Set<EditionGroup>();
  for (const chip of chips) {
    const group =
      !chip.state && !chip.reported && chip.witness ? formed.get(chip.witness) : undefined;
    if (!group) {
      out.push(chip);
      continue;
    }
    if (placed.has(group)) continue;
    placed.add(group);
    out.push({
      kind: 'group',
      siglum: group.siglum,
      note: group.note?.trim() || null,
      members: chips.filter(
        (c) => !c.state && !c.reported && c.witness && group.members.includes(c.witness),
      ),
    });
  }
  return out;
}

function sameWords(a: string, b: string): boolean {
  return trimPunctuation(a).normalize('NFC') === trimPunctuation(b).normalize('NFC');
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

/** The proposer of a conjecture as a row names it. */
function proposer(name: string): string {
  return name === EDITOR_NAME ? r.variant.theEditor : name;
}

/** What a conjecture does, where the words alone do not say it. */
function conjectureWhat(attachment: Attachment): 'conjecture' | 'delete' | 'lacuna' {
  if (attachment.conjectureKind === 'deletion') return 'delete';
  if (attachment.conjectureKind === 'lacuna') return 'lacuna';
  return 'conjecture';
}

/** A conjecture's row: what it proposes, its proposer, and what it cites. */
function conjectureRow(attachment: Attachment, cites: Record<string, string[]>): Row {
  const words = trimPunctuation(attachment.text);
  let lead: Lead | null = null;
  let said = words;
  switch (attachment.conjectureKind) {
    case 'deletion':
      lead = 'delete';
      said = '';
      break;
    case 'lacuna':
      lead = 'lacuna';
      said = '';
      break;
    case 'addition':
    case 'supplement':
      if (words) lead = 'add';
      else lead = 'lacuna';
      break;
    case 'transposition':
      if (!words) lead = 'move';
      break;
    default:
      if (!words) lead = 'delete';
  }
  return {
    kind: 'conjecture',
    lead,
    words: said,
    chips: [],
    rests: [{ kind: 'conjecture', name: proposer(attachment.name), what: 'conjecture' }],
    references: referencesOf(attachment, cites, true),
    links: [],
  };
}

/** A reading reported for a witness, as a chip marked with its source. */
function reportedChip(attachment: Attachment, conspectus: Conspectus): WitnessChip {
  return {
    ...conspectus.ofSiglum(attachment.name),
    reported: { source: unbracket(attachment.source) },
  };
}

/** A reported reading no row gives, as a row of its own. */
function reportedRow(
  attachment: Attachment,
  conspectus: Conspectus,
  cites: Record<string, string[]>,
): Row {
  return {
    kind: 'reported',
    lead: attachment.text === '' ? 'notIn' : null,
    words: trimPunctuation(attachment.text),
    chips: [reportedChip(attachment, conspectus)],
    rests: [],
    references: referencesOf(attachment, cites, false),
    links: [],
  };
}

/** The word a stretch of the edition's words follows, or at the start of a segment precedes. */
function placeOf(segment: ReaderSegment, from: number, to: number): Where['place'] {
  const before = segment.baseUnits[from - 1];
  const after = segment.baseUnits[to];
  if (before) return { side: 'after', word: trimPunctuation(before.text) };
  if (after) return { side: 'before', word: trimPunctuation(after.text) };
  return null;
}

/** The edition's words at a site, and where it stands, as the head of the window says it. */
function whereOf(segment: ReaderSegment, site: Site): Where {
  const base = site.readings.find((reading) => reading.base);
  return {
    words: base && base.text !== '' ? trimPunctuation(base.text) : '',
    place: site.baseFrom === site.baseTo ? placeOf(segment, site.baseFrom, site.baseTo) : null,
  };
}

/** Where a variant stands as plain text, for labels. */
export function whereText(where: Where): string {
  if (where.words) return where.words;
  if (!where.place) return '';
  return `${where.place.side === 'after' ? r.variant.after : r.variant.before} ${where.place.word}`;
}

/** The siglum of a chip, or of a group and its members, as plain text. */
export function chipText(chip: Chip): string {
  return chip.kind === 'group'
    ? `${chip.siglum} (${chip.members.map((m) => m.siglum).join(' ')})`
    : chip.siglum;
}

/** The edition's words at a site as the edition prints them; the lacuna sign where it prints one. */
function editionWords(
  segment: ReaderSegment,
  site: Site,
  base: Reading | undefined,
  interpretative: boolean,
  adopted: Attachment | undefined,
  context: VariantContext,
): string {
  const ids = siteTokenIds(site, segment.baseUnits);
  let words = '';
  if (ids.length > 0) {
    words = context.edition
      ? context.edition.words(ids, interpretative)
      : interpretative
        ? (base?.text ?? '')
        : trimPunctuation(base?.text ?? '');
  } else if (site.baseFrom === site.baseTo && context.edition) {
    const before = segment.baseUnits[site.baseFrom - 1]?.tokenIds.at(-1) ?? null;
    const after = segment.baseUnits[site.baseFrom]?.tokenIds[0] ?? null;
    words = context.edition.lacunaBetween(before, after);
  }
  if (words === '' && (base?.lacunose || adopted?.conjectureKind === 'lacuna'))
    words = context.edition?.lacuna ?? DEFAULT_SIGLA.lacuna;
  return words;
}

/** The edition's notes on the words of a site. */
export function notesAt(segment: ReaderSegment, siteIndex: number): ReaderNote[] {
  const words = new Set(editionTokensAt(segment, siteIndex));
  return (segment.notes ?? []).filter((note) => note.tokenIds.some((id) => words.has(id)));
}

/** The words of a reading as a row says them: edge punctuation left off, unless the letters are the same and a mark may be the difference. */
function readingWords(reading: Reading, interpretative: boolean): string {
  return interpretative ? reading.text : trimPunctuation(reading.text);
}

/** A row being built: its reading, and the witnesses and reports that stand with it. */
interface Entry {
  row: Row;
  /** The texts that have the reading, for finding which witnesses moved. */
  textIds: readonly string[];
  /** The reading as the collation has it, for finding the reports that give it. */
  plain: string;
  witnesses: WitnessChip[];
  reported: WitnessChip[];
}

/** A variant of a segment as the window lists it, or null when the segment has no such site. */
export function variantOf(
  segment: ReaderSegment,
  siteIndex: number,
  context: VariantContext,
): Variant | null {
  const site = siteOf(segment, siteIndex);
  if (!site) return null;
  const conspectus = new Conspectus(context.sigla);
  const baseId = segment.collation.baseId;
  const base = site.readings.find((reading) => reading.base);
  const others = site.readings.filter((reading) => !reading.base);
  const attached = segment.attachments[siteIndex] ?? [];
  const cites = segment.cites ?? {};
  const interpretative = printedKind(site, attached) === 'interpretative';
  const adopted = attached.find((a) => a.adopted && a.kind === 'conjecture');
  const supports = attached.filter((a) => a.adopted && a.kind === 'reported');
  const groups = context.groups ?? [];

  // The witnesses that are there: those of the conspectus with a transcript that stand in a reading.
  const order = context.sigla.flatMap((s) => s.transcriptionId ?? []);
  const thereChips = conspectus.ofTexts(
    witnessesAt(site, baseId, order).filter((id) => conspectus.isWitnessText(id)),
  );

  // The edition's row.
  const baseChips = base ? conspectus.ofReading(base, baseId) : [];
  const words = editionWords(segment, site, base, interpretative, adopted, context);
  const edition: Entry = {
    row: {
      kind: 'edition',
      lead: words === '' ? 'notIn' : null,
      words,
      chips: [],
      rests: [],
      references: [],
      links: [],
    },
    textIds: [],
    plain: base?.text ?? '',
    witnesses: baseChips,
    reported: supports.map((a) => reportedChip(a, conspectus)),
  };
  if (adopted) {
    edition.row.rests.push({
      kind: 'conjecture',
      name: proposer(adopted.name),
      what: conjectureWhat(adopted),
    });
    edition.row.references.push(...referencesOf(adopted, cites, true));
  }
  for (const support of supports)
    for (const cite of referencesOf(support, cites, false))
      if (!edition.row.references.includes(cite)) edition.row.references.push(cite);
  if (!adopted && baseChips.length === 0 && edition.reported.length === 0)
    edition.row.rests.push({ kind: 'editor' });

  // The witnesses' rows.
  const witnessRows: Entry[] = [];
  for (const reading of others) {
    const chips = conspectus.ofReading(reading, baseId);
    if (chips.length === 0) continue;
    const none = reading.omission || reading.text === '';
    witnessRows.push({
      row: {
        kind: 'witnesses',
        lead: none ? 'notIn' : null,
        words: none ? '' : readingWords(reading, interpretative),
        chips: [],
        rests: [],
        references: [],
        links: [],
      },
      textIds: reading.textIds,
      plain: reading.text,
      witnesses: chips,
      reported: [],
    });
  }

  // Reported readings join the row that gives their words, or stand in a row of their own;
  // a conjecture not adopted has a row each.
  const own: Row[] = [];
  const conjectures: Row[] = [];
  for (const attachment of attached) {
    if (attachment.adopted) continue;
    if (attachment.kind === 'conjecture') {
      conjectures.push(conjectureRow(attachment, cites));
      continue;
    }
    const same = [edition, ...witnessRows].find(
      (entry) =>
        sameWords(entry.plain, attachment.text) &&
        (attachment.text !== '' || entry.row.lead === 'notIn'),
    );
    if (!same) {
      own.push(reportedRow(attachment, conspectus, cites));
      continue;
    }
    const chip = reportedChip(attachment, conspectus);
    // A witness that has the words itself needs no report of them.
    if (![...same.witnesses, ...same.reported].some((c) => c.siglum === chip.siglum))
      same.reported.push(chip);
    for (const cite of referencesOf(attachment, cites, false))
      if (!same.row.references.includes(cite)) same.row.references.push(cite);
  }

  // Sigla: the witnesses, groups gathered, then the reported ones.
  for (const entry of [edition, ...witnessRows])
    entry.row.chips = [...gather(entry.witnesses, groups), ...entry.reported];

  // A witness whose words stand in another place of the segment: each of the two variants links the other.
  const moved = site.transposition;
  const other =
    moved && moved.withSite !== site.index ? siteOf(segment, moved.withSite) : undefined;
  if (moved && other) {
    const link: RowLink = {
      key: siteKey(segment.segmentId, other.index),
      // The words of the other variant would only repeat the row's: where it stands tells more.
      where: { words: '', place: placeOf(segment, other.baseFrom, other.baseTo) },
    };
    for (const { row, textIds } of witnessRows)
      if (textIds.some((id) => moved.textIds.includes(id))) row.links.push(link);
  }

  // An addition: the edition has no words where witnesses have some, or prints all of them as deleted.
  const deleted = !!context.edition?.deleted(siteTokenIds(site, segment.baseUnits));
  const added = additionIn(site, baseId, deleted);
  const additionChips = added.length ? gather(conspectus.ofTexts(added), groups) : null;

  const where = whereOf(segment, site);
  return {
    key: siteKey(segment.segmentId, siteIndex),
    segmentId: segment.segmentId,
    siteIndex,
    label: segment.label,
    ...where,
    minor: site.minor === true,
    interpretative,
    there: thereChips.length
      ? {
          count: thereChips.length,
          total: conspectus.total,
          all: thereChips.length >= conspectus.total,
          chips: gather(thereChips, groups),
        }
      : null,
    addition: additionChips,
    rows: [edition.row, ...witnessRows.map((w) => w.row), ...own, ...conjectures],
    notes: notesAt(segment, siteIndex),
  };
}

/** The variants of one segment, with what belongs to the segment as a whole. */
export interface SegmentVariants {
  segmentId: string;
  label: string;
  places: Variant[];
  /** Conjectures and reported readings no variant took, as rows. */
  unplaced: Row[];
  /** Notes on words that are at none of the variants listed. */
  notes: ReaderNote[];
}

/** One conjecture or reported reading that stands at no variant, as a row. */
export function unplacedRow(
  attachment: Attachment,
  context: VariantContext,
  cites: Record<string, string[]> = {},
): Row {
  return attachment.kind === 'reported'
    ? reportedRow(attachment, new Conspectus(context.sigla), cites)
    : conjectureRow(attachment, cites);
}

/** Where a site stands in its segment's text: an addition before the word it precedes. */
function textOrder(site: Site): number {
  return site.baseFrom * 2 - (site.baseFrom === site.baseTo ? 1 : 0);
}

/**
 * The variants of some segments in the order of the text: the sites `shown`
 * names (by site key; those the reader marks), with the segment's unplaced
 * conjectures and its other notes. Segments with none of these are left out.
 */
export function variantsOf(
  segmentIds: string[],
  segments: Record<string, ReaderSegment | undefined>,
  shown: { has(key: string): boolean },
  context: VariantContext,
): SegmentVariants[] {
  const out: SegmentVariants[] = [];
  for (const segmentId of segmentIds) {
    const segment = segments[segmentId];
    if (!segment) continue;
    const sites = segment.collation.sites
      .filter((site) => shown.has(siteKey(segmentId, site.index)))
      .sort((a, b) => textOrder(a) - textOrder(b) || a.baseTo - b.baseTo || a.index - b.index);
    const places = sites.flatMap((site) => variantOf(segment, site.index, context) ?? []);
    const placed = new Set(places.flatMap((place) => place.notes.map((note) => note.id)));
    const notes = (segment.notes ?? []).filter((note) => !placed.has(note.id));
    const unplaced = (segment.unplaced ?? []).map((a) =>
      unplacedRow(a, context, segment.cites ?? {}),
    );
    if (places.length || notes.length || unplaced.length)
      out.push({ segmentId, label: segment.label, places, unplaced, notes });
  }
  return out;
}
