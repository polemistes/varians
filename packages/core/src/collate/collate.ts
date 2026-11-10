/**
 * Collation: a pure function from the words of one segment in a base text
 * and in each witness to the places where they differ: different words, not
 * different ways of writing them, which the normalized forms have already
 * evened out.
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
 * own: one word read otherwise, with whatever it adds or leaves out beside
 * it; words added between two of the base's; a stretch left out or lost; a
 * stretch whose words stand in another order. Each such extent is a place.
 * Witnesses departing over the same extent are readings of one place; a
 * small variant inside a wide one (a word spelt otherwise within a stretch
 * that another witness transposes or omits) is a place of its own, in which
 * the witness of the wide variant does not stand. Neighbouring places that
 * divide the witnesses in the same way are one place, so that a phrase a
 * family reads otherwise is one variant and not a row of single words.
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
   * The text reaches this segment even when it has no units for it: it
   * lacks the passage, and is reported as omitting it, where a text with no
   * units and without this flag is absent and stands in no site.
   */
  present?: boolean;
}

export interface CollationOptions {
  fold?: FoldOptions;
  /** Similarity of diacritic-stripped fold keys at or above which two words are a near match. */
  nearThreshold?: number;
  /** Anchor columns between two transposed sites at or below which the sites are merged into one. */
  transpositionReach?: number;
}

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
  /** The words as read, joined by spaces; empty for an omission. */
  text: string;
  fold: string;
  /** The texts (base or witnesses) that have this reading, in input order. */
  textIds: Id[];
  sigla: string[];
  /** Each text's units at the site, in that text's own order. */
  units: Record<Id, Unit[]>;
  /** The reading is nothing where others have words. */
  omission: boolean;
  /** At least one text with this reading is lacunose across the site. */
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
  /** The witness texts whose words here exchange places with those of another site. */
  transposition?: { withSite: number; textIds: Id[] };
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
   * The site over the whole segment that some witness lacks entirely
   * (omits it, or has lost it): it stands beside the segment's other sites,
   * which are found without those witnesses, and overlaps them.
   */
  wanting?: boolean;
  /** The editor has chosen not to report the place: the apparatus leaves it out. */
  unreported?: boolean;
}

export type SiteKind = 'textual' | 'interpretative';

/** What an editor may say of a place: its kind, over what the letters say, or that it is not to be reported. */
export type SiteMark = SiteKind | 'unreported';

/**
 * Whether readings differ in their letters, or only in how the same letters
 * are read. A lacuna tells nothing of the letters; a place where nothing
 * but a lacuna differs reports the witness, and is textual.
 */
export function siteKindOf(readings: Pick<Reading, 'text' | 'lacunose'>[]): SiteKind {
  const legible = readings.filter((r) => !(r.lacunose && r.text === ''));
  const letters = new Set(legible.map((r) => archetypeLetters(r.text)));
  return legible.length > 1 && letters.size === 1 ? 'interpretative' : 'textual';
}

export interface Collation {
  columns: Column[];
  sites: Site[];
  /** Column indexes where every present text agrees with the base. */
  anchors: number[];
  baseId: Id;
  /** Texts given with no units at all: absent from the segment. */
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
  /** The witness is lost here and has no reading. */
  lacunose: boolean;
  /** The base's words in another order. */
  transposed: boolean;
  /** The witness lacks the whole segment. */
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
  /** Units of the base the witness has lost. */
  lost: Set<number>;
  /** Words the witness has in one place and lacks in another, too far apart to be one place. */
  far: [Atom, Atom][];
  /** The witness lacks a segment in which the base has no words either: it stands nowhere. */
  outside?: boolean;
}

