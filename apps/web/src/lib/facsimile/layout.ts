/**
 * Mapping words to images, the geometric part: dividing a line box
 * into word boxes, and finding text lines on an image with a projection
 * profile. Pure functions; the caller supplies ImageData from a canvas, so
 * this runs in the browser on a downscaled copy of the page.
 */

import type { Rect } from '@varians/core';

export interface WordLike {
  text: string;
}

export interface DivideOptions {
  /** Share of one letter given to the gap between two words. Default 1. */
  space?: number;
}

const MARK = /\p{M}/u;

/** Rows must differ by at least this much (of 255) for anything to count as a line. */
const MIN_CONTRAST = 2;

/** Letters in a word: code points after NFC, combining marks not counted; at least 1. */
export function letterCount(text: string): number {
  let count = 0;
  for (const ch of text.normalize('NFC')) {
    if (/\s/u.test(ch) || MARK.test(ch)) continue;
    count += 1;
  }
  return Math.max(1, count);
}

/**
 * Divides a line box into one box per word, side by side, each as wide as the
 * word's share of letters plus half a space on either inner side, so adjacent
 * boxes meet at a boundary that can later be dragged as a divider. `words`
 * are in reading order; for `rtl` the first word takes the right end.
 */
export function divideLine(
  lineRect: Rect,
  words: WordLike[],
  direction: 'ltr' | 'rtl' = 'ltr',
  options: DivideOptions = {},
): Rect[] {
  const n = words.length;
  if (n === 0) return [];
  const space = Math.max(0, options.space ?? 1);
  const counts = words.map((w) => letterCount(w.text));
  const total = counts.reduce((a, b) => a + b, 0) + space * (n - 1);

  // Boundaries between word i and i + 1, as fractions along the reading direction.
  const edges: number[] = [0];
  let letters = 0;
  for (let i = 0; i < n - 1; i++) {
    letters += counts[i];
    edges.push((letters + space * i + space / 2) / total);
  }
  edges.push(1);

  return words.map((_, i) => {
    const a = edges[i];
    const b = edges[i + 1];
    const [from, to] = direction === 'ltr' ? [a, b] : [1 - b, 1 - a];
    return {
      x: lineRect.x + from * lineRect.w,
      y: lineRect.y,
      w: (to - from) * lineRect.w,
      h: lineRect.h,
    };
  });
}

/** What detectLines reads: the shape of a canvas ImageData (RGBA), or one grey channel. */
export interface GreyImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectLinesOptions {
  /**
   * The part of the image to look at, as fractions of it; the whole image by
   * default. Results are still fractions of the whole image. Use it to keep
   * margins, a facing page or a dark background out of the profile.
   */
  region?: Rect;
  /** A row counts as text when its darkness exceeds the region's mean darkness times this factor. Default 1. */
  threshold?: number;
  /** Bands separated by less than this (fraction of the image height) are merged. Default 0.004. */
  minGap?: number;
  /** Bands thinner than this (fraction of the image height) are dropped. Default 0.006. */
  minHeight?: number;
  /** Rows in the moving average that smooths the profile. Default 3. */
  smooth?: number;
  /** Space added above and below each band (fraction of the image height). Default 0.002. */
  padding?: number;
  /** Shrink each band horizontally to where its ink is. Default true. */
  tighten?: boolean;
}

function channelsOf(image: GreyImageData): number {
  const perPixel = image.data.length / (image.width * image.height);
  if (perPixel === 4 || perPixel === 3 || perPixel === 1) return perPixel;
  throw new Error('detectLines expects RGBA, RGB or single-channel image data');
}

/** Darkness of a pixel, 0 (white) to 255 (black), from the Rec. 601 luma of RGB. */
function darknessAt(data: GreyImageData['data'], index: number, channels: number): number {
  if (channels === 1) return 255 - data[index];
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  return 255 - (0.299 * r + 0.587 * g + 0.114 * b);
}

function movingAverage(values: Float64Array, window: number): Float64Array {
  const w = Math.max(1, Math.floor(window));
  if (w === 1) return values;
  const half = Math.floor(w / 2);
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= values.length) continue;
      sum += values[j];
      count += 1;
    }
    out[i] = sum / count;
  }
  return out;
}

function mean(values: Float64Array | number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

interface Band {
  start: number;
  end: number; // inclusive
}

/** Runs of indices where `values[i] > threshold`. */
function bandsAbove(values: Float64Array, threshold: number): Band[] {
  const bands: Band[] = [];
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    const on = values[i] > threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      bands.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) bands.push({ start, end: values.length - 1 });
  return bands;
}

