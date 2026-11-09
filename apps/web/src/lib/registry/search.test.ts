import { describe, expect, it } from 'vitest';
import { fetchMatches, hitDetail, mergeHits, searchable } from './search';
import type { SearchHit } from './types';

const hit = (id: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  id,
  slug: id,
  title: id.toUpperCase(),
  author: null,
  siglum: null,
  shelfmark: null,
  settlement: null,
  ...extra,
});

describe('search before create', () => {
  it('sends only queries worth sending, each once', () => {
    expect(searchable(['  Iliad ', 'I', '', 'Iliad'])).toEqual(['Iliad']);
    expect(searchable(['Venetus', 'Marc. gr. 454'])).toEqual(['Venetus', 'Marc. gr. 454']);
  });

  it('merges hits in order, each entry once, eight at most', () => {
    const many = Array.from({ length: 10 }, (_, i) => hit(`w${i}`));
    expect(
      mergeHits([
        [hit('a'), hit('b')],
        [hit('b'), hit('c')],
      ]).map((h) => h.id),
    ).toEqual(['a', 'b', 'c']);
    expect(mergeHits([many])).toHaveLength(8);
  });

  it('describes a work by its author and a witness by siglum, place and shelfmark', () => {
    expect(hitDetail(hit('iliad', { author: 'Homer' }))).toBe('Homer');
    expect(
      hitDetail(hit('a', { siglum: 'A', settlement: 'Venice', shelfmark: 'Marc. gr. Z. 454' })),
    ).toBe('A · Venice, Marc. gr. Z. 454');
    expect(hitDetail(hit('c', { siglum: 'C' }))).toBe('C');
    expect(hitDetail(hit('x'))).toBe('');
  });

  it('asks the registry once per query and merges the answers', async () => {
    const asked: string[] = [];
    const fake = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const q = new URL(url, 'http://local').searchParams.get('q');
      const results = q === 'Venetus' ? [hit('a'), hit('b')] : [hit('b'), hit('t')];
      return new Response(JSON.stringify({ results }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const hits = await fetchMatches('witness', ['Venetus', 'Burney 86', 'x'], undefined, fake);
    expect(asked).toEqual([
      '/api/registry/search?kind=witness&q=Venetus',
      '/api/registry/search?kind=witness&q=Burney%2086',
    ]);
    expect(hits.map((h) => h.id)).toEqual(['a', 'b', 't']);
    expect(await fetchMatches('work', [' '], undefined, fake)).toEqual([]);
  });

  it('treats a failed answer as no matches', async () => {
    const failing = (async () => new Response('no', { status: 500 })) as typeof fetch;
    expect(await fetchMatches('work', ['Iliad'], undefined, failing)).toEqual([]);
  });
});
