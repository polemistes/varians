/**
 * Boxes edited together: the word boxes of one or more lines,
 * moved as one, stretched or squeezed as one, turned as one, or one box
 * resized with the boxes after it on its line following without changing
 * their size. Pure functions.
 *
 * The editing happens in the group's own frame: turned with its lines (a
 * sloping line runs along the frame's x axis) and measured in widths of
 * the image on both axes, so that a turn keeps shapes. A box's rectangle is
 * stored in fractions of the image, as drawn before its turn about its
 * centre (ZoneGeometry.rotate).
 */

import type { Point, Rect, ZoneGeometry } from '@varians/core';
import { applyBoundary, clampBoundary, MIN_WORD_WIDTH, type Direction } from './dividers';
import { normalDegrees } from './geometry';

export interface GroupBox {
  /** The zone. */
  id: string;
  rect: Rect;
  /** The line of the text the box belongs to, from 0 in the group. */
  line: number;
  /** Its place on the line in reading order. */
  at: number;
  direction: Direction;
  /** The word as written, for its label. */
  text?: string;
  /** Degrees clockwise the box is turned about its centre. */
  rotate?: number;
}

/** Where boxes may go, in the units they are given in. */
export interface Limits {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The image, in fractions. */
export const IMAGE: Limits = { x0: 0, x1: 1, y0: 0, y1: 1 };
const UNBOUNDED: Limits = { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity };

/** Least height a box keeps when the group is squeezed. */
export const MIN_BOX_HEIGHT = 0.002;

/** The rectangle around all the boxes. */
export function boundsOf(rects: Rect[]): Rect {
  let x = Infinity;
  let y = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x = Math.min(x, r.x);
    y = Math.min(y, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return rects.length ? { x, y, w: x2 - x, h: y2 - y } : { x: 0, y: 0, w: 0, h: 0 };
}

/** Every box moved by the same amount, kept within the limits as a whole. */
export function moveBoxes(rects: Rect[], dx: number, dy: number, limits: Limits = IMAGE): Rect[] {
  const b = boundsOf(rects);
  const mx = Math.min(Math.max(dx, limits.x0 - b.x), limits.x1 - (b.x + b.w));
  const my = Math.min(Math.max(dy, limits.y0 - b.y), limits.y1 - (b.y + b.h));
  return rects.map((r) => ({ ...r, x: r.x + mx, y: r.y + my }));
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * The boxes after one side of the rectangle around them is dragged to
 * `value`: every box keeps its place and size relative to the whole, so a
 * line stretches or squeezes evenly. The opposite side stays.
 */
export function scaleBoxes(
  rects: Rect[],
  side: Side,
  value: number,
  limits: Limits = IMAGE,
): Rect[] {
  const from = boundsOf(rects);
  const to = { ...from };
  const v =
    side === 'left' || side === 'right'
      ? Math.min(limits.x1, Math.max(limits.x0, value))
      : Math.min(limits.y1, Math.max(limits.y0, value));
  const minW = MIN_WORD_WIDTH * rects.length;
  const minH = MIN_BOX_HEIGHT;
  if (side === 'right') to.w = Math.max(minW, v - from.x);
  else if (side === 'left') {
    const right = from.x + from.w;
    to.x = Math.min(v, right - minW);
    to.w = right - to.x;
  } else if (side === 'bottom') to.h = Math.max(minH, v - from.y);
  else {
    const bottom = from.y + from.h;
    to.y = Math.min(v, bottom - minH);
    to.h = bottom - to.y;
  }
  const kx = from.w > 0 ? to.w / from.w : 1;
  const ky = from.h > 0 ? to.h / from.h : 1;
  return rects.map((r) => ({
    x: to.x + (r.x - from.x) * kx,
    y: to.y + (r.y - from.y) * ky,
    w: r.w * kx,
    h: r.h * ky,
  }));
}

/** Where a box ends in reading order: its right side left to right, its left side right to left. */
export function trailingEdge(rect: Rect, direction: Direction): number {
  return direction === 'ltr' ? rect.x + rect.w : rect.x;
}

/**
 * One box's end dragged to `edge`: the box grows or shrinks there, and the
 * boxes after it on the same line move by as much, keeping their size.
 * Boxes before it, and on other lines, stay. Nothing is pushed off the image.
 * Returns the new rectangles of the boxes that changed, by id.
 */
export function rippleResize(
  boxes: GroupBox[],
  id: string,
  edge: number,
  minWidth = MIN_WORD_WIDTH,
  limits: Limits = IMAGE,
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const box = boxes.find((b) => b.id === id);
  if (!box) return out;
  const after = boxes.filter((b) => b.line === box.line && b.at > box.at);
  const r = box.rect;
  if (box.direction === 'ltr') {
    // Growth to the right; at most what the furthest box leaves before the image's edge.
    const furthest = Math.max(r.x + r.w, ...after.map((b) => b.rect.x + b.rect.w));
    let delta = Math.max(minWidth, edge - r.x) - r.w;
    delta = Math.min(delta, limits.x1 - furthest);
    if (delta === 0) return out;
    out.set(box.id, { ...r, w: r.w + delta });
    for (const b of after) out.set(b.id, { ...b.rect, x: b.rect.x + delta });
  } else {
    // Growth to the left.
    const furthest = Math.min(r.x, ...after.map((b) => b.rect.x));
    let delta = r.x + r.w - Math.min(edge, r.x + r.w - minWidth) - r.w;
    delta = Math.min(delta, furthest - limits.x0);
    if (delta === 0) return out;
    out.set(box.id, { ...r, x: r.x - delta, w: r.w + delta });
    for (const b of after) out.set(b.id, { ...b.rect, x: b.rect.x - delta });
  }
  return out;
}

/** Neighbouring boxes on one line, in reading order: where a boundary can be moved. */
export function boundaryPairs(boxes: GroupBox[]): [GroupBox, GroupBox][] {
  const ordered = [...boxes].sort((a, b) => a.line - b.line || a.at - b.at);
  const out: [GroupBox, GroupBox][] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    if (a.line === b.line) out.push([a, b]);
  }
  return out;
}

/**
 * The boundary between two neighbouring boxes moved to `x`: the first ends
 * there and the second begins there, each keeping some width. Nothing else
 * changes.
 */
export function moveBoundary(
  a: GroupBox,
  b: GroupBox,
  x: number,
  minWidth = MIN_WORD_WIDTH,
): Map<string, Rect> {
  const at = clampBoundary(x, a.rect, b.rect, a.direction, minWidth);
  const [ra, rb] = applyBoundary(a.rect, b.rect, at, a.direction);
  return new Map([
    [a.id, ra],
    [b.id, rb],
  ]);
}

// The group's frame

export interface Frame {
  /** The image's height over its width. */
  aspect: number;
  /** Degrees clockwise the frame is turned: the slope of its lines. */
  angle: number;
  /** What it turns about, in widths of the image. */
  pivot: Point;
}

function turn([x, y]: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [x * cos - y * sin, x * sin + y * cos];
}

function centre(rect: Rect, aspect: number): Point {
  return [rect.x + rect.w / 2, (rect.y + rect.h / 2) * aspect];
}

/** The frame of a group: turned as its boxes are (their mean turn), about the middle of their centres. */
export function frameOf(boxes: GroupBox[], aspect: number): Frame {
  if (boxes.length === 0) return { aspect, angle: 0, pivot: [0, 0] };
  const angle = boxes.reduce((sum, b) => sum + (b.rotate ?? 0), 0) / boxes.length;
  const centres = boxes.map((b) => centre(b.rect, aspect));
  const xs = centres.map((c) => c[0]);
  const ys = centres.map((c) => c[1]);
  const pivot: Point = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  return { aspect, angle: Math.abs(angle) < 1e-9 ? 0 : angle, pivot };
}

/** A point of the image (fractions) in the frame. */
export function pointToFrame([x, y]: Point, frame: Frame): Point {
  const [dx, dy] = turn([x - frame.pivot[0], y * frame.aspect - frame.pivot[1]], -frame.angle);
  return [frame.pivot[0] + dx, frame.pivot[1] + dy];
}

/** A point of the frame on the image (fractions). */
export function pointFromFrame([x, y]: Point, frame: Frame): Point {
  const [dx, dy] = turn([x - frame.pivot[0], y - frame.pivot[1]], frame.angle);
  return [frame.pivot[0] + dx, (frame.pivot[1] + dy) / frame.aspect];
}

/** A box's rectangle (fractions, before its turn) as it stands in the frame. */
export function rectToFrame(rect: Rect, frame: Frame): Rect {
  const [cx, cy] = pointToFrame([rect.x + rect.w / 2, rect.y + rect.h / 2], frame);
  const h = rect.h * frame.aspect;
  return { x: cx - rect.w / 2, y: cy - h / 2, w: rect.w, h };
}

/** A rectangle of the frame as a box's rectangle (fractions, before its turn). */
export function rectFromFrame(rect: Rect, frame: Frame): Rect {
  const [cx, cy] = pointFromFrame([rect.x + rect.w / 2, rect.y + rect.h / 2], frame);
  const h = rect.h / frame.aspect;
  return { x: cx - rect.w / 2, y: cy - h / 2, w: rect.w, h };
}

/** Where boxes may go in the frame: the image while it is not turned; anywhere once it is. */
export function frameLimits(frame: Frame): Limits {
  return frame.angle === 0 ? { x0: 0, x1: 1, y0: 0, y1: frame.aspect } : UNBOUNDED;
}

/** The boxes as they stand in the frame. */
export function boxesInFrame(boxes: GroupBox[], frame: Frame): GroupBox[] {
  return boxes.map((b) => ({ ...b, rect: rectToFrame(b.rect, frame) }));
}

/** New rectangles in the frame as the zones' geometry, each box keeping its turn. */
export function geometriesFromFrame(
  boxes: GroupBox[],
  rects: Map<string, Rect>,
  frame: Frame,
): Map<string, ZoneGeometry> {
  const out = new Map<string, ZoneGeometry>();
  for (const b of boxes) {
    const r = rects.get(b.id);
    if (!r) continue;
    const rect = rectFromFrame(r, frame);
    out.set(b.id, b.rotate ? { rect, rotate: b.rotate } : { rect });
  }
  return out;
}

/** Every box turned by `degrees` clockwise about the frame's pivot: the lines turn as one, and each box with them. */
export function turnBoxes(
  boxes: GroupBox[],
  frame: Frame,
  degrees: number,
): Map<string, ZoneGeometry> {
  const out = new Map<string, ZoneGeometry>();
  for (const b of boxes) {
    const [cx, cy] = centre(b.rect, frame.aspect);
    const [dx, dy] = turn([cx - frame.pivot[0], cy - frame.pivot[1]], degrees);
    const x = frame.pivot[0] + dx;
    const y = (frame.pivot[1] + dy) / frame.aspect;
    const rect = { x: x - b.rect.w / 2, y: y - b.rect.h / 2, w: b.rect.w, h: b.rect.h };
    const rotate = normalDegrees((b.rotate ?? 0) + degrees);
    out.set(b.id, rotate ? { rect, rotate } : { rect });
  }
  return out;
}
