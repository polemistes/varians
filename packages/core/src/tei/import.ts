/**
 * TEI import: a TEI P5 or EpiDoc document read into a stream of tokens,
 * breaks and objects. The structure met on the way (divs, lines, milestones,
 * line and page breaks with numbers) is reported as segment start hints and
 * pages for the caller to map onto a reference scheme and a witness's pages.
 *
 * Tokens are whitespace-separated runs of text with punctuation attached, or
 * one per `<w>`. Transcription elements become marks on the tokens they
 * cover, whole-token where they cover whole words and ranged where they
 * cover part of one. Empty elements that stand inside a word (a gap, a space,
 * a hand shift) become point marks (from equal to to) at that character;
 * between words a gap or a space is an object.
 */

import { newId } from '../ids.ts';
import type { Break, Item, Mark, Obj, ObjectType, Stream, Token } from '../stream/items.ts';
import {
  attr,
  childElements,
  collapseWhitespace,
  descendant,
  findDescendants,
  firstChild,
  isElement,
  isText,
  parseXml,
  textContent,
  type XmlElement,
  type XmlNode,
} from './xml.ts';

export interface TeiImportOptions {
  /** Source of item ids; defaults to new ULIDs. */
  ids?: () => string;
}

/** One component of an address found in the TEI structure: a div's subtype or type with its n, a line's n, a milestone's unit and n. */
export interface AddressPart {
  /** The unit name: a div's subtype or type, `line` for `<l>`, `lb` for a numbered `<lb>`, a milestone's unit; null for an untyped div or milestone. */
  unit: string | null;
  n: string;
}

export interface SegmentStartHint {
  /** Index of the token or object that begins the segment. Several hints may share an index when the structure gives parallel numberings (an `<l n>` and an `<lb n>`). */
  itemIndex: number;
  /** The address parts, outermost first, e.g. [{unit: 'book', n: '1'}, {unit: 'line', n: '5'}]. */
  parts: AddressPart[];
}

export interface ImportedPage {
  label: string;
  /** The `facs` attribute as written. */
  facs?: string;
  /** The image URL, when `facs` could be resolved through the document's `<facsimile>` or is a URL itself. */
  imageUrl?: string;
  /** Index of the page break item. */
  itemIndex: number;
}

export interface ImportedWitness {
  repository?: string;
  settlement?: string;
  idno?: string;
  title?: string;
  date?: string;
  material?: string;
  extent?: string;
  hands?: string;
  description?: string;
  /** objectDesc's form: codex, scroll, leaf, or another value as given. */
  form?: string;
}

export interface ImportedHeader {
  title?: string;
  author?: string;
  language?: string;
}

export interface TeiImport {
  stream: Stream;
  /** Segment starts the caller must resolve to segment ids, in stream order. */
  segmentStarts: SegmentStartHint[];
  /** Pages met as `<pb/>`, in order. */
  pages: ImportedPage[];
  /** Witness description from teiHeader/fileDesc/sourceDesc/msDesc when present. */
  witness?: ImportedWitness;
  /** Title, author and language from the header when present. */
  header: ImportedHeader;
  warnings: string[];
}

export interface DetectedStructure {
  /** Numbered units met in the body, in order of first appearance, with how often and the first n. */
  units: { unit: string; count: number; example: string }[];
  hasLineElements: boolean;
  hasWordElements: boolean;
  pageBreaks: number;
}

type Attrs = Record<string, string | number | boolean | null>;

