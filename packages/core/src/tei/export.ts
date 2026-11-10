/**
 * TEI export of a transcription: a TEI P5 document with the title and the
 * witness in the header (the witness as a manuscript description), the pages
 * and zones as a facsimile, and the stream as text with its breaks, marks
 * and objects written as their TEI elements.
 */

import { rotatedCorners, type ZoneGeometry } from '../image/zones.ts';
import type { Break, Item, Mark, Obj, Stream, Token } from '../stream/items.ts';
import { variantGroup, variantMark } from '../stream/words.ts';
import {
  attrsXml,
  elementXml,
  escapeAttr,
  escapeText,
  isXmlName,
  ncName,
  type AttrValue,
} from './xml.ts';

/** A hand of the witness, written as a handNote; `main` is the scribe of the text. */
export interface ExportHand {
  id: string;
  label: string;
  description?: string;
  main?: boolean;
}

/** The xml:id of a hand's handNote, which `hand` attributes point at. */
export function handXmlId(id: string): string {
  return ncName(id, 'hand-');
}

export interface ExportWitness {
  siglum?: string;
  name?: string;
  repository?: string;
  settlement?: string;
  idno?: string;
  date?: string;
  material?: string;
  extent?: string;
  /** The hands of the witness; corrections in the text refer to them by id. */
  hands?: ExportHand[];
  description?: string;
  /** The format, as TEI names it on objectDesc: codex, scroll (a roll), leaf (a single sheet). */
  form?: 'codex' | 'scroll' | 'leaf';
}

export interface ExportPage {
  id: string;
  label: string;
  imageUrl?: string;
  /** Image size in pixels; zone coordinates are scaled to it when both are given. */
  width?: number;
  height?: number;
}

export interface ExportZone {
  id: string;
  pageId: string;
  tokenIds: string[];
  geometry: ZoneGeometry;
}

export interface TranscriptionExport {
  stream: Stream;
  title: string;
  language?: string;
  witness?: ExportWitness;
  pages?: ExportPage[];
  zones?: ExportZone[];
  /** Labels per segment id, written as `<milestone unit="segment" n="LABEL"/>`; starts of unlabelled segments are left out. */
  segmentLabels?: Record<string, string>;
  /** Write every token as `<w xml:id>` (with `facs` to its zones) instead of space-separated text. */
  words?: boolean;
  /** Write a normalized form that differs from the diplomatic form as `<choice><orig/><reg/></choice>`. */
  regularizations?: boolean;
  /** What the transcription rests on or was made from, as its maker states it. */
  sources?: string;
  /** The licence the transcription is published under: its name, or a free statement. */
  licence?: string;
  /** The licence's address. */
  licenceUrl?: string;
  /** A note on rights its maker adds. */
  rightsNote?: string;
  /** Who is responsible for the text, from its history. */
  contributors?: Contributor[];
  /** Who publishes it: the installation's name. */
  authority?: string;
  /** The installation's address, for the prefixes that resolve record ids (`tok:` and the rest). */
  origin?: string;
}

/** A person responsible for a text, for the header's `<respStmt>`. */
export interface Contributor {
  name: string;
  /** What they did: transcription, edition, notes. */
  resp: string;
  orcid?: string;
  /** Their record id, pointed at as `person:<id>` when there is no ORCID iD. */
  personId?: string;
}

/** A `<respStmt>` for each contributor, the ORCID iD as the name's `ref` where known. */
export function respStmts(contributors: readonly Contributor[] | undefined): string {
  return (contributors ?? [])
    .map((c) => {
      const ref = c.orcid
        ? ` ref="https://orcid.org/${escapeAttr(c.orcid)}"`
        : c.personId
          ? ` ref="person:${escapeAttr(c.personId)}"`
          : '';
      return `<respStmt><resp>${escapeText(c.resp)}</resp><persName${ref}>${escapeText(c.name)}</persName></respStmt>`;
    })
    .join('');
}

