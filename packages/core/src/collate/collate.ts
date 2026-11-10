/**
 * Collation: a pure function from the words of a stretch (one segment, or a
 * passage of several taken together) in a base text and in each witness to
 * the places where they differ: different words, not different ways of
 * writing them, which the normalized forms have already evened out.
 *
 * Words are compared by their normalized forms as the editor typed them,
 * under the work's fold (case, punctuation): a different accent or
 * breathing is a different word, but a grave counts as an acute. The
 * diplomatic forms play no part: whatever differs between a witness's
 * diplomatic and normalized text is normalization.
 *
 * Every witness is aligned with the base alone (the edition's text, or the
 * first witness when transcriptions are compared among themselves), by
 * dynamic programming over the letters of the words: exact matches are
 * rewarded, near matches less, and gaps penalised. What one witness reads
 * therefore never depends on another, nor on the order they are given in.
 *
 * Where a witness departs from the base it does so over an extent of its
 * own: one word read otherwise, with whatever it adds or does not have
 * beside it; words added between two of the base's; a stretch it does not
 * have; a stretch whose words stand in another order. Each such extent is a
 * place. Witnesses departing over the same extent are readings of one place;
 * a small variant inside a wide one (a word spelt otherwise within a stretch
 * that another witness transposes or does not have) is a place of its own,
 * in which the witness of the wide variant does not stand. Neighbouring
 * places that divide the witnesses in the same way are one place, so that a
 * phrase a family reads otherwise is one variant and not a row of single
 * words.
 *
 * A place speaks only of the witnesses that are there. Where a witness has
 * a gap (its carrier is lost or illegible, or the stretch is not
 * transcribed) it is not there: the gap reaches over the base's words the
 * witness has nothing for on either side, a place over any of those words
 * leaves the witness out, and the gap is no departure and makes no place.
 * A witness whose text runs on without words is there, and its reading is
 * nothing. So it is where the base has nothing of a segment some witness has
 * (a segment the edition does not print): the witness stands with the base.
 *
 * Nothing here is stored: the result is recomputed whenever a text changes
 * and cached by a hash of its inputs.
 */

import {
  agreementFold,
  archetypeLetters,
  fold as foldText,
  type FoldOptions,
  DEFAULT_FOLD,
} from '../normalize/fold.ts';
import type { Id } from '../stream/items.ts';
import type { Unit } from '../stream/words.ts';
import { similarity } from './similarity.ts';

export interface CollationText {
  /** The transcription or edition id the units come from. */
  id: Id;
  /** The siglum printed for it; the base's is used only when it is a witness. */
  siglum: string;
  units: Unit[];
  /**
   * The text reaches this segment even when it has no units for it: its text
   * runs on without the passage, and its reading over the whole segment is
   * nothing, where a text with no units and without this flag is absent and
   * stands in no site. A text whose units are all gaps is absent too.
   */
  present?: boolean;
  /**
   * Stretches of the base's units, [from, to), for which the text has no
   * text at all: segments of a passage that it has lost or that lie outside
   * what its transcript covers. It is aligned with the rest of the base
   * only, and is not there over these units, nor at a point beside them.
   * Words of a segment it simply does not have are no such stretch: that is
   * an absence like any other.
   */
  notThere?: readonly { from: number; to: number }[];
}

export interface CollationOptions {
  fold?: FoldOptions;
  /** Similarity of diacritic-stripped fold keys at or above which two words are a near match. */
  nearThreshold?: number;
  /** Anchor columns between two transposed sites at or below which the sites are merged into one. */
  transpositionReach?: number;
  /**
   * The base's units within which a word a witness has in one spot and is
   * without in another, too far apart to be one place, makes two places
   * that name each other; farther apart, they are an absence and an
   * addition with no link. `FAR_REACH` by default.
   */
  farReach?: number;
  /**
   * The index of the base's unit at which each segment of the stretch
   * begins, in order (a passage of several segments). A place is `wanting`
   * where it covers exactly the units of one or more whole segments and a
   * witness has none of them. Without it the stretch is one segment.
   */
  segmentStarts?: readonly number[];
}

/** How far apart, in the base's units, two places may be and still name each other: two dozen words. */
export const FAR_REACH = 24;
/** How far, in the base's units, a word may stand from its place and the two still be one transposition. */
export const TRANSPOSITION_REACH = 3;

export interface Cell {
  unitIndex: number;
  /** The witness is lacunose here: a gap of its covers this column. */
  lacunose?: boolean;
}

export interface Column {
  /** Text id to the unit of that text standing in this column. */
  cells: Map<Id, Cell>;
}

export interface Reading {
  /** The words as read, joined by spaces; empty where the texts have none. */
  text: string;
  fold: string;
  /** The texts (base or witnesses) that have this reading, in input order. */
  textIds: Id[];
  sigla: string[];
  /** Each text's units at the site, in that text's own order. */
  units: Record<Id, Unit[]>;
  /** The reading is nothing where others have words. */
  omission: boolean;
  /**
   * The base has a lacuna here (an edition's lacuna mark, a gap in the first
   * witness): only the base's reading can be lacunose. A witness that has
   * lost the words is in no reading.
   */
  lacunose: boolean;
  /** This is the base's reading. */
  base: boolean;
}

export interface Site {
  /** Index of the site among the segment's sites. */
  index: number;
  /** Columns covered, inclusive start and exclusive end. */
  columnFrom: number;
  columnTo: number;
  /** The base's unit indexes covered: [from, to), empty for an insertion point. */
  baseFrom: number;
  baseTo: number;
  readings: Reading[];
  /**
   * The witness texts whose words here exchange places with those of
   * another site: `withSite` is the index of that site among the sites of
   * this collation, or among those of the passage `inPassage` names (by its
   * first segment) where the other site lies in a neighbouring passage. A
   * site that names itself is a transposition within its own stretch.
   */
  transposition?: { withSite: number; textIds: Id[]; inPassage?: Id };
  /**
   * Textual: the readings have different letters (different words, or the
   * same in another order). Interpretative: the same letters read
   * otherwise, in accents, breathings, punctuation or word division; what
   * an archetype in capitals without those signs could not tell apart.
   */
  kind: SiteKind;
  /** The editor set the kind, over what the letters say. */
  kindByEditor?: boolean;
  /**
   * The site covers exactly the units of one or more whole segments, and
   * some witness is without all of them: its text runs on without them. It
   * may stand beside other sites over the same words, which are found
   * without that witness, and overlap them.
   */
  wanting?: boolean;
  /** The editor judges the place minor: the print apparatus leaves it out, and a reader sees it on asking for all the variants. */
  minor?: boolean;
}

