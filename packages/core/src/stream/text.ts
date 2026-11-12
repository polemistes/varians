/**
 * Plain-text renderings of a stream, and the inverse: a stream from plain text.
 */

import { newId } from '../ids.ts';
import {
  isBreak,
  isNotTranscribed,
  isObj,
  isToken,
  readForm,
  type Break,
  type Id,
  type Item,
  type Stream,
  type Token,
} from './items.ts';

export type Form = 'written' | 'read';

export interface TextOptions {
  form?: Form;
  /** Show the attested separators instead of a space between every token (scriptio continua). */
  asWritten?: boolean;
  /** What to print for a gap object. */
  gap?: (attrs: Record<string, unknown>) => string;
  /**
   * For an edition's text, as it is shown (`shownBreaks`): the breaks that are
   * not shown, where the words run on, and the words that end a shown line
   * divided, where a hyphen is written.
   */
  shown?: { hyphens: ReadonlySet<Id>; hidden: ReadonlySet<Id> };
}

/** A stream as plain text: tokens separated by spaces, breaks as newlines (two for a paragraph). */
export function toText(stream: Stream, options: TextOptions = {}): string {
  const form = options.form ?? 'written';
  let out = '';
  let atLineStart = true;
  let pendingJoin = false;
  for (const item of stream.items) {
    if (isBreak(item)) {
      if (options.shown?.hidden.has(item.id)) continue;
      out += item.type === 'paragraph' ? '\n\n' : '\n';
      atLineStart = true;
      continue;
    }
    if (isObj(item)) {
      if (item.type === 'gap') {
        const text = options.gap ? options.gap(item.attrs ?? {}) : gapText(item.attrs ?? {});
        out += (atLineStart ? '' : ' ') + text;
        atLineStart = false;
      } else if (item.text) {
        out += (atLineStart ? '' : ' ') + item.text;
        atLineStart = false;
      }
      continue;
    }
    const text = form === 'read' ? readForm(item) : item.form;
    if (!atLineStart && !pendingJoin) {
      out += separatorBefore(item, options.asWritten ?? false);
    }
    out += text;
    if (options.shown?.hyphens.has(item.id)) out += '-';
    atLineStart = false;
    pendingJoin = item.joinNext === true;
  }
  return out;
}

function separatorBefore(token: Token, asWritten: boolean): string {
  if (!asWritten) return ' ';
  switch (token.sep) {
    case 'none':
      return '';
    case 'interpunct':
      return '·';
    case 'other':
      return ' ';
    default:
      return ' ';
  }
}

/** What a gap prints when it marks a stretch as not transcribed. */
export const NOT_TRANSCRIBED_TEXT = '(not transcribed)';

export function gapText(attrs: Record<string, unknown>): string {
  if (isNotTranscribed(attrs)) return NOT_TRANSCRIBED_TEXT;
  const quantity = typeof attrs.quantity === 'number' ? attrs.quantity : null;
  const reason = typeof attrs.reason === 'string' ? attrs.reason : 'lost';
  if (reason === 'illegible') return quantity ? `{${'.'.repeat(Math.min(quantity, 12))}}` : '{...}';
  return quantity ? `[${'.'.repeat(Math.min(quantity, 12))}]` : '[...]';
}

export interface FromTextOptions {
  /** The language of every word made (a BCP 47 tag): text never has a default one. */
  lang: string;
  ids?: () => Id;
  /** Two newlines make a paragraph break instead of two line breaks. */
  paragraphs?: boolean;
  /** A hyphen directly before a newline divides a word: the two parts are joined. */
  hyphenJoins?: boolean;
}

/** A stream from plain text: whitespace divides words, newlines divide lines. */
export function fromText(text: string, options: FromTextOptions): Stream {
  const ids = options.ids ?? newId;
  const items: Item[] = [];
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let pendingJoin = false;
  for (let l = 0; l < lines.length; l++) {
    let line = lines[l]!;
    if (l > 0) {
      const paragraph = options.paragraphs && line.trim() === '' && lines[l - 1]!.trim() !== '';
      if (paragraph) {
        items.push({ kind: 'break', id: ids(), type: 'paragraph' } satisfies Break);
        continue;
      }
      if (!(options.paragraphs && lines[l - 1]!.trim() === '' && l > 1)) {
        items.push({ kind: 'break', id: ids(), type: 'line' } satisfies Break);
      }
    }
    let joinsNext = false;
    if (options.hyphenJoins && /-$/u.test(line) && l < lines.length - 1) {
      line = line.replace(/-$/u, '');
      joinsNext = true;
    }
    const tokens = line.split(/\s+/u).filter((t) => t.length > 0);
    tokens.forEach((form, k) => {
      const token: Token = { kind: 'token', id: ids(), lang: options.lang, form };
      if (pendingJoin && k === 0) pendingJoin = false;
      if (joinsNext && k === tokens.length - 1) token.joinNext = true;
      items.push(token);
    });
    pendingJoin = joinsNext && tokens.length > 0;
  }
  return { items };
}

/** The tokens of a stream, in order. */
export function tokensOf(stream: Stream): Token[] {
  return stream.items.filter(isToken);
}

/** Every item's id, in order. */
export function idsOf(stream: Stream): Id[] {
  return stream.items.map((i) => i.id);
}