/** Divs of these types, when they have no subtype, are containers rather than address parts. */
const CONTAINER_DIV_TYPES = new Set([
  'edition',
  'translation',
  'commentary',
  'apparatus',
  'transcription',
  'notes',
  'bibliography',
]);
const DIV_ELEMENTS = new Set([
  'div',
  'div0',
  'div1',
  'div2',
  'div3',
  'div4',
  'div5',
  'div6',
  'div7',
]);
/** Elements that become a mark of the same name on the tokens they cover. */
const MARK_ELEMENTS = new Set([
  'unclear',
  'supplied',
  'del',
  'add',
  'subst',
  'hi',
  'damage',
  'surplus',
  'sic',
  'corr',
  'orig',
  'restore',
  'retrace',
  'mod',
  'redo',
  'undo',
  'secl',
]);
/** Elements whose text becomes a paratext object, typed by the element's name. */
const PARATEXT_ELEMENTS = new Set([
  'head',
  'speaker',
  'stage',
  'label',
  'trailer',
  'fw',
  'byline',
  'dateline',
  'opener',
  'closer',
  'salute',
  'signed',
  'docAuthor',
  'docTitle',
  'argument',
  'epigraph',
]);
/** Paratext that stands on a line of its own; stage directions and labels may stand inside a line. */
const INLINE_PARATEXT = new Set(['stage', 'label']);
/** Elements whose content is read as if the element were not there. */
const TRANSPARENT_ELEMENTS = new Set([
  'TEI',
  'text',
  'body',
  'group',
  'floatingText',
  'sp',
  'seg',
  'foreign',
  'name',
  'persName',
  'placeName',
  'orgName',
  'geogName',
  'roleName',
  'forename',
  'surname',
  'addName',
  'genName',
  'nameLink',
  'quote',
  'said',
  'title',
  'author',
  'emph',
  'term',
  'rs',
  'num',
  'date',
  'time',
  'measure',
  'mentioned',
  'soCalled',
  'gloss',
  'ref',
  'bibl',
  'cit',
  'q',
  's',
  'cl',
  'phr',
  'm',
  'c',
  'pc',
  'g',
  'am',
  'ex',
  'reg',
  'lem',
  'rdg',
  'rdgGrp',
  'list',
  'table',
  'cell',
  'castList',
  'castGroup',
  'castItem',
  'desc',
]);
/** Elements that contribute nothing to the text. */
const SKIPPED_ELEMENTS = new Set([
  'teiHeader',
  'facsimile',
  'front',
  'back',
  'standOff',
  'sourceDoc',
  'graphic',
  'binaryObject',
  'witDetail',
  'certainty',
  'precision',
  'respons',
  'anchor',
  'ptr',
  'index',
  'interp',
  'interpGrp',
  'span',
  'spanGrp',
  'link',
  'linkGrp',
  'join',
  'joinGrp',
  'alt',
  'altGrp',
  'timeline',
  'fs',
  'fvLib',
  'gb',
  'figDesc',
]);
const SPAN_MARKERS = new Set(['addSpan', 'delSpan', 'damageSpan']);
/** The types of an `<rdg>` that make its `<app>` a variant noted in the carrier. */
const VARIANT_PLACES = new Set(['margin', 'interlinear', 'other']);
/** Elements that start a new line of a list or table. */
const LINE_ITEMS = new Set(['item', 'row']);
/** Attributes read as numbers on gaps and spaces. */
const NUMERIC_ATTRS = ['quantity', 'atLeast', 'atMost'];
const AM = new Set(['am']);
/** Characters that attach to the word before them when they follow a closed `<w>`. */
const ATTACHABLE = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;

/** A mark element being read: every token flushed while it is open gets a mark of this kind. */
interface MarkFrame {
  mode: 'mark';
  kind: string;
  attrs?: Attrs;
}

/** An orig/reg choice being read: the tokens flushed while it is open get their read form from `reg`. */
interface RegFrame {
  mode: 'reg';
  reg: string;
  /** One word of the regularization per word of the original, when the counts agree. */
  words: string[] | null;
  used: boolean;
}

type Frame = MarkFrame | RegFrame;

interface Range {
  frame: Frame;
  from: number;
  to: number | null;
}

interface Point {
  kind: string;
  attrs?: Attrs;
  at: number;
}

/** The token being built: its characters, the mark ranges over them, the points inside it and the objects to emit after it. */
class TokenBuilder {
  readonly chars: string[] = [];
  readonly ranges: Range[] = [];
  readonly points: Point[] = [];
  readonly after: Obj[] = [];

  get length(): number {
    return this.chars.length;
  }
}

/** The address part a div contributes, or null when it has no n or is a container. */
function divPart(element: XmlElement): AddressPart | null {
  const type = attr(element, 'type');
  const subtype = attr(element, 'subtype');
  const n = attr(element, 'n');
  if (n === undefined) return null;
  if (subtype === undefined && type !== undefined && CONTAINER_DIV_TYPES.has(type)) return null;
  return { unit: subtype ?? type ?? null, n };
}

/** A `hand` attribute as the stream keeps it: a pointer to a handNote gives the hand's id, any other value is kept without its #. */
function handValueOf(raw: string): string {
  const value = raw.trim().replace(/^#/u, '');
  return value.startsWith('hand-') ? value.slice('hand-'.length) : value;
}

function attrsOf(element: XmlElement, numeric: readonly string[] = []): Attrs | undefined {
  const out: Attrs = {};
  let any = false;
  for (const [key, raw] of Object.entries(element.attrs)) {
    if (key === 'id') continue;
    const value = collapseWhitespace(raw);
    out[key] = numeric.includes(key) && /^-?\d+(\.\d+)?$/u.test(value) ? Number(value) : value;
    any = true;
  }
  return any ? out : undefined;
}

function sameAttrs(a: Attrs | undefined, b: Attrs | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => a?.[k] === b?.[k]);
}