/** The prefixes by which a document's pointers name records of the installation (tok:, seg:, wit:, conj:, person:), resolved at its /id/ addresses. */
export const RECORD_PREFIXES = ['tok', 'seg', 'wit', 'conj', 'person'] as const;

/** The encoding description declaring the record prefixes for an installation's origin, or nothing without one. */
export function encodingDesc(origin: string | undefined): string | null {
  if (!origin) return null;
  const base = origin.replace(/\/+$/u, '');
  const defs = RECORD_PREFIXES.map(
    (ident) =>
      `<prefixDef ident="${ident}" matchPattern="([0-9A-HJKMNP-TV-Z]{26})" replacementPattern="${escapeAttr(base)}/id/$1"/>`,
  ).join('');
  return `<encodingDesc><listPrefixDef>${defs}</listPrefixDef></encodingDesc>`;
}

/**
 * The publication statement: by the installation, under the licence when one
 * is given (with its address as `target`), and the note on rights as a
 * statement of its own.
 */
export function publicationStmt(
  licence: string | undefined,
  options: {
    licenceUrl?: string | undefined;
    rightsNote?: string | undefined;
    authority?: string | undefined;
  } = {},
): string {
  const statements: string[] = [];
  if (licence && licence.trim() !== '') {
    const target = options.licenceUrl ? ` target="${escapeAttr(options.licenceUrl)}"` : '';
    statements.push(`<licence${target}>${escapeText(licence.trim())}</licence>`);
  }
  if (options.rightsNote && options.rightsNote.trim() !== '')
    statements.push(`<licence>${escapeText(options.rightsNote.trim())}</licence>`);
  const authority = escapeText((options.authority ?? 'Varians').trim() || 'Varians');
  if (statements.length === 0)
    return `<publicationStmt><p>Exported from ${authority}.</p></publicationStmt>`;
  return `<publicationStmt><authority>${authority}</authority><availability>${statements.join('')}</availability></publicationStmt>`;
}

/** The sources a text states, as a bibliographic note in the source description; nothing when none. */
export function sourcesBibl(sources: string | undefined): string | null {
  return sources && sources.trim() !== ''
    ? `<bibl type="sources">${escapeText(sources.trim())}</bibl>`
    : null;
}

const TEI_NS = 'http://www.tei-c.org/ns/1.0';
/**
 * Paratext with an element TEI allows inside a line, written as itself. The
 * text of a transcription or an edition is a flat run inside `<ab>` or `<p>`,
 * where `<head>`, `<speaker>`, `<trailer>` and the like may not stand; those
 * are written as `<label type="head">` and so on (see varians.odd).
 */
const INLINE_PARATEXT = new Set(['label', 'stage', 'fw']);
/** Mark kinds that are empty elements standing at a point. */
const POINT_KINDS = new Set(['gap', 'space', 'handShift']);
/** Mark kinds with no TEI element of their own; written as `<seg type>`. */
const SEG_KINDS = new Set(['crux', 'note']);

/**
 * A complete TEI P5 document for a transcription. Breaks are `<lb/>`, `<cb/>`
 * and `<pb/>` (with `break="no"` after a token joined to the next), segment
 * starts are milestones, marks are their elements, objects their elements.
 */