export function collate(
  base: CollationText,
  witnesses: CollationText[],
  options: CollationOptions = {},
): Collation {
  const fold = options.fold ?? DEFAULT_FOLD;
  const near = options.nearThreshold ?? 0.6;
  const reach = options.transpositionReach ?? 3;
  // Words are placed by their letters, so that ἦ stands against ἤ; whether they agree is decided by their accents too.
  const bareOf = (text: CollationText) =>
    text.units.map((u) => (u.gap ? '' : foldText(u.text, { ...fold, stripDiacritics: true })));
  const keysOf = (text: CollationText) =>
    text.units.map((u) => (u.gap ? '' : agreementFold(u.text, fold)));
  const baseBare = bareOf(base);
  const baseKeys = keysOf(base);
  const n = base.units.length;
  const baseHasWords = base.units.some((u) => !u.gap);

  const absent: Id[] = [];
  const aligned: Aligned[] = [];
  for (const witness of witnesses) {
    if (witness.units.length === 0 && !witness.present) {
      // A text without the segment at all is absent, not omitting: it stands in no place.
      absent.push(witness.id);
      continue;
    }
    const lost = witness.units.length > 0 && witness.units.every((u) => u.gap);
    if (witness.units.length === 0 || lost) {
      aligned.push(lacking(witness, n, lost, baseHasWords));
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
        near,
        reach,
      ),
    );
  }

  // Uniting may make neighbours of places that divide the witnesses alike, and joining may make two readings overlap: until neither does.
  for (;;) {
    const united = uniteOverlapping(aligned);
    const joined = joinPlaces(base, baseKeys, aligned);
    if (!united && !joined) break;
  }

  const { columns, baseColumn, slotColumn } = buildColumns(base, aligned);
  const inColumns = aligned.filter((a) => !a.atoms.some((atom) => atom.whole) && !a.outside);
  const anchors = anchorColumns(columns, base, baseKeys, inColumns);

  // The places: every extent over which some witness departs, a place nested in another before it.
  const ranges = new Map<string, { from: number; to: number }>();
  for (const a of aligned) for (const atom of a.atoms) ranges.set(`${atom.from}:${atom.to}`, atom);
  const places = [...ranges.values()]
    .map(({ from, to }) => ({ from, to }))
    .sort(
      (p, q) => p.to - q.to || Number(p.from === p.to) - Number(q.from === q.to) || q.from - p.from,
    );
  const sites: Site[] = places.map(({ from, to }, index) => {
    const readings = readingsAt(base, baseKeys, aligned, from, to);
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
    if (from === 0 && to === n && own.some((o) => o.atom.whole)) site.wanting = true;
    return site;
  });
  // A word a witness has in one place and lacks in another, too far apart to be one place: each half names the other.
  const siteOfAtom = (atom: Atom) =>
    sites.find((s) => s.baseFrom === atom.from && s.baseTo === atom.to);
  for (const a of aligned) {
    for (const [one, other] of a.far) {
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
}

/**
 * A witness that lacks the whole segment, by leaving it out or by having
 * lost it: one departure over all of it, beside which every other place of
 * the segment stands without the witness.
 */
function lacking(witness: CollationText, n: number, lost: boolean, baseHasWords: boolean): Aligned {
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
      lacunose: lost,
      transposed: false,
      whole: true,
      steps: [],
    });
  else out.outside = true;
  return out;
}

