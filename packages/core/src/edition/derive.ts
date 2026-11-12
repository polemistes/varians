/**
 * Deriving one stream from another: an edition started from a witness's
 * text, or a transcription copied to serve as the starting point of another
 * witness's. Every item gets a new id; sources are recorded where they matter.
 */

import { newId } from '../ids.ts';
import {
  isToken,
  readForm,
  type Break,
  type Id,
  type Item,
  type SegmentStart,
  type Stream,
  type Token,
} from '../stream/items.ts';

export interface DeriveOptions {
  ids?: () => Id;
  /** Keep only these segments (by id); everything else is left out. Breaks between kept runs are kept. */
  segmentIds?: Set<Id>;
}

/**
 * An edition's text from a transcription: the read forms become the printed
 * words, each sourced from its witness token; line and paragraph breaks are
 * kept as the edition's first lineation; page and column breaks become line
 * breaks; segment starts, gaps and paratext objects are kept; marks are not
 * (the edition's own sigla are its own).
 *
 * A word the witness divides stays divided: its parts are joined tokens, each
 * with the segment start it had. Where the first part carries a normalized
 * form for the whole word, that form is divided where the witness divides the
 * word, if its letters correspond to those of the parts as written; where
 * they do not, the edition has the word whole before the break, and a segment
 * that began with a later part begins with the next word.
 */
export function deriveEdition(
  stream: Stream,
  transcriptionId: Id,
  options: DeriveOptions = {},
): Stream {
  const ids = options.ids ?? newId;
  const items: Item[] = [];
  /** The witness token each edition token was made from. */
  const origin = new Map<Id, Token>();
  let include = options.segmentIds === undefined;
  let pendingBreak: Break | null = null;
  for (const item of stream.items) {
    if (item.kind === 'break') {
      if (!include) continue;
      // A page or column boundary of the carrier is at least a line boundary of the text.
      const type = item.type === 'page' || item.type === 'column' ? 'line' : item.type;
      if (!pendingBreak || type === 'paragraph') pendingBreak = { kind: 'break', id: ids(), type };
      continue;
    }
    if (item.segment && options.segmentIds) {
      include = item.segment.segmentId !== null && options.segmentIds.has(item.segment.segmentId);
    }
    if (!include) continue;
    if (pendingBreak && items.length > 0) items.push(pendingBreak);
    pendingBreak = null;
    if (item.kind === 'object') {
      if (item.type === 'gap' || item.type === 'paratext' || item.type === 'lacuna') {
        const copy: Item = { ...item, id: ids() };
        items.push(copy);
      }
      continue;
    }
    const token: Token = {
      kind: 'token',
      id: ids(),
      // The word keeps its language in the edition.
      ...(item.lang !== undefined ? { lang: item.lang } : {}),
      form: readForm(item),
      source: { kind: 'witness', transcriptionId, tokenIds: [item.id] },
    };
    if (item.segment) token.segment = item.segment;
    if (item.joinNext) token.joinNext = true;
    origin.set(token.id, item);
    items.push(token);
  }
  return { items: withoutEmptyLines(dividedWords(items, origin, transcriptionId)) };
}

/** The letters of a text, which the parts of a divided word and its normalized form are compared by: accents and breathings are not counted. */
function letterCount(text: string): number {
  let n = 0;
  for (const char of text) if (/\p{L}/u.test(char)) n++;
  return n;
}

/**
 * The parts of a word whose letters are counted, as the normalized form of
 * the whole word divides over them, and whether each part joins the next
 * (not where a space of the normalized form falls between two parts). Null
 * where the letters do not correspond.
 */
