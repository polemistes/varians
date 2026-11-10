/**
 * The editor's model: the items shown, the ledger over the document, and
 * how a change to either becomes operations on the whole stream.
 *
 * The component holds the whole stream; the model holds the part shown (a
 * page or everything) with its ledger aligned to the document text. A
 * CodeMirror change set goes through the bridge's `reconcile`; an edit made
 * by a command (a mark, a join, an object) goes through `applyOps`. Both end
 * in operations lifted to the whole stream, which the parent receives.
 */

import { Text, type ChangeSet } from '@codemirror/state';
import {
  applyOps,
  isToken,
  newId,
  segmentAt,
  type Id,
  type Item,
  type Op,
  type SegmentStart,
  type Stream,
  type Token,
} from '@varians/core';
import { alignLedger } from './align.ts';
import { reconcile, render, setJoin, type Form, type Ledger } from './bridge.ts';
import { liftToWhole, pageView, UNPLACED, type PageView } from './page.ts';

export interface Model {
  form: Form;
  page: string | null;
  /** The items shown, with the page break that opens them where one page is shown. */
  view: PageView;
  /**
   * The segment the text before a page leaves running into it, when the
   * page is shown alone: its first word belongs to it unless it begins a
   * segment of its own. Edits on the page do not change it.
   */
  inherited: SegmentStart | null;
  /** Where each shown item stands in the document text. */
  ledger: Ledger;
  byId: Map<Id, Item>;
  segmentLabels: Record<string, string>;
  pageLabels: Record<string, string>;
  /** The document's words do not match the stream's: the document must be reset to the canonical text. */
  misaligned: boolean;
}

export interface ModelOptions {
  form: Form;
  page?: string | null;
  /** The witness's pages in order, for where a page's break is made. */
  pageOrder?: readonly string[];
  segmentLabels?: Record<string, string>;
  pageLabels?: Record<string, string>;
}

/** What a change meant beyond its text, carried on the transaction. */
export interface Intent {
  /** Join this token with the next: the user divided a word at a line's end with a hyphen. */
  join?: Id;
  /** Clear this token's join: the user joined the lines again. */
  unjoin?: Id;
}

export interface ModelChange {
  model: Model;
  /** Operations on the whole stream. */
  ops: Op[];
  /** Operations on the shown items that undo the edit. */
  reverse: Op[];
  /**
   * For a change the user typed: the operations on the shown items, with
   * their reverse. The history undoes the text with these, so that words
   * deleted and brought back are the same words (with their zones,
   * features and read forms), not new ones that look alike.
   */
  typed?: { ops: Op[]; reverse: Op[] };
}

function index(stream: Stream): Map<Id, Item> {
  return new Map(stream.items.map((item) => [item.id, item] as const));
}

function finish(
  base: Omit<Model, 'ledger' | 'byId' | 'misaligned'>,
  canonical: Ledger,
  docText?: string,
): Model {
  const aligned = docText === undefined ? canonical : alignLedger(canonical, docText);
  return {
    ...base,
    ledger: aligned ?? canonical,
    byId: index(base.view.stream),
    misaligned: aligned === null,
  };
}

/** The model of a stream (or one of its pages); aligned to `docText` when the document already exists. */
export function buildModel(whole: Stream, options: ModelOptions, docText?: string): Model {
  const page = options.page ?? null;
  const view = pageView(whole, page, options.pageOrder);
  const base = {
    form: options.form,
    page,
    view,
    inherited: inheritedSegment(whole, view, page),
    segmentLabels: options.segmentLabels ?? {},
    pageLabels: options.pageLabels ?? {},
  };
  return finish(base, render(view.stream, options.form), docText);
}

/** The segment running into a page from the text before it; null for the whole stream, the text on no page, or unassigned text. */
function inheritedSegment(whole: Stream, view: PageView, page: string | null): SegmentStart | null {
  if (page === null || page === UNPLACED) return null;
  const before = view.anchor
    ? whole.items.indexOf(view.anchor)
    : view.missing?.after
      ? whole.items.findIndex((item) => item.id === view.missing!.after)
      : -1;
  const start = before >= 0 ? segmentAt(whole, before) : undefined;
  return start && start.segmentId !== null ? start : null;
}

/** The canonical text of the shown items. */
export function canonicalText(model: Model): string {
  return render(model.view.stream, model.form).text;
}

/**
 * Where new items belong when the changed lines held no items (an empty line
 * in the middle of the text, or the line before a leading page break): after
 * the item that stands before the change. The bridge falls back to the
 * stream's last item there, which would send the new words to the end of the
 * stream. Undefined when the changed lines hold items and the bridge's own
 * placement stands.
 */
