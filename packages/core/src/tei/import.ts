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
 *
 * A document is read in one of two ways (docs/design.md, section 3.7).
 *
 * As a text to start from, it is words and their numbering and nothing
 * else: what a transcriber would have typed in, to be corrected against the
 * witness. Its marks, its pages and its notes are its own edition's and are
 * left behind.
 *
 * As a transcript of the witness, it is read with its features, and a
 * transcript holds its witness and nothing an editor added to it. So what
 * the source's editor supplied or struck out is not read as the witness's
 * text: letters supplied where the carrier is lost become the
 * gap they fill; letters the editor adds as left out by the scribe, or
 * brackets as written in error, are normalization within a word and are
 * otherwise ignored (a whole word added is left out, a whole word bracketed
 * stays); a correction of the scribe's spelling is the word's normalized
 * form. A word that a gap breaks keeps the letters that are there, with the
 * gap as a point mark in it.
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
  /**
   * What the document is read as:
   *
   * - `transcript`, the default: a transcript of the witness, with its
   *   features and pages, and without what its editor supplied or struck out;
   * - `text`: a text to start from, its words and their numbering only;
   * - `verbatim`: every element as its mark, which is how what Varians itself
   *   wrote is read back.
   */
  as?: 'transcript' | 'text' | 'verbatim';
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
/**
 * Paratext that Varians writes as `<label type="KIND">` because TEI allows
 * no such element inside a line (see varians.odd): read back as that kind.
 */
