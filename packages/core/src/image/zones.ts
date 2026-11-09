/**
 * Zones: regions of a page image linked to tokens. Coordinates are fractions
 * of the image's width and height, so they survive any resizing.
 */

import type { Id } from '../stream/items.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point as fractions of the image: [x, y]. */
export type Point = [number, number];

export interface ZoneGeometry {
  rect?: Rect;
  polygon?: Point[];
  /**
   * Degrees clockwise the rectangle is turned about its centre, as TEI's
   * zone@rotate: a word on a sloping line. The turn is of the image as seen,
   * in pixels, not of the fractions.
   */
  rotate?: number;
}

/** A zone as an importer produces it, before it is stored: tokens by id, geometry, the line it belongs to. */
export interface ImportedZone {
  tokenIds: Id[];
  geometry: ZoneGeometry;
  /** Index of the line (in the imported stream's lines) the zone belongs to, when known. */
  lineIndex?: number;
  /** The text the source gave for the zone, for checking. */
  text?: string;
  /** A non-textual feature the zone marks, when it has no tokens. */
  feature?: { kind: string; description?: string };
}

export function boundingRect(polygon: Point[]): Rect {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

/** The corners of a rectangle turned by `rotate` degrees clockwise about its centre, as fractions; `aspect` is the image's height over its width. */
export function rotatedCorners(rect: Rect, rotate: number, aspect: number): Point[] {
  const a = (rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // In units of the image's width on both axes, where a turn keeps its shape.
  const cx = rect.x + rect.w / 2;
  const cy = (rect.y + rect.h / 2) * aspect;
  const hw = rect.w / 2;
  const hh = (rect.h * aspect) / 2;
  const corner = (dx: number, dy: number): Point => [cx + dx * cos - dy * sin, (cy + dx * sin + dy * cos) / aspect];
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

/** The rectangle a zone stands in: a polygon's bounds, or the rectangle as drawn before any turn (its centre is the same). */
export function rectOf(zone: ZoneGeometry): Rect | null {
  if (zone.rect) return zone.rect;
  if (zone.polygon && zone.polygon.length > 0) return boundingRect(zone.polygon);
  return null;
}
