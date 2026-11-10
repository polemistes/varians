/**
 * The edition's text as printed: its tokens with the editorial sigla the
 * edition's conventions choose, and its objects (lacunae, gaps,
 * paratext). Pure, so that the page, the print and the plain-text export
 * print the same thing.
 *
 * - supplied: the marked letters or words between the supplied brackets ⟨ ⟩;
 * - surplus (what the editor deletes): between the deletion brackets [ ];
 * - crux: the crux sign before the marked word, and after the last word when
 *   the mark covers several;
 * - unclear: a dot under each marked letter;
 * - del (a scribe's deletion, which an edition rarely carries): struck through.
 *
 * Adjacent words with the same mark share one pair of brackets. Runs close
 * at the end of a line.
 */
import {
  isNotTranscribed,
  NOT_TRANSCRIBED_TEXT,
  wholeTokenMark,
  type Item,
  type Mark,
  type Token,
} from '@varians/core';

export interface EditionSigla {
  supplied: [string, string];
  deleted: [string, string];
  lacuna: string;
  crux: string;
}

export const DEFAULT_SIGLA: EditionSigla = {
  supplied: ['⟨', '⟩'],
  deleted: ['[', ']'],
  lacuna: '***',
  crux: '†',
};

/** A transcription's marks in the Leiden conventions: [supplied], {surplus}. */
export const LEIDEN_SIGLA: EditionSigla = {
  supplied: ['[', ']'],
  deleted: ['{', '}'],
  lacuna: '[…]',
  crux: '†',
};

export interface TextPart {
  text: string;
  struck?: boolean;
}

interface Spaced {
  id: string;
  /** A space precedes this piece in the line. */
  space: boolean;
}

export type Printed =
  | (Spaced & {
      kind: 'token';
      before: string;
      parts: TextPart[];
      after: string;
      /** The word is divided by the end of the line: a hyphen is drawn after it, and is not part of its text. */
      hyphen: boolean;
    })
  | (Spaced & { kind: 'lacuna'; text: string; extent: string | null })
  | (Spaced & {
      kind: 'gap';
      quantity: number | null;
      unit: string | null;
      /** The transcript stops short here: the gap says nothing of the carrier. */
      untranscribed: boolean;
    })
  | (Spaced & { kind: 'paratext'; type: string; text: string })
  | (Spaced & { kind: 'space' })
  | (Spaced & { kind: 'note'; text: string });

/** Marks that bracket a run of words, outermost first. */
const RUN_KINDS = ['crux', 'surplus', 'supplied'] as const;
type RunKind = (typeof RUN_KINDS)[number];

const UNDERDOT = '̣';
const LETTER = /\p{L}/u;

/** Which form of a token prints: the read form (an edition's words, a witness as read) or the written form. */
export type PrintForm = 'read' | 'written';

/** The words as printed: the read form where one is set, or what the carrier has. */
export function printedForm(token: Token, form: PrintForm = 'read'): string {
  return form === 'written' ? token.form : (token.norm ?? token.form);
}

function covers(mark: Mark, length: number): boolean {
  return mark.from === undefined || (mark.from === 0 && (mark.to ?? length) >= length);
}

function opening(kind: RunKind, sigla: EditionSigla): string {
  if (kind === 'crux') return sigla.crux;
  return kind === 'surplus' ? sigla.deleted[0] : sigla.supplied[0];
}

function closing(kind: RunKind, sigla: EditionSigla): string {
  if (kind === 'crux') return sigla.crux;
  return kind === 'surplus' ? sigla.deleted[1] : sigla.supplied[1];
}

/** The letters of one token, with brackets for marks on part of it, dots under unclear letters, and struck deletions. */
export function tokenParts(
  token: Token,
  sigla: EditionSigla = DEFAULT_SIGLA,
  form: PrintForm = 'read',
): TextPart[] {
  const text = printedForm(token, form);
  const chars = Array.from(text);
  const n = chars.length;
  // Character ranges belong to the written form; on a token printed in another form only whole-token marks apply.
  const ranged = text === token.form;
  const opens: string[][] = Array.from({ length: n + 1 }, () => []);
  const closes: string[][] = Array.from({ length: n + 1 }, () => []);
  const dotted = new Array<boolean>(n).fill(false);
  const struck = new Array<boolean>(n).fill(false);
  for (const mark of token.marks ?? []) {
    const whole = covers(mark, n);
    if (!whole && !ranged) continue;
    const from = whole ? 0 : Math.max(0, Math.min(n, mark.from ?? 0));
    const to = whole ? n : Math.max(from, Math.min(n, mark.to ?? n));
    switch (mark.kind) {
      case 'unclear':
        for (let i = from; i < to; i++) dotted[i] = true;
        break;
      case 'del':
        for (let i = from; i < to; i++) struck[i] = true;
        break;
      case 'supplied':
      case 'surplus':
      case 'crux':
        // Whole words are bracketed as runs, outside the word.
        if (whole || from >= to) break;
        opens[from]!.push(opening(mark.kind, sigla));
        if (mark.kind !== 'crux') closes[to]!.unshift(closing(mark.kind, sigla));
        break;
    }
  }
  const parts: TextPart[] = [];
  const push = (value: string, isStruck: boolean) => {
    if (value === '') return;
    const last = parts[parts.length - 1];
    if (last && Boolean(last.struck) === isStruck) last.text += value;
    else parts.push(isStruck ? { text: value, struck: true } : { text: value });
  };
  for (let i = 0; i <= n; i++) {
    push(closes[i]!.join(''), false);
    push(opens[i]!.join(''), false);
    if (i === n) break;
    const char = chars[i]!;
    push(dotted[i] && LETTER.test(char) ? char + UNDERDOT : char, struck[i]!);
  }
  return parts;
}

