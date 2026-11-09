import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Break, type Stream } from '@varians/core';
import {
  hasLeadingText,
  initialPage,
  neighbours,
  nextUnplacedPage,
  pageIdOfKey,
  pageKeyOf,
  settlePage,
  streamPages,
  unplacedPages,
} from './pages.ts';

const witness = [
  { id: 'p1', label: '12r' },
  { id: 'p2', label: '12v' },
  { id: 'p3', label: '13r' },
];
const labels = { p1: '12r', p2: '12v', p3: '13r' };

/** `a b` on p1, `c` on p2: t1 page break p1, t2 a, t3 b, t4 page break p2, t5 c. */
function paged(): Stream {
  const s = fromText('\na b\nc', { ids: sequentialIds() });
  (s.items[0] as Break).type = 'page';
  (s.items[0] as Break).pageId = 'p1';
  (s.items[3] as Break).type = 'page';
  (s.items[3] as Break).pageId = 'p2';
  return s;
}

describe('streamPages', () => {
  it('lists the page breaks in order with their labels and keys', () => {
    const pages = streamPages(paged(), labels);
    expect(pages.map((p) => [p.key, p.label, p.breakId, p.index])).toEqual([
      ['p1', '12r', 't1', 0],
      ['p2', '12v', 't4', 3],
    ]);
  });

  it('keys a break without a page, or a second break of one page, by its own id', () => {
    const s = paged();
    (s.items[3] as Break).pageId = undefined;
    const t = fromText('d', { ids: sequentialIds('x') });
    s.items.push({ kind: 'break', id: 'b9', type: 'page', pageId: 'p1' }, ...t.items);
    const pages = streamPages(s, labels, (n) => `page ${n}`);
    expect(pages.map((p) => [p.key, p.label])).toEqual([
      ['p1', '12r'],
      ['t4', 'page 2'],
      ['b9', '12r'],
    ]);
  });
});

describe('pages of the witness and of the stream', () => {
  it('finds the pages without a break and the one that follows the last placed', () => {
    const s = paged();
    expect(unplacedPages(witness, s).map((p) => p.id)).toEqual(['p3']);
    expect(nextUnplacedPage(s, streamPages(s, labels), witness)?.id).toBe('p3');
  });

  it('knows which page an item stands on', () => {
    const s = paged();
    const pages = streamPages(s, labels);
    expect(pageKeyOf(s, 't3', pages)).toBe('p1');
    expect(pageKeyOf(s, 't5', pages)).toBe('p2');
    expect(pageIdOfKey('p2', pages, witness)).toBe('p2');
    expect(pageIdOfKey('p3', pages, witness)).toBe('p3');
    expect(pageIdOfKey('zz', pages, witness)).toBeNull();
  });

  it('notices words before the first page break', () => {
    expect(hasLeadingText(paged())).toBe(false);
    const s = fromText('x\na', { ids: sequentialIds() });
    (s.items[1] as Break).type = 'page';
    (s.items[1] as Break).pageId = 'p1';
    expect(hasLeadingText(s)).toBe(true);
  });
});

describe('choosing the page', () => {
  it('opens on the first page, the witness page of an empty text, or the whole text', () => {
    const s = paged();
    expect(initialPage(s, streamPages(s, labels), witness)).toBe('p1');
    const empty: Stream = { items: [] };
    expect(initialPage(empty, [], witness)).toBe('p1');
    expect(initialPage(empty, [], [])).toBeNull();
    const plain = fromText('a b', { ids: sequentialIds() });
    expect(initialPage(plain, [], witness)).toBeNull();
  });

  it('keeps a valid page and falls back from one that is gone', () => {
    const s = paged();
    const pages = streamPages(s, labels);
    expect(settlePage('p2', s, pages, witness)).toBe('p2');
    expect(settlePage('p3', s, pages, witness)).toBe('p3');
    expect(settlePage('gone', s, pages, witness)).toBe('p1');
    expect(settlePage(null, s, pages, witness)).toBeNull();
  });

  it('goes on past the last page to the next witness page without a break', () => {
    const s = paged();
    const pages = streamPages(s, labels);
    expect(neighbours('p1', s, pages, witness)).toEqual({ previous: null, next: 'p2' });
    expect(neighbours('p2', s, pages, witness)).toEqual({ previous: 'p1', next: 'p3' });
    expect(neighbours('p3', s, pages, witness)).toEqual({ previous: 'p2', next: null });
    expect(neighbours(null, s, pages, witness)).toEqual({ previous: null, next: 'p1' });
  });
});