export type SiteKind = 'textual' | 'interpretative';

/** What an editor says of a place: its kind over what the letters say, and whether it is minor, each apart from the other. */
export interface SiteMark {
  kind?: SiteKind;
  minor?: boolean;
}

/**
 * Whether readings differ in their letters, or only in how the same letters
 * are read. A lacuna of the base tells nothing of the letters; a place where
 * nothing but the base's lacuna differs is textual.
 */
export function siteKindOf(readings: Pick<Reading, 'text' | 'lacunose'>[]): SiteKind {
  const legible = readings.filter((r) => !(r.lacunose && r.text === ''));
  const letters = new Set(legible.map((r) => archetypeLetters(r.text)));
  return legible.length > 1 && letters.size === 1 ? 'interpretative' : 'textual';
}

export interface Collation {
  columns: Column[];
  sites: Site[];
  /** Column indexes where every text that is there agrees with the base. */
  anchors: number[];
  baseId: Id;
  /** Texts without the segment: given no units at all, or only gaps. */
  absent: Id[];
  /** The siglum of every text given, base included. */
  sigla: Record<Id, string>;
}

// The scores of the alignment. A word standing against the same word scores most; against the same
// letters with other accents a little less, so that where either is possible the witness is placed
// where it agrees.
const AGREE = 6;
const SAME_LETTERS = 5;
const NEAR = 2;
const GAP_UNIT = 0;
const MISMATCH = -4;
const INDEL = -2;

/** One step of a witness's alignment with the base: a unit of each, or -1 where one has nothing. */
interface Step {
  b: number;
  w: number;
}

/** A witness's departure from the base: the base's units it covers and the witness's words there. */
interface Atom {
  /** The base's units covered: [from, to); from === to for words added before unit `from`. */
  from: number;
  to: number;
  /** Indexes of the witness's words here, in its own order. */
  units: number[];
  /** A loss of the witness: no departure, and no place; the witness is not there. */
  lacunose: boolean;
  /** The base's words in another order. */
  transposed: boolean;
  /** The witness's text runs on without the whole segment. */
  whole?: boolean;
  /** The steps of the alignment the atom was made from, for naming the two halves of a distant transposition. */
  steps: number[];
}

/** A witness aligned with the base. */
interface Aligned {
  text: CollationText;
  keys: string[];
  atoms: Atom[];
  /** For each unit of the base, the witness's unit standing with it, or -1. */
  pairOf: number[];
  /** For each point before a unit of the base (and after the last), the witness's units added there. */
  inserted: number[][];
  /** Units of the base the witness has lost: where it is not there. */
  lost: Set<number>;
  /** Words the witness has in one place and lacks in another, too far apart to be one place. */
  far: [Atom, Atom][];
  /** The witness lacks a segment in which the base has no words either, and which is no segment the base leaves unprinted: it stands nowhere. */
  outside?: boolean;
}

export function collate(
  base: CollationText,
  witnesses: CollationText[],
  options: CollationOptions = {},
): Collation {
  const fold = options.fold ?? DEFAULT_FOLD;
  const near = options.nearThreshold ?? 0.6;
  const reach = options.transpositionReach ?? TRANSPOSITION_REACH;
  const farReach = options.farReach ?? FAR_REACH;
  // Words are placed by their letters, so that ἦ stands against ἤ; whether they agree is decided by their accents too.
  const bareOf = (text: CollationText) =>
    text.units.map((u) => (u.gap ? '' : foldText(u.text, { ...fold, stripDiacritics: true })));
  const keysOf = (text: CollationText) =>
    text.units.map((u) => (u.gap ? '' : agreementFold(u.text, fold)));
  const baseBare = bareOf(base);
  const baseKeys = keysOf(base);
  const n = base.units.length;
  const baseHasWords = base.units.some((u) => !u.gap);
  // A segment the base does not have at all and some witness has: a witness whose text runs on
  // without it is there, and stands with the base, whose reading is nothing. A base that marks
  // the segment lost has units (its gaps), and such a witness stands nowhere there as before.
  const unprinted = n === 0 && witnesses.some((w) => w.units.some((u) => !u.gap));
  // Whether two words are near enough to stand against each other: asked for the same pair by every witness, so kept.
  const likeness = new Map<string, boolean>();
  const alike = (a: string, b: string): boolean => {
    const key = `${a}\u0001${b}`;
    let known = likeness.get(key);
    if (known === undefined) {
      known = similarity(a, b) >= near;
      likeness.set(key, known);
    }
    return known;
  };

  const absent: Id[] = [];
  const aligned: Aligned[] = [];
  for (const witness of witnesses) {
    // A text without the segment at all, or that has lost all of it, is absent: it stands in no place.
    const lost = witness.units.length > 0 && witness.units.every((u) => u.gap);
    const away = notThereUnits(witness, n);
    if ((witness.units.length === 0 && !witness.present) || lost || (n > 0 && away.size === n)) {
      absent.push(witness.id);
      continue;
    }
    if (witness.units.length === 0 && away.size === 0) {
      aligned.push(lacking(witness, n, baseHasWords, unprinted));
      continue;
    }
    aligned.push(
      alignWitness(
        base,
        baseBare,
        baseKeys,
        witness,
        bareOf(witness),
        keysOf(witness),
        alike,
        reach,
        farReach,
        away,
      ),
    );
  }

  // The site over the whole segment, where a witness's text runs on without it.
  const wanting = aligned.some((a) => a.atoms.some((atom) => atom.whole));
  // Uniting may make neighbours of places that divide the witnesses alike, and joining may make two readings overlap: until neither does.
  for (;;) {
    const united = uniteOverlapping(aligned);
    const joined = joinPlaces(base, baseKeys, aligned, wanting);
    if (!united && !joined) break;
  }

  const { columns, baseColumn, slotColumn } = buildColumns(base, aligned);
  const inColumns = aligned.filter((a) => !a.atoms.some((atom) => atom.whole) && !a.outside);
  const anchors = anchorColumns(columns, base, baseKeys, inColumns);

  // The places: every extent over which some witness that is there departs, a place nested in another before it.
  const ranges = new Map<string, { from: number; to: number }>();
  for (const a of aligned)
    for (const atom of departures(a)) ranges.set(`${atom.from}:${atom.to}`, atom);
  const places = [...ranges.values()]
    .map(({ from, to }) => ({ from, to }))
    .sort(
      (p, q) => p.to - q.to || Number(p.from === p.to) - Number(q.from === q.to) || q.from - p.from,
    );
  const sites: Site[] = places.map(({ from, to }, index) => {
    const readings = readingsAt(base, baseKeys, aligned, from, to, wanting);
    const site: Site = {
      index,
      columnFrom: to > from ? baseColumn[from]! : slotColumn[from]!,
      columnTo: to > from ? baseColumn[to - 1]! + 1 : (baseColumn[from] ?? columns.length),
      baseFrom: from,
      baseTo: to,
      readings,
      kind: siteKindOf(readings),
    };
    const own = aligned.flatMap((a) =>
      a.atoms.filter((atom) => atom.from === from && atom.to === to).map((atom) => ({ a, atom })),
    );
    const transposed = own.filter((o) => o.atom.transposed).map((o) => o.a.text.id);
    if (transposed.length > 0) site.transposition = { withSite: index, textIds: transposed };
    if (wholeSegments(from, to) && readings.some((r) => !r.base && r.omission)) site.wanting = true;
    return site;
  });
  // A word a witness has in one place and lacks in another, too far apart to be one place: each half names the other.
  const siteOfAtom = (atom: Atom) =>
    sites.find((s) => s.baseFrom === atom.from && s.baseTo === atom.to);
  for (const a of aligned) {
    for (const [one, other] of a.far) {
      if (!there(a, one.from, one.to) || !there(a, other.from, other.to)) continue;
      const first = siteOfAtom(one);
      const second = siteOfAtom(other);
      if (!first || !second || first === second) continue;
      for (const [site, partner] of [
        [first, second],
        [second, first],
      ] as const) {
        if (site.transposition && site.transposition.withSite === site.index) continue;
        const textIds = new Set(site.transposition?.textIds ?? []);
        textIds.add(a.text.id);
        site.transposition = { withSite: partner.index, textIds: [...textIds] };
      }
    }
  }

  const sigla: Record<Id, string> = {};
  for (const text of [base, ...witnesses]) sigla[text.id] = text.siglum;
  return { columns, sites, anchors, baseId: base.id, absent, sigla };

  /** Whether the base's units [from, to) are those of one or more whole segments of the stretch. */
  function wholeSegments(from: number, to: number): boolean {
    if (to <= from) return false;
    const starts = options.segmentStarts ?? [0];
    return starts.includes(from) && (to === n || starts.includes(to));
  }
}

