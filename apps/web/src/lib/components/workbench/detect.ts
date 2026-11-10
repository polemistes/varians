/**
 * Reading a region of a page image in the browser, for finding its lines
 * with the projection profile: a IIIF service is asked for the
 * region itself; an uploaded original is drawn into a canvas once and cut.
 * Returns null when the image cannot be read (a server without CORS taints
 * the canvas); the caller then divides evenly.
 */

import type { Rect } from '@varians/core';
import { detectLines } from '$lib/facsimile/layout';

const MAX_SIDE = 1600;
const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    });
    images.set(url, pending);
    pending.catch(() => images.delete(url));
  }
  return pending;
}

function pct(v: number): string {
  return (Math.max(0, Math.min(1, v)) * 100).toFixed(4).replace(/\.?0+$/, '');
}

/** The pixels of a region of the page (fractions of the image), at most MAX_SIDE on its longer side. */
export async function regionPixels(image: { kind: 'file' | 'iiif'; url: string }, region: Rect): Promise<ImageData | null> {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    if (image.kind === 'iiif') {
      const url = `${image.url}/pct:${pct(region.x)},${pct(region.y)},${pct(region.w)},${pct(region.h)}/!${MAX_SIDE},${MAX_SIDE}/0/default.jpg`;
      const img = await loadImage(url);
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      context.drawImage(img, 0, 0);
    } else {
      const img = await loadImage(image.url);
      const sx = region.x * img.naturalWidth;
      const sy = region.y * img.naturalHeight;
      const sw = region.w * img.naturalWidth;
      const sh = region.h * img.naturalHeight;
      const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      context.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

/** The text lines inside a box of the page, as fractions of the whole image; null when the image cannot be read. */
export async function linesInBox(image: { kind: 'file' | 'iiif'; url: string } | null, box: Rect): Promise<Rect[] | null> {
  if (!image) return null;
  const pixels = await regionPixels(image, box);
  if (!pixels) return null;
  const found = detectLines(pixels);
  return found.map((r) => ({ x: box.x + r.x * box.w, y: box.y + r.y * box.h, w: r.w * box.w, h: r.h * box.h }));
}
