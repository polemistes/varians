/**
 * Pages as the workbench navigates them. A transcript's
 * text is the text on no page ("Not on a page") followed by the text of
 * each page of the witness, in the witness's order. The workbench shows one
 * of them, or the whole text read only:
 *
 * - `'unplaced'`: the text on no page;
 * - a page id: the text of that page (empty when it has none);
 * - `'whole'`: everything, read only.
 *
 * Pure; the page passes the view to the editor's `page` prop (null for the
 * whole text).
 */

import { isBreak, isObj, isToken, type Id, type Stream } from '@varians/core';
import { UNPLACED } from '$lib/editor/page';

export { UNPLACED };
export const WHOLE = 'whole';

export interface WitnessPage {
  id: string;
  label: string;
}

/** What a page holds in a transcript. */
export interface PageText {
  words: number;
  lines: number;
}

/**
 * The text on each page, by page id: words and lines, for the pages whose
 * stretch holds a word or an object. A page without a break, or with an
 * empty stretch, has no text.
 */
export function pagesWithText(stream: Stream): Map<string, PageText> {
  const out = new Map<string, PageText>();
  let current: PageText | null = null;
  let lineHasContent = false;
  const closeLine = () => {
    if (current && lineHasContent) current.lines++;
    lineHasContent = false;
  };
  const closePage = (pageId: string | null) => {
    closeLine();
    if (pageId && current && (current.words > 0 || current.lines > 0)) out.set(pageId, current);
  };
  let pageId: string | null = null;
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') {
      closePage(pageId);
      pageId = item.pageId ?? null;
      current = { words: 0, lines: 0 };
      continue;
    }
    if (isBreak(item)) {
      closeLine();
      continue;
    }
    if (isToken(item) || isObj(item)) {
      lineHasContent = true;
      if (current && isToken(item)) current.words++;
    }
  }
  closePage(pageId);
  return out;
}

/** The words before the first page break: the text on no page. */
export function wordsUnplaced(stream: Stream): number {
  let n = 0;
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') break;
    if (isToken(item)) n++;
  }
  return n;
}

/** Whether anything (a word or an object) stands on no page. */
export function hasUnplacedText(stream: Stream): boolean {
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') return false;
    if (isToken(item) || isObj(item)) return true;
  }
  return false;
}

/** The views the arrows walk: Not on a page, then the pages in order. */
export function viewOrder(witnessPages: readonly WitnessPage[]): string[] {
  return [UNPLACED, ...witnessPages.map((p) => p.id)];
}

export interface Neighbours {
  previous: string | null;
  next: string | null;
}

/** The views before and after the one shown. From the whole text the next is the first of the order. */
export function neighbours(view: string, order: readonly string[]): Neighbours {
  if (view === WHOLE) return { previous: null, next: order[0] ?? null };
  const at = order.indexOf(view);
  if (at < 0) return { previous: null, next: null };
  return { previous: at > 0 ? order[at - 1]! : null, next: at < order.length - 1 ? order[at + 1]! : null };
}

/**
 * The view a transcript opens on (C2), when none is remembered: the first
 * page with text; else Not on a page when it has text; else the first page;
 * else, for a witness without pages, its text (the text on no page, which
 * is then all of it).
 */
export function initialView(stream: Stream, witnessPages: readonly WitnessPage[]): string {
  const withText = pagesWithText(stream);
  const first = witnessPages.find((p) => withText.has(p.id));
  if (first) return first.id;
  if (hasUnplacedText(stream)) return UNPLACED;
  return witnessPages[0]?.id ?? UNPLACED;
}

/**
 * Make a requested view valid: Not on a page always is; the whole text is
 * where the witness has pages; a page is while the witness has it. Anything
 * else falls back to the view a transcript opens on.
 */
export function settleView(requested: string | null, stream: Stream, witnessPages: readonly WitnessPage[]): string {
  if (requested === UNPLACED) return UNPLACED;
  if (requested === WHOLE) return witnessPages.length ? WHOLE : UNPLACED;
  if (requested !== null && witnessPages.some((p) => p.id === requested)) return requested;
  return initialView(stream, witnessPages);
}

/** The page an item stands on: a page id, or `'unplaced'` before the first page break; null for an item not in the stream. */
export function pageOf(stream: Stream, itemId: Id): string | null {
  let page: string = UNPLACED;
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') page = item.pageId ?? UNPLACED;
    if (item.id === itemId) return page;
  }
  return null;
}

/** The first page in the witness's order without text after `after` (from the start when absent), wrapping round; null when every other page has text. */
export function nextPageWithoutText(witnessPages: readonly WitnessPage[], stream: Stream, after?: string | null): string | null {
  const withText = pagesWithText(stream);
  const free = (p: WitnessPage) => !withText.has(p.id) && p.id !== after;
  const start = after ? witnessPages.findIndex((p) => p.id === after) : -1;
  return witnessPages.slice(start + 1).find(free)?.id ?? witnessPages.find(free)?.id ?? null;
}
