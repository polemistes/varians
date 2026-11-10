/**
 * The lines of the document as the gutter and the decorations see them:
 * which break opens each line, the first item on it, where segment runs
 * begin, and the line's number within its page.
 */

import type { Break, Id, Item, SegmentStart } from '@varians/core';
import { segmentStartOf } from '@varians/core';
import type { Ledger, Span } from './bridge.ts';

export interface SegmentStartAt {
  span: Span;
  segment: SegmentStart;
}

export interface LineInfo {
  from: number;
  to: number;
  /** The break whose newline ends the previous line, when there is one. */
  opener: Span | null;
  /** The first token or object on the line. */
  first: Span | null;
  /** The segment runs beginning on the line, in order. */
  starts: SegmentStartAt[];
  /** The line's number within its page, from 1. */
  numberInPage: number;
}

export function lineIndex(ledger: Ledger, byId: Map<Id, Item>): LineInfo[] {
  const lines: LineInfo[] = [];
  const text = ledger.text;
  let from = 0;
  let opener: Span | null = null;
  let numberInPage = 1;
  let s = 0;
  const spans = ledger.spans;
  for (let pos = 0; pos <= text.length; pos++) {
    if (pos < text.length && text[pos] !== '\n') continue;
    const line: LineInfo = { from, to: pos, opener, first: null, starts: [], numberInPage };
    while (s < spans.length && spans[s]!.from < pos) {
      const span = spans[s]!;
      if (span.kind !== 'break') {
        if (!line.first) line.first = span;
        const item = byId.get(span.id);
        const segment = item ? segmentStartOf(item) : undefined;
        if (segment) line.starts.push({ span, segment });
      }
      s++;
    }
    lines.push(line);
    if (pos === text.length) break;
    // The newline at `pos` belongs to a break span.
    opener =
      s < spans.length && spans[s]!.kind === 'break' && spans[s]!.from === pos ? spans[s]! : null;
    if (opener) s++;
    const item = opener ? byId.get(opener.id) : undefined;
    numberInPage = item && item.kind === 'break' && item.type === 'page' ? 1 : numberInPage + 1;
    from = pos + 1;
  }
  return lines;
}

/** The line holding a position, by binary search. */
export function lineAt(lines: LineInfo[], pos: number): LineInfo | undefined {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid]!;
    if (pos < line.from) hi = mid - 1;
    else if (pos > line.to) lo = mid + 1;
    else return line;
  }
  return undefined;
}

/** The breaks the editor makes on a line. Pages are not made in the text: a page's text is shown on its own. */
export type BreakType = 'column' | 'paragraph';

/**
 * What a column or paragraph break made for a line does. A break always
 * goes before the line: the line break that opens it takes the new type
 * (`set`), or, on the first line of the text, a new break goes before it
 * (`insert`). A line that begins a page keeps its page break (`none`,
 * `page`); a line that already begins what was asked for is left alone
 * (`none`, `same`).
 */
export type BreakTarget =
  | { t: 'set'; id: Id }
  | { t: 'insert' }
  | { t: 'none'; reason: 'page' | 'same' };

/** `opener` is the break that opens the line (the page's own break on a page's first line), null on the first line of the text. */
export function breakTarget(opener: Break | null, type: BreakType): BreakTarget {
  if (!opener) return { t: 'insert' };
  if (opener.type === 'line') return { t: 'set', id: opener.id };
  if (opener.type === 'page') return { t: 'none', reason: 'page' };
  if (opener.type === type) return { t: 'none', reason: 'same' };
  return { t: 'set', id: opener.id };
}