/** The base's units for which a text has no text (`CollationText.notThere`). */
function notThereUnits(text: CollationText, n: number): Set<number> {
  const out = new Set<number>();
  for (const { from, to } of text.notThere ?? [])
    for (let b = Math.max(0, from); b < Math.min(n, to); b++) out.add(b);
  return out;
}

/**
 * A witness whose text runs on without the segment: one departure over all
 * of it, beside which every other place of the segment stands without the
 * witness. Where the base has no words either, the witness stands with the
 * base when the base has nothing of the segment and some witness has its
 * words (a segment the base does not print), and nowhere otherwise.
 */
function lacking(
  witness: CollationText,
  n: number,
  baseHasWords: boolean,
  unprinted: boolean,
): Aligned {
  const out: Aligned = {
    text: witness,
    keys: [],
    atoms: [],
    pairOf: new Array<number>(n).fill(-1),
    inserted: Array.from({ length: n + 1 }, () => []),
    lost: new Set(),
    far: [],
  };
  if (baseHasWords)
    out.atoms.push({
      from: 0,
      to: n,
      units: [],
      lacunose: false,
      transposed: false,
      whole: true,
      steps: [],
    });
  else if (!unprinted) out.outside = true;
  return out;
}

/**
 * Needleman-Wunsch, global alignment of a witness's units with the base's,
 * by the letters of their words: with the base's units `rows` (indexes, in
 * order), all of them where not given.
 */
function alignSteps(
  base: CollationText,
  baseBare: string[],
  baseKeys: string[],
  witness: CollationText,
  bare: string[],
  keys: string[],
  alike: (a: string, b: string) => boolean,
  rows?: readonly number[],
): Step[] {
  const row = (r: number) => (rows ? rows[r]! : r);
  const n = rows ? rows.length : base.units.length;
  const m = witness.units.length;
  const score = (r: number, j: number): number => {
    const i = row(r);
    const b = base.units[i]!.gap !== undefined;
    const w = witness.units[j]!.gap !== undefined;
    // Two losses at the same point stand together; a loss against a word says nothing either way.
    if (b && w) return AGREE;
    if (b || w) return GAP_UNIT;
    if (baseBare[i] === bare[j]) return baseKeys[i] === keys[j] ? AGREE : SAME_LETTERS;
    return alike(baseBare[i]!, bare[j]!) ? NEAR : MISMATCH;
  };
  // dp[i][j] is the best score aligning the base's units[0..i) with the witness's units[0..j).
  const dp: number[][] = [];
  const move: Uint8Array[] = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array<number>(m + 1).fill(0));
    move.push(new Uint8Array(m + 1));
  }
  for (let i = 1; i <= n; i++) {
    dp[i]![0] = i * INDEL;
    move[i]![0] = 1; // up: a unit of the base without one of the witness
  }
  for (let j = 1; j <= m; j++) {
    dp[0]![j] = j * INDEL;
    move[0]![j] = 2; // left: a unit of the witness without one of the base
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = dp[i - 1]![j - 1]! + score(i - 1, j - 1);
      let mv = 0;
      const up = dp[i - 1]![j]! + INDEL;
      if (up > best) {
        best = up;
        mv = 1;
      }
      const left = dp[i]![j - 1]! + INDEL;
      if (left > best) {
        best = left;
        mv = 2;
      }
      dp[i]![j] = best;
      move[i]![j] = mv;
    }
  }
  const steps: Step[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = i === 0 ? 2 : j === 0 ? 1 : move[i]![j]!;
    if (mv === 0) steps.push({ b: row(--i), w: --j });
    else if (mv === 1) steps.push({ b: row(--i), w: -1 });
    else steps.push({ b: -1, w: --j });
  }
  return steps.reverse();
}

