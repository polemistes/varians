/**
 * Collation: a pure function from the words of one segment in a base text
 * and in each witness to the sites where they differ: different words, not
 * different ways of writing them, which the normalized forms have already
 * evened out.
 *
 * Words are compared by their normalized forms as the editor typed them,
 * under the work's fold (case, punctuation): a different accent or
 * breathing is a different word, but a grave counts as an acute. The
 * diplomatic forms play no part: whatever differs between a witness's
 * diplomatic and normalized text is normalization.
 *
 * The base (an edition's text, or the first witness when transcriptions are
 * compared among themselves) seeds a sequence of columns. Each witness in
 * turn is aligned to the columns by dynamic programming over fold keys,
 * rewarding exact matches, rewarding near matches less, and penalising
 * gaps; words of the witness that match nothing open new columns. Columns
 * where every present witness agrees with the base are anchors; every
 * maximal run between anchors is a site, whose readings are each witness's
 * words there, grouped by fold. Nothing here is stored: the result is
 * recomputed whenever a text changes and cached by a hash of its inputs.
 */

import { agreementFold, archetypeLetters, fold as foldText, type FoldOptions, DEFAULT_FOLD } from '../normalize/fold.ts';
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
}

export type SiteKind = 'textual' | 'interpretative';

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

const EXACT = 3;
const NEAR = 1;
const GAP_UNIT = 0;
const MISMATCH = -2;
const INDEL = -1;

export function collate(base: CollationText, witnesses: CollationText[], options: CollationOptions = {}): Collation {
  const fold = options.fold ?? DEFAULT_FOLD;
  const near = options.nearThreshold ?? 0.6;
  const reach = options.transpositionReach ?? 3;
  // Words are placed by their letters, so that ἦ stands against ἤ; whether they agree is decided by their accents too.
  const bare = new Map<Id, string[]>();
  const keys = new Map<Id, string[]>();
  const texts = [base, ...witnesses];
  for (const text of texts) {
    bare.set(text.id, text.units.map((u) => (u.gap ? '' : foldText(u.text, { ...fold, stripDiacritics: true }))));
    keys.set(text.id, text.units.map((u) => (u.gap ? '' : agreementFold(u.text, fold))));
  }

  let columns: Column[] = base.units.map((_, i) => ({ cells: new Map([[base.id, { unitIndex: i }]]) }));
  const absent: Id[] = [];
  const transpositions: { textId: Id; insertedColumn: number; omittedColumn: number }[] = [];
  // Witnesses that lack the whole segment: present without words, or with nothing but a gap.
  const omitting = witnesses.filter((w) => w.present && w.units.length === 0);
  const lost = witnesses.filter((w) => w.units.length > 0 && w.units.every((u) => u.gap));
  const wanting = new Set([...omitting, ...lost].map((w) => w.id));

  for (const witness of witnesses) {
    if (wanting.has(witness.id)) continue;
    if (witness.units.length === 0) {
      if (!witness.present) absent.push(witness.id);
      continue;
    }
    const result = alignWitness(columns, witness, bare, near);
    columns = result.columns;
    markLacunae(columns, witness.id, witness.units);
    for (const link of findTranspositions(columns, witness.id, base.id, bare)) transpositions.push(link);
  }

  // A text without the segment at all is absent, not omitting: it stands in no site.
  // A text that lacks the whole segment stands in one site of its own over all of it.
  const absentSet = new Set(absent);
  const present = texts.filter((t) => !absentSet.has(t.id) && !wanting.has(t.id));
  const anchors = anchorColumns(columns, base.id, keys, present.map((t) => t.id));
  const sites = buildSites(columns, anchors, base, present, keys, bare, transpositions, reach);
  if (wanting.size > 0 && base.units.some((u) => !u.gap)) sites.push(wantingSite(sites.length, columns.length, base, present, keys, omitting, lost));
  const sigla: Record<Id, string> = {};
  for (const text of texts) sigla[text.id] = text.siglum;
  return { columns, sites, anchors, baseId: base.id, absent, sigla };
}

