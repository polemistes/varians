/**
 * The ledger over the document as it really is.
 *
 * The bridge renders a stream to a canonical text: one space between words,
 * none at the ends of lines. The document the user edits may hold more
 * whitespace at any moment (a space typed at a line's end before the next
 * word). The words, objects and newlines are the same in the same order, so
 * the canonical spans can be laid over the real text; that aligned ledger is
 * what the next change set is applied against.
 */

import { OBJECT_CHAR, type Ledger, type Span } from './bridge.ts';

function isSpace(ch: string): boolean {
  return ch !== '\n' && /\s/u.test(ch);
}

/**
 * The canonical ledger's spans placed on `text`. Null when the text's words
 * are not the stream's words (the document then has to be reset to the
 * canonical text).
 */
export function alignLedger(canonical: Ledger, text: string): Ledger | null {
  if (canonical.text === text) return canonical;
  const spans: Span[] = [];
  let i = 0;
  const skipSpaces = () => {
    while (i < text.length && isSpace(text[i]!)) i++;
  };
  for (const span of canonical.spans) {
    skipSpaces();
    if (span.kind === 'break') {
      if (text[i] !== '\n') return null;
      spans.push({ ...span, from: i, to: i + 1 });
      i++;
      continue;
    }
    const shown = canonical.text.slice(span.from, span.to);
    const words =
      span.kind === 'object' ? [OBJECT_CHAR] : shown.split(/\s+/u).filter((w) => w.length > 0);
    const start = i;
    for (let w = 0; w < words.length; w++) {
      if (w > 0) skipSpaces();
      if (!text.startsWith(words[w]!, i)) return null;
      i += words[w]!.length;
    }
    // A longer word in the document is a different word.
    if (
      span.kind === 'token' &&
      i < text.length &&
      !/\s/u.test(text[i]!) &&
      text[i] !== OBJECT_CHAR
    )
      return null;
    spans.push({ ...span, from: start, to: i });
  }
  skipSpaces();
  if (i < text.length) return null;
  return { text, spans };
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The one replacement that turns one text into another, around their common prefix and suffix. */
export function minimalChange(oldText: string, newText: string): TextChange | null {
  if (oldText === newText) return null;
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldText.length - suffix))) suffix--;
  return {
    from: prefix,
    to: oldText.length - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
}
