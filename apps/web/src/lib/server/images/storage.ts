/**
 * Where uploaded page images and their tile pyramids live on disk.
 *
 * Layout under the storage directory (STORAGE_DIR):
 *
 *   images/<pageId>/original.<ext>    the upload as it was received
 *   tiles/<pageId>/image.dzi          Deep Zoom descriptor
 *   tiles/<pageId>/image_files/...    the pyramid, one folder per level
 *
 * Paths returned by the helpers are relative to the storage root and use
 * forward slashes, so they can be stored in the database and used in URLs
 * (/media/<path>). `absolutePath` turns one into a path on disk and refuses
 * anything that would leave the root.
 */

import { env } from '$env/dynamic/private';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Used when STORAGE_DIR is not set: the `storage` folder at the root of the repository, which git ignores (the app runs from apps/web). */
export const DEFAULT_STORAGE_DIR = '../../storage';

/** Page ids are ULIDs; be strict so an id can never carry path syntax. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EXT_PATTERN = /^[a-z0-9]{1,8}$/;

export class StoragePathError extends Error {
  readonly code = 'invalid-path';
  constructor(message: string) {
    super(message);
    this.name = 'StoragePathError';
  }
}

/**
 * Resolves the configured storage directory. A relative value is taken
 * relative to the working directory of the process (apps/web in development,
 * so the `../../storage` of .env lands beside the repository's packages).
 */
export function resolveStorageDir(value: string | undefined, cwd = process.cwd()): string {
  const dir = value && value.trim() !== '' ? value.trim() : DEFAULT_STORAGE_DIR;
  return path.resolve(cwd, dir);
}

/** The storage root for this process, from STORAGE_DIR. */
export function storageDir(): string {
  return resolveStorageDir(env.STORAGE_DIR);
}

export function assertPageId(pageId: string): void {
  if (!ID_PATTERN.test(pageId)) throw new StoragePathError(`Not a valid page id: ${pageId}`);
}

function assertExtension(ext: string): void {
  if (!EXT_PATTERN.test(ext)) throw new StoragePathError(`Not a valid file extension: ${ext}`);
}

/** `images/<pageId>`: the folder holding a page's original. */
export function imageDir(pageId: string): string {
  assertPageId(pageId);
  return `images/${pageId}`;
}

/** `images/<pageId>/original.<ext>` */
export function originalPath(pageId: string, ext: string): string {
  assertExtension(ext);
  return `${imageDir(pageId)}/original.${ext}`;
}

/** `tiles/<pageId>`: the folder holding a page's Deep Zoom pyramid. */
export function tilesDir(pageId: string): string {
  assertPageId(pageId);
  return `tiles/${pageId}`;
}

/** `tiles/<pageId>/image.dzi`: the descriptor the viewer opens. */
export function dziPath(pageId: string): string {
  return `${tilesDir(pageId)}/image.dzi`;
}

/**
 * Joins a relative path onto a root and returns the absolute path, refusing
 * anything that could escape the root: absolute paths, `..` and `.` segments,
 * empty segments, backslashes and NUL bytes. The result is guaranteed to lie
 * strictly inside `root`.
 */
export function safeJoin(root: string, relative: string): string {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new StoragePathError('Empty path');
  }
  if (relative.includes('\0') || relative.includes('\\')) {
    throw new StoragePathError('Path contains forbidden characters');
  }
  if (relative.startsWith('/')) {
    throw new StoragePathError('Absolute paths are not allowed');
  }
  const segments = relative.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new StoragePathError(`Path segment not allowed: "${segment}"`);
    }
  }
  const absoluteRoot = path.resolve(root);
  const joined = path.resolve(absoluteRoot, ...segments);
  if (!joined.startsWith(absoluteRoot + path.sep)) {
    throw new StoragePathError('Path leaves the storage directory');
  }
  return joined;
}

/** The absolute path of a storage-relative path, inside `root` (the configured storage dir by default). */
export function absolutePath(relative: string, root = storageDir()): string {
  return safeJoin(root, relative);
}

export async function ensureDir(absoluteDir: string): Promise<void> {
  await mkdir(absoluteDir, { recursive: true });
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exchanges the files of two pages, when an image moves to another page: what
 * lay under the first page's id now lies under the second's and the other way
 * round. A page without files simply receives the other's. Done folder by
 * folder (originals, then tiles) through a temporary name beside them.
 */
export async function swapPageFiles(a: string, b: string, root = storageDir()): Promise<void> {
  assertPageId(a);
  assertPageId(b);
  if (a === b) return;
  const temporary = `${a}_swap`;
  for (const dir of [imageDir, tilesDir]) {
    const first = absolutePath(dir(a), root);
    const second = absolutePath(dir(b), root);
    const holding = absolutePath(dir(temporary), root);
    await rm(holding, { recursive: true, force: true });
    const [hasFirst, hasSecond] = await Promise.all([exists(first), exists(second)]);
    if (hasFirst) await rename(first, holding);
    if (hasSecond) await rename(second, first);
    if (hasFirst) await rename(holding, second);
  }
}

/** Removes a page's original and tiles, if present. */
export async function removePageFiles(pageId: string, root = storageDir()): Promise<void> {
  await rm(absolutePath(imageDir(pageId), root), { recursive: true, force: true });
  await rm(absolutePath(tilesDir(pageId), root), { recursive: true, force: true });
}
