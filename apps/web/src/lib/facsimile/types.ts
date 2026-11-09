/**
 * Shapes shared by the facsimile viewer, its overlays and the pages that use them.
 */

import type OpenSeadragon from 'openseadragon';
import type { Point, Rect, ZoneGeometry } from '@varians/core';

export type FacsimileSource =
  /** A Deep Zoom descriptor, as made by the server for uploads: /media/tiles/<pageId>/image.dzi */
  | { kind: 'dzi'; url: string }
  /** A IIIF Image API resource, by its info.json */
  | { kind: 'iiif'; infoUrl: string }
  /** One plain image; the viewer builds a pyramid in memory */
  | { kind: 'image'; url: string; width: number; height: number };

export type ZoneKind = 'word' | 'line' | 'feature';

export interface FacsimileZone {
  id: string;
  geometry: ZoneGeometry;
  tokenIds: string[];
  kind?: ZoneKind;
}

export type FacsimileMode = 'pan' | 'rect' | 'polygon';

export interface ImageSize {
  width: number;
  height: number;
}

/** A point in pixels relative to the viewer's element. */
export interface ElementPoint {
  x: number;
  y: number;
}

/** What the viewer hands to `onviewready` and to its children. */
export interface FacsimileApi {
  readonly viewer: OpenSeadragon.Viewer;
  /** The current image in pixels, once it is open. */
  readonly imageSize: ImageSize;
  /** Zooms so the zone fills most of the view. */
  fitTo(zoneId: string): void;
  /** Zooms so the rectangle (fractions of the image) fills most of the view. */
  zoomTo(rect: Rect): void;
  /** Shows the whole image. */
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Fractions of the image to pixels relative to the viewer element. */
  toElement(point: Point): ElementPoint;
  /** Pixels relative to the viewer element to fractions of the image. */
  fromElement(point: ElementPoint): Point;
  /** Calls `listener` whenever the view moves or resizes; returns the unsubscribe function. */
  onViewportChange(listener: () => void): () => void;
}
