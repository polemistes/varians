/** A built package as a download; the temporary files go when the answer has been sent. */
import { env } from '$env/dynamic/private';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { BuiltPackage } from './archive/package.ts';
import { VERSION } from '$lib/version';

export function packageResponse(pkg: BuiltPackage): Response {
  const stream = createReadStream(pkg.file);
  const cleanup = () => void pkg.cleanup();
  stream.on('close', cleanup);
  stream.on('error', cleanup);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${pkg.name}.zip"`,
      'cache-control': 'private, no-store',
    },
  });
}

/** The address packages name this installation by: ORIGIN, else the request's. */
export function packageOrigin(requestOrigin: string): string {
  return (env.ORIGIN?.trim() || requestOrigin).replace(/\/+$/u, '');
}

export const PACKAGE_AGENT = `Varians ${VERSION}`;
