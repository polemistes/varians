/**
 * One page of a transcript in the editor.
 *
 * A transcript's stream begins with the text on no page ("Not on a page"),
 * then each page break, naming a page of the witness in the witness's
 * order, opens that page's text. The editor shows one of these stretches:
 * a page (`page` a page id), the text on no page (`page` the sentinel
 * `'unplaced'`), or the whole stream (`page` null).
 *
 * The operations the bridge produces for a stretch name items by id, so
 * they apply to the whole stream as they are, except an insert at the start
 * of the stretch (`after: null`), which in the whole stream stands after the
 * page break. Inserts at the start of the text on no page need no lifting.
 * A page without a break shows empty; the first edit creates its break in
 * the place the witness's order gives it, so that the page breaks stay in
 * that order.
 */

import { isBreak, pageBreakPlace, type Break, type Id, type Item, type Op, type Stream } from '@varians/core';

/** The sentinel of the text on no page. */
export const UNPLACED = 'unplaced';

export interface PageView {
  /** The items shown. */
  stream: Stream;
  /** The page break that opens the shown page; null for the whole stream, the text on no page, or a page without a break. */
  anchor: Break | null;
  /** The page shown has no break yet; its break is created after this item on the first edit. */
  missing: { pageId: string; after: Id | null } | null;
}

export function isPageBreak(item: Item | undefined): item is Break {
  return isBreak(item) && item.type === 'page';
}

/** The page breaks of a stream, in order. */
export function pageBreaks(stream: Stream): Break[] {
  return stream.items.filter(isPageBreak);
}

/** The items of a page, of the text on no page, or the whole stream when `page` is null. */
export function pageView(whole: Stream, page: string | null | undefined, pageOrder: readonly string[] = []): PageView {
  if (page === null || page === undefined) return { stream: whole, anchor: null, missing: null };
  const items = whole.items;
  if (page === UNPLACED) {
    let end = 0;
    while (end < items.length && !isPageBreak(items[end])) end++;
    return { stream: { items: items.slice(0, end) }, anchor: null, missing: null };
  }
  const start = items.findIndex((item) => isPageBreak(item) && item.pageId === page);
  if (start < 0) {
    const order = pageOrder.includes(page) ? pageOrder : [...pageOrder, page];
    return { stream: { items: [] }, anchor: null, missing: { pageId: page, after: pageBreakPlace(whole, page, order) } };
  }
  let end = start + 1;
  while (end < items.length && !isPageBreak(items[end])) end++;
  return {
    stream: { items: items.slice(start + 1, end) },
    anchor: items[start] as Break,
    missing: null,
  };
}

/** Operations on a page's items rewritten for the whole stream: an insert at the page's start goes after the page break. */
export function liftOps(ops: Op[], anchor: Id | null): Op[] {
  if (anchor === null) return ops;
  return ops.map((op) => {
    if ((op.t === 'insert' || op.t === 'move') && op.after === null) return { ...op, after: anchor };
    return op;
  });
}

export interface Lifted {
  ops: Op[];
  anchor: Break | null;
  missing: PageView['missing'];
}

/**
 * Lift operations on the shown items to the whole stream. When the shown
 * page has no break yet and something is inserted, the page break is
 * created first, where the witness's order puts it, and becomes the anchor.
 */
export function liftToWhole(ops: Op[], view: PageView, ids: () => Id): Lifted {
  if (ops.length === 0) return { ops, anchor: view.anchor, missing: view.missing };
  if (view.missing) {
    const brk: Break = { kind: 'break', id: ids(), type: 'page', pageId: view.missing.pageId };
    return {
      ops: [{ t: 'insert', after: view.missing.after, items: [brk] }, ...liftOps(ops, brk.id)],
      anchor: brk,
      missing: null,
    };
  }
  return {
    ops: liftOps(ops, view.anchor ? view.anchor.id : null),
    anchor: view.anchor,
    missing: null,
  };
}
