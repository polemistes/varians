/**
 * Pages as the workbench navigates them (PLAN 6.2): the page breaks of the
 * stream in order, the witness's pages that have no break yet, and which
 * page an item stands on. Pure; the page passes the result to the editor's
 * `page` prop, which takes a page id or a page break's own id.
 */

import { isBreak, isObj, isToken, type Id, type Stream } from '@varians/core';

export interface WitnessPage {
  id: string;
  label: string;
}

/** A page break of the stream as a page to show. */
export interface StreamPage {
  /** What the editor's `page` prop takes: the page id, or the break's id when the break names no page or repeats one. */
  key: string;
  pageId: string | null;
  breakId: Id;
  label: string;
  /** Index of the page break in the stream. */
  index: number;
}

/**
 * The page breaks of a stream in order. A break that names a witness page is
 * labelled with that page's label; one that names none with its own label,
 * else with `fallback(n)` for the nth page break.
 */
export function streamPages(
  stream: Stream,
  pageLabels: Record<string, string>,
  fallback: (n: number) => string = (n) => String(n),
): StreamPage[] {
  const out: StreamPage[] = [];
  const seen = new Set<string>();
  stream.items.forEach((item, index) => {
    if (!isBreak(item) || item.type !== 'page') return;
    const n = out.length + 1;
    const pageId = item.pageId ?? null;
    const key = pageId && !seen.has(pageId) ? pageId : item.id;
    if (pageId) seen.add(pageId);
    const label = (pageId && pageLabels[pageId]) || item.label || fallback(n);
    out.push({ key, pageId, breakId: item.id, label, index });
  });
  return out;
}

/** The witness's pages no page break of the stream names yet, in the witness's order. */
export function unplacedPages(witnessPages: WitnessPage[], stream: Stream): WitnessPage[] {
  const placed = new Set<string>();
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page' && item.pageId) placed.add(item.pageId);
  }
  return witnessPages.filter((page) => !placed.has(page.id));
}

/** Whether words or objects stand before the stream's first page break (they belong to no page). */
export function hasLeadingText(stream: Stream): boolean {
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') return false;
    if (isToken(item) || isObj(item)) return true;
  }
  return false;
}

/** The key of the page an item stands on: the last page break before it; null before the first. */
export function pageKeyOf(stream: Stream, itemId: Id, pages: StreamPage[]): string | null {
  const index = stream.items.findIndex((item) => item.id === itemId);
  if (index < 0) return null;
  let key: string | null = null;
  for (const page of pages) {
    if (page.index < index) key = page.key;
    else break;
  }
  return key;
}

/** The witness page id behind a page key (a page id, or a page break's id). */
export function pageIdOfKey(key: string | null, pages: StreamPage[], witnessPages: WitnessPage[]): string | null {
  if (key === null) return null;
  const page = pages.find((p) => p.key === key);
  if (page) return page.pageId;
  return witnessPages.some((p) => p.id === key) ? key : null;
}

/**
 * The page to show first: the first page break's page; for an empty stream
 * the witness's first page (typing creates its break); else the whole text.
 * A stream with words before its first page break opens on the whole text,
 * so that those words are seen.
 */
export function initialPage(stream: Stream, pages: StreamPage[], witnessPages: WitnessPage[]): string | null {
  if (pages.length > 0) return hasLeadingText(stream) ? null : pages[0]!.key;
  if (stream.items.length === 0 && witnessPages.length > 0) return witnessPages[0]!.id;
  return null;
}

/**
 * Make a requested page valid for the current stream: a page of the stream,
 * a witness page without a break (shown empty until typed into), or the
 * whole text. A page that is gone falls back to the first page.
 */
export function settlePage(
  requested: string | null,
  stream: Stream,
  pages: StreamPage[],
  witnessPages: WitnessPage[],
): string | null {
  if (requested === null) return null;
  if (pages.some((p) => p.key === requested)) return requested;
  if (unplacedPages(witnessPages, stream).some((p) => p.id === requested)) return requested;
  return initialPage(stream, pages, witnessPages);
}

/** The witness page that follows the last placed one, for going on past the stream's last page. */
export function nextUnplacedPage(stream: Stream, pages: StreamPage[], witnessPages: WitnessPage[]): WitnessPage | null {
  const unplaced = unplacedPages(witnessPages, stream);
  if (unplaced.length === 0) return null;
  const order = new Map(witnessPages.map((p, i) => [p.id, i] as const));
  let last = -1;
  for (const page of pages) {
    if (page.pageId !== null) last = Math.max(last, order.get(page.pageId) ?? -1);
  }
  return unplaced.find((p) => (order.get(p.id) ?? -1) > last) ?? null;
}

export interface Neighbours {
  previous: string | null;
  next: string | null;
}

/**
 * The pages before and after the one shown. From the whole text the next is
 * the first page. Past the last page of the stream comes the next witness
 * page without a break, so that a codex can be transcribed page after page.
 */
export function neighbours(
  current: string | null,
  stream: Stream,
  pages: StreamPage[],
  witnessPages: WitnessPage[],
): Neighbours {
  const following = nextUnplacedPage(stream, pages, witnessPages);
  if (current === null) {
    return { previous: null, next: pages[0]?.key ?? following?.id ?? null };
  }
  const at = pages.findIndex((p) => p.key === current);
  if (at < 0) {
    // A witness page without a break: it comes after the stream's pages.
    return { previous: pages[pages.length - 1]?.key ?? null, next: nextAfter(current, stream, witnessPages) };
  }
  const previous = at > 0 ? pages[at - 1]!.key : null;
  if (at < pages.length - 1) return { previous, next: pages[at + 1]!.key };
  return { previous, next: following?.id ?? null };
}

/** The witness page without a break that follows `current` in the witness's order. */
function nextAfter(current: string, stream: Stream, witnessPages: WitnessPage[]): string | null {
  const unplaced = new Set(unplacedPages(witnessPages, stream).map((p) => p.id));
  const at = witnessPages.findIndex((p) => p.id === current);
  for (let i = at + 1; i < witnessPages.length; i++) {
    if (unplaced.has(witnessPages[i]!.id)) return witnessPages[i]!.id;
  }
  return null;
}
