import { referencePieces } from '$lib/bibliography/format';
import { entryOf, listBibliography } from '$lib/server/bibliography';
import { grantsFor } from '$lib/server/authz';
import {
  searchPublishedEditions,
  searchWitnesses,
  searchWorks,
  withEditionRights,
  withWitnessRights,
  withWorkRights,
} from '$lib/server/library';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

const BIBLIOGRAPHY_LIMIT = 10;

/** The header's search: published editions, works, witnesses and bibliography entries matching one query. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const crumb = { label: site.search.title };
  if (!q)
    return {
      crumb,
      q,
      editions: [],
      works: [],
      witnesses: [],
      bibliography: { items: [], total: 0 },
    };
  const [editions, works, witnesses, bibliography, grants] = await Promise.all([
    searchPublishedEditions(locals.db, q),
    searchWorks(locals.db, q),
    searchWitnesses(locals.db, q),
    listBibliography(locals.db, { q, limit: BIBLIOGRAPHY_LIMIT }),
    grantsFor(locals.db, locals.user),
  ]);
  return {
    crumb,
    q,
    editions: withEditionRights(editions, locals.user, grants),
    works: withWorkRights(works, locals.user, grants),
    witnesses: withWitnessRights(witnesses, locals.user, grants),
    bibliography: {
      total: bibliography.total,
      items: bibliography.items.map((item) => ({
        id: item.id,
        key: item.citationKey,
        label: item.label,
        pieces: referencePieces(entryOf(item)),
      })),
    },
  };
};