export function exportTranscriptionTei(input: TranscriptionExport): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TEI xmlns="${TEI_NS}">`,
    ...header(input),
  ];
  if (input.pages && input.pages.length > 0)
    lines.push(...facsimile(input.pages, input.zones ?? []));
  const lang = input.language === undefined ? '' : ` xml:lang="${escapeAttr(input.language)}"`;
  lines.push(
    `  <text${lang}>`,
    '    <body>',
    body(input),
    '    </body>',
    '  </text>',
    '</TEI>',
    '',
  );
  return lines.join('\n');
}

function indent(level: number, ...content: string[]): string[] {
  return content.map((line) => `${'  '.repeat(level)}${line}`);
}

function header(input: TranscriptionExport): string[] {
  const lines = indent(1, '<teiHeader>');
  lines.push(...indent(2, '<fileDesc>'));
  lines.push(
    ...indent(3, '<titleStmt>'),
    ...indent(4, elementXml('title', undefined, input.title)),
    ...(input.contributors?.length ? indent(4, respStmts(input.contributors)) : []),
    ...indent(3, '</titleStmt>'),
  );
  lines.push(
    ...indent(
      3,
      publicationStmt(input.licence, {
        licenceUrl: input.licenceUrl,
        rightsNote: input.rightsNote,
        authority: input.authority,
      }),
    ),
  );
  lines.push(...indent(3, '<sourceDesc>'));
  const bibl = sourcesBibl(input.sources);
  if (input.witness) lines.push(...msDesc(input.witness, 4));
  if (bibl) lines.push(...indent(4, bibl));
  if (!input.witness && !bibl) lines.push(...indent(4, '<p>Transcription.</p>'));
  lines.push(...indent(3, '</sourceDesc>'));
  lines.push(...indent(2, '</fileDesc>'));
  const encoding = encodingDesc(input.origin);
  if (encoding) lines.push(...indent(2, encoding));
  if (input.language !== undefined) {
    lines.push(...indent(2, '<profileDesc>'), ...indent(3, '<langUsage>'));
    lines.push(...indent(4, elementXml('language', { ident: input.language }, input.language)));
    lines.push(...indent(3, '</langUsage>'), ...indent(2, '</profileDesc>'));
  }
  lines.push(...indent(1, '</teiHeader>'));
  return lines;
}

function msDesc(witness: ExportWitness, level: number): string[] {
  const lines = indent(level, '<msDesc>', '  <msIdentifier>');
  const identifier: [string, string | undefined][] = [
    ['settlement', witness.settlement],
    ['repository', witness.repository],
    ['idno', witness.idno],
  ];
  for (const [name, value] of identifier) {
    if (value !== undefined) lines.push(...indent(level + 2, elementXml(name, undefined, value)));
  }
  // TEI's rule msId_minimal: an identifier without a place or library must not be empty or begin with
  // the siglum; the witness is then identified by its name (the siglum when it has none).
  if (
    witness.settlement === undefined &&
    witness.repository === undefined &&
    witness.idno === undefined
  ) {
    const name = witness.name ?? witness.siglum ?? 'Unidentified witness';
    lines.push(...indent(level + 2, elementXml('msName', undefined, name)));
  }
  if (witness.siglum !== undefined) {
    lines.push(
      ...indent(
        level + 2,
        `<altIdentifier type="siglum">${elementXml('idno', undefined, witness.siglum)}</altIdentifier>`,
      ),
    );
  }
  lines.push(...indent(level + 1, '</msIdentifier>'));
  if (witness.name !== undefined)
    lines.push(...indent(level + 1, elementXml('head', undefined, witness.name)));
  if (witness.description !== undefined) {
    lines.push(
      ...indent(
        level + 1,
        `<msContents>${elementXml('summary', undefined, witness.description)}</msContents>`,
      ),
    );
  }
  const described =
    witness.material !== undefined || witness.extent !== undefined || witness.form !== undefined;
  const hands = witness.hands ?? [];
  if (described || hands.length > 0) {
    lines.push(...indent(level + 1, '<physDesc>'));
    if (described) {
      lines.push(
        ...indent(
          level + 2,
          witness.form ? `<objectDesc form="${witness.form}">` : '<objectDesc>',
          '  <supportDesc>',
        ),
      );
      if (witness.material !== undefined) {
        lines.push(
          ...indent(
            level + 4,
            `<support>${elementXml('material', undefined, witness.material)}</support>`,
          ),
        );
      }
      if (witness.extent !== undefined)
        lines.push(...indent(level + 4, elementXml('extent', undefined, witness.extent)));
      lines.push(...indent(level + 2, '  </supportDesc>', '</objectDesc>'));
    }
    if (hands.length > 0) {
      lines.push(...indent(level + 2, `<handDesc hands="${hands.length}">`));
      for (const hand of hands) {
        const scope = hand.main ? (hands.length === 1 ? 'sole' : 'major') : 'minor';
        // xml:id is written by hand: the attribute writer takes plain names only.
        lines.push(
          ...indent(
            level + 3,
            `<handNote xml:id="${handXmlId(hand.id)}" n="${escapeAttr(hand.label)}" scope="${scope}">${escapeText(hand.description ?? '')}</handNote>`,
          ),
        );
      }
      lines.push(...indent(level + 2, '</handDesc>'));
    }
    lines.push(...indent(level + 1, '</physDesc>'));
  }
  if (witness.date !== undefined) {
    lines.push(
      ...indent(
        level + 1,
        `<history><origin>${elementXml('origDate', undefined, witness.date)}</origin></history>`,
      ),
    );
  }
  lines.push(...indent(level, '</msDesc>'));
  return lines;
}

function facsimile(pages: ExportPage[], zones: ExportZone[]): string[] {
  const lines = indent(1, '<facsimile>');
  for (const page of pages) {
    lines.push(
      ...indent(2, `<surface xml:id="${surfaceId(page.id)}" n="${escapeAttr(page.label)}">`),
    );
    if (page.imageUrl !== undefined) {
      const size: Record<string, AttrValue> = { url: page.imageUrl };
      if (page.width !== undefined) size.width = `${page.width}px`;
      if (page.height !== undefined) size.height = `${page.height}px`;
      lines.push(...indent(3, elementXml('graphic', size)));
    }
    for (const zone of zones.filter((z) => z.pageId === page.id)) {
      lines.push(
        ...indent(3, `<zone xml:id="${zoneId(zone.id)}"${zoneAttrs(zone.geometry, page)}/>`),
      );
    }
    lines.push(...indent(2, '</surface>'));
  }
  lines.push(...indent(1, '</facsimile>'));
  return lines;
}

function surfaceId(pageId: string): string {
  return ncName(pageId, 'p-');
}

function zoneId(id: string): string {
  return ncName(id, 'z-');
}

/** Zone coordinates in pixels of the image when its size is known, else as thousandths of its width and height. */
function zoneAttrs(geometry: ZoneGeometry, page: ExportPage): string {
  const [sx, sy] =
    page.width !== undefined && page.height !== undefined
      ? [page.width, page.height]
      : [1000, 1000];
  if (geometry.polygon && geometry.polygon.length > 0) {
    const points = geometry.polygon
      .map(([x, y]) => `${Math.round(x * sx)},${Math.round(y * sy)}`)
      .join(' ');
    return ` points="${points}"`;
  }
  if (geometry.rect && geometry.rotate) {
    // A turned rectangle as its four corners: TEI's rotate takes whole degrees only.
    const aspect = page.width && page.height ? page.height / page.width : 1;
    const points = rotatedCorners(geometry.rect, geometry.rotate, aspect)
      .map(([x, y]) => `${Math.round(x * sx)},${Math.round(y * sy)}`)
      .join(' ');
    return ` points="${points}"`;
  }
  if (geometry.rect) {
    const { x, y, w, h } = geometry.rect;
    return attrsXml({
      ulx: Math.round(x * sx),
      uly: Math.round(y * sy),
      lrx: Math.round((x + w) * sx),
      lry: Math.round((y + h) * sy),
    });
  }
  return '';
}

function body(input: TranscriptionExport): string {
  const write: MarkWriteOptions = { handRef: handRefFor(input.witness?.hands) };
  const items = input.stream.items;
  const words = input.words ?? false;
  const regularizations = input.regularizations ?? false;
  const labels = input.segmentLabels ?? {};
  const pagesById = new Map((input.pages ?? []).map((page) => [page.id, page]));
  const zonesByToken = new Map<string, string[]>();
  for (const zone of input.zones ?? []) {
    for (const tokenId of zone.tokenIds)
      zonesByToken.set(tokenId, [...(zonesByToken.get(tokenId) ?? []), zoneId(zone.id)]);
  }
  const block = items.some((item) => item.kind === 'break' && item.type === 'paragraph')
    ? 'p'
    : 'ab';
  let out = `      <${block}>`;
  /** What stands before the next inline element: nothing at a line start or after a joined token, else a space. */
  let separator = '';
  items.forEach((item, index) => {
    if (item.kind === 'break') {
      if (item.type === 'paragraph') {
        out += `</${block}>\n      <${block}>`;
      } else {
        const previous = items[index - 1];
        const joined = previous?.kind === 'token' && previous.joinNext === true;
        out += (joined ? '' : '\n      ') + breakXml(item, joined, pagesById);
      }
      separator = '';
      return;
    }
    const segmentId = item.segment?.segmentId;
    const label = segmentId === null || segmentId === undefined ? undefined : labels[segmentId];
    if (label !== undefined) {
      out += `${separator}<milestone unit="segment" n="${escapeAttr(label)}"/>`;
      separator = '';
    }
    if (item.kind === 'token') {
      const variant = variantEdges(items, index);
      out += separator + (variant.opens ? '<app><lem>' : '');
      out += tokenXml(item, words, regularizations, zonesByToken.get(item.id) ?? [], write);
      if (variant.closes) out += `</lem>${readingXml(variant.closes, write)}</app>`;
      separator = item.joinNext ? '' : ' ';
    } else {
      out += separator + objectXml(item);
      separator = ' ';
    }
  });
  // A word divided with nothing after it is told by a break that divides a word. When a line break
  // stands there already, a second one is its own, so that the first is not taken for the join alone.
  const last = items.at(-1);
  if (last?.kind === 'token' && last.joinNext === true)
    out += breakXml({ kind: 'break', id: '', type: 'line' }, true, pagesById);
  else if (last?.kind === 'break' && last.type === 'line') {
    const before = items.at(-2);
    if (before?.kind === 'token' && before.joinNext === true)
      out += '\n      ' + breakXml({ kind: 'break', id: '', type: 'line' }, false, pagesById);
  }
  return `${out}</${block}>`;
}

function breakXml(brk: Break, joined: boolean, pages: ReadonlyMap<string, ExportPage>): string {
  const attrs: Record<string, AttrValue> = {};
  switch (brk.type) {
    case 'line':
      if (brk.label !== undefined) attrs.n = brk.label;
      if (joined) attrs.break = 'no';
      if (brk.rend !== undefined) attrs.rend = brk.rend;
      return elementXml('lb', attrs);
    case 'column':
      if (brk.label !== undefined) attrs.n = brk.label;
      if (joined) attrs.break = 'no';
      return elementXml('cb', attrs);
    default: {
      const page = brk.pageId === undefined ? undefined : pages.get(brk.pageId);
      const label = page?.label ?? brk.label;
      if (label !== undefined) attrs.n = label;
      if (page) attrs.facs = `#${surfaceId(page.id)}`;
      if (joined) attrs.break = 'no';
      return elementXml('pb', attrs);
    }
  }
}