function alignWitness(
  base: CollationText,
  baseBare: string[],
  baseKeys: string[],
  witness: CollationText,
  bare: string[],
  keys: string[],
  alike: (a: string, b: string) => boolean,
  reach: number,
  farReach: number,
  away: ReadonlySet<number>,
): Aligned {
  const n = base.units.length;
  // Where the witness has no text, it is aligned with the rest of the base, and the units there are lost to it.
  const rows =
    away.size > 0 ? Array.from({ length: n }, (_, b) => b).filter((b) => !away.has(b)) : undefined;
  const steps: Step[] = [];
  const absentStep: boolean[] = [];
  const missing = [...away].sort((x, y) => x - y);
  let next = 0;
  for (const step of alignSteps(base, baseBare, baseKeys, witness, bare, keys, alike, rows)) {
    while (step.b >= 0 && next < missing.length && missing[next]! < step.b) {
      steps.push({ b: missing[next++]!, w: -1 });
      absentStep.push(true);
    }
    steps.push(step);
    absentStep.push(false);
  }
  while (next < missing.length) {
    steps.push({ b: missing[next++]!, w: -1 });
    absentStep.push(true);
  }
  const pairOf = new Array<number>(n).fill(-1);
  const inserted: number[][] = Array.from({ length: n + 1 }, () => []);
  /** For each step, the units of the base before it: where what the witness adds there stands. */
  const slotOf: number[] = [];
  let consumed = 0;
  for (const step of steps) {
    slotOf.push(consumed);
    if (step.b >= 0) {
      if (step.w >= 0) pairOf[step.b] = step.w;
      consumed++;
    } else inserted[consumed]!.push(step.w);
  }
  const baseGap = (s: Step) => s.b >= 0 && base.units[s.b]!.gap !== undefined;
  const witnessGap = (s: Step) => s.w >= 0 && witness.units[s.w]!.gap !== undefined;
  // The witness reads what the base reads; where the base itself is lost, a witness with nothing there says nothing against it.
  const agrees = (s: Step): boolean => {
    if (s.b >= 0 && s.w >= 0)
      return baseGap(s) ? witnessGap(s) : !witnessGap(s) && baseKeys[s.b] === keys[s.w];
    return s.w < 0 && baseGap(s);
  };
  // A loss in the witness reaches over the base's words it has nothing for on either side: lost, not left out.
  const lost = absentStep.slice();
  steps.forEach((step, k) => {
    if (!witnessGap(step) || agrees(step)) return;
    lost[k] = true;
    for (let p = k - 1; p >= 0 && steps[p]!.w < 0 && !baseGap(steps[p]!); p--) lost[p] = true;
    for (let p = k + 1; p < steps.length && steps[p]!.w < 0 && !baseGap(steps[p]!); p++)
      lost[p] = true;
  });

  // The stretches where the witness does not read with the base.
  interface Run {
    s0: number;
    s1: number;
    transposed: boolean;
  }
  const runs: Run[] = [];
  for (let k = 0; k < steps.length; ) {
    if (agrees(steps[k]!)) {
      k++;
      continue;
    }
    let e = k;
    while (e < steps.length && !agrees(steps[e]!)) e++;
    runs.push({ s0: k, s1: e, transposed: false });
    k = e;
  }

  // A stretch whose words are the base's in another order is a transposition: its
  // runs and the words between them become one, so that the apparatus reads
  // "swift red] red swift B" and not an omission beside an addition.
  const wordsOver = (s0: number, s1: number): { b: string[]; w: string[] } => {
    const b: string[] = [];
    const w: string[] = [];
    for (let k = s0; k < s1; k++) {
      const step = steps[k]!;
      if (step.b >= 0 && !baseGap(step)) b.push(baseBare[step.b]!);
      if (step.w >= 0 && !witnessGap(step)) w.push(bare[step.w]!);
    }
    return { b, w };
  };
  const SEP = '\u0001';
  // A stretch where the witness has lost something is no transposition: what it has there is not known.
  const lostIn = (s0: number, s1: number) => lost.slice(s0, s1).some((x) => x);
  const sameWords = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(SEP) === [...b].sort().join(SEP);
  // The shortest stretches first, so that a word read otherwise near a transposition is not drawn into it.
  for (let span = 0; span <= reach; span++) {
    for (let i = 0; i + span < runs.length; i++) {
      const j = i + span;
      const stretch = runs.slice(i, j + 1);
      if (stretch.some((r) => r.transposed)) continue;
      if (stretch.some((r, k) => k > 0 && r.s0 - stretch[k - 1]!.s1 > reach)) continue;
      if (lostIn(runs[i]!.s0, runs[j]!.s1)) continue;
      const { b, w } = wordsOver(runs[i]!.s0, runs[j]!.s1);
      if (b.length < 2 || !sameWords(b, w) || b.join(SEP) === w.join(SEP)) continue;
      runs.splice(i, span + 1, { s0: runs[i]!.s0, s1: runs[j]!.s1, transposed: true });
    }
  }
  // A word the witness adds in one place and lacks in another has changed places.
  const runAt = (step: number) => runs.findIndex((r) => step >= r.s0 && step < r.s1);
  const omitted = new Map<string, number[]>();
  const added: number[] = [];
  for (const run of runs) {
    if (run.transposed) continue;
    for (let k = run.s0; k < run.s1; k++) {
      const step = steps[k]!;
      if (lost[k]) continue;
      if (step.w < 0 && !baseGap(step)) {
        const list = omitted.get(baseBare[step.b]!) ?? [];
        list.push(k);
        omitted.set(baseBare[step.b]!, list);
      } else if (step.b < 0 && !witnessGap(step)) added.push(k);
    }
  }
  const farSteps: [number, number][] = [];
  // Where a step stands among the base's units: its unit, or the point before which it adds.
  const placeOf = (k: number) => (steps[k]!.b >= 0 ? steps[k]!.b : slotOf[k]!);
  for (const k of added) {
    const candidates = omitted.get(bare[steps[k]!.w]!);
    if (!candidates || candidates.length === 0) continue;
    candidates.sort((x, y) => Math.abs(x - k) - Math.abs(y - k));
    const other = candidates.shift()!;
    const a = runAt(k);
    const b = runAt(other);
    if (a < 0 || b < 0) continue;
    const [first, second] = a < b ? [a, b] : [b, a];
    // Farther apart than `farReach`, the two are an absence in one spot and an addition in the other.
    const near = Math.abs(placeOf(k) - placeOf(other)) <= farReach;
    if (lostIn(runs[first]!.s0, runs[second]!.s1)) {
      if (near) farSteps.push([k, other]);
    } else if (a === b) runs[a]!.transposed = true;
    else if (runs[second]!.s0 - runs[first]!.s1 <= reach)
      runs.splice(first, second - first + 1, {
        s0: runs[first]!.s0,
        s1: runs[second]!.s1,
        transposed: true,
      });
    else if (near) farSteps.push([k, other]);
  }

  // Each run as the witness's departures. A transposition is one, whole. A loss is one. Otherwise
  // each word read otherwise is one, with the words the witness adds beside it; a word it leaves
  // out beside one it reads otherwise is a departure by itself, unless the letters say that the
  // base's two words are the witness's one (φί λος against φίλος).
  const atoms: Atom[] = [];
  const push = (list: number[], lacunose: boolean, transposed: boolean) => {
    if (list.length === 0) return;
    let from = -1;
    let to = -1;
    for (const k of list) {
      const b = steps[k]!.b;
      if (b < 0) continue;
      if (from < 0 || b < from) from = b;
      if (b + 1 > to) to = b + 1;
    }
    if (from < 0) from = to = slotOf[list[0]!]!;
    const units = lacunose
      ? []
      : list
          .filter((k) => steps[k]!.w >= 0 && !witnessGap(steps[k]!))
          .map((k) => steps[k]!.w)
          .sort((x, y) => x - y);
    const same = atoms.find((a) => a.from === from && a.to === to);
    if (same) {
      // What is added and what is lost at one point is one departure there.
      same.units = [...same.units, ...units].sort((x, y) => x - y);
      same.lacunose ||= lacunose;
      same.steps.push(...list);
    } else atoms.push({ from, to, units, lacunose, transposed, steps: [...list] });
  };
  const range = (s0: number, s1: number) => Array.from({ length: s1 - s0 }, (_, k) => s0 + k);
  const lettersOf = (list: number[], side: 'b' | 'w') =>
    list
      .filter((k) => steps[k]![side] >= 0)
      .sort((x, y) => steps[x]![side] - steps[y]![side])
      .map((k) => (side === 'b' ? baseBare[steps[k]!.b]! : bare[steps[k]!.w]!))
      .join('');
  const likeness = (list: number[]) => similarity(lettersOf(list, 'b'), lettersOf(list, 'w'));
  const stretch = (s0: number, s1: number) => {
    const isPair = (k: number) => steps[k]!.b >= 0 && steps[k]!.w >= 0;
    const pairs = range(s0, s1).filter(isPair);
    if (pairs.length === 0) {
      push(range(s0, s1), false, false);
      return;
    }
    const groups = new Map<number, number[]>(pairs.map((k) => [k, [k]]));
    const alone: number[][] = [];
    // The steps between two pairs (or before the first, after the last) that pair nothing.
    for (let p = -1; p < pairs.length; p++) {
      const left = p >= 0 ? pairs[p]! : null;
      const right = p + 1 < pairs.length ? pairs[p + 1]! : null;
      const between = range(left === null ? s0 : left + 1, right === null ? s1 : right);
      if (between.length === 0) continue;
      const added = between.filter((k) => steps[k]!.b < 0);
      const left_out = between.filter((k) => steps[k]!.w < 0);
      const toward = (list: number[], gain: boolean): number | null => {
        let best: number | null = null;
        let bestScore = -Infinity;
        for (const pair of [left, right]) {
          if (pair === null) continue;
          const group = groups.get(pair)!;
          const score = likeness([...group, ...list]) - (gain ? likeness(group) : 0);
          if (score > bestScore) {
            best = pair;
            bestScore = score;
          }
        }
        return gain && bestScore <= 0 ? null : best;
      };
      if (added.length > 0 && left_out.length > 0) {
        // Words added and words left out at one point, with nothing paired: one reading with the neighbouring word.
        groups.get((left ?? right)!)!.push(...between);
        continue;
      }
      if (added.length > 0) groups.get(toward(added, false)!)!.push(...added);
      if (left_out.length > 0) {
        const pair = toward(left_out, true);
        if (pair === null) alone.push(left_out);
        else groups.get(pair)!.push(...left_out);
      }
    }
    for (const group of [...groups.values(), ...alone]) push(group, false, false);
  };
  for (const run of runs) {
    if (run.transposed) {
      push(range(run.s0, run.s1), false, true);
      continue;
    }
    let k = run.s0;
    while (k < run.s1) {
      let e = k;
      if (lost[k]) {
        while (e < run.s1 && lost[e]) e++;
        push(range(k, e), true, false);
      } else {
        while (e < run.s1 && !lost[e]) e++;
        stretch(k, e);
      }
      k = e;
    }
  }
  atoms.sort((x, y) => x.from - y.from || x.to - y.to);
  const atomAt = (step: number) => atoms.find((a) => a.steps.includes(step));
  const far: [Atom, Atom][] = [];
  for (const [x, y] of farSteps) {
    const one = atomAt(x);
    const other = atomAt(y);
    if (one && other && one !== other) far.push([one, other]);
  }
  const lostUnits = new Set<number>();
  steps.forEach((step, k) => {
    if (lost[k] && step.b >= 0) lostUnits.add(step.b);
  });
  return { text: witness, keys, atoms, pairOf, inserted, lost: lostUnits, far };
}