/**
 * The site over the whole segment for the witnesses that lack it: the base
 * with every witness that has the passage (whatever its words there, which
 * the other sites report), against an omission and a loss.
 */
function wantingSite(
  index: number,
  columnCount: number,
  base: CollationText,
  present: CollationText[],
  keys: Map<Id, string[]>,
  omitting: CollationText[],
  lost: CollationText[],
): Site {
  const words = base.units.filter((u) => !u.gap);
  const having: Reading = {
    text: words.map((u) => u.text).join(' '),
    fold: base.units.map((u, i) => (u.gap ? '' : keyOf(keys, base.id, i))).filter((k) => k !== '').join(' '),
    textIds: present.map((t) => t.id),
    sigla: present.map((t) => t.siglum),
    units: Object.fromEntries(present.map((t) => [t.id, t.units.filter((u) => !u.gap)] as const)),
    omission: false,
    lacunose: false,
    base: true,
  };
  const lacking = (texts: CollationText[], lacunose: boolean): Reading => ({
    text: '',
    fold: '',
    textIds: texts.map((t) => t.id),
    sigla: texts.map((t) => t.siglum),
    units: Object.fromEntries(texts.map((t) => [t.id, []] as const)),
    omission: !lacunose,
    lacunose,
    base: false,
  });
  const readings = [having, ...(omitting.length ? [lacking(omitting, false)] : []), ...(lost.length ? [lacking(lost, true)] : [])];
  return {
    index,
    columnFrom: 0,
    columnTo: columnCount,
    baseFrom: 0,
    baseTo: base.units.length,
    readings,
    kind: 'textual',
    wanting: true,
  };
}

function keyOf(keys: Map<Id, string[]>, textId: Id, unitIndex: number): string {
  return keys.get(textId)?.[unitIndex] ?? '';
}

/** The fold keys standing in a column, base first. */
function columnKeys(column: Column, keys: Map<Id, string[]>, baseId: Id): string[] {
  const out: string[] = [];
  const baseCell = column.cells.get(baseId);
  if (baseCell) out.push(keyOf(keys, baseId, baseCell.unitIndex));
  for (const [textId, cell] of column.cells) {
    if (textId === baseId) continue;
    const key = keyOf(keys, textId, cell.unitIndex);
    if (key !== '' && !out.includes(key)) out.push(key);
  }
  return out;
}

