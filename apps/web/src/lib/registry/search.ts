/**
 * Search-before-create in the browser: the registry's JSON search, asked
 * once per thing typed (a title; a name and a shelfmark), the hits merged.
 */
import type { SearchHit } from './types';

export type RegistryKind = 'work' | 'witness';

/** Shorter queries are not sent. */
export const MIN_QUERY = 2;
/** Milliseconds of quiet typing before a search goes out. */
export const SEARCH_DELAY = 200;
export const MAX_HITS = 8;

/** The queries worth sending: trimmed, long enough, each once. */
export function searchable(queries: string[]): string[] {
  return [...new Set(queries.map((q) => q.trim()).filter((q) => q.length >= MIN_QUERY))];
}

/** Hits of several searches as one list, in order of arrival, each entry once. */
export function mergeHits(lists: SearchHit[][], limit = MAX_HITS): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const list of lists) {
    for (const hit of list) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      out.push(hit);
    }
  }
  return out.slice(0, limit);
}

/** What follows the title of a hit: a work's author, or a witness's siglum, place and shelfmark. */
export function hitDetail(hit: SearchHit): string {
  if (hit.author) return hit.author;
  const where = [hit.settlement, hit.shelfmark].filter(Boolean).join(', ');
  return [hit.siglum, where].filter(Boolean).join(' · ');
}

export async function fetchMatches(
  kind: RegistryKind,
  queries: string[],
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SearchHit[]> {
  const wanted = searchable(queries);
  if (wanted.length === 0) return [];
  const lists = await Promise.all(
    wanted.map(async (q) => {
      const response = await fetcher(
        `/api/registry/search?kind=${kind}&q=${encodeURIComponent(q)}`,
        { signal },
      );
      if (!response.ok) return [];
      const body = (await response.json()) as { results?: SearchHit[] };
      return body.results ?? [];
    }),
  );
  return mergeHits(lists);
}
