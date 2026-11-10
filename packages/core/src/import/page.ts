/**
 * Layout recognition output into a stream with zones: PAGE XML (PRImA, as
 * Transkribus and eScriptorium write it) and ALTO. Pages become page
 * breaks, text lines become line breaks, words become tokens, and every
 * word with coordinates gets a zone in fractions of the page size. A line
 * whose words have no coordinates of their own is divided horizontally in
 * proportion to the words' letter counts.
 */

import { newId } from '../ids.ts';
import type { ImportedZone, Point, Rect, ZoneGeometry } from '../image/zones.ts';
import type { Break, Item, Stream, Token } from '../stream/items.ts';
import { childrenNamed, descendants, firstChild, numberAttr, parseXml, type XmlElement } from './xml.ts';

export interface LayoutPage {
  /** The page's name: the image file name without its extension when there is one. */
  label?: string;
  imageFilename?: string;
  /** Page size in the source's own unit (pixels, or ALTO's mm10 and inch1200). Zero when unknown. */
  width: number;
  height: number;
}

export interface LayoutImport {
  stream: Stream;
  zones: ImportedZone[];
  pages: LayoutPage[];
  warnings: string[];
}

export interface LayoutImportOptions {
  ids?: () => string;
}

/** A rectangle or polygon in the source's own coordinates. */
interface Shape {
  polygon?: Point[];
  rect?: Rect;
}

interface Size {
  width: number;
  height: number;
}

interface Context {
  ids: () => string;
  items: Item[];
  zones: ImportedZone[];
  pages: LayoutPage[];
  warnings: string[];
  /** Breaks emitted so far: the index of the current line in `lines(stream)`. */
  breaks: number;
  /** Words without coordinates on the current page, reported once per page. */
  unplaced: number;
}

/** Import PAGE XML. */
export function importPageXml(xml: string, options: LayoutImportOptions = {}): LayoutImport {
  const ctx = newContext(options);
  const root = parseRoot(ctx, xml);
  if (!root) return result(ctx);
  if (root.name !== 'PcGts') {
    ctx.warnings.push(`The root element is <${root.name}>, not <PcGts>; reading the <Page> elements found.`);
  }
  const pages = root.name === 'PcGts' ? childrenNamed(root, 'Page') : descendants(root, 'Page');
  if (pages.length === 0) ctx.warnings.push('No <Page> element found.');
  pages.forEach((page, n) => importPage(ctx, page, n));
  return result(ctx);
}

/** Import ALTO. */
export function importAltoXml(xml: string, options: LayoutImportOptions = {}): LayoutImport {
  const ctx = newContext(options);
  const root = parseRoot(ctx, xml);
  if (!root) return result(ctx);
  if (root.name !== 'alto') {
    ctx.warnings.push(`The root element is <${root.name}>, not <alto>; reading the <Page> elements found.`);
  }
  const layout = firstChild(root, 'Layout');
  const pages = layout ? childrenNamed(layout, 'Page') : descendants(root, 'Page');
  if (pages.length === 0) ctx.warnings.push('No <Page> element found.');
  const fileName = descendants(root, 'fileName')[0]?.text;
  pages.forEach((page, n) => importAltoPage(ctx, page, n, pages.length === 1 ? fileName : undefined));
  return result(ctx);
}

function newContext(options: LayoutImportOptions): Context {
  return {
    ids: options.ids ?? newId,
    items: [],
    zones: [],
    pages: [],
    warnings: [],
    breaks: 0,
    unplaced: 0,
  };
}

function result(ctx: Context): LayoutImport {
  return { stream: { items: ctx.items }, zones: ctx.zones, pages: ctx.pages, warnings: ctx.warnings };
}

function parseRoot(ctx: Context, xml: string): XmlElement | null {
  const parsed = parseXml(xml);
  if (parsed.error) ctx.warnings.push(`The XML is not well formed: ${parsed.error}`);
  const root = parsed.elements[0];
  if (!root) {
    ctx.warnings.push('No XML document found.');
    return null;
  }
  return root;
}