/**
 * Whether the token at `index` opens or closes the span of a variant noted
 * in the carrier (the `variant` mark, see items.ts): the span is written as
 * `<app><lem>` around its words with the variant as `<rdg>`.
 */
function variantEdges(items: readonly Item[], index: number): { opens: boolean; closes?: Mark } {
  const token = items[index];
  if (token?.kind !== 'token') return { opens: false };
  const mark = variantMark(token);
  const group = mark?.attrs?.group;
  if (!mark || typeof group !== 'string') return { opens: false };
  const near = (step: 1 | -1): Token | undefined => {
    for (let i = index + step; i >= 0 && i < items.length; i += step) {
      const item = items[i]!;
      if (item.kind === 'token') return item;
      if (item.kind === 'object' && item.type === 'gap') return undefined;
    }
    return undefined;
  };
  const before = near(-1);
  const after = near(1);
  const opens = !before || variantGroup(before) !== group;
  const closes = !after || variantGroup(after) !== group;
  return closes ? { opens, closes: mark } : { opens };
}

function readingXml(mark: Mark, options: MarkWriteOptions = {}): string {
  const attrs: Record<string, AttrValue> = {};
  const place = mark.attrs?.place;
  attrs.type = typeof place === 'string' && place !== '' ? place : 'other';
  const hand = mark.attrs?.hand;
  if (typeof hand === 'string' && hand !== '') {
    const ref = options.handRef ? options.handRef(hand) : hand;
    if (ref !== undefined) attrs.hand = ref;
  }
  const reading = mark.attrs?.reading;
  return elementXml('rdg', attrs, typeof reading === 'string' ? reading : '');
}