/**
 * Whether a witness is there at a place over the base's units [from, to)
 * (a point where from === to): it has lost none of those units, nor, at a
 * point, the unit on either side of it, nor has a gap of its own there. A
 * witness whose text runs on without the whole segment is there only at the
 * place over all of it, and one that stands nowhere is not there at all.
 * The place over the whole segment where some text runs on without it is
 * not asked of this: every witness with a word of the segment is there.
 */
function there(a: Aligned, from: number, to: number): boolean {
  if (a.outside) return false;
  if (a.atoms.some((atom) => atom.whole)) return from === 0 && to === a.pairOf.length;
  if (to > from) {
    for (let b = from; b < to; b++) if (a.lost.has(b)) return false;
    return true;
  }
  if (a.lost.has(from - 1) || a.lost.has(from)) return false;
  return !(a.inserted[from] ?? []).some((i) => a.text.units[i]!.gap);
}

/** A witness's departures that are reported: not its losses, and not where it is not there. */
function departures(a: Aligned): Atom[] {
  return a.atoms.filter((atom) => !atom.lacunose && there(a, atom.from, atom.to));
}

/**
 * Whether the place over the base's units [from, to) has no reading but
 * the absence of its words: every witness departing over exactly this
 * extent is without them.
 */
function absenceOnlyAt(aligned: Aligned[], from: number, to: number): boolean {
  if (to <= from) return false;
  let any = false;
  for (const a of aligned)
    for (const atom of departures(a)) {
      if (atom.from !== from || atom.to !== to) continue;
      if (atom.units.length > 0 || atom.transposed) return false;
      any = true;
    }
  return any;
}