function sameUnits(a: AddressPart[], b: AddressPart[]): boolean {
  return a.length === b.length && a.every((p, i) => p.unit === b[i]?.unit);
}

function isPrefixOf(a: AddressPart[], b: AddressPart[]): boolean {
  return a.length < b.length && a.every((p, i) => p.unit === b[i]?.unit && p.n === b[i]?.n);
}

/** Adjacent ranges of the same kind and attributes are one mark; a range over the whole token is a whole-token mark. */
function normalizeMarks(marks: Mark[], length: number): Mark[] {
  const merged: Mark[] = [];
  for (const mark of marks) {
    const { from, to } = mark;
    if (from !== undefined && to !== undefined && from < to) {
      const previous = merged.find(
        (m) =>
          m.kind === mark.kind &&
          sameAttrs(m.attrs, mark.attrs) &&
          m.to === from &&
          m.from !== m.to,
      );
      if (previous) {
        previous.to = to;
        continue;
      }
    }
    merged.push({ ...mark });
  }
  for (const mark of merged) {
    if (mark.from === 0 && mark.to === length) {
      delete mark.from;
      delete mark.to;
    }
  }
  return merged.sort(
    (a, b) => (a.from ?? 0) - (b.from ?? 0) || (b.to ?? length) - (a.to ?? length),
  );
}

class Importer {
  readonly items: Item[] = [];
  readonly segmentStarts: SegmentStartHint[] = [];
  readonly pages: ImportedPage[] = [];
  readonly warnings: string[] = [];
  private readonly unknown = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly divParts: AddressPart[] = [];
  private readonly milestones = new Map<string, string>();
  private pending: AddressPart[][] = [];
  private pendingMarks: Mark[] = [];
  private readonly frames: Frame[] = [];
  private builder = new TokenBuilder();
  private wordDepth = 0;
  private expanDepth = 0;
  private afterWord = false;

  constructor(
    private readonly ids: () => string,
    private readonly surfaces: ReadonlyMap<string, string>,
  ) {}

  walk(nodes: XmlNode[]): void {
    for (const node of nodes) {
      if (isText(node)) this.text(node.text);
      else this.element(node);
    }
  }

  /** Flush the last token and collect the warnings. */
  finish(): void {
    this.flush(false);
    if (this.unknown.size > 0) {
      this.warnings.push(
        `Unknown elements were kept as text: ${[...this.unknown].sort().join(', ')}.`,
      );
    }
  }

  private text(text: string): void {
    for (const ch of text) {
      if (WHITESPACE.test(ch)) {
        if (this.wordDepth === 0) this.flush(false);
        continue;
      }
      if (this.afterWord && !ATTACHABLE.test(ch)) this.flush(false);
      this.builder.chars.push(ch);
    }
  }

  private element(element: XmlElement): void {
    const name = element.name;
    if (SKIPPED_ELEMENTS.has(name)) return;
    if (SPAN_MARKERS.has(name)) {
      this.warnOnce('span', 'Span markers (addSpan, delSpan, damageSpan) were not imported.');
      return;
    }
    if (DIV_ELEMENTS.has(name)) return this.div(element);
    if (LINE_ITEMS.has(name)) {
      this.lineBreak();
      return this.walk(element.children);
    }
    switch (name) {
      case 'lg':
        this.lineBreak();
        return this.walk(element.children);
      case 'l':
        return this.line(element);
      case 'p':
      case 'ab':
        this.paragraphBreak();
        return this.walk(element.children);
      case 'lb':
        return this.lb(element);
      case 'pb':
        return this.pb(element);
      case 'cb':
        return this.cb(element);
      case 'milestone':
        return this.milestone(element);
      case 'w':
        return this.word(element);
      case 'choice':
        return this.choice(element);
      case 'expan':
        return this.expan(element);
      case 'ex':
        if (this.expanDepth > 0) return;
        return this.walk(element.children);
      case 'abbr':
        if (this.expanDepth > 0) return this.walk(element.children);
        return this.mark(element, 'abbr');
      case 'app':
        return this.app(element);
      case 'gap':
      case 'space':
        return this.pointObject(element, name);
      case 'handShift':
        return this.handShift(element);
      case 'note':
        return this.object('note', attrsOf(element), textContent(element));
      case 'metamark':
        return this.object('mark', attrsOf(element), textContent(element));
      case 'figure':
        return this.figure(element);
      case 'seg':
        if (attr(element, 'type') === 'crux') return this.mark(element, 'crux', ['type']);
        return this.walk(element.children);
      default:
        break;
    }
    if (PARATEXT_ELEMENTS.has(name)) return this.paratext(element);
    if (MARK_ELEMENTS.has(name)) return this.mark(element, name);
    if (!TRANSPARENT_ELEMENTS.has(name)) this.unknown.add(name);
    this.walk(element.children);
  }