function tokenXml(
  token: Token,
  words: boolean,
  regularizations: boolean,
  zones: string[],
  options: MarkWriteOptions = {},
): string {
  // A variant noted in the carrier is written around the words as an <app>, not as an element of the token.
  const all = (token.marks ?? []).filter((m) => m.kind !== 'variant');
  // TEI has no number or foreign phrase inside a <w>: over a whole word they stand around it.
  const around = words
    ? all.filter((m) => AROUND_WORD.has(m.kind) && m.from === undefined && m.to === undefined)
    : [];
  const marks = all.filter((m) => !around.includes(m));
  let inner = markupToken(token.form, marks, words ? { ...options, inWord: true } : options);
  if (regularizations && token.norm !== undefined && token.norm !== token.form) {
    inner = `<choice><orig>${inner}</orig><reg>${escapeText(token.norm)}</reg></choice>`;
  }
  if (!words) return inner;
  const facs = zones.length > 0 ? ` facs="${zones.map((z) => `#${z}`).join(' ')}"` : '';
  const word = `<w xml:id="${ncName(token.id, 'w-')}"${facs}>${inner}</w>`;
  return around.reduceRight((xml, mark) => openTag(mark, options) + xml + closeTag(mark), word);
}

/** Marks whose TEI elements may not stand inside a `<w>`. */
const AROUND_WORD = new Set(['num', 'foreign']);