function alignWitness(
  columns: Column[],
  witness: CollationText,
  keys: Map<Id, string[]>,
  near: number,
): { columns: Column[] } {
  const n = columns.length;
  const m = witness.units.length;
  const wKeys = keys.get(witness.id)!;
  // Score of placing witness unit j in column i.
  const score = (i: number, j: number): number => {
    const unit = witness.units[j]!;
    if (unit.gap) return GAP_UNIT;
    const column = columns[i]!;
    let best = MISMATCH;
    for (const [textId, cell] of column.cells) {
      const key = keyOf(keys, textId, cell.unitIndex);
      if (key === '') continue;
      if (key === wKeys[j]) return EXACT;
      if (similarity(key, wKeys[j]!) >= near) best = Math.max(best, NEAR);
    }
    return best;
  };
  // Needleman-Wunsch, global alignment. dp[i][j] is the best score aligning columns[0..i) with units[0..j).
  const dp: number[][] = [];
  const move: Uint8Array[] = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array<number>(m + 1).fill(0));
    move.push(new Uint8Array(m + 1));
  }
  for (let i = 1; i <= n; i++) {
    dp[i]![0] = i * INDEL;
    move[i]![0] = 1; // up: column without witness unit
  }
  for (let j = 1; j <= m; j++) {
    dp[0]![j] = j * INDEL;
    move[0]![j] = 2; // left: witness unit without column
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1]![j - 1]! + score(i - 1, j - 1);
      const up = dp[i - 1]![j]! + INDEL;
      const left = dp[i]![j - 1]! + INDEL;
      let best = diag;
      let m = 0;
      if (up > best) {
        best = up;
        m = 1;
      }
      if (left > best) {
        best = left;
        m = 2;
      }
      dp[i]![j] = best;
      move[i]![j] = m;
    }
  }
  // Traceback into a new column list.
  const placed: { column: number | null; unit: number }[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = i === 0 ? 2 : j === 0 ? 1 : move[i]![j]!;
    if (mv === 0) {
      placed.push({ column: i - 1, unit: j - 1 });
      i--;
      j--;
    } else if (mv === 1) {
      i--;
    } else {
      placed.push({ column: null, unit: j - 1 });
      j--;
    }
  }
  placed.reverse();
  const out: Column[] = [];
  let nextColumn = 0;
  const copy = (column: Column): Column => ({ cells: new Map(column.cells) });
  for (const p of placed) {
    if (p.column === null) {
      // An insertion: a new column after whatever column the previous unit stood in.
      out.push({ cells: new Map([[witness.id, { unitIndex: p.unit }]]) });
      continue;
    }
    while (nextColumn < p.column) out.push(copy(columns[nextColumn++]!));
    const column = copy(columns[nextColumn++]!);
    column.cells.set(witness.id, { unitIndex: p.unit });
    out.push(column);
  }
  while (nextColumn < n) out.push(copy(columns[nextColumn++]!));
  return { columns: out };
}

/**
 * A gap unit of a witness makes the witness lacunose from its previous word
 * to its next: every column between them that the witness lacks is marked,
 * so that it is reported as lacunose rather than as omitting.
 */
function markLacunae(columns: Column[], textId: Id, units: Unit[]): void {
  const gapColumns: number[] = [];
  columns.forEach((column, index) => {
    const cell = column.cells.get(textId);
    if (cell && units[cell.unitIndex]?.gap) gapColumns.push(index);
  });
  for (const at of gapColumns) {
    columns[at]!.cells.get(textId)!.lacunose = true;
    for (let i = at - 1; i >= 0 && !columns[i]!.cells.has(textId); i--) {
      columns[i]!.cells.set(textId, { unitIndex: -1, lacunose: true });
    }
    for (let i = at + 1; i < columns.length && !columns[i]!.cells.has(textId); i++) {
      columns[i]!.cells.set(textId, { unitIndex: -1, lacunose: true });
    }
  }
}

/**
 * A word of the witness that opened a column of its own, while a column
 * where the witness is absent carries the same word, is a transposition.
 */
function findTranspositions(
  columns: Column[],
  textId: Id,
  baseId: Id,
  keys: Map<Id, string[]>,
): { textId: Id; insertedColumn: number; omittedColumn: number }[] {
  const out: { textId: Id; insertedColumn: number; omittedColumn: number }[] = [];
  const omitted = new Map<string, number[]>();
  columns.forEach((column, index) => {
    if (column.cells.has(textId)) return;
    for (const key of columnKeys(column, keys, baseId)) {
      if (key === '') continue;
      const list = omitted.get(key) ?? [];
      list.push(index);
      omitted.set(key, list);
    }
  });
  columns.forEach((column, index) => {
    const cell = column.cells.get(textId);
    if (!cell || cell.unitIndex < 0) return;
    if (column.cells.size !== 1) return;
    const key = keyOf(keys, textId, cell.unitIndex);
    const candidates = omitted.get(key);
    if (!candidates || candidates.length === 0) return;
    // The nearest omitted column with the same word.
    candidates.sort((a, b) => Math.abs(a - index) - Math.abs(b - index));
    out.push({ textId, insertedColumn: index, omittedColumn: candidates.shift()! });
  });
  return out;
}