// PAGE

function importPage(ctx: Context, page: XmlElement, n: number): void {
  const imageFilename = page.attrs.imageFilename;
  const label = imageFilename ? stem(imageFilename) : String(n + 1);
  const size = sizeOf(page, 'imageWidth', 'imageHeight');
  startPage(ctx, label, imageFilename, size);
  if (!size) ctx.warnings.push(`Page ${label}: no image size (imageWidth, imageHeight), so its zones are left out.`);
  let first = true;
  for (const region of orderedTextRegions(page)) {
    const regionRtl = region.attrs.readingDirection === 'right-to-left';
    for (const line of textLinesOf(region)) {
      if (!first) lineBreak(ctx);
      first = false;
      const rtl = line.attrs.readingDirection ? line.attrs.readingDirection === 'right-to-left' : regionRtl;
      importTextLine(ctx, line, size, rtl);
    }
  }
  for (const region of page.children) {
    if (region.name !== 'ImageRegion' && region.name !== 'GraphicRegion') continue;
    const shape = coordsShape(region);
    const geometry = shape && size ? toGeometry(shape, size) : null;
    if (geometry) ctx.zones.push({ tokenIds: [], geometry, feature: { kind: 'figure' } });
  }
  endPage(ctx, label);
}

/** The text regions of a page in reading order: the ReadingOrder element's order first, then the rest in document order. */
function orderedTextRegions(page: XmlElement): XmlElement[] {
  const regions: XmlElement[] = [];
  for (const child of page.children) {
    if (child.name === 'TextRegion') regions.push(child);
    else if (child.name.endsWith('Region')) regions.push(...descendants(child, 'TextRegion'));
  }
  const order = readingOrder(firstChild(page, 'ReadingOrder'));
  if (order.length === 0) return regions;
  const byId = new Map<string, XmlElement>();
  for (const region of regions) if (region.attrs.id) byId.set(region.attrs.id, region);
  const out: XmlElement[] = [];
  for (const id of order) {
    const region = byId.get(id);
    if (region) {
      out.push(region);
      byId.delete(id);
    }
  }
  for (const region of regions) if (!region.attrs.id || byId.has(region.attrs.id)) out.push(region);
  return out;
}

function readingOrder(element: XmlElement | undefined): string[] {
  if (!element) return [];
  const refs: string[] = [];
  const walk = (group: XmlElement): void => {
    const children = [...group.children];
    if (group.name.startsWith('Ordered')) {
      children.sort((a, b) => (numberAttr(a, 'index') ?? 0) - (numberAttr(b, 'index') ?? 0));
    }
    for (const child of children) {
      if (child.name === 'RegionRef' || child.name === 'RegionRefIndexed') {
        if (child.attrs.regionRef) refs.push(child.attrs.regionRef);
      } else {
        walk(child);
      }
    }
  };
  walk(element);
  return refs;
}

/** The text lines of a region in document order, including those of nested regions. */
function textLinesOf(region: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of region.children) {
    if (child.name === 'TextLine') out.push(child);
    else if (child.name === 'TextRegion') out.push(...textLinesOf(child));
  }
  return out;
}

function importTextLine(ctx: Context, line: XmlElement, size: Size | null, rtl: boolean): void {
  const words = childrenNamed(line, 'Word')
    .map((word) => ({ text: unicodeOf(word), shape: coordsShape(word) }))
    .filter((word) => word.text !== '');
  if (words.length > 0) {
    for (const word of words) emitWords(ctx, word.text, word.shape, size, rtl);
    return;
  }
  emitWords(ctx, unicodeOf(line), coordsShape(line), size, rtl);
}