interface RangeMark {
  mark: Mark;
  from: number;
  to: number;
  order: number;
}

/**
 * A token's written form with its marks as elements. Overlapping ranges that
 * do not nest are split into well-formed pieces; the importer merges adjacent
 * pieces of one mark again. Point marks are empty elements at their position.
 */
/** How marks are written: `handRef` turns a mark's `hand` into the value of the attribute, or drops it. */
export interface MarkWriteOptions {
  handRef?: (value: string) => string | undefined;
  /** The marks are written inside a `<w>`, where a number or a foreign phrase over part of the word can only be a `<seg>`. */
  inWord?: boolean;
}

/** A mark's attributes as written, with the hand resolved to a reference. */
function writtenAttrs(mark: Mark, options: MarkWriteOptions): Mark['attrs'] {
  const attrs = mark.attrs;
  if (!attrs || typeof attrs.hand !== 'string' || !options.handRef) return attrs;
  const ref = options.handRef(attrs.hand);
  const out: NonNullable<Mark['attrs']> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== 'hand') out[key] = value;
    else if (ref !== undefined) out[key] = ref;
  }
  return out;
}

/**
 * The hand references of a transcription: a registered hand points at its
 * handNote, the scribe at the main hand's, an unidentified other hand is
 * left unsaid, and a value as imported is written as it came.
 */
