/**
 * Between our zone geometry (fractions of the image, PLAN 4.2) and the
 * image-pixel shapes Annotorious uses. Pure; tested without a browser.
 */

import type { Point, Rect, ZoneGeometry } from '@varians/core';
import { boundingRect } from '@varians/core';
import type { ImageAnnotation, Shape, ShapeType } from '@annotorious/openseadragon';
import type { FacsimileZone, ImageSize } from './types';

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round(v: number): number {
  // Six decimals: a millionth of the image, far below a pixel on any scan.
  return Math.round(v * 1e6) / 1e6;
}

function boundsOf(points: [number, number][]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Our geometry as an Annotorious selector in image pixels, or null when the geometry is empty. */
export function geometryToSelector(geometry: ZoneGeometry, size: ImageSize): Shape | null {
  const { width: W, height: H } = size;
  if (geometry.polygon && geometry.polygon.length >= 3) {
    const points = geometry.polygon.map(([x, y]) => [x * W, y * H] as [number, number]);
    return {
      type: 'POLYGON' as ShapeType.POLYGON,
      geometry: { points, bounds: boundsOf(points) },
    } as Shape;
  }
  if (geometry.rect) {
    const r = geometry.rect;
    const x = r.x * W;
    const y = r.y * H;
    const w = r.w * W;
    const h = r.h * H;
    const rot = ((geometry.rotate ?? 0) * Math.PI) / 180;
    const bounds = rot ? boundsOf(rotatedCorners(x, y, w, h, rot)) : { minX: x, minY: y, maxX: x + w, maxY: y + h };
    return {
      type: 'RECTANGLE' as ShapeType.RECTANGLE,
      geometry: rot ? { x, y, w, h, rot, bounds } : { x, y, w, h, bounds },
    } as unknown as Shape;
  }
  return null;
}

/** The four corners of a rectangle rotated by `rot` radians around its centre. */
function rotatedCorners(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
): [number, number][] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const corner = (px: number, py: number): [number, number] => {
    const dx = px - cx;
    const dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  return [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)];
}

function toFractionPoints(points: [number, number][], size: ImageSize): Point[] {
  return points.map(([x, y]) => [round(clamp01(x / size.width)), round(clamp01(y / size.height))]);
}

function rectFromBounds(b: Bounds, size: ImageSize): Rect {
  const x = clamp01(b.minX / size.width);
  const y = clamp01(b.minY / size.height);
  const x2 = clamp01(b.maxX / size.width);
  const y2 = clamp01(b.maxY / size.height);
  return { x: round(x), y: round(y), w: round(x2 - x), h: round(y2 - y) };
}

/** An angle in degrees as one between -180 and 180, rounded to a thousandth. */
export function normalDegrees(degrees: number): number {
  let d = degrees % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d * 1000) / 1000;
}

/**
 * An Annotorious selector (image pixels) as our geometry. Rectangles stay
 * rectangles, a turned one with its turn; polygons keep their points;
 * anything else is reduced to its bounding rectangle. Returns null for
 * degenerate shapes (no area).
 */
export function selectorToGeometry(selector: Shape, size: ImageSize): ZoneGeometry | null {
  const g = selector.geometry as Record<string, unknown> & { bounds: Bounds };
  switch (String(selector.type)) {
    case 'RECTANGLE': {
      const x = g.x as number;
      const y = g.y as number;
      const w = g.w as number;
      const h = g.h as number;
      if (!(w > 0 && h > 0)) return null;
      const rot = (g.rot as number | undefined) ?? 0;
      const rect = { x: round(x / size.width), y: round(y / size.height), w: round(w / size.width), h: round(h / size.height) };
      // A turned rectangle stays a rectangle, with its turn in degrees clockwise.
      if (Math.abs(rot) > 1e-6) return { rect, rotate: normalDegrees((rot * 180) / Math.PI) };
      return { rect: rectFromBounds({ minX: x, minY: y, maxX: x + w, maxY: y + h }, size) };
    }
    case 'POLYGON': {
      const points = g.points as [number, number][];
      if (!points || points.length < 3) return null;
      const polygon = toFractionPoints(points, size);
      const box = boundingRect(polygon);
      if (!(box.w > 0 && box.h > 0)) return null;
      return { polygon };
    }
    case 'MULTIPOLYGON': {
      const polygons = g.polygons as { rings: { points: [number, number][] }[] }[] | undefined;
      const ring = polygons?.[0]?.rings?.[0]?.points;
      if (ring && ring.length >= 3) return { polygon: toFractionPoints(ring, size) };
      return fallbackRect(g.bounds, size);
    }
    default:
      return fallbackRect(g.bounds, size);
  }
}

function fallbackRect(bounds: Bounds | undefined, size: ImageSize): ZoneGeometry | null {
  if (!bounds) return null;
  const rect = rectFromBounds(bounds, size);
  return rect.w > 0 && rect.h > 0 ? { rect } : null;
}

/** A zone as the annotation Annotorious renders; its kind rides along in `properties`. */
export function zoneToAnnotation(zone: FacsimileZone, size: ImageSize): ImageAnnotation | null {
  const selector = geometryToSelector(zone.geometry, size);
  if (!selector) return null;
  return {
    id: zone.id,
    bodies: [],
    target: { annotation: zone.id, selector },
    properties: { kind: zone.kind ?? 'word' },
  } as ImageAnnotation;
}

function pointsEqual(a: Point[], b: Point[], eps: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > eps || Math.abs(a[i][1] - b[i][1]) > eps) return false;
  }
  return true;
}

/** True when two geometries describe the same shape within `eps` (fractions of the image). */
export function geometryEquals(
  a: ZoneGeometry | null,
  b: ZoneGeometry | null,
  eps = 1e-5,
): boolean {
  if (!a || !b) return a === b;
  const aPoly = a.polygon && a.polygon.length >= 3 ? a.polygon : null;
  const bPoly = b.polygon && b.polygon.length >= 3 ? b.polygon : null;
  if (aPoly || bPoly) return !!aPoly && !!bPoly && pointsEqual(aPoly, bPoly, eps);
  if (!a.rect || !b.rect) return a.rect === b.rect;
  if (Math.abs((a.rotate ?? 0) - (b.rotate ?? 0)) > 1e-3) return false;
  return (
    Math.abs(a.rect.x - b.rect.x) <= eps &&
    Math.abs(a.rect.y - b.rect.y) <= eps &&
    Math.abs(a.rect.w - b.rect.w) <= eps &&
    Math.abs(a.rect.h - b.rect.h) <= eps
  );
}

/** A rectangle grown by `factor` of its size on every side, kept inside the image. */
export function expandRect(rect: Rect, factor: number): Rect {
  const dx = rect.w * factor;
  const dy = rect.h * factor;
  const x = clamp01(rect.x - dx);
  const y = clamp01(rect.y - dy);
  const x2 = clamp01(rect.x + rect.w + dx);
  const y2 = clamp01(rect.y + rect.h + dy);
  return { x, y, w: x2 - x, h: y2 - y };
}