/** Needleman-Wunsch, global alignment of a witness's units with the base's, by the letters of their words. */
function alignSteps(
  base: CollationText,
  baseBare: string[],
  baseKeys: string[],
  witness: CollationText,
  bare: string[],
  keys: string[],
  near: number,
): Step[] {
  const n = base.units.length;
  const m = witness.units.length;
  const score = (i: number, j: number): number => {
    const b = base.units[i]!.gap !== undefined;
    const w = witness.units[j]!.gap !== undefined;
    // Two losses at the same point stand together; a loss against a word says nothing either way.
    if (b && w) return AGREE;
    if (b || w) return GAP_UNIT;
    if (baseBare[i] === bare[j]) return baseKeys[i] === keys[j] ? AGREE : SAME_LETTERS;
    return similarity(baseBare[i]!, bare[j]!) >= near ? NEAR : MISMATCH;
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
    if (mv === 0) steps.push({ b: --i, w: --j });
    else if (mv === 1) steps.push({ b: --i, w: -1 });
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
  near: number,
  reach: number,
): Aligned {
  const n = base.units.length;
  const steps = alignSteps(base, baseBare, baseKeys, witness, bare, keys, near);
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
  const lost = new Array<boolean>(steps.length).fill(false);
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
  const sameWords = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(SEP) === [...b].sort().join(SEP);
  // The shortest stretches first, so that a word read otherwise near a transposition is not drawn into it.
  for (let span = 0; span <= reach; span++) {
    for (let i = 0; i + span < runs.length; i++) {
      const j = i + span;
      const stretch = runs.slice(i, j + 1);
      if (stretch.some((r) => r.transposed)) continue;
      if (stretch.some((r, k) => k > 0 && r.s0 - stretch[k - 1]!.s1 > reach)) continue;
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
  for (const k of added) {
    const candidates = omitted.get(bare[steps[k]!.w]!);
    if (!candidates || candidates.length === 0) continue;
    candidates.sort((x, y) => Math.abs(x - k) - Math.abs(y - k));
    const other = candidates.shift()!;
    const a = runAt(k);
    const b = runAt(other);
    if (a < 0 || b < 0) continue;
    if (a === b) {
      runs[a]!.transposed = true;
      continue;
    }
    const [first, second] = a < b ? [a, b] : [b, a];
    if (runs[second]!.s0 - runs[first]!.s1 <= reach)
      runs.splice(first, second - first + 1, {
        s0: runs[first]!.s0,
        s1: runs[second]!.s1,
        transposed: true,
      });
    else farSteps.push([k, other]);
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
 * How a witness stands to a place: with a reading of its own there; reported
 * at a wider place that holds this one, where its words here are part of its
 * reading; or with the base. With the base it stands also where it departs
 * only within the place, or over a stretch that merely overlaps it: those
 * departures have places of their own.
 */
function standing(a: Aligned, from: number, to: number): Atom | 'elsewhere' | 'with' {
  if (a.outside) return 'elsewhere';
  let covered = false;
  for (const atom of a.atoms) {
    if (atom.from === from && atom.to === to) return atom;
    if (atom.whole) covered = true;
    else if (atom.to === atom.from) continue;
    else if (from === to) covered ||= atom.from < from && from < atom.to;
    else covered ||= atom.from <= from && to <= atom.to;
  }
  return covered ? 'elsewhere' : 'with';
}

const LOST = '\u0000lost';

/**
 * The readings of a place: the base's, with every witness that has no
 * departure of this extent (whatever narrower ones it has inside, which
 * their own places report); then each other reading with its witnesses.
 */
function readingsAt(
  base: CollationText,
  baseKeys: string[],
  aligned: Aligned[],
  from: number,
  to: number,
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
  for (const a of aligned) {
    const stands = standing(a, from, to);
    if (stands === 'elsewhere') continue;
    const units =
      stands === 'with'
        ? projected(a, from, to).map((i) => a.text.units[i]!)
        : stands.units.map((i) => a.text.units[i]!);
    const lost = stands !== 'with' && stands.lacunose;
    const key =
      stands === 'with'
        ? baseReading.fold
        : lost && units.length === 0
          ? LOST
          : stands.units.map((i) => a.keys[i]!).join(' ');
    let reading = key === baseReading.fold && !lost ? baseReading : groups.get(key);
    if (!reading) {
      reading = {
        text: units.map((u) => u.text).join(' '),
        fold: key === LOST ? '' : key,
        textIds: [],
        sigla: [],
        units: {},
        omission: units.length === 0 && !lost,
        lacunose: false,
        base: false,
      };
      groups.set(key, reading);
    }
    reading.textIds.push(a.text.id);
    reading.sigla.push(a.text.siglum);
    reading.units[a.text.id] = units;
    if (lost) reading.lacunose = true;
  }
  return [baseReading, ...groups.values()];
}

/** A witness's words standing with the base's units [from, to): those paired with them and those added between them. */
function projected(a: Aligned, from: number, to: number): number[] {
  const out: number[] = [];
  for (let b = from; b < to; b++) {
    if (b > from) for (const i of a.inserted[b]!) if (!a.text.units[i]!.gap) out.push(i);
    const i = a.pairOf[b]!;
    if (i >= 0 && !a.text.units[i]!.gap) out.push(i);
  }
  return out;
}

/**
 * Readings that overlap without one lying within the other (two witnesses
 * transposing stretches that share a word) are one place over all of them:
 * each of their witnesses is given its words over the whole of it. What a
 * witness leaves out or has lost is not drawn in: an omission or a loss
 * keeps its own extent whatever it overlaps. The extents are taken together,
 * all that hang on one another at once, so that the outcome does not depend
 * on the order of the witnesses.
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
    let any = false;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const p = list[x]!;
        const q = list[y]!;
        const overlaps = Math.max(p.from, q.from) < Math.min(p.to, q.to);
        const nested = (p.from <= q.from && q.to <= p.to) || (q.from <= p.from && p.to <= q.to);
        if (!overlaps || nested) continue;
        group[find(x)] = find(y);
        any = true;
      }
    }
    if (!any) return changed;
    changed = true;
    const united = new Map<number, { from: number; to: number; members: Set<string> }>();
    list.forEach((r, k) => {
      const g = find(k);
      const u = united.get(g) ?? { from: r.from, to: r.to, members: new Set<string>() };
      u.from = Math.min(u.from, r.from);
      u.to = Math.max(u.to, r.to);
      u.members.add(key(r));
      united.set(g, u);
    });
    for (const { from, to, members } of united.values()) {
      if (members.size < 2) continue;
      for (const a of aligned) {
        if (!a.atoms.some((atom) => wide(atom) && members.has(key(atom)))) continue;
        // The witness's departure over the whole, with everything of its own that lies inside.
        const inside = a.atoms.filter((atom) => !atom.whole && from <= atom.from && atom.to <= to);
        const units = new Set<number>(projected(a, from, to));
        for (const atom of inside) for (const i of atom.units) units.add(i);
        a.atoms = a.atoms.filter((atom) => !inside.includes(atom));
        a.atoms.push({
          from,
          to,
          units: [...units].sort((x, y) => x - y),
          lacunose: inside.some((atom) => atom.lacunose),
          transposed: inside.some((atom) => atom.transposed),
          steps: inside.flatMap((atom) => atom.steps),
        });
        a.atoms.sort((x, y) => x.from - y.from || x.to - y.to);
      }
    }
  }
}

/**
 * Neighbouring places that divide the witnesses in the same way become one:
 * the same witnesses depart at both, in the same groups, and the others
 * stand with the base at both. Transpositions, losses and whole segments
 * stay as they are, and a place where only the reading of the letters
 * differs is not joined to one where the letters do.
 */
function joinPlaces(base: CollationText, baseKeys: string[], aligned: Aligned[]): boolean {
  const division = (from: number, to: number): string | null => {
    const groups = new Map<string, number>();
    const out: string[] = [];
    for (const a of aligned) {
      const stands = standing(a, from, to);
      if (stands === 'elsewhere') out.push('e');
      else if (stands === 'with') out.push('b');
      else {
        if (stands.transposed || stands.whole || stands.lacunose) return null;
        const key = stands.units.map((i) => a.keys[i]!).join(' ');
        if (!groups.has(key)) groups.set(key, groups.size);
        out.push(String(groups.get(key)));
      }
    }
    return out.join(',') + '|' + siteKindOf(readingsAt(base, baseKeys, aligned, from, to));
  };
  let changed = false;
  for (;;) {
    const byExtent = new Map<string, { from: number; to: number }>();
    for (const a of aligned)
      for (const atom of a.atoms) byExtent.set(`${atom.from}:${atom.to}`, atom);
    // In the order of the text, so that the result does not depend on the order of the witnesses.
    const places = [...byExtent.values()].sort((p, q) => p.from - q.from || p.to - q.to);
    let joined = false;
    for (const p of places) {
      for (const q of places) {
        if (p === q || p.to !== q.from || (p.from === q.from && p.to === q.to)) continue;
        // Two stretches with words added between them by someone are neighbours only through that point.
        if (p.to > p.from && q.to > q.from && byExtent.has(`${p.to}:${p.to}`)) continue;
        const one = division(p.from, p.to);
        if (one === null || one !== division(q.from, q.to)) continue;
        const [from, mid, end] = [p.from, p.to, q.to];
        const first = (atom: Atom) => atom.from === from && atom.to === mid;
        const second = (atom: Atom) => atom.from === mid && atom.to === end;
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

/** The columns where every text that has the segment reads with the base. */
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
      // A lacunose witness neither agrees nor disagrees; the apparatus still reports it.
      if (!cell || cell.lacunose || a.keys[cell.unitIndex] !== baseKey) return;
    }
    anchors.push(index);
  });
  return anchors;
}

/**
 * The editor's word on some sites, by site key: the kind of a place, put
 * over the classification by letters, or that the place is not reported. A
 * key that no longer names a site is ignored.
 */
export function applySiteKinds(
  collation: Collation,
  baseUnits: Unit[],
  kinds: ReadonlyMap<string, SiteMark> | undefined,
): Collation {
  if (!kinds || kinds.size === 0) return collation;
  return {
    ...collation,
    sites: collation.sites.map((site) => {
      const mark = kinds.get(siteKey(site, baseUnits));
      if (mark === 'unreported') return { ...site, unreported: true };
      return mark && mark !== site.kind ? { ...site, kind: mark, kindByEditor: true } : site;
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
