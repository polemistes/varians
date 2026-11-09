import type { RequestHandler } from './$types';
import { serveStorageFile } from '$lib/server/images/media';

/** Tiles and originals from the storage directory; see serveStorageFile for what is allowed. */
export const GET: RequestHandler = ({ params, request }) => serveStorageFile(params.path, request);

export const HEAD: RequestHandler = GET;