  private div(element: XmlElement): void {
    const part = divPart(element);
    if (part) {
      this.milestones.clear();
      this.divParts.push(part);
      this.addPending([...this.divParts]);
    }
    this.walk(element.children);
    if (part) this.divParts.pop();
  }

  private line(element: XmlElement): void {
    this.lineBreak();
    const n = attr(element, 'n');
    if (n !== undefined) this.addPending([...this.divParts, { unit: 'line', n }]);
    this.walk(element.children);
  }

  private lb(element: XmlElement): void {
    const join = this.wordDepth > 0 || attr(element, 'break') === 'no';
    const n = attr(element, 'n');
    this.lineBreak(join, n, attr(element, 'rend'));
    if (n !== undefined) this.addPending([...this.divParts, { unit: 'lb', n }]);
  }

  private pb(element: XmlElement): void {
    this.flush(this.wordDepth > 0 || attr(element, 'break') === 'no');
    const facs = attr(element, 'facs');
    const label = attr(element, 'n') ?? String(this.pages.length + 1);
    this.items.push({ kind: 'break', id: this.ids(), type: 'page', label });
    const page: ImportedPage = { label, itemIndex: this.items.length - 1 };
    if (facs !== undefined) {
      page.facs = facs;
      const url = this.imageUrl(facs);
      if (url !== undefined) page.imageUrl = url;
    }
    this.pages.push(page);
  }

  /** The image a `facs` attribute names: a surface or graphic of the facsimile, or a URL given directly. */
  private imageUrl(facs: string): string | undefined {
    const first = facs.split(' ')[0] ?? facs;
    if (first.startsWith('#')) return this.surfaces.get(first.slice(1));
    return first;
  }

  private cb(element: XmlElement): void {
    this.flush(this.wordDepth > 0 || attr(element, 'break') === 'no');
    const brk: Break = { kind: 'break', id: this.ids(), type: 'column' };
    const n = attr(element, 'n');
    if (n !== undefined) brk.label = n;
    this.items.push(brk);
  }

  /** A milestone's n is remembered per unit; units met after it in the document are reset, as lower levels of a hierarchy. */
  private milestone(element: XmlElement): void {
    const n = attr(element, 'n');
    if (n === undefined) return;
    const key = attr(element, 'unit') ?? '';
    const keys = [...this.milestones.keys()];
    const at = keys.indexOf(key);
    if (at >= 0) for (const lower of keys.slice(at + 1)) this.milestones.delete(lower);
    this.milestones.set(key, n);
    const parts = [...this.milestones].map(([unit, value]) => ({
      unit: unit === '' ? null : unit,
      n: value,
    }));
    this.addPending([...this.divParts, ...parts]);
  }

  private word(element: XmlElement): void {
    const opening = this.builder.chars.every((ch) => ATTACHABLE.test(ch));
    if (this.afterWord || !opening) this.flush(this.afterWord && this.builder.length > 0);
    this.wordDepth++;
    this.walk(element.children);
    this.wordDepth--;
    if (this.wordDepth === 0) this.afterWord = true;
  }

  private choice(element: XmlElement): void {
    const kids = childElements(element);
    const find = (name: string): XmlElement | undefined => kids.find((k) => k.name === name);
    const abbr = find('abbr');
    const expan = find('expan');
    const sic = find('sic');
    const corr = find('corr');
    const orig = find('orig');
    const reg = find('reg');
    if (abbr && expan) {
      return this.withFrame(
        { mode: 'mark', kind: 'abbr', attrs: { expan: textContent(expan, AM) } },
        () => this.walk(abbr.children),
      );
    }
    if (sic && corr) {
      return this.withFrame(
        { mode: 'mark', kind: 'corr', attrs: { corr: textContent(corr) } },
        () => this.walk(sic.children),
      );
    }
    if (orig && reg) return this.regularization(orig, reg);
    const first = kids[0];
    if (!first) return;
    this.warnOnce(
      'choice',
      `Choices between ${kids.map((k) => k.name).join(' and ')} were resolved to the first alternative.`,
    );
    this.walk(first.children);
  }