/** Whether a witness has a word of its own standing with one of the base's units [from, to). */
function hasWordsIn(a: Aligned, from: number, to: number): boolean {
  if (a.outside || a.atoms.some((atom) => atom.whole)) return false;
  for (let b = from; b < to; b++) {
    const i = a.pairOf[b]!;
    if (i >= 0 && !a.text.units[i]!.gap) return true;
  }
  return false;
}

/**
 * How a witness stands to a place: with a reading of its own there; not
 * there, or reported at a wider place that holds this one, where its words
 * here are part of its reading (both "elsewhere"); or with the base. With
 * the base it stands also where it departs only within the place, or over a
 * stretch that merely overlaps it: those departures have places of their
 * own. At the place over the whole stretch that some text runs on without
 * (`wanting`), every witness with a word of the stretch is there. At a place
 * whose only other readings are that the words are not in a witness
 * (`absenceOnly`), a witness that has lost some of the words and has others
 * is there, since part of the words is evidence of them.
 */
function standing(
  a: Aligned,
  from: number,
  to: number,
  wanting: boolean,
  absenceOnly: boolean,
): Atom | 'elsewhere' | 'with' {
  if (a.outside) return 'elsewhere';
  if (wanting && from === 0 && to === a.pairOf.length)
    return a.atoms.find((atom) => atom.from === from && atom.to === to && !atom.lacunose) ?? 'with';
  if (!there(a, from, to) && !(absenceOnly && hasWordsIn(a, from, to))) return 'elsewhere';
  let covered = false;
  for (const atom of a.atoms) {
    if (atom.lacunose) continue;
    if (atom.from === from && atom.to === to) return atom;
    if (atom.whole) covered = true;
    else if (atom.to === atom.from) continue;
    else if (from === to) covered ||= atom.from < from && from < atom.to;
    else covered ||= atom.from <= from && to <= atom.to;
  }
  return covered ? 'elsewhere' : 'with';
}

/**
 * The readings of a place: the base's, with every witness that is there and
 * has no departure of this extent (whatever narrower ones it has inside,
 * which their own places report); then each other reading with its
 * witnesses. A witness that is not there is in none of them.
 */
function readingsAt(
  base: CollationText,
  baseKeys: string[],
  aligned: Aligned[],
  from: number,
  to: number,
  wanting: boolean,
): Reading[] {
  const baseUnits = base.units.slice(from, to);
  const baseWords = baseUnits.filter((u) => !u.gap);
  const baseReading: Reading = {
    text: baseWords.map((u) => u.text).join(' '),
    fold: baseKeys
      .slice(from, to)
      .filter((k) => k !== '')
      .join(' '),
    textIds: [base.id],
    sigla: [base.siglum],
    units: { [base.id]: baseWords },
    // Where witnesses add words, the base has none.
    omission: to === from,
    lacunose: baseWords.length === 0 && baseUnits.length > 0,
    base: true,
  };
  const groups = new Map<string, Reading>();
  const absenceOnly = absenceOnlyAt(aligned, from, to);
  for (const a of aligned) {
    const stands = standing(a, from, to, wanting, absenceOnly);
    if (stands === 'elsewhere') continue;
    const units =
      stands === 'with'
        ? projected(a, from, to).map((i) => a.text.units[i]!)
        : stands.units.map((i) => a.text.units[i]!);
    const key =
      stands === 'with' ? baseReading.fold : stands.units.map((i) => a.keys[i]!).join(' ');
    let reading = key === baseReading.fold ? baseReading : groups.get(key);
    if (!reading) {
      reading = {
        text: units.map((u) => u.text).join(' '),
        fold: key,
        textIds: [],
        sigla: [],
        units: {},
        omission: units.length === 0,
        lacunose: false,
        base: false,
      };
      groups.set(key, reading);
    }
    reading.textIds.push(a.text.id);
    reading.sigla.push(a.text.siglum);
    reading.units[a.text.id] = units;
  }
  return [baseReading, ...groups.values()];
}

/**
 * A witness's words standing with the base's units [from, to): those paired
 * with them and those added between them, but not words added at a point
 * where the witness also has a gap, which are not reported.
 */
function projected(a: Aligned, from: number, to: number): number[] {
  const out: number[] = [];
  for (let b = from; b < to; b++) {
    if (b > from) {
      const added = a.inserted[b]!;
      if (!added.some((i) => a.text.units[i]!.gap)) out.push(...added);
    }
    const i = a.pairOf[b]!;
    if (i >= 0 && !a.text.units[i]!.gap) out.push(i);
  }
  return out;
}

/**
 * A reading in words over a stretch of the base is a place in which every
 * witness is accounted for over the whole stretch. So:
 *
 * - readings that overlap without one lying within the other (two witnesses
 *   transposing stretches that share a word) are one place over all of them;
 * - a witness that departs within such a place (a word spelt otherwise or
 *   left out inside a stretch another witness transposes) is given its words
 *   over the whole of it, with what it adds at either end.
 *
 * Words a witness does not have make no such place: they keep their own
 * extent, and what others read otherwise inside it keeps theirs. A witness
 * that has lost something within the place is not drawn in: it stands only
 * in the places over the words it has. The extents are taken together, all
 * that hang on one another at once, so that the outcome does not depend on
 * the order of the witnesses.
 */