/** The text of a PAGE element: its best TextEquiv's Unicode, else PlainText. */
function unicodeOf(element: XmlElement): string {
  const equivs = [...childrenNamed(element, 'TextEquiv')].sort(
    (a, b) => (numberAttr(a, 'index') ?? 0) - (numberAttr(b, 'index') ?? 0),
  );
  for (const equiv of equivs) {
    const text = firstChild(equiv, 'Unicode')?.text ?? firstChild(equiv, 'PlainText')?.text ?? '';
    if (text !== '') return text;
  }
  return '';
}

/** The shape of a PAGE element's Coords: a polygon from `points`, or from Point children in the older schema. */
function coordsShape(element: XmlElement): Shape | null {
  const coords = firstChild(element, 'Coords');
  if (!coords) return null;
  const points: Point[] = [];
  if (coords.attrs.points) {
    for (const pair of coords.attrs.points.trim().split(/\s+/u)) {
      const [x, y] = pair.split(',').map(Number);
      if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    }
  } else {
    for (const point of childrenNamed(coords, 'Point')) {
      const x = numberAttr(point, 'x');
      const y = numberAttr(point, 'y');
      if (x !== null && y !== null) points.push([x, y]);
    }
  }
  return shapeOfPoints(points);
}

function shapeOfPoints(points: Point[]): Shape | null {
  if (points.length >= 3) return { polygon: points };
  if (points.length === 2) return { rect: boundsOf(points) };
  return null;
}

// ALTO

function importAltoPage(ctx: Context, page: XmlElement, n: number, fileName: string | undefined): void {
  const label = fileName ? stem(fileName) : (page.attrs.PHYSICAL_IMG_NR ?? page.attrs.ID ?? String(n + 1));
  const size = sizeOf(page, 'WIDTH', 'HEIGHT');
  startPage(ctx, label, fileName, size);
  if (!size) ctx.warnings.push(`Page ${label}: no page size (WIDTH, HEIGHT), so its zones are left out.`);
  let first = true;
  for (const line of descendants(page, 'TextLine')) {
    if (!first) lineBreak(ctx);
    first = false;
    importAltoLine(ctx, line, size);
  }
  endPage(ctx, label);
}

function importAltoLine(ctx: Context, line: XmlElement, size: Size | null): void {
  const rtl = (line.attrs.BASEDIRECTION ?? '').toLowerCase() === 'rtl';
  let lastToken: Token | null = null;
  for (const child of line.children) {
    if (child.name === 'HYP') {
      if (lastToken) lastToken.joinNext = true;
      continue;
    }
    if (child.name !== 'String') continue;
    const content = child.attrs.CONTENT ?? '';
    if (content.trim() === '') continue;
    const tokens = emitWords(ctx, content, altoShape(child), size, rtl);
    const last = tokens[tokens.length - 1];
    if (last) {
      lastToken = last;
      if (child.attrs.SUBS_TYPE === 'HypPart1') last.joinNext = true;
    }
  }
}

/** The shape of an ALTO element: its Shape/Polygon when it has one, else the HPOS/VPOS/WIDTH/HEIGHT box. */
function altoShape(element: XmlElement): Shape | null {
  const polygon = firstChild(firstChild(element, 'Shape'), 'Polygon');
  if (polygon?.attrs.POINTS) {
    const points: Point[] = [];
    const numbers = polygon.attrs.POINTS.trim().split(/[\s,]+/u).map(Number);
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const x = numbers[i]!;
      const y = numbers[i + 1]!;
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    }
    const shape = shapeOfPoints(points);
    if (shape) return shape;
  }
  const x = numberAttr(element, 'HPOS');
  const y = numberAttr(element, 'VPOS');
  const w = numberAttr(element, 'WIDTH');
  const h = numberAttr(element, 'HEIGHT');
  if (x === null || y === null || w === null || h === null) return null;
  return { rect: { x, y, w, h } };
}

// Shared

function startPage(ctx: Context, label: string, imageFilename: string | undefined, size: Size | null): void {
  const page: LayoutPage = { label, width: size?.width ?? 0, height: size?.height ?? 0 };
  if (imageFilename !== undefined) page.imageFilename = imageFilename;
  ctx.pages.push(page);
  const item: Break = { kind: 'break', id: ctx.ids(), type: 'page', label };
  ctx.items.push(item);
  ctx.breaks++;
  ctx.unplaced = 0;
}

