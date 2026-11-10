/**
 * The edition's words as the edition prints them, for the variant window:
 * a stretch of its tokens with the critical signs the edition's conventions
 * choose (the deletion and supplement brackets, the crux, the lacuna sign),
 * and what the edition prints at a point between two words. Built once from
 * the edition's lines; pure, so that the window and its tests need no page.
 */
import { trimPunctuationAt, wholeTokenMark, type Item, type Token } from '@varians/core';
import { DEFAULT_SIGLA, plainLine, printLine, type EditionSigla, type Printed } from './marks';

/** What the variant window asks of the edition's text. */
export interface EditionPrint {
  /**
   * The words of these tokens as printed, signs included. Punctuation at the
   * edges of the stretch is left off unless `edges` asks for it, as where the
   * difference between two readings may be a mark of punctuation.
   */
  words(tokenIds: readonly string[], edges: boolean): string;
  /** Whether the edition prints every one of these words as deleted. */
  deleted(tokenIds: readonly string[]): boolean;
  /** The sign the edition prints for a lacuna. */
  readonly lacuna: string;
  /** The lacuna sign, when the edition has a lacuna mark between these two words (at an end of a segment, where one is null, none is found); otherwise an empty string. */
  lacunaBetween(before: string | null, after: string | null): string;
}

export class EditionText implements EditionPrint {
  private index = new Map<string, number>();
  private items: Item[];
  readonly lacuna: string;

  constructor(
    items: readonly Item[],
    private sigla: EditionSigla = DEFAULT_SIGLA,
  ) {
    this.lacuna = sigla.lacuna;
    this.items = [...items];
    this.items.forEach((item, i) => this.index.set(item.id, i));
  }

  private tokens(ids: readonly string[]): Token[] {
    const out: Token[] = [];
    for (const id of ids) {
      const item = this.items[this.index.get(id) ?? -1];
      if (item?.kind === 'token') out.push(item);
    }
    return out;
  }

  words(tokenIds: readonly string[], edges: boolean): string {
    const wanted = new Set(tokenIds);
    const positions = tokenIds.flatMap((id) => this.index.get(id) ?? []);
    if (positions.length === 0) return '';
    const from = Math.min(...positions);
    const to = Math.max(...positions);
    // The stretch's own words, and the lacuna marks standing within it.
    const stretch = this.items
      .slice(from, to + 1)
      .filter(
        (item) =>
          (item.kind === 'token' && wanted.has(item.id)) ||
          (item.kind === 'object' && item.type === 'lacuna'),
      );
    const pieces = printLine(stretch, this.sigla);
    if (!edges) trimEdges(pieces);
    return plainLine(pieces);
  }

  deleted(tokenIds: readonly string[]): boolean {
    const tokens = this.tokens(tokenIds);
    return tokens.length > 0 && tokens.every((token) => wholeTokenMark(token, 'surplus'));
  }

  lacunaBetween(before: string | null, after: string | null): string {
    const from = before === null ? undefined : this.index.get(before);
    const to = after === null ? undefined : this.index.get(after);
    if (from === undefined || to === undefined) return '';
    for (let i = from + 1; i < to; i++) {
      const item = this.items[i]!;
      if (item.kind === 'object' && item.type === 'lacuna') return this.lacuna;
    }
    return '';
  }
}

/** The punctuation at the two ends of a printed stretch taken off its first and last word, inside the signs. */
function trimEdges(pieces: Printed[]): void {
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (first?.kind === 'token' && first.parts.length) {
    const part = first.parts[0]!;
    part.text = trimPunctuationAt(part.text, 'start');
  }
  if (last?.kind === 'token' && last.parts.length) {
    const part = last.parts[last.parts.length - 1]!;
    part.text = trimPunctuationAt(part.text, 'end');
  }
}