function anchorColumns(columns: Column[], baseId: Id, keys: Map<Id, string[]>, presentIds: Id[]): number[] {
  const anchors: number[] = [];
  const present = new Set<Id>(presentIds);
  columns.forEach((column, index) => {
    const baseCell = column.cells.get(baseId);
    if (!baseCell) return;
    const baseKey = keyOf(keys, baseId, baseCell.unitIndex);
    if (baseKey === '') return;
    for (const textId of present) {
      if (textId === baseId) continue;
      const cell = column.cells.get(textId);
      if (!cell) return; // omitted here
      // A lacunose witness neither agrees nor disagrees; the apparatus still reports it.
      if (cell.lacunose) return;
      if (keyOf(keys, textId, cell.unitIndex) !== baseKey) return;
    }
    anchors.push(index);
  });
  return anchors;
}

function buildSites(
  columns: Column[],
  anchors: number[],
  base: CollationText,
  texts: CollationText[],
  keys: Map<Id, string[]>,
  /** Letters only: a transposed word is recognised by them, wherever it stands. */
  bare: Map<Id, string[]>,
  transpositions: { textId: Id; insertedColumn: number; omittedColumn: number }[],
  reach: number,
): Site[] {
  const anchorSet = new Set(anchors);
  // The texts that disagree with the base in a column: absent, lacunose or
  // reading otherwise; in a column without the base, everyone present adds.
  const present = new Set<Id>(texts.map((t) => t.id));
  const disagreeing = (column: Column): Set<Id> => {
    const out = new Set<Id>();
    const baseCell = column.cells.get(base.id);
    if (!baseCell || baseCell.unitIndex < 0) {
      for (const textId of column.cells.keys()) if (textId !== base.id) out.add(textId);
      return out;
    }
    const baseKey = keyOf(keys, base.id, baseCell.unitIndex);
    for (const textId of present) {
      if (textId === base.id) continue;
      const cell = column.cells.get(textId);
      if (!cell || cell.lacunose || keyOf(keys, textId, cell.unitIndex) !== baseKey) out.add(textId);
    }
    return out;
  };
  // Runs of non-anchor columns, divided where the disagreeing texts of
  // adjacent columns have nobody in common: an omission by B followed by an
  // addition by C are two sites, a word B reads as three is one.
  const runs: [number, number][] = [];
  let start: number | null = null;
  let current = new Set<Id>();
  for (let i = 0; i <= columns.length; i++) {
    const isAnchor = i === columns.length || anchorSet.has(i);
    if (isAnchor) {
      if (start !== null) runs.push([start, i]);
      start = null;
      current = new Set();
      continue;
    }
    const here = disagreeing(columns[i]!);
    if (start === null) {
      start = i;
      current = here;
      continue;
    }
    const shared = [...here].some((id) => current.has(id));
    if (!shared) {
      runs.push([start, i]);
      start = i;
      current = here;
    } else {
      for (const id of here) current.add(id);
    }
  }
  // A witness whose words over a stretch are the base's words in another
  // order has transposed them: the sites of the stretch, anchors between
  // them included, become one site, so that the apparatus reads
  // "swift red] red swift B" and not an omission beside an addition.
  const linked = new Map<number, Set<Id>>();
  const foldsOver = (textId: Id, from: number, to: number): string[] => {
    const cells: { unitIndex: number; key: string }[] = [];
    for (let c = from; c < to; c++) {
      const cell = columns[c]!.cells.get(textId);
      if (!cell || cell.unitIndex < 0) continue;
      const key = keyOf(bare, textId, cell.unitIndex);
      if (key !== '') cells.push({ unitIndex: cell.unitIndex, key });
    }
    return cells.sort((a, b) => a.unitIndex - b.unitIndex).map((c) => c.key);
  };
  const baseOrderOver = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let c = from; c < to; c++) {
      const cell = columns[c]!.cells.get(base.id);
      if (cell && cell.unitIndex >= 0) {
        const key = keyOf(bare, base.id, cell.unitIndex);
        if (key !== '') out.push(key);
      }
    }
    return out;
  };
  const sameMultiset = (a: string[], b: string[]): boolean =>
    a.length === b.length && [...a].sort().join('\u0001') === [...b].sort().join('\u0001');
  for (const text of texts) {
    if (text.id === base.id) continue;
    let i = 0;
    while (i < runs.length) {
      let merged = false;
      for (let j = i; j < runs.length && j <= i + reach; j++) {
        const from = runs[i]![0];
        const to = runs[j]![1];
        if (j > i && runs[j]![0] - runs[j - 1]![1] > reach) break;
        const baseWords = baseOrderOver(from, to);
        const textWords = foldsOver(text.id, from, to);
        if (baseWords.length < 2 || !sameMultiset(baseWords, textWords)) continue;
        if (baseWords.join('\u0001') === textWords.join('\u0001')) continue;
        if (j > i) {
          runs.splice(i, j - i + 1, [from, to]);
          const shifted = new Map<number, Set<Id>>();
          for (const [k, v] of linked) shifted.set(k > j ? k - (j - i) : k > i ? i : k, v);
          linked.clear();
          for (const [k, v] of shifted) linked.set(k, v);
        }
        linked.set(i, (linked.get(i) ?? new Set<Id>()).add(text.id));
        merged = true;
        break;
      }
      i++;
      void merged;
    }
  }

  // Merge runs linked by a transposition within reach.
  const runOf = (column: number): number => runs.findIndex(([a, b]) => column >= a && column < b);
  for (const t of transpositions) {
    const a = runOf(t.insertedColumn);
    const b = runOf(t.omittedColumn);
    if (a < 0 || b < 0 || a === b) {
      if (a >= 0 && a === b) linked.set(a, (linked.get(a) ?? new Set()).add(t.textId));
      continue;
    }
    const [first, second] = a < b ? [a, b] : [b, a];
    const between = runs[second]![0] - runs[first]![1];
    if (between <= reach) {
      const merged: [number, number] = [runs[first]![0], runs[second]![1]];
      runs.splice(second, 1);
      runs.splice(first, 1, merged);
      const set = linked.get(first) ?? new Set<Id>();
      set.add(t.textId);
      // Shift link indexes after the removed run.
      const shifted = new Map<number, Set<Id>>();
      for (const [k, v] of linked) shifted.set(k > second ? k - 1 : k === second ? first : k, v);
      linked.clear();
      for (const [k, v] of shifted) linked.set(k, v);
      linked.set(first, new Set([...(linked.get(first) ?? []), ...set]));
    } else {
      linked.set(a, (linked.get(a) ?? new Set()).add(t.textId));
      linked.set(b, (linked.get(b) ?? new Set()).add(t.textId));
    }
  }

  const sites: Site[] = [];
  runs.forEach(([from, to], siteIndex) => {
    const perText = new Map<Id, { units: Unit[]; indexes: number[]; lacunose: boolean }>();
    for (const text of texts) perText.set(text.id, { units: [], indexes: [], lacunose: false });
    for (let c = from; c < to; c++) {
      for (const [textId, cell] of columns[c]!.cells) {
        const entry = perText.get(textId);
        if (!entry) continue;
        if (cell.lacunose) entry.lacunose = true;
        if (cell.unitIndex >= 0) entry.indexes.push(cell.unitIndex);
      }
    }
    // A text's words in its own order.
    for (const text of texts) {
      const entry = perText.get(text.id)!;
      entry.indexes.sort((a, b) => a - b);
      entry.units = entry.indexes.map((i) => text.units[i]!).filter((u) => !u.gap);
    }
    const baseEntry = perText.get(base.id)!;
    const baseIndexes = baseEntry.indexes.filter((i) => !base.units[i]!.gap);
    const groups = new Map<string, Reading>();
    const order: string[] = [];
    for (const text of texts) {
      const entry = perText.get(text.id)!;
      const wordIndexes = entry.indexes.filter((i) => !text.units[i]!.gap);
      const key = wordIndexes.map((i) => keys.get(text.id)![i] ?? '').join(' ');
      const groupKey = entry.lacunose && wordIndexes.length === 0 ? `\u0000lac:${text.id}` : key;
      let reading = groups.get(groupKey);
      if (!reading) {
        reading = {
          text: entry.units.map((u) => u.text).join(' '),
          fold: key,
          textIds: [],
          sigla: [],
          units: {},
          omission: wordIndexes.length === 0 && !entry.lacunose,
          lacunose: false,
          base: false,
        };
        groups.set(groupKey, reading);
        order.push(groupKey);
      }
      reading.textIds.push(text.id);
      reading.sigla.push(text.siglum);
      reading.units[text.id] = entry.units;
      if (entry.lacunose) reading.lacunose = true;
      if (text.id === base.id) reading.base = true;
    }
    const readings = order.map((k) => groups.get(k)!);
    const baseReading = readings.find((r) => r.base);
    if (baseReading) {
      readings.splice(readings.indexOf(baseReading), 1);
      readings.unshift(baseReading);
    }
    const site: Site = {
      index: siteIndex,
      columnFrom: from,
      columnTo: to,
      baseFrom: baseIndexes.length ? baseIndexes[0]! : baseInsertionPoint(columns, from, base.id),
      baseTo: baseIndexes.length ? baseIndexes[baseIndexes.length - 1]! + 1 : baseInsertionPoint(columns, from, base.id),
      readings,
      kind: siteKindOf(readings),
    };
    const link = linked.get(siteIndex);
    if (link && link.size > 0) {
      // Find the site holding the other half, if the halves were not merged.
      const other = transpositions.find((t) => link.has(t.textId) && (runOf(t.insertedColumn) === siteIndex || runOf(t.omittedColumn) === siteIndex));
      const otherSite = other ? (runOf(other.insertedColumn) === siteIndex ? runOf(other.omittedColumn) : runOf(other.insertedColumn)) : siteIndex;
      site.transposition = { withSite: otherSite, textIds: [...link] };
    }
    sites.push(site);
  });
  return sites;
}