function endPage(ctx: Context, label: string): void {
  if (ctx.unplaced > 0) {
    ctx.warnings.push(`Page ${label}: ${ctx.unplaced} word${ctx.unplaced === 1 ? '' : 's'} without coordinates, imported without a zone.`);
  }
}

function lineBreak(ctx: Context): void {
  const item: Break = { kind: 'break', id: ctx.ids(), type: 'line' };
  ctx.items.push(item);
  ctx.breaks++;
}

/**
 * Emit the words of a text as tokens. One word takes the shape as it is;
 * several words divide the shape's bounding box horizontally in proportion
 * to their letter counts, from the right for a right-to-left line.
 */
function emitWords(ctx: Context, text: string, shape: Shape | null, size: Size | null, rtl: boolean): Token[] {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  const tokens: Token[] = [];
  if (words.length === 0) return tokens;
  let shapes: (Shape | null)[];
  if (words.length === 1) {
    shapes = [shape];
  } else {
    const bounds = shape ? boundsOfShape(shape) : null;
    shapes = bounds ? divideProportionally(bounds, words, rtl).map((rect) => ({ rect })) : words.map(() => null);
  }
  words.forEach((form, i) => {
    const token: Token = { kind: 'token', id: ctx.ids(), form };
    ctx.items.push(token);
    tokens.push(token);
    const wordShape = shapes[i] ?? null;
    const geometry = wordShape && size ? toGeometry(wordShape, size) : null;
    if (geometry) {
      ctx.zones.push({ tokenIds: [token.id], geometry, lineIndex: ctx.breaks, text: form });
    } else if (!wordShape) {
      ctx.unplaced++;
    }
  });
  return tokens;
}

/** Divide a box among words in proportion to their letter counts, one letter's width between neighbours. */
export function divideProportionally(box: Rect, words: string[], rtl = false): Rect[] {
  const lengths = words.map((word) => Math.max(1, Array.from(word).length));
  const total = lengths.reduce((sum, n) => sum + n, 0) + Math.max(0, words.length - 1);
  if (total <= 0) return words.map(() => ({ ...box }));
  const out: Rect[] = [];
  let offset = 0;
  for (const length of lengths) {
    const w = (box.w * length) / total;
    const fromLeft = box.x + (box.w * offset) / total;
    const x = rtl ? box.x + box.w - (box.w * (offset + length)) / total : fromLeft;
    out.push({ x, y: box.y, w, h: box.h });
    offset += length + 1;
  }
  return out;
}

function toGeometry(shape: Shape, size: Size): ZoneGeometry | null {
  if (shape.polygon) {
    return { polygon: shape.polygon.map(([x, y]) => [clamp(x / size.width), clamp(y / size.height)] as Point) };
  }
  if (shape.rect) {
    const { x, y, w, h } = shape.rect;
    const x0 = clamp(x / size.width);
    const y0 = clamp(y / size.height);
    return { rect: { x: x0, y: y0, w: clamp(w / size.width, 1 - x0), h: clamp(h / size.height, 1 - y0) } };
  }
  return null;
}

function clamp(value: number, max = 1): number {
  return Math.min(max, Math.max(0, value));
}

function boundsOfShape(shape: Shape): Rect | null {
  if (shape.rect) return shape.rect;
  if (shape.polygon) return boundsOf(shape.polygon);
  return null;
}

function boundsOf(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function sizeOf(element: XmlElement, widthAttr: string, heightAttr: string): Size | null {
  const width = numberAttr(element, widthAttr);
  const height = numberAttr(element, heightAttr);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { width, height };
}

/** A file name without directory and extension. */
function stem(filename: string): string {
  const base = filename.split(/[\\/]/u).pop() ?? filename;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
