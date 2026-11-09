/**
 * Words divided at a line's end.
 *
 * Enter after a hyphen at the end of a word removes the hyphen, breaks the
 * line and joins the word's two halves (`joinNext`). Backspace at the start
 * of a line whose previous word is joined with it clears the join as the
 * lines are joined again; the bridge fuses the text by itself. Between two
 * words that are not one word, removing the break leaves a space: the line
 * break was also what kept them apart.
 */

import { isToken, type Id, type Item } from '@varians/core';
import type { Ledger, Span } from './bridge.ts';

export interface TextEdit {
  from: number;
  to: number;
  tokenId: Id;
}

/** The span whose text contains the character at `pos`. */
export function spanContaining(ledger: Ledger, pos: number): Span | undefined {
  for (const span of ledger.spans) {
    if (span.from > pos) return undefined;
    if (pos < span.to) return span;
  }
  return undefined;
}

/** Enter at `pos`: replace the hyphen before it with a line break and join `tokenId` with the next token, or null. */
export function hyphenEnter(ledger: Ledger, byId: Map<Id, Item>, pos: number): TextEdit | null {
  if (pos <= 0 || ledger.text[pos - 1] !== '-') return null;
  const span = spanContaining(ledger, pos - 1);
  if (!span || span.kind !== 'token' || pos - 1 <= span.from) return null;
  if (!isToken(byId.get(span.id))) return null;
  return { from: pos - 1, to: pos, tokenId: span.id };
}

/** Backspace at `pos`: delete the line break before it and clear the join of the token that ends the previous line, or null. */
export function backspaceUnjoin(ledger: Ledger, byId: Map<Id, Item>, pos: number): TextEdit | null {
  if (pos <= 0 || ledger.text[pos - 1] !== '\n') return null;
  const index = ledger.spans.findIndex((s) => s.kind === 'break' && s.from === pos - 1);
  if (index <= 0) return null;
  const previous = ledger.spans[index - 1]!;
  if (previous.kind !== 'token') return null;
  if (!/^\s*$/u.test(ledger.text.slice(previous.to, pos - 1))) return null;
  const token = byId.get(previous.id);
  if (!isToken(token) || !token.joinNext) return null;
  return { from: pos - 1, to: pos, tokenId: previous.id };
}

const INLINE_SPACE = /^[^\S\n]*$/u;

/**
 * Backspace at the start of a line (`backward`) or Delete at the end of one
 * (`forward`) between two words that are not one word: the break goes and
 * a space keeps the words apart, where deleting the newline alone would
 * fuse them into one word, the second losing its id, read form and zones.
 * Null where the break is not between two such words.
 */
export function joinLinesEdit(
  ledger: Ledger,
  byId: Map<Id, Item>,
  pos: number,
  direction: 'backward' | 'forward',
): { from: number; to: number; insert: string } | null {
  const at = direction === 'backward' ? pos - 1 : pos;
  if (at < 0 || ledger.text[at] !== '\n') return null;
  const index = ledger.spans.findIndex((s) => s.kind === 'break' && s.from === at);
  const before = ledger.spans[index - 1];
  const after = ledger.spans[index + 1];
  if (index <= 0 || !before || !after || before.kind !== 'token' || after.kind !== 'token') return null;
  if (!INLINE_SPACE.test(ledger.text.slice(before.to, at)) || !INLINE_SPACE.test(ledger.text.slice(at + 1, after.from)))
    return null;
  const previous = byId.get(before.id);
  if (!isToken(previous) || previous.joinNext) return null;
  return { from: at, to: at + 1, insert: ' ' };
}