export function handRefFor(
  hands: readonly ExportHand[] | undefined,
): (value: string) => string | undefined {
  const main = hands?.find((h) => h.main);
  return (value) => {
    if (value === 'scribe') return main ? `#${handXmlId(main.id)}` : undefined;
    if (value === 'other') return undefined;
    if (hands?.some((h) => h.id === value)) return `#${handXmlId(value)}`;
    return value.startsWith('#') ? value : `#${value}`;
  };
}

export function markupToken(
  form: string,
  marks: readonly Mark[],
  options: MarkWriteOptions = {},
): string {
  const chars = Array.from(form);
  const length = chars.length;
  const before: string[] = [];
  const points: Mark[] = [];
  const ranges: RangeMark[] = [];
  marks.forEach((mark, order) => {
    if (mark.from !== undefined && mark.to !== undefined && mark.from === mark.to)
      points.push(mark);
    else if (POINT_KINDS.has(mark.kind) && mark.from === undefined)
      before.push(emptyElement(mark, options));
    else {
      const from = Math.max(0, mark.from ?? 0);
      const to = Math.min(length, mark.to ?? length);
      if (from < to) ranges.push({ mark, from, to, order });
    }
  });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order);
  const cuts = new Set<number>([0, length]);
  for (const range of ranges) cuts.add(range.from).add(range.to);
  for (const point of points) cuts.add(Math.min(length, Math.max(0, point.from ?? 0)));
  const bounds = [...cuts].sort((a, b) => a - b);
  let out = before.join('');
  const open: RangeMark[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k]!;
    const b = bounds[k + 1]!;
    const active = ranges.filter((r) => r.from <= a && r.to >= b);
    let common = 0;
    while (common < open.length && common < active.length && open[common] === active[common])
      common++;
    for (let j = open.length - 1; j >= common; j--) out += closeTag(open[j]!.mark, options);
    open.length = common;
    for (let j = common; j < active.length; j++) {
      out += openTag(active[j]!.mark, options);
      open.push(active[j]!);
    }
    out += points
      .filter((p) => p.from === a)
      .map((p) => emptyElement(p, options))
      .join('');
    out += escapeText(chars.slice(a, b).join(''));
  }
  for (let j = open.length - 1; j >= 0; j--) out += closeTag(open[j]!.mark, options);
  out += points
    .filter((p) => (p.from ?? 0) >= length)
    .map((p) => emptyElement(p, options))
    .join('');
  return out;
}

function elementName(mark: Mark): string {
  return isXmlName(mark.kind) && !SEG_KINDS.has(mark.kind) ? mark.kind : 'seg';
}

function openTag(mark: Mark, options: MarkWriteOptions = {}): string {
  const attrs = writtenAttrs(mark, options);
  if (options.inWord && AROUND_WORD.has(mark.kind))
    return `<seg type="${escapeAttr(mark.kind)}"${attrsXml({ lang: attrs?.lang })}>`;
  // A symbol that stands for a whole word: nothing was written but what the expansion gives.
  if (mark.kind === 'abbr' && attrs?.symbol === true)
    return `<expan><ex${attrsXml(attrs, ['expan', 'symbol'])}>`;
  if (mark.kind === 'abbr' && typeof attrs?.expan === 'string')
    return `<choice><abbr${attrsXml(attrs, ['expan'])}>`;
  if (mark.kind === 'corr' && typeof attrs?.corr === 'string')
    return `<choice><sic${attrsXml(attrs, ['corr'])}>`;
  const name = elementName(mark);
  const type = name === 'seg' ? ` type="${escapeAttr(mark.kind)}"` : '';
  return `<${name}${type}${attrsXml(attrs, ['type'])}>`;
}

function closeTag(mark: Mark, options: MarkWriteOptions = {}): string {
  const attrs = mark.attrs;
  if (options.inWord && AROUND_WORD.has(mark.kind)) return '</seg>';
  if (mark.kind === 'abbr' && attrs?.symbol === true) return '</ex></expan>';
  if (mark.kind === 'abbr' && typeof attrs?.expan === 'string')
    return `</abbr>${elementXml('expan', undefined, attrs.expan)}</choice>`;
  if (mark.kind === 'corr' && typeof attrs?.corr === 'string')
    return `</sic>${elementXml('corr', undefined, attrs.corr)}</choice>`;
  return `</${elementName(mark)}>`;
}