export function predecessorOfChange(ledger: Ledger, changes: ChangeSet): Id | null | undefined {
  const oldDoc = Text.of(ledger.text.split('\n'));
  const newDoc = changes.apply(oldDoc);
  const inverted = changes.invert(oldDoc);
  let changedFrom = Infinity;
  let changedTo = -Infinity;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    changedFrom = Math.min(changedFrom, fromB);
    changedTo = Math.max(changedTo, toB);
  });
  if (changedFrom === Infinity) return undefined;
  const rangeFrom = Math.min(newDoc.lineAt(Math.min(changedFrom, newDoc.length)).from, changedFrom);
  const rangeTo = Math.max(newDoc.lineAt(Math.min(changedTo, newDoc.length)).to, changedTo);
  const oldFrom = inverted.mapPos(rangeFrom, -1);
  const oldTo = inverted.mapPos(rangeTo, 1);
  if (ledger.spans.some((s) => s.from < oldTo && s.to > oldFrom)) return undefined;
  let predecessor: Id | null = null;
  for (const span of ledger.spans) {
    if (span.to <= oldFrom) predecessor = span.id;
    else break;
  }
  return predecessor;
}

function tokenIn(stream: Stream, id: Id): Token | undefined {
  const item = stream.items.find((i) => i.id === id);
  return isToken(item) ? item : undefined;
}

function intentOps(sub: Stream, intent: Intent | undefined): Op[] {
  const ops: Op[] = [];
  if (!intent) return ops;
  if (intent.join) {
    const token = tokenIn(sub, intent.join);
    if (token && !token.joinNext) ops.push(setJoin(token, true));
  }
  if (intent.unjoin) {
    const token = tokenIn(sub, intent.unjoin);
    if (token && token.joinNext) ops.push(setJoin(token, false));
  }
  return ops;
}

function commit(
  model: Model,
  sub: Stream,
  ops: Op[],
  docText: string,
  ids: () => Id,
  canonical?: Ledger,
): Omit<ModelChange, 'reverse'> {
  const lifted = liftToWhole(ops, model.view, ids);
  const view: PageView = { stream: sub, anchor: lifted.anchor, missing: lifted.missing };
  const next = finish({ ...model, view }, canonical ?? render(sub, model.form), docText);
  return { model: next, ops: lifted.ops };
}

/**
 * A change set the user made to the document, as operations: the bridge
 * reads the changed lines back into items, then the intent (a join set or
 * cleared) is applied.
 */
export function reconcileModel(
  model: Model,
  changes: ChangeSet,
  docText: string,
  intent?: Intent,
  ids: () => Id = newId,
): ModelChange {
  const r = reconcile(model.view.stream, model.ledger, changes, model.form, { ids });
  let ops = r.ops;
  let sub = r.stream;
  let canonical: Ledger | undefined = r.ledger;
  const predecessor = ops.length ? predecessorOfChange(model.ledger, changes) : undefined;
  if (predecessor !== undefined) {
    const items = model.view.stream.items;
    const last = items.length ? items[items.length - 1]!.id : null;
    if (predecessor !== last) {
      ops = ops.map((op) =>
        op.t === 'insert' && op.after === last ? { ...op, after: predecessor } : op,
      );
      sub = applyOps(model.view.stream, ops).stream;
      canonical = undefined;
    }
  }
  const extra = intentOps(sub, intent);
  if (extra.length) {
    sub = applyOps(sub, extra).stream;
    ops = [...ops, ...extra];
    canonical = undefined;
  }
  const reverse = ops.length ? applyOps(model.view.stream, ops).reverse : [];
  return {
    ...commit(model, sub, ops, docText, ids, canonical),
    reverse,
    typed: ops.length ? { ops, reverse } : undefined,
  };
}

/**
 * Operations on the shown items (an insert at the page's start has `after:
 * null`), applied and lifted. `docText` is the document after the change
 * that shows the edit, or the unchanged document when the edit has no text.
 */
export function editModel(
  model: Model,
  ops: Op[],
  docText: string,
  ids: () => Id = newId,
): ModelChange {
  const applied = applyOps(model.view.stream, ops);
  return { ...commit(model, applied.stream, ops, docText, ids), reverse: applied.reverse };
}

/** The same stream, labels and page, read in the other form. */
export function withForm(model: Model, form: Form, docText?: string): Model {
  return finish({ ...model, form }, render(model.view.stream, form), docText);
}