function uniteOverlapping(aligned: Aligned[]): boolean {
  const wide = (atom: Atom) => atom.to > atom.from && !atom.whole && atom.units.length > 0;
  const key = (r: { from: number; to: number }) => `${r.from}:${r.to}`;
  let changed = false;
  for (;;) {
    const extents = new Map<string, { from: number; to: number }>();
    for (const a of aligned)
      for (const atom of a.atoms) if (wide(atom)) extents.set(key(atom), atom);
    const list = [...extents.values()].map(({ from, to }) => ({ from, to }));
    // The groups of extents hanging on one another.
    const group = list.map((_, k) => k);
    const find = (k: number): number => (group[k] === k ? k : (group[k] = find(group[k]!)));
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const p = list[x]!;
        const q = list[y]!;
        const overlaps = Math.max(p.from, q.from) < Math.min(p.to, q.to);
        const nested = (p.from <= q.from && q.to <= p.to) || (q.from <= p.from && p.to <= q.to);
        if (overlaps && !nested) group[find(x)] = find(y);
      }
    }
    const united = new Map<number, { from: number; to: number; members: Set<string> }>();
    list.forEach((r, k) => {
      const g = find(k);
      const u = united.get(g) ?? { from: r.from, to: r.to, members: new Set<string>() };
      u.from = Math.min(u.from, r.from);
      u.to = Math.max(u.to, r.to);
      u.members.add(key(r));
      united.set(g, u);
    });
    // The widest first: what lies within a place is drawn into it before it can draw in anything itself.
    const places = [...united.values()].sort(
      (p, q) => q.to - q.from - (p.to - p.from) || p.from - q.from,
    );
    let any = false;
    for (const { from, to } of places) {
      for (const a of aligned) {
        if (a.outside) continue;
        // A witness with a departure over the place, or over a stretch that holds it, stays as it is.
        if (
          a.atoms.some(
            (atom) => atom.whole || (atom.from <= from && to <= atom.to && atom.to > atom.from),
          )
        )
          continue;
        const touches = (atom: Atom, lo: number, hi: number) =>
          atom.to > atom.from
            ? Math.max(atom.from, lo) < Math.min(atom.to, hi)
            : lo < atom.from && atom.from < hi;
        // A witness that has lost something here is not drawn in: its loss and what it reads beside it keep their places.
        if (a.atoms.some((atom) => atom.lacunose && touches(atom, from, to))) continue;
        const within = a.atoms.filter(
          (atom) => from <= atom.from && atom.to <= to && touches(atom, from, to),
        );
        if (within.length === 0) continue;
        // What the witness leaves out across an end of the place carries the place's end with it for this witness.
        let lo = from;
        let hi = to;
        for (const atom of a.atoms) {
          if (!touches(atom, from, to)) continue;
          lo = Math.min(lo, atom.from);
          hi = Math.max(hi, atom.to);
        }
        if (a.atoms.some((atom) => atom.lacunose && touches(atom, lo, hi))) continue;
        // With it, the words it adds at either end.
        const inside = a.atoms.filter(
          (atom) =>
            touches(atom, lo, hi) ||
            (atom.from === atom.to && (atom.from === lo || atom.from === hi)),
        );
        const units = new Set<number>(projected(a, lo, hi));
        for (const atom of inside) for (const i of atom.units) units.add(i);
        a.atoms = a.atoms.filter((atom) => !inside.includes(atom));
        a.atoms.push({
          from: lo,
          to: hi,
          units: [...units].sort((x, y) => x - y),
          lacunose: false,
          transposed: inside.some((atom) => atom.transposed),
          steps: inside.flatMap((atom) => atom.steps),
        });
        a.atoms.sort((x, y) => x.from - y.from || x.to - y.to);
        any = true;
      }
    }
    if (!any) return changed;
    changed = true;
  }
}

/**
 * Neighbouring places that divide the witnesses in the same way become one:
 * the same witnesses depart at both, in the same groups, and the others
 * stand with the base at both, or are not there at both. Transpositions and
 * whole segments stay as they are, losses make no place to join, and a place
 * where only the reading of the letters differs is not joined to one where
 * the letters do.
 */
function joinPlaces(
  base: CollationText,
  baseKeys: string[],
  aligned: Aligned[],
  wanting: boolean,
): boolean {
  const division = (from: number, to: number): string | null => {
    const groups = new Map<string, number>();
    const out: string[] = [];
    const absenceOnly = absenceOnlyAt(aligned, from, to);
    for (const a of aligned) {
      const stands = standing(a, from, to, wanting, absenceOnly);
      if (stands === 'elsewhere') out.push('e');
      else if (stands === 'with') out.push('b');
      else {
        if (stands.transposed || stands.whole) return null;
        const key = stands.units.map((i) => a.keys[i]!).join(' ');
        if (!groups.has(key)) groups.set(key, groups.size);
        out.push(String(groups.get(key)));
      }
    }
    return out.join(',') + '|' + siteKindOf(readingsAt(base, baseKeys, aligned, from, to, wanting));
  };
  let changed = false;
  for (;;) {
    // Every extent, a loss's included, for telling whether two stretches are neighbours; the places are those reported.
    const byExtent = new Map<string, { from: number; to: number }>();
    const reported = new Map<string, { from: number; to: number }>();
    for (const a of aligned) {
      for (const atom of a.atoms) byExtent.set(`${atom.from}:${atom.to}`, atom);
      for (const atom of departures(a)) reported.set(`${atom.from}:${atom.to}`, atom);
    }
    // In the order of the text, so that the result does not depend on the order of the witnesses.
    const places = [...reported.values()].sort((p, q) => p.from - q.from || p.to - q.to);
    let joined = false;
    for (const p of places) {
      for (const q of places) {
        if (p === q || p.to !== q.from || (p.from === q.from && p.to === q.to)) continue;
        // Two stretches with words added between them by someone are neighbours only through that point.
        if (p.to > p.from && q.to > q.from && byExtent.has(`${p.to}:${p.to}`)) continue;
        const one = division(p.from, p.to);
        if (one === null || one !== division(q.from, q.to)) continue;
        const [from, mid, end] = [p.from, p.to, q.to];
        const first = (atom: Atom) => !atom.lacunose && atom.from === from && atom.to === mid;
        const second = (atom: Atom) => !atom.lacunose && atom.from === mid && atom.to === end;
        for (const a of aligned) {
          const left = a.atoms.find(first);
          const right = a.atoms.find(second);
          if (!left || !right || left === right) continue;
          left.to = end;
          left.units = [...left.units, ...right.units].sort((x, y) => x - y);
          left.steps.push(...right.steps);
          a.atoms.splice(a.atoms.indexOf(right), 1);
        }
        joined = true;
        break;
      }
      if (joined) break;
    }
    if (!joined) return changed;
    changed = true;
  }
}