  private regularization(orig: XmlElement, reg: XmlElement): void {
    const regText = textContent(reg);
    const origWords = textContent(orig)
      .split(' ')
      .filter((w) => w.length > 0);
    const regWords = regText.split(' ').filter((w) => w.length > 0);
    const words = origWords.length > 1 && origWords.length === regWords.length ? regWords : null;
    if (origWords.length > 1 && words === null) {
      this.warnOnce(
        'reg',
        'A regularization of several words could not be divided among them; the whole reading was put on the first word.',
      );
    }
    this.withFrame({ mode: 'reg', reg: regText, words, used: false }, () =>
      this.walk(orig.children),
    );
  }

  /** An EpiDoc expansion: the letters written (outside `<ex>`) with a mark carrying the full expansion. */
  private expan(element: XmlElement): void {
    const expan = textContent(element, AM);
    this.expanDepth++;
    this.withFrame({ mode: 'mark', kind: 'abbr', attrs: { expan } }, () =>
      this.walk(element.children),
    );
    this.expanDepth--;
  }

  private app(element: XmlElement): void {
    if (this.variant(element)) return;
    const lem =
      firstChild(element, 'lem') ??
      findDescendants(element, 'lem')[0] ??
      findDescendants(element, 'rdg')[0];
    this.warnOnce(
      'app',
      'Apparatus entries (app) were reduced to their lemma; readings were not imported.',
    );
    if (lem) this.walk(lem.children);
  }

  /**
   * A variant noted in the carrier: an `<app>` with a `<lem>` and one `<rdg>`
   * typed margin, interlinear or other. The lemma's words are read as text and
   * carry a `variant` mark (see items.ts) with the reading. Anything else is
   * an apparatus entry of another kind and returns false.
   */
  private variant(element: XmlElement): boolean {
    const kids = childElements(element);
    const lem = kids.find((k) => k.name === 'lem');
    const rdgs = kids.filter((k) => k.name === 'rdg');
    const rdg = rdgs[0];
    const place = rdg ? attr(rdg, 'type') : undefined;
    if (!lem || !rdg || rdgs.length !== 1 || place === undefined || !VARIANT_PLACES.has(place)) return false;
    const attrs: Attrs = { group: this.ids().slice(-8), reading: textContent(rdg), place };
    const hand = attr(rdg, 'hand');
    if (hand !== undefined) attrs.hand = handValueOf(hand);
    this.withFrame({ mode: 'mark', kind: 'variant', attrs }, () => this.walk(lem.children));
    return true;
  }

  private mark(element: XmlElement, kind: string, exclude: readonly string[] = []): void {
    const attrs = attrsOf(element, ['seq']);
    for (const key of exclude) delete attrs?.[key];
    if (attrs && typeof attrs.hand === 'string') attrs.hand = handValueOf(attrs.hand);
    const frame: MarkFrame = { mode: 'mark', kind };
    if (attrs && Object.keys(attrs).length > 0) frame.attrs = attrs;
    this.withFrame(frame, () => this.walk(element.children));
  }

  private withFrame(frame: Frame, inner: () => void): void {
    this.frames.push(frame);
    this.builder.ranges.push({ frame, from: this.builder.length, to: null });
    inner();
    this.frames.pop();
    const open = this.builder.ranges.find((r) => r.frame === frame && r.to === null);
    if (open) open.to = this.builder.length;
  }

  /** A gap or space: an object between words, a point mark inside one. */
  private pointObject(element: XmlElement, kind: 'gap' | 'space'): void {
    const attrs = attrsOf(element, NUMERIC_ATTRS);
    if (this.builder.length === 0) return this.push(this.makeObject(kind, attrs));
    const point: Point = { kind, at: this.builder.length };
    if (attrs) point.attrs = attrs;
    this.builder.points.push(point);
  }

  /** A hand shift marks the token it stands before, or the character it stands at inside a word. */
  private handShift(element: XmlElement): void {
    const attrs = attrsOf(element);
    if (this.builder.length === 0) {
      const mark: Mark = { kind: 'handShift' };
      if (attrs) mark.attrs = attrs;
      this.pendingMarks.push(mark);
      return;
    }
    const point: Point = { kind: 'handShift', at: this.builder.length };
    if (attrs) point.attrs = attrs;
    this.builder.points.push(point);
  }

