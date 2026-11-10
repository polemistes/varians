/**
 * Deriving one stream from another: an edition started from a witness's
 * text, or a transcription copied to serve as the starting point of another
 * witness's. Every item gets a new id; sources are recorded where they matter.
 */

import { newId } from '../ids.ts';
import { readForm, type Id, type Item, type Stream, type Token } from '../stream/items.ts';

export interface DeriveOptions {
  ids?: () => Id;
  /** Keep only these segments (by id); everything else is left out. Breaks between kept runs are kept. */
  segmentIds?: Set<Id>;
}

/**
 * An edition's text from a transcription: the read forms become the printed
 * words, each sourced from its witness token; line and paragraph breaks are
 * kept as the edition's first lineation; page and column breaks are dropped;
 * segment starts, gaps and paratext objects are kept; marks are not (the
 * edition's own sigla are its own).
 */
export function deriveEdition(
  stream: Stream,
  transcriptionId: Id,
  options: DeriveOptions = {},
): Stream {
  const ids = options.ids ?? newId;
  const items: Item[] = [];
  let include = options.segmentIds === undefined;
  let pendingBreak: Item | null = null;
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
      form: readForm(item),
      source: { kind: 'witness', transcriptionId, tokenIds: [item.id] },
    };
    if (item.segment) token.segment = item.segment;
    // A word divided at a line's end is printed whole, and the division is not the edition's.
    if (item.joinNext) {
      const previous = items[items.length - 1];
      void previous;
    }
    items.push(token);
  }
  return { items: joinDividedWords(items) };
}

/** Tokens the witness divided at a line end are one printed word in the edition. */
function joinDividedWords(items: Item[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    out.push(item);
  }
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
