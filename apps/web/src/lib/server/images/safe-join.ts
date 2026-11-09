/**
 * Joining a storage-relative path onto a root without leaving it: needed
 * by the server and by the archive, which also runs from the command line.
 */

import path from 'node:path';

export class StoragePathError extends Error {
  readonly code = 'invalid-path';
  constructor(message: string) {
    super(message);
    this.name = 'StoragePathError';
  }
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
