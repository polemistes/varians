/**
 * The lines of a text as a reader or an editor's gutter shows them: items
 * grouped by the stream's breaks, with the segment label of each line and
 * whether the conventions print it there. A paragraph is verse or prose
 * (`lineationOf`): a verse paragraph is shown in the lines its breaks make,
 * a prose paragraph runs on (`runOn`) and has no line breaks shown.
 */

import {
  isToken,
  type Break,
  type Id,
  type Item,
  type Lineation,
  type Stream,
} from '../stream/items.ts';

/** The kind of the paragraph a paragraph break opens: its own, else the edition's convention. */
export function lineationOf(paragraph: Break | undefined, convention: Lineation): Lineation {
  return paragraph?.lineation ?? convention;
}

/**
 * The kind of each paragraph of a text, by the id of the break that opens it
 * and `null` for the paragraph before the first paragraph break. A paragraph
 * break at the very start of the text opens the first paragraph.
 */
export function paragraphKinds(
  items: readonly Item[],
  convention: Lineation,
): Map<Id | null, Lineation> {
  const kinds = new Map<Id | null, Lineation>([[null, convention]]);
  items.forEach((item, i) => {
    if (item.kind !== 'break' || item.type !== 'paragraph') return;
    kinds.set(item.id, lineationOf(item, convention));
    // A leading paragraph break stands for the paragraph before it, which is empty.
    if (i === 0) kinds.set(null, lineationOf(item, convention));
  });
  return kinds;
}

/**
 * The kind of the paragraph each of the items asked for stands in, by one
 * pass over the text: for the few items that a mark or an adoption concerns.
 * A paragraph break stands in the paragraph it opens. An item that is not in
 * the text is not in the answer.
 */
export function lineationsAt(
  items: readonly Item[],
  ids: ReadonlySet<Id>,
  convention: Lineation = 'verse',
): Map<Id, Lineation> {
  const out = new Map<Id, Lineation>();
  if (ids.size === 0) return out;
  let kind = convention;
  for (const item of items) {
    if (item.kind === 'break' && item.type === 'paragraph') kind = lineationOf(item, convention);
    if (ids.has(item.id)) out.set(item.id, kind);
  }
  return out;
}

/** The kind of the paragraph an item stands in; the edition's convention for an item that is not in the text. */
export function lineationAt(
  items: readonly Item[],
  id: Id,
  convention: Lineation = 'verse',
): Lineation {
  return lineationsAt(items, new Set([id]), convention).get(id) ?? convention;
}

/**
 * What a text shows of its breaks, by the kind of each paragraph: the words
 * that are divided by the end of a line that is shown, and so are written
 * with a hyphen there (a joined token that a break follows, in a verse
 * paragraph; the hyphen is never stored), and the breaks that are not shown
 * (the line breaks inside a prose paragraph, which stay in the text). In
 * prose no word is hyphenated, and a join with no break after it (a word
 * divided where a segment begins) draws none.
 */
export interface Shown {
  hyphens: Set<Id>;
  hidden: Set<Id>;
}

export function shownBreaks(items: readonly Item[], convention: Lineation = 'verse'): Shown {
  const hyphens = new Set<Id>();
  const hidden = new Set<Id>();
  let kind = convention;
  items.forEach((item, i) => {
    if (item.kind === 'break') {
      if (item.type === 'paragraph') kind = lineationOf(item, convention);
      else if (kind === 'prose') hidden.add(item.id);
      return;
    }
    if (kind === 'verse' && isToken(item) && item.joinNext && items[i + 1]?.kind === 'break')
      hyphens.add(item.id);
  });
  return { hyphens, hidden };
}

/** The words that are written with a hyphen where their line ends (see `shownBreaks`). */
export function hyphenatedWords(items: readonly Item[], convention: Lineation = 'verse'): Set<Id> {
  return shownBreaks(items, convention).hyphens;
}

export interface LayoutLine {
  /** Index of the line in the stream (0-based). */
  index: number;
  /** Index range of the line's items in the stream, end exclusive. */
  from: number;
  to: number;
  items: Item[];
  /** Segment ids beginning on this line, in order. */
  starts: { segmentId: Id | null; itemIndex: number; part: number }[];
  /** The label printed beside the line, if any. */
  label: string | null;
  /** The line opens a paragraph. */
  paragraph: boolean;
  /**
   * Whether the paragraph the line is in is verse or prose. A prose line made
   * by `runOn` is the whole paragraph, and holds its line breaks among its items.
   */
  lineation: Lineation;
  /** The line's last word runs on into the next line, which is shown: a hyphen is drawn after it. */
  hyphen: boolean;
  /** The page beginning at this line, if a page break opens it. */
  pageId: Id | null;
  /** Direction of the line when a break sets it. */
  rend: string | null;
}