function divide(whole: string, letters: number[]): { form: string; joinNext: boolean }[] | null {
  if (letters.some((n) => n === 0) || letterCount(whole) !== letters.reduce((a, b) => a + b, 0))
    return null;
  const chars = Array.from(whole);
  const texts: string[] = [];
  let at = 0;
  for (const n of letters.slice(0, -1)) {
    let seen = 0;
    while (at < chars.length && seen < n) if (/\p{L}/u.test(chars[at++]!)) seen++;
    // The marks that stand on the last letter go with it.
    while (at < chars.length && /\p{M}/u.test(chars[at]!)) at++;
    texts.push(chars.splice(0, at).join(''));
    at = 0;
  }
  texts.push(chars.join(''));
  const parts = texts.map((text, k) => ({
    form: text.trim(),
    joinNext: k < texts.length - 1 && !/\s$/u.test(text) && !/^\s/u.test(texts[k + 1]!),
  }));
  return parts.some((part) => part.form === '') ? null : parts;
}

/**
 * The tokens of the words the witness divides, as the edition has them (see
 * `deriveEdition`). A join that nothing follows, where the text derived stops
 * inside the word, is dropped.
 */
function dividedWords(items: Item[], origin: ReadonlyMap<Id, Token>, transcriptionId: Id): Item[] {
  const absorbed = new Set<Id>();
  for (let i = 0; i < items.length; i++) {
    const first = items[i]!;
    if (!isToken(first) || !first.joinNext) continue;
    // The parts of the word: the tokens the join reaches, over the breaks between them.
    const at = [i];
    for (let current: Token = first, j = i + 1; current.joinNext; j++) {
      while (items[j]?.kind === 'break') j++;
      const next = items[j];
      if (!isToken(next)) break;
      at.push(j);
      current = next;
    }
    const parts = at.map((k) => items[k] as Token);
    const last = parts[parts.length - 1]!;
    delete last.joinNext;
    i = at[at.length - 1]!;
    if (parts.length === 1) continue;
    const witness = parts.map((part) => origin.get(part.id)!);
    const whole = witness[0]!.norm;
    // Without a normalized form for the word, the parts keep their read forms.
    if (whole === undefined) continue;
    const cut = divide(
      whole,
      witness.map((w) => letterCount(w.form)),
    );
    if (cut) {
      parts.forEach((part, k) => {
        part.form = cut[k]!.form;
        if (cut[k]!.joinNext) part.joinNext = true;
        else delete part.joinNext;
      });
      continue;
    }
    // The word whole in its first part; what began with a later part begins with the next word.
    const [head, ...rest] = parts as [Token, ...Token[]];
    head.form = whole;
    delete head.joinNext;
    head.source = { kind: 'witness', transcriptionId, tokenIds: witness.map((w) => w.id) };
    let carried: SegmentStart | undefined;
    for (const part of rest) {
      absorbed.add(part.id);
      if (part.segment) carried = part.segment;
    }
    const next = items.slice(i + 1).find((item) => item.kind !== 'break');
    if (carried && next && !(next as Token).segment && !absorbed.has(next.id))
      (next as Token).segment = carried;
  }
  return items.filter((item) => !absorbed.has(item.id));
}

/** Breaks that no word stands between become one (a paragraph break outweighs a line break), and none ends the text. */
function withoutEmptyLines(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    const previous = out[out.length - 1];
    if (item.kind === 'break' && previous?.kind === 'break') {
      if (item.type === 'paragraph') out[out.length - 1] = item;
      continue;
    }
    out.push(item);
  }
  while (out[out.length - 1]?.kind === 'break') out.pop();
  return out;
}

/** A copy of a transcription's stream with new ids, as the starting point of another transcription. */
export function deriveTranscription(stream: Stream, options: DeriveOptions = {}): Stream {
  const ids = options.ids ?? newId;
  let include = options.segmentIds === undefined;
  const items: Item[] = [];
  for (const item of stream.items) {
    if (item.kind !== 'break' && item.segment && options.segmentIds) {
      include = item.segment.segmentId !== null && options.segmentIds.has(item.segment.segmentId);
    }
    if (!include) continue;
    const copy = JSON.parse(JSON.stringify(item)) as Item;
    copy.id = ids();
    if (copy.kind === 'token') {
      delete copy.source;
      delete copy.unchecked;
    }
    items.push(copy);
  }
  return { items };
}
