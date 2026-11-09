/**
 * Uploaded page images: validation, the original on disk, and the Deep Zoom
 * pyramid OpenSeadragon reads. Everything goes through sharp, which also
 * decides what a file really is (the browser's claimed MIME type is not
 * trusted).
 */

import sharp from 'sharp';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MAX_UPLOAD_BYTES } from '$lib/components/pages/files';
import {
  absolutePath,
  dziPath,
  ensureDir,
  imageDir,
  originalPath,
  storageDir,
  tilesDir,
} from '$lib/server/images/storage';

/** Formats an upload may have, with the extension the original is stored under. */
export const ACCEPTED_FORMATS = {
  jpeg: 'jpg',
  png: 'png',
  tiff: 'tif',
  webp: 'webp',
} as const;

export type AcceptedFormat = keyof typeof ACCEPTED_FORMATS;

export { DEFAULT_MAX_UPLOAD_BYTES };

export const TILE_SIZE = 512;
export const TILE_OVERLAP = 1;
export const TILE_QUALITY = 85;

export type UploadErrorCode = 'too-large' | 'unsupported-type' | 'unreadable';

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface ImageInfo {
  /** Width as displayed, after EXIF orientation. */
  width: number;
  height: number;
  /** sharp's format name: jpeg, png, tiff, webp, gif, ... */
  format: string;
}

export interface TileResult {
  /** Path of the .dzi relative to the storage root. */
  dziPath: string;
  width: number;
  height: number;
}

export interface AcceptedUpload extends TileResult {
  /** Path of the original relative to the storage root. */
  imagePath: string;
  format: AcceptedFormat;
  bytes: number;
}

export interface StorageOptions {
  /** Storage root; the configured STORAGE_DIR when omitted. Tests pass a temporary folder. */
  root?: string;
}

/** Reads width, height and format from a file path or a buffer. Throws when sharp cannot read it. */
export async function probeImage(input: string | Buffer): Promise<ImageInfo> {
  const meta = await sharp(input).metadata();
  const oriented = meta.autoOrient;
  let width = oriented?.width ?? meta.width ?? 0;
  let height = oriented?.height ?? meta.height ?? 0;
  if (!oriented && (meta.orientation ?? 1) >= 5) {
    [width, height] = [height, width];
  }
  if (width <= 0 || height <= 0) throw new Error('Image has no dimensions');
  return { width, height, format: meta.format ?? 'unknown' };
}

/**
 * Writes a Deep Zoom pyramid for the image at `original` under tiles/<pageId>:
 * `image.dzi` beside `image_files/<level>/<x>_<y>.jpeg`. Tiles are JPEG at
 * quality 85, 512 px with a one pixel overlap. An existing pyramid is replaced.
 */
export async function makeTiles(
  original: string,
  pageId: string,
  options: StorageOptions = {},
): Promise<TileResult> {
  const root = options.root ?? storageDir();
  const dir = absolutePath(tilesDir(pageId), root);
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);
  const info = await sharp(original)
    .rotate()
    .jpeg({ quality: TILE_QUALITY })
    .tile({ size: TILE_SIZE, overlap: TILE_OVERLAP, layout: 'dz' })
    // sharp appends .dzi itself and writes <name>_files beside it.
    .toFile(path.join(dir, 'image'));
  return { dziPath: dziPath(pageId), width: info.width, height: info.height };
}

function sizeOf(file: File | Buffer | Uint8Array): number {
  return file instanceof Uint8Array ? file.byteLength : file.size;
}

async function bytesOf(file: File | Buffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(file)) return file;
  if (file instanceof Uint8Array) return Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  return Buffer.from(await file.arrayBuffer());
}

/**
 * Takes an upload for a page: checks the size limit, sniffs the format with
 * sharp (jpeg, png, tiff or webp), stores the original under images/<pageId>
 * and builds the pyramid under tiles/<pageId>. Anything the page had before
 * is replaced. Throws UploadError with a code the caller can translate.
 */
export async function acceptUpload(
  file: File | Buffer | Uint8Array,
  pageId: string,
  options: StorageOptions & { maxBytes?: number } = {},
): Promise<AcceptedUpload> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const bytes = sizeOf(file);
  if (bytes > maxBytes) {
    throw new UploadError(
      'too-large',
      `The file is ${bytes} bytes; the limit is ${maxBytes} bytes.`,
    );
  }
  if (bytes === 0) throw new UploadError('unreadable', 'The file is empty.');

  const buffer = await bytesOf(file);
  let info: ImageInfo;
  try {
    info = await probeImage(buffer);
  } catch {
    throw new UploadError('unreadable', 'The file could not be read as an image.');
  }
  if (!(info.format in ACCEPTED_FORMATS)) {
    throw new UploadError(
      'unsupported-type',
      `Images must be JPEG, PNG, TIFF or WebP; this is ${info.format}.`,
    );
  }
  const format = info.format as AcceptedFormat;

  const root = options.root ?? storageDir();
  const dir = absolutePath(imageDir(pageId), root);
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);
  const imagePath = originalPath(pageId, ACCEPTED_FORMATS[format]);
  const absolute = absolutePath(imagePath, root);
  await writeFile(absolute, buffer);

  const tiles = await makeTiles(absolute, pageId, { root });
  return { ...tiles, imagePath, format, bytes };
}