function emptyElement(mark: Mark, options: MarkWriteOptions = {}): string {
  const attrs = writtenAttrs(mark, options);
  if (mark.kind === 'note') {
    const text = typeof attrs?.text === 'string' ? attrs.text : '';
    return `<note${attrsXml(attrs, ['text'])}>${escapeText(text)}</note>`;
  }
  if (!isXmlName(mark.kind))
    return `<seg type="${escapeAttr(mark.kind)}"${attrsXml(attrs, ['type'])}/>`;
  if (mark.kind === 'gap') return gapXml(attrs);
  return elementXml(mark.kind, attrs);
}

/** A gap, with what is said of it (vestiges, another language, not transcribed) as its `<desc>`. */
function gapXml(attrs: Mark['attrs']): string {
  const desc = attrs?.desc;
  if (typeof desc !== 'string' || desc === '') return elementXml('gap', attrs);
  return `<gap${attrsXml(attrs, ['desc'])}>${elementXml('desc', undefined, desc)}</gap>`;
}

/**
 * A sign of the carrier that is not a letter: a glyph by its name (EpiDoc's
 * `<g>`), a rule or paragraphos (a `<milestone>` that numbers nothing), or
 * any other mark of the scribe's (`<metamark>`).
 */
function signXml(attrs: Obj['attrs'], text: string): string {
  if (typeof attrs?.g === 'string') {
    const written: Record<string, AttrValue> = { type: attrs.g };
    if (typeof attrs.rend === 'string') written.rend = attrs.rend;
    const glyph = elementXml('g', written, text === '' ? undefined : text);
    return attrs.unclear === true ? `<unclear>${glyph}</unclear>` : glyph;
  }
  if (typeof attrs?.unit === 'string' && typeof attrs.rend === 'string' && text === '')
    return elementXml('milestone', { rend: attrs.rend, unit: attrs.unit });
  return elementXml('metamark', attrs, text);
}

function objectXml(obj: Obj): string {
  const attrs = obj.attrs;
  const text = obj.text ?? '';
  switch (obj.type) {
    case 'gap':
      return gapXml(attrs);
    case 'lacuna':
      return elementXml('gap', { reason: 'lost', ...attrs });
    case 'space':
      return elementXml('space', attrs);
    case 'figure': {
      const graphic =
        typeof attrs?.url === 'string' ? elementXml('graphic', { url: attrs.url }) : '';
      const desc = obj.text === undefined ? '' : elementXml('figDesc', undefined, obj.text);
      return `<figure${attrsXml(attrs, ['url'])}>${graphic}${desc}</figure>`;
    }
    case 'note':
      return elementXml('note', attrs, text);
    case 'mark':
      return signXml(attrs, text);
    default:
      return paratextXml(attrs, text);
  }
}

/**
 * A paratext object: label, stage and fw as themselves with the object's
 * subtype as `type`; any other kind (head, speaker, trailer, margin, …) as a
 * label whose `type` is the kind and whose `subtype` is the object's subtype.
 * An untyped paratext is a label.
 */
export function paratextXml(attrs: Obj['attrs'], text: string): string {
  const kind = typeof attrs?.type === 'string' && attrs.type !== '' ? attrs.type : 'label';
  const rest: Record<string, AttrValue> = { ...attrs };
  delete rest.type;
  if (INLINE_PARATEXT.has(kind)) {
    if (rest.subtype !== undefined) {
      rest.type = rest.subtype;
      delete rest.subtype;
    }
    return elementXml(kind, rest, text);
  }
  return elementXml('label', { type: kind, ...rest }, text);
}
