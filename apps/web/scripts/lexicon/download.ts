/**
 * The downloads of the lexicon build: over https, or over http only with a
 * SHA-256 to check the file against; a redirect that leaves https is
 * refused unless a checksum vouches for the file. The file is written
 * beside its destination as .part and renamed when it is complete and,
 * where a checksum is given, checked.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

export class DownloadError extends Error {}

export interface DownloadOptions {
  sha256?: string;
  fetch?: typeof fetch;
}

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** The 64 hexadecimal digits of a checksum, lower case, or an error for anything else. */
export function checksumGiven(sha256: string): string {
  const expected = sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(expected))
    throw new DownloadError('A SHA-256 is given as its 64 hexadecimal digits.');
  return expected;
}

export async function download(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const expected = options.sha256 === undefined ? undefined : checksumGiven(options.sha256);
  if (!/^https?:\/\//iu.test(url)) throw new DownloadError(`${url} is not an https address.`);
  if (!/^https:\/\//iu.test(url) && expected === undefined) {
    throw new DownloadError(
      `${url}: download over https, or give a SHA-256 to check a file fetched over http.`,
    );
  }
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(url);
  if (!response.ok || !response.body)
    throw new DownloadError(
      `${url}: the download failed, ${response.status} ${response.statusText}.`,
    );
  if (expected === undefined && response.url && !/^https:\/\//iu.test(response.url)) {
    throw new DownloadError(
      `${url} was redirected to ${response.url}; give a SHA-256 to accept a file not served over https.`,
    );
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(part));
    if (expected !== undefined) {
      const actual = await sha256OfFile(part);
      if (actual !== expected)
        throw new DownloadError(
          `${url}: the file's SHA-256 is ${actual}, not the ${expected} expected.`,
        );
    }
    await rename(part, dest);
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
}