/** Where in the base's units an insertion site falls: after the base's last word before the site. */
function baseInsertionPoint(columns: Column[], column: number, baseId: Id): number {
  for (let c = column - 1; c >= 0; c--) {
    const cell = columns[c]!.cells.get(baseId);
    if (cell && cell.unitIndex >= 0) return cell.unitIndex + 1;
  }
  return 0;
}

/**
 * The editor's word on the kind of some sites, by site key, put over the
 * classification by letters. A key that no longer names a site is ignored.
 */
export function applySiteKinds(collation: Collation, baseUnits: Unit[], kinds: ReadonlyMap<string, SiteKind> | undefined): Collation {
  if (!kinds || kinds.size === 0) return collation;
  return {
    ...collation,
    sites: collation.sites.map((site) => {
      const kind = kinds.get(siteKey(site, baseUnits));
      return kind && kind !== site.kind ? { ...site, kind, kindByEditor: true } : site;
    }),
  };
}

/** A stable key for a site, from the base's token ids it covers, for review marks and constraints. */
export function siteKey(site: Site, baseUnits: Unit[]): string {
  if (site.baseTo > site.baseFrom) {
    const ids = new Set<string>();
    for (let i = site.baseFrom; i < site.baseTo; i++) for (const id of baseUnits[i]?.tokenIds ?? []) ids.add(id);
    // The site of the witnesses lacking the segment may cover the same words as another: it is told apart.
    return (site.wanting ? 'wanting:' : '') + [...ids].join(',');
  }
  const before = baseUnits[site.baseFrom - 1]?.tokenIds.join(',') ?? '^';
  const after = baseUnits[site.baseFrom]?.tokenIds.join(',') ?? '$';
  return `${before}|${after}`;
}
