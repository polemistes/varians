/** GET /bibliography.bib: the whole shared bibliography as biblatex. */
import { bibText } from '$lib/server/bibliography';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  return new Response(await bibText(locals.db), {
    headers: {
      'content-type': 'application/x-bibtex; charset=utf-8',
      'content-disposition': 'attachment; filename="varians.bib"',
    },
  });
};
