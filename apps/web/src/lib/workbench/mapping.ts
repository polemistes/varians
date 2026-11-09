/**
 * Mapping words to the image (PLAN 5.6), the part that needs no browser:
 * which words of a page have no zone, which zones a set of words lights,
 * the lines a selection covers, and a guide box drawn over several lines
 * divided into one band per line and each band into word boxes by letter
 * counts. Coordinates are fractions of the image.
 */

import {
  isBreak,
  isObj,
  isToken,
  lines,
  rectOf,
  words,
  type Id,
  type Rect,
  type Stream,
  type ZoneGeometry,
} from '@varians/core';
import type { GroupBox } from '$lib/facsimile/group';
import { divideLine } from '$lib/facsimile/layout';

export interface ZoneLike {
  id: string;
  tokenIds: string[];
  geometry: ZoneGeometry;
  feature?: { kind: string; description?: string } | null;
}

export interface NewZoneInput {
  geometry: ZoneGeometry;
  tokenIds: Id[];
}

/** The token ids of a stream (a page) that no zone names. */
export function unmappedTokens(stream: Stream, zones: ZoneLike[]): Id[] {
  const mapped = new Set<Id>();
  for (const zone of zones) for (const id of zone.tokenIds) mapped.add(id);
  return stream.items.filter((item) => isToken(item) && !mapped.has(item.id)).map((item) => item.id);
}

/** Ids of the zones that name any of the tokens. */
export function zonesOfTokens(zones: ZoneLike[], tokenIds: Iterable<Id>): string[] {
  const wanted = new Set(tokenIds);
  if (wanted.size === 0) return [];
  return zones.filter((zone) => zone.tokenIds.some((id) => wanted.has(id))).map((zone) => zone.id);
}

/** Ids of the word zones made only of these tokens: what mapping the tokens again replaces. */
export function replacedZones(zones: ZoneLike[], tokenIds: Iterable<Id>): string[] {
  const mapping = new Set(tokenIds);
  return zones
    .filter((zone) => !zone.feature && zone.tokenIds.length > 0 && zone.tokenIds.every((id) => mapping.has(id)))
    .map((zone) => zone.id);
}

/** For every token, the ids of all tokens of its word (one, or several joined across lines). */
export function wordTokens(stream: Stream): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  for (const word of words(stream)) {
    const ids = word.tokens.map((t) => t.id);
    for (const id of ids) out.set(id, ids);
  }
  return out;
}

/** One part of a word on one line: what gets a box when a line is divided. */
export interface WordPart {
  /** Every token of the word the part belongs to; empty for a spacer. */
  tokenIds: Id[];
  /** The written letters of this part, which decide its share of the line. */
  text: string;
  /** A gap in the text: takes room on the line but gets no zone. */
  spacer?: boolean;
}

export interface LineParts {
  parts: WordPart[];
}

const DEFAULT_GAP_LETTERS = 3;

/** The letters a gap object stands for on the line: its extent in characters, else a few. */
function gapLetters(attrs: Record<string, unknown> | undefined): number {
  const quantity = attrs?.quantity;
  const unit = attrs?.unit;
  if (typeof quantity === 'number' && quantity > 0 && (unit === undefined || unit === 'character' || unit === 'chars')) {
    return Math.min(60, Math.round(quantity));
  }
  return DEFAULT_GAP_LETTERS;
}

/**
 * The lines of `page` that hold any of `tokenIds`, whole, with their word
 * parts in reading order. `whole` is the whole stream, which says what word
 * a part divided across lines (or pages) belongs to. Lines without words
 * are left out.
 */
export function selectedLines(page: Stream, tokenIds: Iterable<Id>, whole: Stream = page): LineParts[] {
  const wanted = new Set(tokenIds);
  const wordOf = wordTokens(whole);
  const out: LineParts[] = [];
  for (const line of lines(page)) {
    const items = page.items.slice(line.from, line.to);
    if (!items.some((item) => isToken(item) && wanted.has(item.id))) continue;
    const parts: WordPart[] = [];
    for (const item of items) {
      if (isToken(item)) parts.push({ tokenIds: wordOf.get(item.id) ?? [item.id], text: item.form });
      else if (isObj(item) && (item.type === 'gap' || item.type === 'space')) {
        parts.push({ tokenIds: [], text: 'x'.repeat(gapLetters(item.attrs)), spacer: true });
      }
    }
    if (parts.some((p) => !p.spacer)) out.push({ parts });
  }
  return out;
}

/** The token ids on the line of `page` that holds `tokenId`, in order. */
export function lineTokens(page: Stream, tokenId: Id): Id[] {
  for (const line of lines(page)) {
    const items = page.items.slice(line.from, line.to);
    if (items.some((item) => item.id === tokenId)) return items.filter(isToken).map((t) => t.id);
  }
  return [];
}

