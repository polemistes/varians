/**
 * Word dividers (PLAN 5.6): the boundary between two adjacent word boxes on
 * a line, dragged as one vertical line instead of resizing two boxes.
 * All values are fractions of the image width.
 */

import type { Rect } from '@varians/core';

export type Direction = 'ltr' | 'rtl';

/** Minimum width a word box keeps when its divider is dragged. */
export const MIN_WORD_WIDTH = 0.002;

/**
 * Where the boundary between `a` and its reading-order successor `b` stands:
 * halfway between the two facing edges, which is the shared edge itself when
 * the boxes meet.
 */
export function boundaryBetween(a: Rect, b: Rect, direction: Direction = 'ltr'): number {
  return direction === 'ltr' ? (a.x + a.w + b.x) / 2 : (a.x + b.x + b.w) / 2;
}

/** The boundaries between each adjacent pair of word boxes, in reading order (n - 1 values). */
export function boundariesOf(rects: Rect[], direction: Direction = 'ltr'): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < rects.length; i++)
    out.push(boundaryBetween(rects[i], rects[i + 1], direction));
  return out;
}

/** Keeps a dragged boundary where both words keep at least `minWidth`. */
export function clampBoundary(
  x: number,
  a: Rect,
  b: Rect,
  direction: Direction = 'ltr',
  minWidth = MIN_WORD_WIDTH,
): number {
  const [lo, hi] =
    direction === 'ltr'
      ? [a.x + minWidth, b.x + b.w - minWidth]
      : [b.x + minWidth, a.x + a.w - minWidth];
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * The two boxes after their boundary moves to `x`: for ltr the first word's
 * right edge and the second's left edge; for rtl the other way round.
 */
export function applyBoundary(
  a: Rect,
  b: Rect,
  x: number,
  direction: Direction = 'ltr',
): [Rect, Rect] {
  if (direction === 'ltr') {
    return [
      { ...a, w: x - a.x },
      { ...b, x, w: b.x + b.w - x },
    ];
  }
  return [
    { ...a, x, w: a.x + a.w - x },
    { ...b, w: x - b.x },
  ];
}