  private figure(element: XmlElement): void {
    const desc = firstChild(element, 'figDesc') ?? firstChild(element, 'head');
    const url = firstChild(element, 'graphic')?.attrs.url;
    const attrs: Attrs | undefined = url !== undefined ? { url } : undefined;
    this.object('figure', attrs, desc ? textContent(desc) : undefined);
  }

  private paratext(element: XmlElement): void {
    if (!INLINE_PARATEXT.has(element.name)) this.lineBreak();
    const attrs: Attrs = { type: element.name };
    for (const [key, value] of Object.entries(element.attrs)) {
      if (key === 'id') continue;
      attrs[key === 'type' ? 'subtype' : key] = collapseWhitespace(value);
    }
    this.object('paratext', attrs, textContent(element));
  }

  /** An object between words is emitted at once; one met inside a word follows that word. */
  private object(type: ObjectType, attrs: Attrs | undefined, text: string | undefined): void {
    const obj = this.makeObject(type, attrs, text);
    if (this.builder.length === 0) this.push(obj);
    else this.builder.after.push(obj);
  }

  private makeObject(type: ObjectType, attrs: Attrs | undefined, text?: string): Obj {
    const obj: Obj = { kind: 'object', id: this.ids(), type };
    if (attrs && Object.keys(attrs).length > 0) obj.attrs = attrs;
    if (text !== undefined && text !== '') obj.text = text;
    return obj;
  }

  /** A line break, unless nothing stands on the line before it. The join goes on the token before it either way. */
  private lineBreak(join = false, label?: string, rend?: string): void {
    this.flush(join);
    const last = this.items.at(-1);
    if (!last || last.kind === 'break') return;
    const brk: Break = { kind: 'break', id: this.ids(), type: 'line' };
    if (label !== undefined) brk.label = label;
    if (rend !== undefined) brk.rend = rend;
    this.items.push(brk);
  }

  /** A paragraph break; a line break just before it is upgraded, and no empty line is made after another break. */
  private paragraphBreak(): void {
    this.flush(false);
    const last = this.items.at(-1);
    if (!last) return;
    if (last.kind === 'break') {
      if (last.type === 'line') last.type = 'paragraph';
      return;
    }
    this.items.push({ kind: 'break', id: this.ids(), type: 'paragraph' });
  }

  /** Emit the token being built, if any, with its marks and read form, then the objects that waited for it. */
  private flush(join: boolean): void {
    const builder = this.builder;
    const length = builder.length;
    this.afterWord = false;
    if (length === 0) {
      if (join) this.joinLastToken();
      for (const obj of builder.after) this.push(obj);
      this.resetBuilder();
      return;
    }
    const token: Token = { kind: 'token', id: this.ids(), form: builder.chars.join('') };
    const marks: Mark[] = this.pendingMarks;
    this.pendingMarks = [];
    const regs: { from: number; to: number; frame: RegFrame }[] = [];
    for (const range of builder.ranges) {
      const to = range.to ?? length;
      if (to <= range.from) continue;
      if (range.frame.mode === 'reg') {
        regs.push({ from: range.from, to, frame: range.frame });
        continue;
      }
      const mark: Mark = { kind: range.frame.kind };
      if (range.frame.attrs) mark.attrs = { ...range.frame.attrs };
      // A variant concerns whole words.
      if (!(range.from === 0 && to === length) && range.frame.kind !== 'variant') {
        mark.from = range.from;
        mark.to = to;
      }
      marks.push(mark);
    }
    const afterObjects: Obj[] = [];
    for (const point of builder.points) {
      const mark: Mark = { kind: point.kind };
      if (point.attrs) mark.attrs = { ...point.attrs };
      if (point.at < length) {
        mark.from = point.at;
        mark.to = point.at;
        marks.push(mark);
      } else if (point.kind === 'gap' || point.kind === 'space') {
        afterObjects.push(this.makeObject(point.kind, point.attrs));
      } else {
        this.pendingMarks.push(mark);
      }
    }
    if (marks.length > 0) token.marks = normalizeMarks(marks, length);
    const norm = readFormOf(builder.chars, regs);
    if (norm !== undefined) token.norm = norm;
    if (join) token.joinNext = true;
    this.push(token);
    for (const obj of afterObjects) this.push(obj);
    for (const obj of builder.after) this.push(obj);
    this.resetBuilder();
  }

  private resetBuilder(): void {
    this.builder = new TokenBuilder();
    for (const frame of this.frames) this.builder.ranges.push({ frame, from: 0, to: null });
  }