export interface LayoutOptions {
  /** Print a label only every n lines of a run of consecutive numbered lines (verse); 1 prints every start. A prose line prints every label. */
  numberEvery?: number;
  /** The edition's convention: the kind of a paragraph that is not marked. Verse where absent. */
  lineation?: Lineation;
  /** Whether a label's last number is a multiple of `numberEvery`; given a label, returns its last number or null. */
  lastNumber?: (label: string) => number | null;
}

export function defaultLastNumber(label: string): number | null {
  const match = /(\d+)[^\d]*$/u.exec(label);
  return match ? Number(match[1]) : null;
}

/** Group a stream into lines and decide which labels print. */
export function layoutLines(
  stream: Stream,
  labelOf: (segmentId: Id) => string,
  options: LayoutOptions = {},
): LayoutLine[] {
  const verseEvery = Math.max(1, options.numberEvery ?? 1);
  const lastNumber = options.lastNumber ?? defaultLastNumber;
  const convention = options.lineation ?? 'verse';
  const lines: LayoutLine[] = [];
  let kind: Lineation = convention;
  let current: LayoutLine = {
    index: 0,
    from: 0,
    to: 0,
    items: [],
    starts: [],
    label: null,
    paragraph: false,
    lineation: kind,
    hyphen: false,
    pageId: null,
    rend: null,
  };
  const push = (followedByBreak: boolean) => {
    current.to = current.from + current.items.length;
    const last = current.items[current.items.length - 1];
    current.hyphen = followedByBreak && kind === 'verse' && isToken(last) && last.joinNext === true;
    lines.push(current);
  };
  stream.items.forEach((item, index) => {
    if (item.kind === 'break') {
      // Breaks close the current line; the line's item range excludes the break itself.
      push(true);
      if (item.type === 'paragraph') kind = lineationOf(item, convention);
      current = {
        index: lines.length,
        from: index + 1,
        to: index + 1,
        items: [],
        starts: [],
        label: null,
        paragraph: item.type === 'paragraph',
        lineation: kind,
        hyphen: false,
        pageId: item.type === 'page' ? (item.pageId ?? null) : null,
        rend: item.rend ?? null,
      };
      return;
    }
    current.items.push(item);
    if (item.segment)
      current.starts.push({
        segmentId: item.segment.segmentId,
        itemIndex: index,
        part: item.segment.part ?? 1,
      });
  });
  push(false);
  // Labels: the first start on a line gives its label; with numberEvery > 1 only
  // multiples print, except the first labelled line of the text and lines after a gap in numbering.
  let printedAny = false;
  for (const line of lines) {
    const first = line.starts.find((s) => s.segmentId !== null);
    if (!first || first.segmentId === null) continue;
    const label = labelOf(first.segmentId);
    const every = line.lineation === 'prose' ? 1 : verseEvery;
    if (every === 1 || !printedAny) {
      line.label = label;
      printedAny = true;
      continue;
    }
    const n = lastNumber(label);
    if (n !== null && n % every === 0) line.label = label;
  }
  return lines.filter(
    (l) => l.items.length > 0 || l.paragraph || l.pageId !== null || lines.length === 1,
  );
}

/**
 * The lines as they are shown: a verse line as the stream's breaks make it, a
 * prose paragraph as one line that runs on to the width of the page. The
 * line of a prose paragraph holds its line breaks among its items, which
 * stay in the text and are not shown, so that its item range is the
 * paragraph's. Where a segment begins in it, the label is printed there, in
 * the text; the margin has one only where the paragraph's first item begins a
 * segment.
 */
export function runOn(stream: Stream, lines: readonly LayoutLine[]): LayoutLine[] {
  const out: LayoutLine[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (
      previous &&
      previous.lineation === 'prose' &&
      line.lineation === 'prose' &&
      !line.paragraph
    ) {
      previous.to = line.to;
      previous.items = stream.items.slice(previous.from, line.to);
      previous.starts.push(...line.starts);
      continue;
    }
    if (line.lineation !== 'prose') {
      out.push(line);
      continue;
    }
    out.push({
      ...line,
      items: stream.items.slice(line.from, line.to),
      starts: [...line.starts],
      hyphen: false,
    });
  }
  for (const line of out) {
    if (line.lineation !== 'prose') continue;
    const first = line.starts[0];
    if (!(first && first.itemIndex === line.from && first.segmentId !== null)) line.label = null;
  }
  return out;
}