/**
 * The table of the alignment, in the base's order: a column for each unit
 * of the base, and before each (and after the last) as many columns as the
 * witness adding most there has words.
 */
function buildColumns(
  base: CollationText,
  aligned: Aligned[],
): { columns: Column[]; baseColumn: number[]; slotColumn: number[] } {
  const n = base.units.length;
  const shown = aligned.filter((a) => !a.outside && !a.atoms.some((atom) => atom.whole));
  const columns: Column[] = [];
  const baseColumn: number[] = [];
  const slotColumn: number[] = [];
  for (let s = 0; s <= n; s++) {
    slotColumn.push(columns.length);
    const most = Math.max(0, ...shown.map((a) => a.inserted[s]!.length));
    for (let k = 0; k < most; k++) {
      const cells = new Map<Id, Cell>();
      for (const a of shown) {
        const i = a.inserted[s]![k];
        if (i === undefined) continue;
        cells.set(
          a.text.id,
          a.text.units[i]!.gap ? { unitIndex: i, lacunose: true } : { unitIndex: i },
        );
      }
      columns.push({ cells });
    }
    if (s === n) break;
    baseColumn.push(columns.length);
    const cells = new Map<Id, Cell>([[base.id, { unitIndex: s }]]);
    for (const a of shown) {
      const i = a.pairOf[s]!;
      if (i >= 0)
        cells.set(
          a.text.id,
          a.text.units[i]!.gap ? { unitIndex: i, lacunose: true } : { unitIndex: i },
        );
      else if (a.lost.has(s)) cells.set(a.text.id, { unitIndex: -1, lacunose: true });
    }
    columns.push({ cells });
  }
  return { columns, baseColumn, slotColumn };
}

/** The columns where every text that has the segment and is there reads with the base. */
function anchorColumns(
  columns: Column[],
  base: CollationText,
  baseKeys: string[],
  present: Aligned[],
): number[] {
  const anchors: number[] = [];
  columns.forEach((column, index) => {
    const baseCell = column.cells.get(base.id);
    if (!baseCell) return;
    const baseKey = baseKeys[baseCell.unitIndex] ?? '';
    if (baseKey === '') return;
    for (const a of present) {
      const cell = column.cells.get(a.text.id);
      // A witness that has lost the word is not there: it neither agrees nor disagrees.
      if (cell?.lacunose) continue;
      if (!cell || a.keys[cell.unitIndex] !== baseKey) return;
    }
    anchors.push(index);
  });
  return anchors;
}

/**
 * The editor's word on some sites, by site key: the kind of a place, put
 * over the classification by letters, and whether it is minor. A key that no
 * longer names a site is ignored.
 */
export function applySiteKinds(
  collation: Collation,
  baseUnits: Unit[],
  marks: ReadonlyMap<string, SiteMark> | undefined,
): Collation {
  if (!marks || marks.size === 0) return collation;
  return {
    ...collation,
    sites: collation.sites.map((site) => {
      const mark = marks.get(siteKey(site, baseUnits));
      if (!mark) return site;
      let marked = site;
      if (mark.kind && mark.kind !== site.kind)
        marked = { ...marked, kind: mark.kind, kindByEditor: true };
      if (mark.minor) marked = { ...marked, minor: true };
      return marked;
    }),
  };
}

/** A stable key for a site, from the base's token ids it covers, for review marks and constraints. */
export function siteKey(site: Site, baseUnits: Unit[]): string {
  if (site.baseTo > site.baseFrom) {
    const ids = new Set<string>();
    for (let i = site.baseFrom; i < site.baseTo; i++)
      for (const id of baseUnits[i]?.tokenIds ?? []) ids.add(id);
    // The site of the witnesses lacking the segment may cover the same words as another: it is told apart.
    return (site.wanting ? 'wanting:' : '') + [...ids].join(',');
  }
  const before = baseUnits[site.baseFrom - 1]?.tokenIds.join(',') ?? '^';
  const after = baseUnits[site.baseFrom]?.tokenIds.join(',') ?? '$';
  return `${before}|${after}`;
}

/**
 * The witnesses that are there at a site: the texts of its readings, the
 * base excluded. A witness that has lost the words, or has no text for the
 * segment, is in no reading and so is not among them. In the order of
 * `order` (the texts as they were given to collate) where it is given, a
 * text it does not name after those it does; otherwise in the order the
 * readings name them, the base's reading first.
 */
export function witnessesAt(site: Pick<Site, 'readings'>, baseId: Id, order?: readonly Id[]): Id[] {
  const ids = [...new Set(site.readings.flatMap((r) => r.textIds))].filter((id) => id !== baseId);
  if (!order) return ids;
  const rank = new Map(order.map((id, k) => [id, k]));
  const at = (id: Id, k: number) => rank.get(id) ?? order.length + k;
  return ids
    .map((id, k) => ({ id, k }))
    .sort((x, y) => at(x.id, x.k) - at(y.id, y.k))
    .map((x) => x.id);
}

/**
 * The witnesses in which a site's words are an addition, in the editor's
 * judgement as the edition's text shows it: where the base has no words,
 * those whose reading has words; where the edition prints all the site's
 * words as deleted (`deleted`, which the caller tells from the edition's
 * tokens), those that have the base's words. Otherwise none. In the order
 * the readings name them.
 *
 * Where the site is one of two that name each other, because a witness has a
 * word in another place nearby (of this stretch, or of the neighbouring
 * passage), that witness has added nothing at this one: the word is the
 * edition's, standing elsewhere.
 */
export function additionIn(
  site: Pick<Site, 'baseFrom' | 'baseTo' | 'readings'> &
    Partial<Pick<Site, 'index' | 'transposition'>>,
  baseId: Id,
  deleted: boolean,
): Id[] {
  const readings =
    site.baseFrom === site.baseTo
      ? site.readings.filter((r) => !r.base && !r.omission)
      : deleted
        ? site.readings.filter((r) => r.base)
        : [];
  const standingElsewhere =
    site.transposition &&
    (site.transposition.inPassage !== undefined || site.transposition.withSite !== site.index);
  const moved = new Set<Id>(standingElsewhere ? site.transposition!.textIds : []);
  return readings.flatMap((r) => r.textIds).filter((id) => id !== baseId && !moved.has(id));
}