function attr(
  item: { attrs?: Record<string, string | number | boolean | null> },
  key: string,
): string | number | boolean | null | undefined {
  return item.attrs?.[key];
}

/**
 * One line's items as printed pieces, with the runs of bracketing marks
 * resolved. A line of prose holds the line breaks of its paragraph, which are
 * not shown: the words run on over them. `hyphen`: the last word of the line
 * is divided by its end, and a hyphen is drawn after it.
 */
export function printLine(
  all: Item[],
  sigla: EditionSigla = DEFAULT_SIGLA,
  form: PrintForm = 'read',
  hyphen = false,
): Printed[] {
  const items = all.some((item) => item.kind === 'break')
    ? all.filter((item) => item.kind !== 'break')
    : all;
  const out: Printed[] = [];
  // Whole-word marks of each item, for finding where runs begin and end.
  const whole = items.map((item) =>
    item.kind === 'token'
      ? new Set(RUN_KINDS.filter((kind) => wholeTokenMark(item, kind)))
      : new Set<RunKind>(),
  );
  // The length of the run of each kind that ends at an item, for the closing crux.
  const runLength = new Map<RunKind, number>();
  let joinNext = false;
  items.forEach((item, i) => {
    const space = out.length > 0 && !joinNext;
    joinNext = false;
    if (item.kind === 'token') {
      const previous = items[i - 1]?.kind === 'token' ? whole[i - 1]! : new Set<RunKind>();
      const next = items[i + 1]?.kind === 'token' ? whole[i + 1]! : new Set<RunKind>();
      let before = '';
      let after = '';
      for (const kind of RUN_KINDS) {
        if (!whole[i]!.has(kind)) continue;
        if (!previous.has(kind)) {
          before += opening(kind, sigla);
          runLength.set(kind, 0);
        }
        runLength.set(kind, (runLength.get(kind) ?? 0) + 1);
      }
      for (const kind of [...RUN_KINDS].reverse()) {
        if (!whole[i]!.has(kind) || next.has(kind)) continue;
        if (kind !== 'crux' || (runLength.get(kind) ?? 1) > 1) after += closing(kind, sigla);
      }
      out.push({
        kind: 'token',
        id: item.id,
        space,
        before,
        parts: tokenParts(item, sigla, form),
        after,
        hyphen: hyphen && i === items.length - 1 && item.joinNext === true,
      });
      joinNext = item.joinNext === true;
      return;
    }
    if (item.kind !== 'object') return;
    switch (item.type) {
      case 'lacuna': {
        const extent = attr(item, 'extent');
        out.push({
          kind: 'lacuna',
          id: item.id,
          space,
          text: sigla.lacuna,
          extent: typeof extent === 'string' && extent !== '' ? extent : null,
        });
        return;
      }
      case 'gap': {
        const quantity = attr(item, 'quantity');
        const unit = attr(item, 'unit');
        out.push({
          kind: 'gap',
          id: item.id,
          space,
          quantity: typeof quantity === 'number' ? quantity : null,
          unit: typeof unit === 'string' ? unit : null,
          untranscribed: isNotTranscribed(item.attrs),
        });
        return;
      }
      case 'paratext': {
        const type = attr(item, 'type');
        out.push({
          kind: 'paratext',
          id: item.id,
          space,
          type: typeof type === 'string' ? type : 'paratext',
          text: item.text ?? '',
        });
        return;
      }
      case 'space':
        out.push({ kind: 'space', id: item.id, space });
        return;
      case 'note':
        if (item.text) out.push({ kind: 'note', id: item.id, space, text: item.text });
        return;
      default:
        // Figures and marks of the carrier are not printed in an edition's text.
        return;
    }
  });
  return out;
}

/** What a gap prints: brackets around an ellipsis; a gap marked as not transcribed prints so. */
export const GAP_TEXT = '[…]';

/** What a gap prints, by whether it marks a stretch as not transcribed. */
export function gapSign(piece: { untranscribed: boolean }): string {
  return piece.untranscribed ? NOT_TRANSCRIBED_TEXT : GAP_TEXT;
}
export const VACAT_TEXT = 'vac.';

/** The hyphen drawn after a word that the end of a line divides. */
export const HYPHEN = '-';

/** A line as plain text, as the plain-text export and the search print it. */
export function plainLine(pieces: Printed[]): string {
  let out = '';
  for (const piece of pieces) {
    let text = '';
    switch (piece.kind) {
      case 'token':
        text =
          piece.before +
          piece.parts.map((p) => p.text).join('') +
          piece.after +
          (piece.hyphen ? HYPHEN : '');
        break;
      case 'lacuna':
        text = piece.text;
        break;
      case 'gap':
        text = gapSign(piece);
        break;
      case 'paratext':
        text = piece.text;
        break;
      case 'space':
        text = VACAT_TEXT;
        break;
      case 'note':
        continue;
    }
    if (text === '') continue;
    out += (piece.space && out !== '' ? ' ' : '') + text;
  }
  return out;
}
