/**
 * One page of a stream in the editor.
 *
 * The editor can show one page: the items after the page break that opens
 * it, up to the next page break. The operations the bridge produces for
 * that sub-stream name items by id, so they apply to the whole stream as
 * they are, except an insert at the start of the page (`after: null`),
 * which in the whole stream stands after the page break. A page that has no
 * break yet shows nothing; the first edit creates its break at the end of
 * the stream and the typed items after it. A page break can also be named
 * by its own id: a break that names no page of the witness (one made with
 * the page break command), or a second break naming the same page, can then
 * be shown too.
 */

import { isBreak, type Break, type Id, type Item, type Op, type Stream } from '@varians/core';

export interface PageView {
  /** The items shown. */
  stream: Stream;
  /** The page break that opens the shown page; null when the whole stream is shown or the page has no break. */
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

/** Whether an item is the page break that opens `page`: a page id, or the break's own id. */
export function opensPage(item: Item | undefined, page: string): boolean {
  return isPageBreak(item) && (item.pageId === page || item.id === page);
}

/** The items of one page, or the whole stream when `page` is null. */
export function pageView(whole: Stream, page: string | null | undefined): PageView {
  if (page === null || page === undefined) return { stream: whole, anchor: null, missing: null };
  const items = whole.items;
  const start = items.findIndex((item) => opensPage(item, page));
  if (start < 0) {
    const last = items.length ? items[items.length - 1]!.id : null;
    return { stream: { items: [] }, anchor: null, missing: { pageId: page, after: last } };
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
    if ((op.t === 'insert' || op.t === 'move') && op.after === null)
      return { ...op, after: anchor };
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
 * created first, at the end of the stream, and becomes the anchor.
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