const STRONG_RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;
const STRONG_LTR = /[A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]/u;

/** The direction of a line of text from its first strong character. */
export function lineDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) return 'rtl';
    if (STRONG_LTR.test(ch)) return 'ltr';
  }
  return 'ltr';
}

/** `n` equal horizontal bands of a box, top to bottom. */
export function evenBands(box: Rect, n: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) out.push({ x: box.x, y: box.y + (box.h * i) / n, w: box.w, h: box.h / n });
  return out;
}

/** A rectangle cut to lie inside a box; null when nothing of it is left. */
export function clipRect(rect: Rect, box: Rect): Rect | null {
  const x = Math.max(rect.x, box.x);
  const y = Math.max(rect.y, box.y);
  const x2 = Math.min(rect.x + rect.w, box.x + box.w);
  const y2 = Math.min(rect.y + rect.h, box.y + box.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export interface GuideBoxOptions {
  /** Lines found inside the box on the image, top to bottom; used when there are as many as lines of text. */
  detected?: Rect[];
  /** Force a direction for every line; by default each line's own. */
  direction?: 'ltr' | 'rtl';
}

/**
 * A guide box over several lines of text, divided into zones: one band per
 * line (the lines found on the image when their number matches, else equal
 * bands), each band into word boxes in proportion to the parts' letters.
 * A word divided across lines gets one zone per part, each naming every
 * token of the word, so that either part lights the whole word.
 */
export function divideGuideBox(box: Rect, lineParts: LineParts[], options: GuideBoxOptions = {}): NewZoneInput[] {
  const n = lineParts.length;
  if (n === 0 || box.w <= 0 || box.h <= 0) return [];
  const evens = evenBands(box, n);
  const found = options.detected && options.detected.length === n ? options.detected : null;
  const bands = evens.map((even, i) => (found ? (clipRect(found[i]!, box) ?? even) : even));
  const out: NewZoneInput[] = [];
  lineParts.forEach((line, i) => {
    const direction = options.direction ?? lineDirection(line.parts.map((p) => p.text).join(' '));
    const rects = divideLine(bands[i]!, line.parts.map((p) => ({ text: p.text })), direction);
    line.parts.forEach((part, k) => {
      if (part.spacer || part.tokenIds.length === 0) return;
      out.push({ geometry: { rect: round(rects[k]!) }, tokenIds: part.tokenIds });
    });
  });
  return out;
}

function round(rect: Rect): Rect {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return { x: r(rect.x), y: r(rect.y), w: r(rect.w), h: r(rect.h) };
}

export interface LineWordBox {
  /** The zone. */
  id: string;
  rect: Rect;
}

/**
 * The word boxes of one line for the dividers: the rectangle zones of the
 * line's tokens in reading order (one per zone), with the line's box around
 * them. Null when fewer than two words have a rectangle.
 */
export function lineWordBoxes(zones: ZoneLike[], lineTokenIds: Id[]): { line: Rect; words: LineWordBox[] } | null {
  const order = new Map(lineTokenIds.map((id, i) => [id, i] as const));
  const boxes: (LineWordBox & { at: number })[] = [];
  for (const zone of zones) {
    if (zone.feature || !zone.geometry.rect || (zone.geometry.polygon && zone.geometry.polygon.length >= 3)) continue;
    const positions = zone.tokenIds.map((id) => order.get(id)).filter((p): p is number => p !== undefined);
    if (positions.length === 0) continue;
    boxes.push({ id: zone.id, rect: zone.geometry.rect, at: Math.min(...positions) });
  }
  if (boxes.length < 2) return null;
  boxes.sort((a, b) => a.at - b.at);
  let x = Infinity;
  let y = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const box of boxes) {
    x = Math.min(x, box.rect.x);
    y = Math.min(y, box.rect.y);
    x2 = Math.max(x2, box.rect.x + box.rect.w);
    y2 = Math.max(y2, box.rect.y + box.rect.h);
  }
  return { line: { x, y, w: x2 - x, h: y2 - y }, words: boxes.map(({ id, rect }) => ({ id, rect })) };
}

/** Whether a zone is a word box: a rectangle (turned or not), not a feature or a polygon. */
export function isWordBox(zone: ZoneLike): zone is ZoneLike & { geometry: { rect: Rect } } {
  return !zone.feature && !!zone.geometry.rect && !(zone.geometry.polygon && zone.geometry.polygon.length >= 3);
}

/** Lines are told apart when their middles stand this many box heights apart. */
const LINE_GAP = 0.6;

/**
 * The chosen word boxes, to be edited together: each with its line on the
 * page and its place there, in reading order. A box goes with the line of
 * its words. A box of a word divided across lines names tokens on two
 * lines; it goes with the line whose other boxes stand nearest to it on
 * the image. Boxes whose words are gone are put in lines by where they
 * stand (across the slope of their turn), left to right; those lines come
 * after the lines of the text. `aspect` is the image's height over its width.
 */
export function groupBoxes(page: Stream, zones: ZoneLike[], zoneIds: Iterable<string>, aspect = 1): GroupBox[] {
  const wanted = new Set(zoneIds);
  const where = new Map<Id, { line: number; at: number; form: string }>();
  const texts: string[] = [];
  const pageLines = lines(page);
  pageLines.forEach((line, index) => {
    const tokens = page.items.slice(line.from, line.to).filter(isToken);
    tokens.forEach((token, at) => where.set(token.id, { line: index, at, form: token.form }));
    texts[index] = tokens.map((t) => t.form).join(' ');
  });
  const chosen = zones.filter((zone) => wanted.has(zone.id) && isWordBox(zone));
  const placesOf = (zone: ZoneLike) => zone.tokenIds.map((id) => where.get(id)).filter((p) => p !== undefined);
  // Where each line stands, from the boxes that belong to one line only.
  const centres = new Map<number, number[]>();
  for (const zone of chosen) {
    const lineSet = new Set(placesOf(zone).map((p) => p.line));
    if (lineSet.size !== 1) continue;
    const [line] = lineSet;
    const r = zone.geometry.rect!;
    centres.set(line!, [...(centres.get(line!) ?? []), r.y + r.h / 2]);
  }
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const out: GroupBox[] = [];
  const loose: (ZoneLike & { geometry: { rect: Rect } })[] = [];
  for (const zone of chosen) {
    const places = placesOf(zone);
    const r = zone.geometry.rect!;
    const rotate = zone.geometry.rotate || undefined;
    if (places.length === 0) {
      loose.push(zone as ZoneLike & { geometry: { rect: Rect } });
      continue;
    }
    const y = r.y + r.h / 2;
    let line = places[0]!.line;
    let best = Infinity;
    for (const candidate of new Set(places.map((p) => p.line))) {
      const known = centres.get(candidate);
      const distance = known ? Math.abs(mean(known) - y) : Infinity;
      if (distance < best) {
        best = distance;
        line = candidate;
      }
    }
    const here = places.filter((p) => p.line === line);
    const at = Math.min(...here.map((p) => p.at));
    const text = here.map((p) => p.form).join(' ');
    out.push({ id: zone.id, rect: r, line, at, direction: lineDirection(texts[line] ?? ''), text, ...(rotate ? { rotate } : {}) });
  }
  out.push(...looseLines(loose, aspect, pageLines.length));
  return out.sort((a, b) => a.line - b.line || a.at - b.at);
}

/** Boxes without words, put in lines by where they stand: across their slope for the line, along it for the order. */
function looseLines(zones: (ZoneLike & { geometry: { rect: Rect } })[], aspect: number, firstLine: number): GroupBox[] {
  if (zones.length === 0) return [];
  const placed = zones.map((zone) => {
    const r = zone.geometry.rect;
    const a = ((zone.geometry.rotate ?? 0) * Math.PI) / 180;
    const cx = r.x + r.w / 2;
    const cy = (r.y + r.h / 2) * aspect;
    return { zone, across: -cx * Math.sin(a) + cy * Math.cos(a), along: cx * Math.cos(a) + cy * Math.sin(a), height: r.h * aspect };
  });
  placed.sort((a, b) => a.across - b.across);
  const heights = placed.map((p) => p.height).sort((a, b) => a - b);
  const gap = (heights[Math.floor(heights.length / 2)] ?? 0) * LINE_GAP;
  const groups: (typeof placed)[] = [];
  for (const p of placed) {
    const current = groups[groups.length - 1];
    const middle = current ? current.reduce((sum, q) => sum + q.across, 0) / current.length : -Infinity;
    if (current && p.across - middle <= gap) current.push(p);
    else groups.push([p]);
  }
  return groups.flatMap((group, index) =>
    [...group]
      .sort((a, b) => a.along - b.along)
      .map((p, at) => {
        const rotate = p.zone.geometry.rotate || undefined;
        return { id: p.zone.id, rect: p.zone.geometry.rect, line: firstLine + index, at, direction: 'ltr' as const, ...(rotate ? { rotate } : {}) };
      }),
  );
}

/** The bounding rectangle of a drawn shape. */
export function boxOf(geometry: ZoneGeometry): Rect | null {
  return rectOf(geometry);
}

/** Whether the items between two tokens hold a line break: their words stand on different lines. */
export function spansLines(stream: Stream, fromId: Id, toId: Id): boolean {
  const a = stream.items.findIndex((i) => i.id === fromId);
  const b = stream.items.findIndex((i) => i.id === toId);
  if (a < 0 || b < 0) return false;
  for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) if (isBreak(stream.items[i])) return true;
  return false;
}
