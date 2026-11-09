/**
 * Serving files from the storage directory: tile pyramids and originals.
 * Only `tiles/...` and `images/...` are reachable; the archives and anything
 * else under the storage root are not. Pages belong to the public registry,
 * so no authentication is needed here.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { StoragePathError, safeJoin, storageDir } from '$lib/server/images/storage';

export type MediaArea = 'tiles' | 'images';

const CONTENT_TYPES: Record<string, string> = {
  dzi: 'application/xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/** Tiles never change once written; an original is replaced in place by a new upload. */
const CACHE_CONTROL: Record<MediaArea, string> = {
  tiles: 'public, max-age=31536000, immutable',
  images: 'public, max-age=3600',
};

export interface MediaKind {
  area: MediaArea;
  contentType: string;
  cacheControl: string;
}

/**
 * Decides whether a storage-relative path may be served and how. Pure, so it
 * can be tested without a filesystem. Returns null for anything outside the
 * two areas or with a file type we do not serve.
 */
export function classifyMediaPath(relativePath: string): MediaKind | null {
  const match = /^(tiles|images)\/(.+)$/.exec(relativePath);
  if (!match) return null;
  const area = match[1] as MediaArea;
  const file = match[2];
  const dot = file.lastIndexOf('.');
  if (dot < 0) return null;
  const contentType = CONTENT_TYPES[file.slice(dot + 1).toLowerCase()];
  if (!contentType) return null;
  return { area, contentType, cacheControl: CACHE_CONTROL[area] };
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/**
 * Answers a request for `/media/<relativePath>`. 404 for anything that is not
 * a servable file inside the storage root; 304 when the client's ETag matches.
 */
export async function serveStorageFile(
  relativePath: string,
  request: Pick<Request, 'method' | 'headers'>,
  root = storageDir(),
): Promise<Response> {
  const kind = classifyMediaPath(relativePath);
  if (!kind) return notFound();

  let absolute: string;
  try {
    absolute = safeJoin(root, relativePath);
  } catch (error) {
    if (error instanceof StoragePathError) return notFound();
    throw error;
  }

  let info;
  try {
    info = await stat(absolute);
  } catch {
    return notFound();
  }
  if (!info.isFile()) return notFound();

  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = new Headers({
    'content-type': kind.contentType,
    'cache-control': kind.cacheControl,
    etag,
    'last-modified': info.mtime.toUTCString(),
  });

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-length', String(info.size));
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  const body = Readable.toWeb(createReadStream(absolute)) as ReadableStream;
  return new Response(body, { status: 200, headers });
}