  private joinLastToken(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item?.kind === 'token') {
        item.joinNext = true;
        return;
      }
      if (item?.kind !== 'break') return;
    }
  }

  private push(item: Item): void {
    this.items.push(item);
    if (item.kind === 'break') return;
    const index = this.items.length - 1;
    for (const parts of this.pending) this.segmentStarts.push({ itemIndex: index, parts });
    this.pending = [];
  }

  /** A new start replaces a waiting one with the same units (an empty line) or one it extends (its div). */
  private addPending(parts: AddressPart[]): void {
    this.pending = this.pending.filter((p) => !sameUnits(p, parts) && !isPrefixOf(p, parts));
    this.pending.push(parts);
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(message);
  }
}

/** The read form from orig/reg choices over a token, or undefined when there were none. */
function readFormOf(
  chars: readonly string[],
  regs: { from: number; to: number; frame: RegFrame }[],
): string | undefined {
  if (regs.length === 0) return undefined;
  let pieces: string[] = [...chars];
  for (const range of [...regs].sort((a, b) => b.from - a.from)) {
    pieces = [...pieces.slice(0, range.from), regText(range.frame), ...pieces.slice(range.to)];
  }
  return pieces.join('');
}

function regText(frame: RegFrame): string {
  if (frame.words) return frame.words.shift() ?? '';
  if (frame.used) return '';
  frame.used = true;
  return frame.reg;
}

/** The `<body>` elements not nested in another body, in document order. */
function bodies(root: XmlElement): XmlElement[] {
  if (root.name === 'body') return [root];
  const out: XmlElement[] = [];
  const visit = (element: XmlElement): void => {
    for (const child of childElements(element)) {
      if (child.name === 'body') out.push(child);
      else if (child.name !== 'teiHeader') visit(child);
    }
  };
  visit(root);
  return out;
}

/** Surface and graphic ids of the facsimile mapped to their image URLs. */
function surfaceImages(root: XmlElement): Map<string, string> {
  const map = new Map<string, string>();
  const facsimile = firstChild(root, 'facsimile');
  if (!facsimile) return map;
  for (const surface of findDescendants(facsimile, 'surface')) {
    const graphic = firstChild(surface, 'graphic');
    const url = graphic ? attr(graphic, 'url') : undefined;
    if (url === undefined) continue;
    const surfaceId = attr(surface, 'id');
    const graphicId = graphic ? attr(graphic, 'id') : undefined;
    if (surfaceId !== undefined) map.set(surfaceId, url);
    if (graphicId !== undefined) map.set(graphicId, url);
  }
  return map;
}

function text(element: XmlElement | undefined): string | undefined {
  if (!element) return undefined;
  const value = textContent(element);
  return value === '' ? undefined : value;
}

function readHeader(root: XmlElement): ImportedHeader {
  const header: ImportedHeader = {};
  const teiHeader = root.name === 'teiHeader' ? root : firstChild(root, 'teiHeader');
  const titleStmt = teiHeader ? descendant(teiHeader, ['fileDesc', 'titleStmt']) : undefined;
  const title = titleStmt
    ? childElements(titleStmt)
        .filter((e) => e.name === 'title')
        .map(text)
        .find((t) => t !== undefined)
    : undefined;
  if (title !== undefined) header.title = title;
  const author = titleStmt ? text(firstChild(titleStmt, 'author')) : undefined;
  if (author !== undefined) header.author = author;
  const language = readLanguage(root, teiHeader);
  if (language !== undefined) header.language = language;
  return header;
}

function readLanguage(root: XmlElement, teiHeader: XmlElement | undefined): string | undefined {
  const declared = teiHeader
    ? descendant(teiHeader, ['profileDesc', 'langUsage', 'language'])
    : undefined;
  const ident = declared ? attr(declared, 'ident') : undefined;
  if (ident !== undefined) return ident;
  const candidates = [root, ...findDescendants(root, 'text', 'body', 'div')].filter(
    (e) => e.name !== 'teiHeader',
  );
  for (const element of candidates) {
    const lang = attr(element, 'lang');
    if (lang !== undefined) return lang;
  }
  return undefined;
}

