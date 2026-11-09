/**
 * Where lexicon:import reads its lexicon.sqlite from: a path, or an address
 * that is downloaded to a temporary file first. With a SHA-256 given, the
 * file is refused unless it matches; a plain http address is accepted only
 * with one, since nothing else would show that the file arrived unaltered.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

export interface LexiconSource {
  file: string;
  /** Removes the downloaded file, if there is one. */
  cleanup: () => Promise<void>;
}

export class LexiconSourceError extends Error {}

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export async function lexiconSource(
  given: string,
  options: { sha256?: string; fetch?: typeof fetch } = {},
): Promise<LexiconSource> {
  const expected = options.sha256?.toLowerCase();
  if (expected !== undefined && !/^[0-9a-f]{64}$/u.test(expected)) {
    throw new LexiconSourceError('--sha256 takes the 64 hexadecimal digits of the file’s SHA-256.');
  }
  let source: LexiconSource;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(given)) {
    if (!/^https?:\/\//iu.test(given)) throw new LexiconSourceError('Give a path, or an https address.');
    if (/^http:\/\//iu.test(given) && !expected) {
      throw new LexiconSourceError('Download over https, or give --sha256 to check a file fetched over http.');
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'varians-lexicon-'));
    const cleanup = () => rm(dir, { recursive: true, force: true });
    const file = path.join(dir, 'lexicon.sqlite');
    try {
      const response = await (options.fetch ?? fetch)(given, { redirect: 'follow' });
      if (!response.ok || !response.body) throw new LexiconSourceError(`The download failed: ${response.status} ${response.statusText}`);
      // Without a checksum, only https vouches for the file: a redirect may not leave it.
      if (!expected && response.url && !/^https:\/\//iu.test(response.url)) {
        throw new LexiconSourceError(`The download was redirected to ${response.url}; give --sha256 to accept a file not served over https.`);
      }
      await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(file));
    } catch (error) {
      await cleanup();
      throw error;
    }
    source = { file, cleanup };
  } else {
    if (!existsSync(given)) throw new LexiconSourceError(`No file at ${given}.`);
    source = { file: given, cleanup: async () => undefined };
  }
  if (expected) {
    const actual = await sha256OfFile(source.file);
    if (actual !== expected) {
      await source.cleanup();
      throw new LexiconSourceError(`The file’s SHA-256 is ${actual}, not the ${expected} given; nothing was loaded.`);
    }
  }
  return source;
}
