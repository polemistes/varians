import { describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { applyOps, fromText, sequentialIds, toText, type Break, type Stream } from '@varians/core';
import { reconcile, render } from './bridge.ts';
import { liftOps, liftToWhole, pageBreaks, pageView, UNPLACED } from './page.ts';

/** Two pages: `a b` on p1, `c d` and `e` on p2, with text before the first page break. */
function twoPages(): Stream {
  const s = fromText('x\na b\nc d\ne', { ids: sequentialIds() });
  // breaks: t2 (after x), t5 (after b), t8 (after d)
  (s.items[1] as Break).type = 'page';
  (s.items[1] as Break).pageId = 'p1';
  (s.items[4] as Break).type = 'page';
  (s.items[4] as Break).pageId = 'p2';
  return s;
}

describe('pageView', () => {
  it('shows the whole stream when no page is named', () => {
    const s = twoPages();
    const view = pageView(s, null);
    expect(view.stream).toBe(s);
    expect(view.anchor).toBeNull();
    expect(view.missing).toBeNull();
  });

  it('shows the items between a page break and the next', () => {
    const s = twoPages();
    const p1 = pageView(s, 'p1');
    expect(toText(p1.stream)).toBe('a b');
    expect(p1.anchor?.id).toBe('t2');
    const p2 = pageView(s, 'p2');
    expect(toText(p2.stream)).toBe('c d\ne');
    expect(p2.anchor?.id).toBe('t5');
    expect(pageBreaks(s).map((b) => b.pageId)).toEqual(['p1', 'p2']);
  });

  it('shows the text on no page: the items before the first page break', () => {
    const s = twoPages();
    const view = pageView(s, UNPLACED);
    expect(toText(view.stream)).toBe('x');
    expect(view.anchor).toBeNull();
    expect(view.missing).toBeNull();
    expect(toText(pageView(fromText('a b\nc', { ids: sequentialIds() }), UNPLACED).stream)).toBe(
      'a b\nc',
    );
  });

  it('shows nothing for a page that has no break yet, remembering where the witness order puts its break', () => {
    const s = twoPages();
    expect(pageView(s, 'p3', ['p1', 'p2', 'p3']).missing).toEqual({ pageId: 'p3', after: 't9' });
    // A page between p1 and p2 goes after p1's text, not at the end.
    expect(pageView(s, 'p1a', ['p1', 'p1a', 'p2']).missing).toEqual({ pageId: 'p1a', after: 't4' });
    // A page before every other goes after the text on no page.
    expect(pageView(s, 'p0', ['p0', 'p1', 'p2']).missing).toEqual({ pageId: 'p0', after: 't1' });
    const view = pageView(s, 'p3', ['p1', 'p2', 'p3']);
    expect(view.stream.items).toEqual([]);
    expect(view.anchor).toBeNull();
  });
});

describe('liftOps', () => {
  it('moves an insert at the page start to after the page break and leaves the rest alone', () => {
    const ops = liftOps(
      [
        { t: 'insert', after: null, items: [] },
        { t: 'insert', after: 'x', items: [] },
        { t: 'delete', ids: ['y'] },
      ],
      'pb',
    );
    expect(ops).toEqual([
      { t: 'insert', after: 'pb', items: [] },
      { t: 'insert', after: 'x', items: [] },
      { t: 'delete', ids: ['y'] },
    ]);
  });

  it('is the identity for the whole stream', () => {
    const ops = [{ t: 'insert' as const, after: null, items: [] }];
    expect(liftOps(ops, null)).toBe(ops);
  });
});

describe('editing one page through the bridge', () => {
  it('inserts a word at the start of the page after the page break in the whole', () => {
    const whole = twoPages();
    const view = pageView(whole, 'p2');
    const ledger = render(view.stream, 'written');
    const r = reconcile(
      view.stream,
      ledger,
      ChangeSet.of({ from: 0, to: 0, insert: 'new ' }, ledger.text.length),
      'written',
      {
        ids: sequentialIds('n'),
      },
    );
    expect(r.ops).toEqual([
      { t: 'insert', after: null, items: [{ kind: 'token', id: 'n1', form: 'new' }] },
    ]);
    const lifted = liftToWhole(r.ops, view, sequentialIds('b'));
    expect(lifted.ops).toEqual([
      { t: 'insert', after: 't5', items: [{ kind: 'token', id: 'n1', form: 'new' }] },
    ]);
    const next = applyOps(whole, lifted.ops).stream;
    expect(toText(next)).toBe('x\na b\nnew c d\ne');
    expect(pageView(next, 'p2').stream).toEqual(r.stream);
  });

  it('edits in the middle of a page apply to the whole unchanged', () => {
    const whole = twoPages();
    const view = pageView(whole, 'p1');
    const ledger = render(view.stream, 'written');
    const r = reconcile(
      view.stream,
      ledger,
      ChangeSet.of({ from: 2, to: 3, insert: 'bee' }, ledger.text.length),
      'written',
    );
    const lifted = liftToWhole(r.ops, view, sequentialIds('b'));
    expect(lifted.ops).toEqual(r.ops);
    const next = applyOps(whole, lifted.ops).stream;
    expect(toText(next)).toBe('x\na bee\nc d\ne');
    expect(pageView(next, 'p1').stream).toEqual(r.stream);
  });

  it('creates the page break on the first edit of a page without one', () => {
    const whole = twoPages();
    const view = pageView(whole, 'p3', ['p1', 'p2', 'p3']);
    const ledger = render(view.stream, 'written');
    const r = reconcile(
      view.stream,
      ledger,
      ChangeSet.of({ from: 0, to: 0, insert: 'f g' }, 0),
      'written',
      {
        ids: sequentialIds('n'),
      },
    );
    const lifted = liftToWhole(r.ops, view, sequentialIds('b'));
    expect(lifted.ops).toEqual([
      {
        t: 'insert',
        after: 't9',
        items: [{ kind: 'break', id: 'b1', type: 'page', pageId: 'p3' }],
      },
      {
        t: 'insert',
        after: 'b1',
        items: [
          { kind: 'token', id: 'n1', form: 'f' },
          { kind: 'token', id: 'n2', form: 'g' },
        ],
      },
    ]);
    expect(lifted.anchor?.id).toBe('b1');
    expect(lifted.missing).toBeNull();
    const next = applyOps(whole, lifted.ops).stream;
    expect(toText(next)).toBe('x\na b\nc d\ne\nf g');
    expect(pageView(next, 'p3').stream).toEqual(r.stream);
  });

  it('creates the break of a page between two others in its place', () => {
    const whole = twoPages();
    const view = pageView(whole, 'p1a', ['p1', 'p1a', 'p2']);
    const lifted = liftToWhole(
      [{ t: 'insert', after: null, items: [{ kind: 'token', id: 'n1', form: 'f' }] }],
      view,
      sequentialIds('b'),
    );
    const next = applyOps(whole, lifted.ops).stream;
    expect(toText(next)).toBe('x\na b\nf\nc d\ne');
    expect(pageBreaks(next).map((b) => b.pageId)).toEqual(['p1', 'p1a', 'p2']);
  });

  it('lifts edits of the text on no page as they are', () => {
    const whole = twoPages();
    const view = pageView(whole, UNPLACED);
    const ops = [
      {
        t: 'insert' as const,
        after: null,
        items: [{ kind: 'token' as const, id: 'n1', form: 'w' }],
      },
    ];
    expect(liftToWhole(ops, view, sequentialIds('b')).ops).toEqual(ops);
  });

  it('does not create a break when nothing was inserted', () => {
    const view = pageView(twoPages(), 'p3');
    const lifted = liftToWhole([], view, sequentialIds('b'));
    expect(lifted.ops).toEqual([]);
    expect(lifted.missing).toEqual(view.missing);
  });
});