function readWitness(root: XmlElement): ImportedWitness | undefined {
  const sourceDesc = descendant(root, ['teiHeader', 'fileDesc', 'sourceDesc']);
  const msDesc = sourceDesc ? findDescendants(sourceDesc, 'msDesc')[0] : undefined;
  if (!msDesc) return undefined;
  const witness: ImportedWitness = {};
  const set = (key: keyof ImportedWitness, value: string | undefined): void => {
    if (value !== undefined) witness[key] = value;
  };
  set('repository', text(descendant(msDesc, ['msIdentifier', 'repository'])));
  set('settlement', text(descendant(msDesc, ['msIdentifier', 'settlement'])));
  set('idno', text(descendant(msDesc, ['msIdentifier', 'idno'])));
  set('title', text(descendant(findDescendants(msDesc, 'msItem')[0] ?? msDesc, ['title'])));
  set(
    'description',
    text(findDescendants(msDesc, 'summary')[0]) ??
      text(firstChild(msDesc, 'head')) ??
      text(firstChild(msDesc, 'p')),
  );
  const origDate = findDescendants(msDesc, 'origDate')[0];
  if (origDate) {
    const when = attr(origDate, 'when');
    const range = [attr(origDate, 'notBefore'), attr(origDate, 'notAfter')]
      .filter((v) => v !== undefined)
      .join(' to ');
    set('date', text(origDate) ?? when ?? (range === '' ? undefined : range));
  }
  const physDesc = firstChild(msDesc, 'physDesc');
  if (physDesc) {
    const supportDesc = findDescendants(physDesc, 'supportDesc')[0];
    set(
      'material',
      text(findDescendants(physDesc, 'material')[0]) ??
        (supportDesc ? attr(supportDesc, 'material') : undefined),
    );
    set('extent', text(findDescendants(physDesc, 'extent')[0]));
    const objectDesc = findDescendants(physDesc, 'objectDesc')[0];
    set('form', objectDesc ? attr(objectDesc, 'form') : undefined);
    set('hands', text(firstChild(physDesc, 'handDesc')));
  }
  return witness;
}

/**
 * Read a TEI document into a stream. Throws an XmlError when the XML is not
 * well formed. Documents without a `<body>` are read whole, so a fragment
 * such as a single `<div>` or `<ab>` imports too.
 */
export function importTei(xml: string, options: TeiImportOptions = {}): TeiImport {
  const root = parseXml(xml);
  const importer = new Importer(options.ids ?? newId, surfaceImages(root));
  const found = bodies(root);
  if (found.length === 0) {
    importer.warnings.push('No <body> element was found; the whole document was read as text.');
    importer.walk([root]);
  } else {
    importer.walk(found);
  }
  importer.finish();
  const result: TeiImport = {
    stream: { items: importer.items },
    segmentStarts: importer.segmentStarts,
    pages: importer.pages,
    header: readHeader(root),
    warnings: importer.warnings,
  };
  const witness = readWitness(root);
  if (witness) result.witness = witness;
  return result;
}

/**
 * The numbered structure of a TEI document, for the mapping dialog: which
 * units carry numbers (div subtypes and types, `line` for `<l n>`, `lb` for
 * `<lb n>`, milestone units; `div` for an untyped div), whether the text has
 * `<l>` and `<w>` elements, and how many page breaks it has.
 */
export function detectStructure(xml: string): DetectedStructure {
  const root = parseXml(xml);
  const roots = bodies(root);
  const units = new Map<string, { count: number; example: string }>();
  const found = { hasLineElements: false, hasWordElements: false, pageBreaks: 0 };
  const count = (unit: string, n: string): void => {
    const entry = units.get(unit);
    if (entry) entry.count++;
    else units.set(unit, { count: 1, example: n });
  };
  const visit = (element: XmlElement): void => {
    if (SKIPPED_ELEMENTS.has(element.name)) return;
    const n = attr(element, 'n');
    if (DIV_ELEMENTS.has(element.name)) {
      const part = divPart(element);
      if (part) count(part.unit ?? 'div', part.n);
    } else if (element.name === 'l') {
      found.hasLineElements = true;
      if (n !== undefined) count('line', n);
    } else if (element.name === 'lb') {
      if (n !== undefined) count('lb', n);
    } else if (element.name === 'milestone') {
      if (n !== undefined) count(attr(element, 'unit') ?? 'milestone', n);
    } else if (element.name === 'pb') {
      found.pageBreaks++;
    } else if (element.name === 'w') {
      found.hasWordElements = true;
    }
    for (const child of element.children) if (isElement(child)) visit(child);
  };
  for (const element of roots.length > 0 ? roots : [root]) visit(element);
  return {
    units: [...units].map(([unit, entry]) => ({
      unit,
      count: entry.count,
      example: entry.example,
    })),
    ...found,
  };
}
