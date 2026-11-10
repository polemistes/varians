/**
 * The format specification as the site serves it: docs/formats
 * read-only at /formats/<version>/, so that the `$id` of every schema
 * resolves on every installation. Only the current version is served.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { FORMAT_VERSION, formatsDir } from './archive/archive.ts';

const TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.bib': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.odd': 'application/xml; charset=utf-8',
  '.rng': 'application/xml; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/** Files at the top of docs/formats that are served; everything else there is the build's business. */
const TOP_FILES = new Set([
  'specification.md',
  'CHANGELOG.md',
  'tei-subset.md',
  'varians.odd',
  'varians.rng',
  'BUILD.md',
  'LICENSE',
  'README.md',
]);

export function isCurrentVersion(version: string): boolean {
  return version === String(FORMAT_VERSION);
}

/**
 * The file a path under /formats/<version>/ names, or null. A schema's
 * address is /formats/2/<name>.schema.json; other files keep their place in
 * docs/formats, and the example archive is under example/.
 */
export function resolveFormatFile(relative: string): string | null {
  const root = formatsDir();
  if (!root) return null;
  if (
    relative.includes('\0') ||
    relative.split('/').some((part) => part === '..' || part.startsWith('.'))
  )
    return null;
  let target: string;
  if (/^[a-z0-9-]+\.schema\.json$/u.test(relative)) target = path.join(root, 'schemas', relative);
  else if (TOP_FILES.has(relative)) target = path.join(root, relative);
  else if (relative.startsWith('example/')) target = path.join(root, relative);
  else return null;
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) return null;
  return existsSync(resolved) ? resolved : null;
}

export function contentTypeOf(file: string): string {
  if (file.endsWith('.schema.json')) return 'application/schema+json; charset=utf-8';
  if (path.basename(file) === 'LICENSE') return 'text/plain; charset=utf-8';
  return TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export async function readFormatFile(file: string): Promise<{ body: Buffer; type: string } | null> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  return { body: await readFile(file), type: contentTypeOf(file) };
}

/** The specification's Markdown and the schemas' names, for the page at /formats/<version>. */
export async function specification(): Promise<{
  markdown: string;
  schemas: string[];
  hasOdd: boolean;
  hasExample: boolean;
} | null> {
  const root = formatsDir();
  if (!root) return null;
  const markdown = await readFile(path.join(root, 'specification.md'), 'utf8').catch(() => null);
  if (markdown === null) return null;
  const schemas = (await readdir(path.join(root, 'schemas')).catch(() => [] as string[]))
    .filter((n) => n.endsWith('.schema.json'))
    .sort();
  return {
    markdown,
    schemas,
    hasOdd: existsSync(path.join(root, 'varians.odd')),
    hasExample: existsSync(path.join(root, 'example')),
  };
}