function mergeClose(bands: Band[], minGap: number): Band[] {
  const merged: Band[] = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band.start - last.end - 1 < minGap) last.end = band.end;
    else merged.push({ ...band });
  }
  return merged;
}

/** Mean darkness per row (within the region's columns), the horizontal projection profile. */
export function rowProfile(image: GreyImageData, region?: Rect): Float64Array {
  const channels = channelsOf(image);
  const { x0, x1, y0, y1 } = regionPixels(image, region);
  const profile = new Float64Array(y1 - y0);
  const columns = x1 - x0;
  for (let y = y0; y < y1; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++)
      sum += darknessAt(image.data, (y * image.width + x) * channels, channels);
    profile[y - y0] = columns > 0 ? sum / columns : 0;
  }
  return profile;
}

function regionPixels(image: GreyImageData, region?: Rect) {
  const r = region ?? { x: 0, y: 0, w: 1, h: 1 };
  const x0 = clampInt(Math.floor(r.x * image.width), 0, image.width);
  const x1 = clampInt(Math.ceil((r.x + r.w) * image.width), x0, image.width);
  const y0 = clampInt(Math.floor(r.y * image.height), 0, image.height);
  const y1 = clampInt(Math.ceil((r.y + r.h) * image.height), y0, image.height);
  return { x0, x1, y0, y1 };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The horizontal span of ink in rows [start, end] (region-relative), or null when nothing stands out. */
function inkSpan(
  image: GreyImageData,
  channels: number,
  x0: number,
  x1: number,
  yStart: number,
  yEnd: number,
  threshold: number,
): { from: number; to: number } | null {
  const columns = x1 - x0;
  if (columns <= 0) return null;
  const profile = new Float64Array(columns);
  const rows = yEnd - yStart + 1;
  for (let x = x0; x < x1; x++) {
    let sum = 0;
    for (let y = yStart; y <= yEnd; y++)
      sum += darknessAt(image.data, (y * image.width + x) * channels, channels);
    profile[x - x0] = sum / rows;
  }
  const cut = mean(profile) * threshold;
  let from = -1;
  let to = -1;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > cut) {
      if (from < 0) from = i;
      to = i;
    }
  }
  if (from < 0 || to <= from) return null;
  return { from: x0 + from, to: x0 + to + 1 };
}

/**
 * Finds the text lines of a page as horizontal bands: rows darker than the
 * mean row are text, neighbouring text rows form a band, bands closer than
 * `minGap` are merged and bands thinner than `minHeight` are dropped. Each
 * band is then shrunk sideways to where its ink is. Returns one Rect per
 * line, top to bottom, as fractions of the whole image.
 */
export function detectLines(image: GreyImageData, options: DetectLinesOptions = {}): Rect[] {
  const {
    region,
    threshold = 1,
    minGap = 0.004,
    minHeight = 0.006,
    smooth = 3,
    padding = 0.002,
    tighten = true,
  } = options;
  if (image.width === 0 || image.height === 0) return [];
  const channels = channelsOf(image);
  const { x0, x1, y0, y1 } = regionPixels(image, region);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return [];

  const profile = movingAverage(rowProfile(image, region), smooth);
  // A flat profile (a blank area, or one shade all over) has no lines.
  let min = Infinity;
  let max = -Infinity;
  for (const v of profile) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < MIN_CONTRAST) return [];
  const cut = mean(profile) * threshold;
  const minGapRows = Math.max(1, Math.round(minGap * image.height));
  const minHeightRows = Math.max(1, Math.round(minHeight * image.height));
  const padRows = Math.round(padding * image.height);

  const bands = mergeClose(bandsAbove(profile, cut), minGapRows).filter(
    (b) => b.end - b.start + 1 >= minHeightRows,
  );

  return bands.map((band) => {
    const top = Math.max(y0, y0 + band.start - padRows);
    const bottom = Math.min(y1, y0 + band.end + 1 + padRows);
    let left = x0;
    let right = x1;
    if (tighten) {
      const span = inkSpan(image, channels, x0, x1, y0 + band.start, y0 + band.end, threshold);
      if (span) {
        const padCols = Math.round(padding * image.width);
        left = Math.max(x0, span.from - padCols);
        right = Math.min(x1, span.to + padCols);
      }
    }
    return {
      x: left / image.width,
      y: top / image.height,
      w: (right - left) / image.width,
      h: (bottom - top) / image.height,
    };
  });
}
