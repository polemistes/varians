/**
 * From document positions to items: the tokens a selection covers, the
 * token at the caret, and where an item inserted at the caret goes.
 */

import { isToken, type Id, type Item, type Token } from '@varians/core';
import { OBJECT_CHAR, spansIn, tokenText, type Form, type Ledger, type Span } from './bridge.ts';
import { codePointIndex } from './unicode.ts';

export interface SelectionTokens {
  tokenIds: Id[];
  caret: Id | null;
}

/** The token at a position: the one containing it, else the one ending there, else the one starting there. */
export function tokenSpanAt(ledger: Ledger, pos: number): Span | undefined {
  let ending: Span | undefined;
  let starting: Span | undefined;
  for (const span of ledger.spans) {
    if (span.from > pos) break;
    if (span.kind !== 'token') continue;
    if (span.from < pos && pos < span.to) return span;
    if (span.to === pos) ending = span;
    else if (span.from === pos) starting = span;
  }
  return ending ?? starting;
}

export function tokenAt(ledger: Ledger, byId: Map<Id, Item>, pos: number): Token | null {
  const span = tokenSpanAt(ledger, pos);
  const token = span ? byId.get(span.id) : undefined;
  return isToken(token) ? token : null;
}

/** The tokens a selection covers and the token at its head. */
export function selectionTokens(
  ledger: Ledger,
  from: number,
  to: number,
  head: number,
): SelectionTokens {
  if (from > to) [from, to] = [to, from];
  const tokenIds = spansIn(ledger, from, to)
    .filter((s) => s.kind === 'token')
    .map((s) => s.id);
  const caret = tokenSpanAt(ledger, head);
  return { tokenIds, caret: caret ? caret.id : null };
}

export interface Insertion {
  /** The shown item the new item follows; null when it comes first. */
  after: Id | null;
  /** The token to divide first, at this code point of its written form, when the caret stands inside a word. */
  split: { id: Id; at: number } | null;
  /** The text change that shows the item. */
  change: { from: number; to: number; insert: string };
  /** Where the caret goes afterwards. */
  caret: number;
}

/**
 * Where an object or a break typed at `pos` goes. Inside a word the word is
 * divided; between words the whitespace between them is replaced.
 */
export function planInsertion(
  ledger: Ledger,
  byId: Map<Id, Item>,
  form: Form,
  pos: number,
  kind: 'object' | 'break',
): Insertion {
  const shown = kind === 'object' ? OBJECT_CHAR : '\n';
  let prev: Span | undefined;
  let next: Span | undefined;
  for (const span of ledger.spans) {
    if (span.from < pos && pos < span.to) {
      const item = byId.get(span.id);
      if (span.kind === 'token' && isToken(item) && !(form === 'read' && item.norm !== undefined)) {
        const text = ledger.text.slice(span.from, span.to);
        const left = text.slice(0, pos - span.from);
        const right = text.slice(pos - span.from);
        const insert = kind === 'object' ? `${left} ${shown} ${right}` : `${left}\n${right}`;
        return {
          after: span.id,
          split: { id: span.id, at: codePointIndex(tokenText(item, form), pos - span.from) },
          change: { from: span.from, to: span.to, insert },
          caret: span.from + left.length + (kind === 'object' ? 2 : 1),
        };
      }
      // Inside an object, or a read form that cannot be divided: insert after it.
      prev = span;
      next = undefined;
      pos = span.to;
      break;
    }
    if (span.to <= pos) prev = span;
    else if (span.from >= pos) {
      next = span;
      break;
    }
  }
  if (!next) next = ledger.spans.find((s) => s.from >= pos);
  const from = prev ? prev.to : 0;
  const to = next ? next.from : ledger.text.length;
  if (kind === 'break') {
    return {
      after: prev ? prev.id : null,
      split: null,
      change: { from, to, insert: '\n' },
      caret: from + 1,
    };
  }
  const before = prev && prev.kind !== 'break' ? ' ' : '';
  const afterward = next && next.kind !== 'break' ? ' ' : '';
  return {
    after: prev ? prev.id : null,
    split: null,
    change: { from, to, insert: `${before}${shown}${afterward}` },
    caret: from + before.length + shown.length,
  };
}
