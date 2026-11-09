/**
 * /editions/[slug].tei.xml: the edition as a TEI critical apparatus
 * (parallel segmentation), of the version the visitor would see at
 * /editions/[slug] (`?v=n` for a published version, `?draft=1` for an
 * editor's preview).
 */
import { readerDownload, readerRequestFromUrl } from '$lib/server/reader-pages';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, params, url }) =>
  readerDownload(locals.db, locals.user, params.slug, readerRequestFromUrl(url), 'tei');