const LABELLED_PARATEXT = new Set(
  [...PARATEXT_ELEMENTS, 'margin'].filter((name) => !['stage', 'label', 'fw'].includes(name)),
);
/** Elements whose content is read as if the element were not there. */
const TRANSPARENT_ELEMENTS = new Set([
  'TEI',
  'text',
  'body',
  'group',
  'floatingText',
  'sp',
  'seg',
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
  'date',
  'time',
  'measure',
  'mentioned',
  'soCalled',
  'gloss',
  'ref',
  'bibl',
  'cit',
  's',
  'cl',
  'phr',
  'm',
  'c',
  'pc',
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
  /** The source's editor corrected the scribe, where a regularization only respells: the read form waits for confirmation. */
  check?: boolean;
}

/**
 * Letters as the source's editor judged them, in the transcript of a
 * carrier: `lost` (supplied where the carrier is lost: not there), `added`
 * (left out by the scribe, as the editor holds: not there, but read),
 * `surplus` (written in error: there, but not read).
 */
type LetterStatus = 'lost' | 'added' | 'surplus';

interface EditFrame {
  mode: 'edit';
  status: LetterStatus;
}

type Frame = MarkFrame | RegFrame | EditFrame;

/** A placeholder for one letter of a gap that stands inside a supplement: it is counted and never written. */
const LOST_LETTER = '\uFFFC';

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
  /** A gap of unknown extent stood inside a supplement of this word: so is the gap it leaves. */
  lostUnknown = false;

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

/** The attributes with `cert: 'low'` when the element holds a `<certainty>`, EpiDoc's way of saying its editor is not sure. */
function certain(element: XmlElement, attrs: Attrs | undefined): Attrs | undefined {
  if (!childElements(element).some((child) => child.name === 'certainty')) return attrs;
  return { ...attrs, cert: 'low' };
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
  /** Starts met after a word that is not yet a token: they wait for the item that follows it. */
  private deferred: AddressPart[][] = [];
  private pendingMarks: Mark[] = [];
  private readonly frames: Frame[] = [];
  private builder = new TokenBuilder();
  private wordDepth = 0;
  private expanDepth = 0;
  private afterWord = false;
  /** The line break made by a break that divides a word (`break="no"`), until something after it confirms it. */
  private joinBreak: Break | null = null;
  /** Inside what the source's editor supplied, in the transcript of a carrier: objects met there are the editor's too. */
  private suppliedDepth = 0;
  /** The gap last made from supplied words, which the next supplied word joins. */
  private lastLostGap: Obj | null = null;

  constructor(
    private readonly ids: () => string,
    private readonly surfaces: ReadonlyMap<string, string>,
    /** Every element is read as its mark, what an editor supplied or struck out with the rest. */
    private readonly keep: boolean,
    /** A text to start from: its pages and columns are its own edition's, and are passed over as if not there. */
    private readonly pageless: boolean,
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
    // A break that only said the last word is divided, with nothing after it, is not a line of its own.
    if (this.joinBreak !== null && this.items.at(-1) === this.joinBreak) this.items.pop();
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
    if (!this.keep && name === 'supplied') return this.supplied(element);
    if (!this.keep && name === 'surplus') {
      return this.withFrame({ mode: 'edit', status: 'surplus' }, () => this.walk(element.children));
    }
    if (name === 'unclear') {
      const kids = element.children.filter((c) => isElement(c) || c.text.trim() !== '');
      const only = kids.length === 1 ? kids[0] : undefined;
      if (only && isElement(only) && only.name === 'g') return this.glyph(only, true);
    }
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
      case 'subst':
        return this.subst(element);
      case 'g':
        return this.glyph(element, false);
      case 'num':
        // A number without letters gives the value of a number spelt out: its editor's reading, not the carrier's.
        if (textContent(element) === '' && childElements(element).length === 0) return;
        return this.mark(element, 'num');
      case 'foreign':
      case 'q':
        return this.mark(element, name);
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
    if (this.pageless) return;
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
    if (this.pageless) return;
    this.flush(this.wordDepth > 0 || attr(element, 'break') === 'no');
    const brk: Break = { kind: 'break', id: this.ids(), type: 'column' };
    const n = attr(element, 'n');
    if (n !== undefined) brk.label = n;
    this.items.push(brk);
  }

  /** A milestone's n is remembered per unit; units met after it in the document are reset, as lower levels of a hierarchy. */
  private milestone(element: XmlElement): void {
    const n = attr(element, 'n');
    if (n === undefined) {
      // Without a number it divides nothing: a sign on the carrier (a paragraphos, a rule, a coronis).
      const rend = attr(element, 'rend');
      if (rend !== undefined)
        this.object('mark', { rend, unit: attr(element, 'unit') ?? 'undefined' }, undefined);
      return;
    }
    const key = attr(element, 'unit') ?? '';
    const keys = [...this.milestones.keys()];
    const at = keys.indexOf(key);
    if (at >= 0) for (const lower of keys.slice(at + 1)) this.milestones.delete(lower);
    this.milestones.set(key, n);
    const parts = [...this.milestones].map(([unit, value]) => ({
      unit: unit === '' ? null : unit,
      n: value,
    }));
    const start = [...this.divParts, ...parts];
    // A start that does not end the word it stands in (`break="no"`): the letters before it are a token
    // joined to the next, which the start is given to.
    if (attr(element, 'break') === 'no' && this.wordDepth === 0) {
      this.flush(true);
      this.addPending(start);
      return;
    }
    // After a word that is closed but not yet made a token the start is the next token's: it would else
    // be given to the word, which is made when the next one begins.
    if (this.afterWord && this.builder.length > 0) this.deferred.push(start);
    else this.addPending(start);
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
        { mode: 'mark', kind: 'abbr', attrs: { ...attrsOf(abbr), expan: textContent(expan, AM) } },
        () => this.walk(abbr.children),
      );
    }
    if (sic && corr && !this.keep) return this.regularization(sic, corr, true);
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

  /** The text of a regularization, without the letters its editor supplied where the carrier is lost. */
  private regularized(reg: XmlElement): string {
    if (this.keep) return textContent(reg);
    const lost = (e: XmlElement): boolean =>
      e.name === 'supplied' && attr(e, 'reason') !== 'omitted';
    const read = (nodes: XmlNode[]): string =>
      nodes
        .map((node) =>
          isText(node)
            ? node.text
            : lost(node) || SKIPPED_ELEMENTS.has(node.name)
              ? ''
              : read(node.children),
        )
        .join('');
    return collapseWhitespace(read(reg.children));
  }

  private regularization(orig: XmlElement, reg: XmlElement, check = false): void {
    const regText = this.regularized(reg);
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
    const frame: RegFrame = { mode: 'reg', reg: regText, words, used: false };
    if (check) frame.check = true;
    this.withFrame(frame, () => this.walk(orig.children));
  }

  /** An EpiDoc expansion: the letters written (outside `<ex>`) with a mark carrying the full expansion. */
  private expan(element: XmlElement): void {
    const expan = textContent(element, AM);
    const attrs: Attrs = { expan };
    if (findDescendants(element, 'ex').some((ex) => attr(ex, 'cert') === 'low')) attrs.cert = 'low';
    this.expanDepth++;
    this.withFrame({ mode: 'mark', kind: 'abbr', attrs }, () => {
      const before = this.builder.length;
      this.walk(element.children);
      // Nothing but the expansion: a symbol stands for the word, which is then its form.
      if (this.builder.length === before && expan !== '') {
        attrs.symbol = true;
        this.builder.chars.push(...expan.replace(/\s+/gu, ''));
      }
    });
    this.expanDepth--;
  }

  private app(element: XmlElement): void {
    if (this.variant(element)) return;
    const type = attr(element, 'type');
    // An editor's choice between readings of the carrier: the reading chosen is the transcript's.
    if (type === 'editorial' || type === 'alternative') {
      const chosen = firstChild(element, 'lem');
      if (chosen) this.walk(chosen.children);
      return;
    }
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
    if (!lem || !rdg || rdgs.length !== 1 || place === undefined || !VARIANT_PLACES.has(place))
      return false;
    const attrs: Attrs = { group: this.ids().slice(-8), reading: textContent(rdg), place };
    const hand = attr(rdg, 'hand');
    if (hand !== undefined) attrs.hand = handValueOf(hand);
    this.withFrame({ mode: 'mark', kind: 'variant', attrs }, () => this.walk(lem.children));
    return true;
  }

  private mark(element: XmlElement, kind: string, exclude: readonly string[] = []): void {
    const attrs = certain(element, attrsOf(element, ['seq']));
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

  /**
   * What the source's editor supplied, in the transcript of a carrier: the
   * letters are read with their status and taken out when the word is
   * finished (see `flush`), leaving the gap where the carrier is lost.
   */
  private supplied(element: XmlElement): void {
    const status: LetterStatus = attr(element, 'reason') === 'omitted' ? 'added' : 'lost';
    this.suppliedDepth++;
    this.withFrame({ mode: 'edit', status }, () => this.walk(element.children));
    this.suppliedDepth--;
  }

  /**
   * The scribe's own correction: what was added in place of what was
   * deleted. Where it stands as a word of its own, the two are two words,
   * one added and one deleted, so that the witness can be read before and
   * after the correction; inside a word they are parts of that word.
   */
  private subst(element: XmlElement): void {
    const whole = this.builder.length === 0;
    this.withFrame({ mode: 'mark', kind: 'subst' }, () => {
      for (const child of element.children) {
        if (isText(child)) this.text(child.text);
        else {
          this.element(child);
          if (whole && (child.name === 'add' || child.name === 'del')) this.flush(false);
        }
      }
    });
  }

  /** A sign that is not a letter (EpiDoc's `<g>`): a mark object named by its type, with the character given for it, if any. */
  private glyph(element: XmlElement, unclear: boolean): void {
    if (this.suppliedDepth > 0) return;
    const attrs: Attrs = { g: attr(element, 'type') ?? 'glyph' };
    const rend = attr(element, 'rend');
    if (rend !== undefined) attrs.rend = rend;
    if (unclear) attrs.unclear = true;
    this.object('mark', attrs, textContent(element));
  }

  /**
   * A gap or a space. A space is an object between words and a point mark
   * inside one. A gap is a point of the word it touches, before or inside
   * it, and an object when no letters touch it (decided in `flush`).
   */
  private pointObject(element: XmlElement, kind: 'gap' | 'space'): void {
    if (this.suppliedDepth > 0) {
      // A gap inside a supplement is part of what is lost there.
      if (kind !== 'gap') return;
      const quantity = Number(attr(element, 'quantity'));
      if (Number.isInteger(quantity) && quantity > 0 && attr(element, 'unit') === 'character')
        this.builder.chars.push(...LOST_LETTER.repeat(quantity));
      else this.builder.lostUnknown = true;
      return;
    }
    const attrs = certain(element, attrsOf(element, NUMERIC_ATTRS)) ?? {};
    const desc = firstChild(element, 'desc');
    if (desc && textContent(desc) !== '') attrs.desc = textContent(desc);
    const given = Object.keys(attrs).length > 0 ? attrs : undefined;
    if (kind === 'space' && this.builder.length === 0)
      return this.push(this.makeObject(kind, given));
    const point: Point = { kind, at: this.builder.length };
    if (given) point.attrs = given;
    this.builder.points.push(point);
  }

  /** A hand shift marks the token it stands before, or the character it stands at inside a word. */
  private handShift(element: XmlElement): void {
    if (this.suppliedDepth > 0) return;
    const attrs = certain(element, attrsOf(element));
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
    const labelled = element.name === 'label' ? attr(element, 'type') : undefined;
    const kind = labelled !== undefined && LABELLED_PARATEXT.has(labelled) ? labelled : undefined;
    if (!INLINE_PARATEXT.has(kind ?? element.name)) this.lineBreak();
    const attrs: Attrs = { type: kind ?? element.name };
    for (const [key, value] of Object.entries(element.attrs)) {
      if (key === 'id' || (kind !== undefined && key === 'type')) continue;
      // The element's type is the paratext's subtype; a labelled kind keeps its subtype as written.
      attrs[key === 'type' ? 'subtype' : key] = collapseWhitespace(value);
    }
    this.object('paratext', attrs, textContent(element));
  }

  /** An object between words is emitted at once; one met inside a word follows that word. */
  private object(type: ObjectType, attrs: Attrs | undefined, text: string | undefined): void {
    if (this.suppliedDepth > 0) return;
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
    // A break just after a break that divides a word is the line's own break.
    this.joinBreak = null;
    if (!last || last.kind === 'break') return;
    const brk: Break = { kind: 'break', id: this.ids(), type: 'line' };
    if (label !== undefined) brk.label = label;
    if (rend !== undefined) brk.rend = rend;
    this.items.push(brk);
    if (join) this.joinBreak = brk;
  }

  /** A paragraph break; a line break just before it is upgraded, and no empty line is made after another break. */
  private paragraphBreak(): void {
    this.flush(false);
    this.joinBreak = null;
    const last = this.items.at(-1);
    if (!last) return;
    if (last.kind === 'break') {
      if (last.type === 'line') last.type = 'paragraph';
      return;
    }
    this.items.push({ kind: 'break', id: this.ids(), type: 'paragraph' });
  }

  /**
   * Emit the token being built, if any, with its marks and read form, then
   * the objects that waited for it. Letters the source's editor supplied are
   * taken out here: those lost on the carrier leave a gap, which is a point
   * mark of the word when other letters of it are there and an object when
   * none are; those the editor added or bracketed make the read form.
   */
  private flush(join: boolean): void {
    const builder = this.builder;
    const length = builder.length;
    this.afterWord = false;
    const chars = builder.chars;
    const status = letterStatus(builder, length);
    const kept: number[] = [];
    for (let i = 0; i < length; i++)
      if (status[i] !== 'lost' && status[i] !== 'added') kept.push(i);
    /** Where a place among the letters read falls among the letters kept. */
    const at = (place: number): number => {
      let n = 0;
      while (n < kept.length && kept[n]! < place) n++;
      return n;
    };
    const gaps = builder.points.filter((point) => point.kind === 'gap');
    if (kept.length === 0) {
      if (join && length === 0) this.joinLastToken();
      const lost = status.filter((s) => s === 'lost').length;
      if (lost > 0 || builder.lostUnknown) this.lostGap(lost, builder.lostUnknown);
      // A gap that no letters touch stands between the words.
      for (const point of gaps) this.push(this.makeObject('gap', point.attrs));
      for (const obj of builder.after) this.push(obj);
      this.resetBuilder();
      return;
    }
    const token: Token = {
      kind: 'token',
      id: this.ids(),
      form: kept.map((i) => chars[i]).join(''),
    };
    const marks: Mark[] = this.pendingMarks;
    this.pendingMarks = [];
    const regs: { from: number; to: number; frame: RegFrame }[] = [];
    for (const range of builder.ranges) {
      const to = range.to ?? length;
      if (to <= range.from || range.frame.mode === 'edit') continue;
      if (range.frame.mode === 'reg') {
        regs.push({ from: range.from, to, frame: range.frame });
        continue;
      }
      const from = at(range.from);
      const until = at(to);
      if (until <= from) continue;
      const mark: Mark = { kind: range.frame.kind };
      if (range.frame.attrs) mark.attrs = { ...range.frame.attrs };
      // A variant concerns whole words.
      if (!(from === 0 && until === kept.length) && range.frame.kind !== 'variant') {
        mark.from = from;
        mark.to = until;
      }
      marks.push(mark);
    }
    const afterObjects: Obj[] = [];
    for (const point of builder.points) {
      const mark: Mark = { kind: point.kind };
      if (point.attrs) mark.attrs = { ...point.attrs };
      if (point.at < length || point.kind === 'gap') {
        mark.from = at(point.at);
        mark.to = mark.from;
        marks.push(mark);
      } else if (point.kind === 'space') {
        afterObjects.push(this.makeObject(point.kind, point.attrs));
      } else {
        this.pendingMarks.push(mark);
      }
    }
    // What is lost within the word: a gap where each run of supplied letters stood.
    for (let i = 0; i < length; i++) {
      if (status[i] !== 'lost' || status[i - 1] === 'lost') continue;
      let run = 0;
      while (status[i + run] === 'lost') run++;
      const place = at(i);
      marks.push({
        kind: 'gap',
        from: place,
        to: place,
        attrs: builder.lostUnknown
          ? { reason: 'lost', unit: 'character', extent: 'unknown' }
          : { reason: 'lost', unit: 'character', quantity: run },
      });
    }
    token.marks = normalizeMarks(mergeGaps(marks), kept.length);
    if (token.marks.length === 0) delete token.marks;
    const norm = readFormOf(chars, status, regs);
    if (norm !== undefined && (regs.length > 0 || (norm !== '' && norm !== token.form))) {
      token.norm = norm;
      const judged = status.some((s) => s === 'added' || s === 'surplus');
      if (norm !== token.form && (judged || regs.some((r) => r.frame.check)))
        token.unchecked = true;
    }
    if (join) token.joinNext = true;
    this.push(token);
    for (const obj of afterObjects) this.push(obj);
    for (const obj of builder.after) this.push(obj);
    this.resetBuilder();
  }

  /** The gap that words supplied where the carrier is lost leave: one gap for a run of such words, as long as their letters. */
  private lostGap(letters: number, unknown: boolean): void {
    const last = this.lastLostGap;
    if (last && this.items.at(-1) === last) {
      const attrs = last.attrs ?? {};
      if (unknown || attrs.extent === 'unknown') {
        delete attrs.quantity;
        attrs.extent = 'unknown';
      } else attrs.quantity = Number(attrs.quantity ?? 0) + letters;
      return;
    }
    const gap = this.makeObject(
      'gap',
      unknown
        ? { reason: 'lost', unit: 'character', extent: 'unknown' }
        : { reason: 'lost', unit: 'character', quantity: letters },
    );
    this.push(gap);
    this.lastLostGap = gap;
  }

  private resetBuilder(): void {
    this.builder = new TokenBuilder();
    for (const frame of this.frames) this.builder.ranges.push({ frame, from: 0, to: null });
    for (const start of this.deferred) this.addPending(start);
    this.deferred = [];
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

/** How the source's editor judged each letter read into a word; undefined for a letter simply there. */
function letterStatus(builder: TokenBuilder, length: number): (LetterStatus | undefined)[] {
  const rank: Record<LetterStatus, number> = { surplus: 1, added: 2, lost: 3 };
  const status: (LetterStatus | undefined)[] = new Array<LetterStatus | undefined>(length).fill(
    undefined,
  );
  for (const range of builder.ranges) {
    if (range.frame.mode !== 'edit') continue;
    const to = range.to ?? length;
    for (let i = range.from; i < to; i++) {
      const now = status[i];
      if (now === undefined || rank[range.frame.status] > rank[now]) status[i] = range.frame.status;
    }
  }
  return status;
}

/** Gaps at one place of a word are one gap: their letters together, of unknown extent when one of them is. */
function mergeGaps(marks: Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const mark of marks) {
    const isGap = mark.kind === 'gap' && mark.from !== undefined && mark.from === mark.to;
    const same = isGap
      ? out.find((m) => m.kind === 'gap' && m.from === mark.from && m.to === mark.to)
      : undefined;
    if (!same) {
      out.push(mark);
      continue;
    }
    const a = same.attrs ?? {};
    const b = mark.attrs ?? {};
    if (typeof a.quantity === 'number' && typeof b.quantity === 'number' && a.unit === b.unit) {
      same.attrs = { ...a, quantity: a.quantity + b.quantity };
    } else {
      const { quantity: _quantity, atLeast: _least, atMost: _most, ...rest } = a;
      same.attrs = { ...rest, extent: 'unknown' };
    }
  }
  return out;
}

/**
 * The read form of a word: its letters without those lost on the carrier or
 * bracketed as written in error, with those the editor added, and the
 * regularization in place of what it regularizes. Undefined when nothing
 * was regularized, added or bracketed.
 */
function readFormOf(
  chars: readonly string[],
  status: readonly (LetterStatus | undefined)[],
  regs: { from: number; to: number; frame: RegFrame }[],
): string | undefined {
  if (regs.length === 0 && !status.some((s) => s === 'added' || s === 'surplus')) return undefined;
  const ordered = [...regs].sort((a, b) => a.from - b.from || b.to - a.to);
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const reg = ordered.find((r) => r.from === i);
    if (reg) {
      out += regText(reg.frame);
      i = reg.to;
      continue;
    }
    if (status[i] !== 'lost' && status[i] !== 'surplus') out += chars[i];
    i++;
  }
  return out;
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
  const reading = options.as ?? 'transcript';
  const importer = new Importer(
    options.ids ?? newId,
    surfaceImages(root),
    reading !== 'transcript',
    reading === 'text',
  );
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
  return reading === 'text' ? startingText(result) : result;
}

/**
 * A document as a text to start from: its words as it prints them (the
 * regularized, corrected or expanded word where it gives one), its lines and
 * paragraphs, and the starts of its numbered parts. Its marks, gaps, notes,
 * figures and paratext are left behind, and so are its pages and columns,
 * which are those of its own edition and not of the witness to be
 * transcribed.
 */
function startingText(read: TeiImport): TeiImport {
  const items: Item[] = [];
  /** Where each item of the reading now stands; -1 for one left behind. */
  const now: number[] = [];
  for (const item of read.stream.items) {
    now.push(-1);
    if (item.kind === 'object') continue;
    if (item.kind === 'break') {
      if (item.type === 'page' || item.type === 'column') continue;
      const last = items.at(-1);
      // No line is empty: a break after a break is one break, the stronger of the two.
      if (!last) continue;
      if (last.kind === 'break') {
        if (item.type === 'paragraph') last.type = 'paragraph';
        continue;
      }
      items.push({ kind: 'break', id: item.id, type: item.type });
      continue;
    }
    const corrected = item.marks?.find((m) => m.kind === 'corr')?.attrs?.corr;
    const expanded = item.marks?.find((m) => m.kind === 'abbr')?.attrs?.expan;
    const word =
      typeof corrected === 'string'
        ? corrected
        : typeof expanded === 'string'
          ? expanded
          : (item.norm ?? item.form);
    if (word === '') continue;
    const token: Token = { kind: 'token', id: item.id, form: word };
    if (item.joinNext) token.joinNext = true;
    now[now.length - 1] = items.length;
    items.push(token);
  }
  while (items.at(-1)?.kind === 'break') items.pop();
  // A start that stood on something left behind goes to the next word.
  const segmentStarts: SegmentStartHint[] = [];
  for (const hint of read.segmentStarts) {
    let index = hint.itemIndex;
    while (index < now.length && now[index]! < 0) index++;
    if (index < now.length) segmentStarts.push({ itemIndex: now[index]!, parts: hint.parts });
  }
  return { ...read, stream: { items }, segmentStarts, pages: [] };
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
