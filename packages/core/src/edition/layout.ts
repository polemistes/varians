/**
 * The lines of a text as a reader or an editor's gutter shows them: items
 * grouped by the stream's breaks, with the segment label of each line and
 * whether the conventions print it there.
 */

import type { Id, Item, Stream } from '../stream/items.ts';

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
  /** The page beginning at this line, if a page break opens it. */
  pageId: Id | null;
  /** Direction of the line when a break sets it. */
  rend: string | null;
}

export interface LayoutOptions {
  /** Print a label only every n lines of a run of consecutive numbered lines (verse); 1 prints every start. */
  numberEvery?: number;
  /** Whether a label's last number is a multiple of `numberEvery`; given a label, returns its last number or null. */
  lastNumber?: (label: string) => number | null;
}

export function defaultLastNumber(label: string): number | null {
  const match = /(\d+)[^\d]*$/u.exec(label);
  return match ? Number(match[1]) : null;
}

/** Group a stream into lines and decide which labels print. */
export function layoutLines(stream: Stream, labelOf: (segmentId: Id) => string, options: LayoutOptions = {}): LayoutLine[] {
  const every = Math.max(1, options.numberEvery ?? 1);
  const lastNumber = options.lastNumber ?? defaultLastNumber;
  const lines: LayoutLine[] = [];
  let current: LayoutLine = { index: 0, from: 0, to: 0, items: [], starts: [], label: null, paragraph: false, pageId: null, rend: null };
  const push = () => {
    current.to = current.from + current.items.length;
    lines.push(current);
  };
  stream.items.forEach((item, index) => {
    if (item.kind === 'break') {
      // Breaks close the current line; the line's item range excludes the break itself.
      push();
      current = {
        index: lines.length,
        from: index + 1,
        to: index + 1,
        items: [],
        starts: [],
        label: null,
        paragraph: item.type === 'paragraph',
        pageId: item.type === 'page' ? item.pageId ?? null : null,
        rend: item.rend ?? null,
      };
      return;
    }
    current.items.push(item);
    if (item.segment) current.starts.push({ segmentId: item.segment.segmentId, itemIndex: index, part: item.segment.part ?? 1 });
  });
  push();
  // Labels: the first start on a line gives its label; with numberEvery > 1 only
  // multiples print, except the first labelled line of the text and lines after a gap in numbering.
  let printedAny = false;
  for (const line of lines) {
    const first = line.starts.find((s) => s.segmentId !== null);
    if (!first || first.segmentId === null) continue;
    const label = labelOf(first.segmentId);
    if (every === 1 || !printedAny) {
      line.label = label;
      printedAny = true;
      continue;
    }
    const n = lastNumber(label);
    if (n !== null && n % every === 0) line.label = label;
  }
  return lines.filter((l) => l.items.length > 0 || l.paragraph || l.pageId !== null || lines.length === 1);
}
