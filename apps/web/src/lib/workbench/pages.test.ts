import { describe, expect, it } from 'vitest';
import type { Item, Stream } from '@varians/core';
import { hasUnplacedText, initialView, neighbours, nextPageWithoutText, pageOf, pagesWithText, settleView, UNPLACED, viewOrder, WHOLE, wordsUnplaced } from './pages.ts';

/** `a` a token, `/` a line break, `#p1` a page break naming p1. */
function build(spec: string): Stream {
  let n = 0;
  return {
    items: spec
      .split(' ')
      .filter(Boolean)
      .map((w): Item => {
        if (w === '/') return { kind: 'break', id: `l${++n}`, type: 'line' };
        if (w.startsWith('#')) return { kind: 'break', id: `b${++n}`, type: 'page', pageId: w.slice(1) };
        return { kind: 'token', id: w, form: w };
      }),
  };
}

const pages = [
  { id: 'p1', label: '1r' },
  { id: 'p2', label: '1v' },
  { id: 'p3', label: '2r' },
];

describe('the text of pages', () => {
  it('counts the words and lines on each page with text, and the words on no page', () => {
    const s = build('u v #p1 a / b c #p2 #p3 d');
    expect([...pagesWithText(s)]).toEqual([
      ['p1', { words: 3, lines: 2 }],
      ['p3', { words: 1, lines: 1 }],
    ]);
    expect(wordsUnplaced(s)).toBe(2);
    expect(hasUnplacedText(s)).toBe(true);
    expect(hasUnplacedText(build('#p1 a'))).toBe(false);
  });

  it('finds the page an item stands on', () => {
    const s = build('u #p1 a #p2 b');
    expect(pageOf(s, 'u')).toBe(UNPLACED);
    expect(pageOf(s, 'b')).toBe('p2');
    expect(pageOf(s, 'x')).toBeNull();
  });
});

describe('views', () => {
  it('walks Not on a page and the pages in order', () => {
    const order = viewOrder(pages);
    expect(order).toEqual([UNPLACED, 'p1', 'p2', 'p3']);
    expect(neighbours(UNPLACED, order)).toEqual({ previous: null, next: 'p1' });
    expect(neighbours('p2', order)).toEqual({ previous: 'p1', next: 'p3' });
    expect(neighbours('p3', order)).toEqual({ previous: 'p2', next: null });
    expect(neighbours(WHOLE, order)).toEqual({ previous: null, next: UNPLACED });
  });

  it('opens on the first page with text, else Not on a page with text, else the first page, else the text', () => {
    expect(initialView(build('u #p2 a'), pages)).toBe('p2');
    expect(initialView(build('u v'), pages)).toBe(UNPLACED);
    expect(initialView(build(''), pages)).toBe('p1');
    expect(initialView(build('a b'), [])).toBe(UNPLACED);
  });

  it('settles a view that is gone, and the whole text of a witness without pages', () => {
    const s = build('#p1 a');
    expect(settleView('p3', s, pages)).toBe('p3');
    expect(settleView('gone', s, pages)).toBe('p1');
    expect(settleView(WHOLE, s, pages)).toBe(WHOLE);
    expect(settleView(WHOLE, build('a'), [])).toBe(UNPLACED);
    expect(settleView(UNPLACED, s, pages)).toBe(UNPLACED);
    expect(settleView(null, s, pages)).toBe('p1');
  });

  it('proposes the next page without text, wrapping round', () => {
    const s = build('#p1 a #p3 c');
    expect(nextPageWithoutText(pages, s)).toBe('p2');
    expect(nextPageWithoutText(pages, s, 'p2')).toBeNull();
    expect(nextPageWithoutText(pages, build('#p2 b'), 'p3')).toBe('p1');
  });
});
