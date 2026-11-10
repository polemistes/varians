/**
 * The items of a text stream.
 *
 * A transcription, and an edition's text, is an ordered list of items:
 * tokens (runs of letters on one line of the carrier), breaks (line, column,
 * page, paragraph) and objects (gaps, figures, marks, paratext). Every item
 * has a permanent id; everything else in Varians that refers to text refers
 * to these ids, never to a character position.
 */

export type Id = string;

/** A feature on a token: whole-token when `from`/`to` are absent, else a range of its written form. */
export interface Mark {
  /**
   * TEI-derived kind: unclear, supplied, gap, del, add, subst, abbr, hi, sic, corr, damage, surplus, handShift, space, orig, reg, crux, note, variant.
   *
   * `variant`: the carrier notes an alternative reading of these words (in the
   * margin, between the lines, often introduced by γρ.). Always whole-token.
   * One variant may cover several consecutive words: every token of the span
   * carries the mark with the same `attrs.group` (a short id). Its attrs:
   * `group` (string), `reading` (the variant's words as read, divided at
   * spaces; an empty string means the variant leaves the words out), `place`
   * ('margin' | 'interlinear' | 'other'), and optionally `hand`. A token has
   * at most one variant mark. Exported to TEI as `<app><lem>` around the words
   * with `<rdg type="place" hand>reading</rdg>`.
   */
  kind: string;
  attrs?: Record<string, string | number | boolean | null>;
  from?: number;
  to?: number;
}

/** Where a token's words were taken from, on an edition's tokens only. */
export type TokenSource =
  | { kind: 'witness'; transcriptionId: Id; tokenIds: Id[] }
  | { kind: 'conjecture'; conjectureId: Id }
  | { kind: 'editor' };

/** The property of a token that begins a run of a segment. `segmentId` null means: unassigned from here. */
export interface SegmentStart {
  segmentId: Id | null;
  /** Content order of this run among the segment's runs in the same stream; 1 when the segment is in one piece. */
  part?: number;
}

export type Separator = 'space' | 'none' | 'interpunct' | 'other';

export interface Token {
  kind: 'token';
  id: Id;
  /** The diplomatic form: the word as the witness writes it. In a transcription without a diplomatic record, the only form, normalized. */
  form: string;
  /** The normalized form, where it differs from the diplomatic form. May contain spaces: the token is read as several words. */
  norm?: string;
  /** The diplomatic form changed after the normalized form was last confirmed. */
  unchecked?: boolean;
  /**
   * This token and the next form one word: divided at a line's end, or where
   * a segment begins. The hyphen of a divided word is not stored: it is drawn
   * where a line break that is shown falls inside the word.
   */
  joinNext?: boolean;
  /** What the carrier has before this token, when recorded. */
  sep?: Separator;
  /** This token begins a run of a segment. */
  segment?: SegmentStart;
  marks?: Mark[];
  /** Edition tokens only. */
  source?: TokenSource;
}

export type BreakType = 'line' | 'column' | 'page' | 'paragraph';

/** How a paragraph of an edition's text is shown: in lines as the editor breaks them, or run on. */
export type Lineation = 'verse' | 'prose';

export interface Break {
  kind: 'break';
  id: Id;
  type: BreakType;
  /** The page that begins here, for a page break. */
  pageId?: Id;
  /** A label shown at the break: a page or column name, when the page is not registered. */
  label?: string;
  /** Layout of the line that begins here: ltr, rtl, vertical, circular, boustrophedon, retrograde. */
  rend?: string;
  /**
   * On a paragraph break of an edition's text: whether the paragraph it opens
   * is verse or prose. Absent: the edition's own convention. The text before
   * the first paragraph break is a paragraph too; a paragraph break at the
   * very start of the text opens it and carries its kind.
   */
  lineation?: Lineation;
}

/** Objects in the flow that are not words: gaps, figures, scribal marks, notes, paratext, lacuna marks. */
export type ObjectType = 'gap' | 'figure' | 'mark' | 'note' | 'lacuna' | 'paratext' | 'space';

export interface Obj {
  kind: 'object';
  id: Id;
  type: ObjectType;
  attrs?: Record<string, string | number | boolean | null>;
  /** Text of the object where it has one: a paratext's words, a note. */
  text?: string;
  /** This object begins a run of a segment, like a token. */
  segment?: SegmentStart;
}

export type Item = Token | Break | Obj;

/**
 * What a gap carries when its transcriber marks a stretch as not transcribed:
 * the reason `ellipsis` of EpiDoc, with the words EpiDoc and Leiden+ give it.
 * Such a gap says nothing of the carrier, which is neither lost nor illegible
 * there; it says that the transcript stops short of the witness's own text.
 */
export const NOT_TRANSCRIBED_ATTRS = { reason: 'ellipsis', desc: 'non transcribed' } as const;

/** Whether a gap marks a stretch as not transcribed, and not as text lost or illegible in the carrier. */
export function isNotTranscribed(attrs: Record<string, unknown> | undefined): boolean {
  return attrs?.reason === NOT_TRANSCRIBED_ATTRS.reason;
}

export interface Stream {
  items: Item[];
}

export function isToken(item: Item | undefined): item is Token {
  return item?.kind === 'token';
}

export function isBreak(item: Item | undefined): item is Break {
  return item?.kind === 'break';
}

export function isObj(item: Item | undefined): item is Obj {
  return item?.kind === 'object';
}

/** The read form of a token: the override where there is one, else the written form. */
export function readForm(token: Token): string {
  return token.norm ?? token.form;
}

/** Breaks that end a line of the carrier. A paragraph break ends a line as well. */
export function endsLine(item: Item): boolean {
  return item.kind === 'break';
}

/** A structural copy of an item, so that a stream can be edited without touching the caller's objects. */
export function cloneItem<T extends Item>(item: T): T {
  return JSON.parse(JSON.stringify(item)) as T;
}

export function emptyStream(): Stream {
  return { items: [] };
}

/** Index of every item id in a stream. */
export function indexOf(stream: Stream): Map<Id, number> {
  const map = new Map<Id, number>();
  stream.items.forEach((item, i) => map.set(item.id, i));
  return map;
}

export function findIndex(stream: Stream, id: Id): number {
  return stream.items.findIndex((item) => item.id === id);
}

export function requireIndex(stream: Stream, id: Id): number {
  const index = findIndex(stream, id);
  if (index < 0) throw new StreamError(`no item ${id}`, 'missing', [id]);
  return index;
}

export class StreamError extends Error {
  constructor(
    message: string,
    public readonly reason: 'missing' | 'duplicate' | 'invalid',
    public readonly ids: Id[] = [],
  ) {
    super(message);
    this.name = 'StreamError';
  }
}
