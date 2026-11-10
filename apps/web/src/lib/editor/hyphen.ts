/**
 * Words divided at a line's end.
 *
 * In a transcript the transcriber says where the manuscript divides a word:
 * Enter after a hyphen at the end of a word removes the hyphen, breaks the
 * line and joins the word's two halves (`joinNext`). Backspace at the start
 * of a line whose previous word is joined with it clears the join as the
 * lines are joined again; the bridge fuses the text by itself. Between two
 * words that are not one word, removing the break leaves a space: the line
 * break was also what kept them apart.
 *
 * In an edition the editor decides where lines break: Enter inside a word
 * divides it there (`divideWord`), and joining the lines again puts the word
 * together (`rejoinWord`). The hyphen is drawn where a line ends inside a
 * word, never typed or stored.
 */

import { isToken, type Id, type Item, type Op, type Token } from '@varians/core';
import { tokenText, type Form, type Ledger, type Span } from './bridge.ts';
import type { TextChange } from './paragraphs.ts';
import { codePointIndex } from './unicode.ts';

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
  if (index <= 0 || !before || !after || before.kind !== 'token' || after.kind !== 'token')
    return null;
  if (
    !INLINE_SPACE.test(ledger.text.slice(before.to, at)) ||
    !INLINE_SPACE.test(ledger.text.slice(at + 1, after.from))
  )
    return null;
  const previous = byId.get(before.id);
  if (!isToken(previous) || previous.joinNext) return null;
  return { from: at, to: at + 1, insert: ' ' };
}

/** What an edit made by a command is: the operations on the shown items, the text change that shows them, and where the caret goes. */
export interface Planned {
  ops: Op[];
  change: TextChange;
  caret: number;
}

/**
 * Enter inside a word of an edition, where the editor decides where lines
 * break: the word is divided there, into two joined parts with a line break
 * between them, and keeps its source and its segment (the first part has the
 * start, if the word had one; the second continues the segment). The hyphen
 * is drawn, not typed. Null where `pos` is not inside a word.
 */
export function divideWord(
  ledger: Ledger,
  byId: Map<Id, Item>,
  form: Form,
  pos: number,
  ids: () => Id,
): Planned | null {
  const span = spanContaining(ledger, pos);
  if (!span || span.kind !== 'token' || pos <= span.from || pos >= span.to) return null;
  const token = byId.get(span.id);
  // A read form that differs belongs to the whole word, and cannot be divided where the text is.
  if (!isToken(token) || (form === 'read' && token.norm !== undefined)) return null;
  const at = codePointIndex(tokenText(token, form), pos - span.from);
  const rest = ids();
  const ops: Op[] = [
    { t: 'split', id: token.id, at, newId: rest, join: true },
    { t: 'insert', after: token.id, items: [{ kind: 'break', id: ids(), type: 'line' }] },
  ];
  if (token.source) ops.push({ t: 'set', id: rest, fields: { source: token.source } });
  return { ops, change: { from: pos, to: pos, insert: '\n' }, caret: pos + 1 };
}

/** The source a word has when two parts of it are put together: the witness tokens of both, where the same transcription has both. */
function unitedSource(first: Token, second: Token): Token['source'] {
  const a = first.source;
  const b = second.source;
  if (a?.kind === 'witness' && b?.kind === 'witness' && a.transcriptionId === b.transcriptionId)
    return {
      kind: 'witness',
      transcriptionId: a.transcriptionId,
      tokenIds: [...new Set([...a.tokenIds, ...b.tokenIds])],
    };
  return a;
}

/**
 * Backspace at the start of a line (`direction` backward) or Delete at the
 * end of one (forward) in an edition, where the line break falls inside a
 * word: the lines are joined and the word has its parts put together again,
 * as one token where the second part does not begin a segment, and as two
 * joined tokens (a space the view does not show between them, and no hyphen,
 * since no line ends there) where it does, so that no word changes segment.
 * Null where the break is not inside a word.
 */
export function rejoinWord(
  ledger: Ledger,
  byId: Map<Id, Item>,
  pos: number,
  direction: 'backward' | 'forward',
): Planned | null {
  const at = direction === 'backward' ? pos - 1 : pos;
  if (at < 0 || ledger.text[at] !== '\n') return null;
  const index = ledger.spans.findIndex((s) => s.kind === 'break' && s.from === at);
  const before = ledger.spans[index - 1];
  const after = ledger.spans[index + 1];
  if (index <= 0 || !before || !after || before.kind !== 'token' || after.kind !== 'token')
    return null;
  if (
    !INLINE_SPACE.test(ledger.text.slice(before.to, at)) ||
    !INLINE_SPACE.test(ledger.text.slice(at + 1, after.from))
  )
    return null;
  const first = byId.get(before.id);
  const second = byId.get(after.id);
  if (!isToken(first) || !isToken(second) || !first.joinNext) return null;
  const ops: Op[] = [{ t: 'delete', ids: [ledger.spans[index]!.id] }];
  // A part that begins a segment is not put into the other: the word would change segment.
  if (second.segment) {
    return {
      ops,
      change: { from: before.to, to: after.from, insert: ' ' },
      caret: before.to + 1,
    };
  }
  ops.push({ t: 'join', id: first.id });
  const source = unitedSource(first, second);
  if (source && source !== first.source) ops.push({ t: 'set', id: first.id, fields: { source } });
  return { ops, change: { from: before.to, to: after.from, insert: '' }, caret: before.to };
}
