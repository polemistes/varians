import { describe, expect, it } from 'vitest';
import {
  applyOps,
  fromText,
  sequentialIds,
  toText,
  type Id,
  type Item,
  type Op,
  type Token,
} from '@varians/core';
import { render, type Form } from './bridge.ts';
import { planInsertion, selectionTokens, tokenAt, type Insertion } from './selection.ts';

function setup(text: string, form: Form = 'written') {
  const stream = fromText(text, { lang: 'grc', ids: sequentialIds() });
  stream.items.splice(2, 0, { kind: 'object', id: 'g1', type: 'gap' });
  const ledger = render(stream, form);
  const byId = new Map<Id, Item>(stream.items.map((i) => [i.id, i]));
  return { stream, ledger, byId };
}

describe('selectionTokens', () => {
  it('lists the tokens a selection covers and the token at its head', () => {
    const { ledger } = setup('the quick fox\njumps');
    expect(ledger.text).toBe('the quick ￼ fox\njumps');
    expect(selectionTokens(ledger, 2, 13, 13)).toEqual({
      tokenIds: ['t1', 't2', 't3'],
      caret: 't3',
    });
    expect(selectionTokens(ledger, 13, 2, 2)).toEqual({
      tokenIds: ['t1', 't2', 't3'],
      caret: 't1',
    });
    expect(selectionTokens(ledger, 6, 6, 6)).toEqual({ tokenIds: ['t2'], caret: 't2' });
    // Between the object and a space: no token.
    expect(selectionTokens(ledger, 11, 11, 11)).toEqual({ tokenIds: [], caret: null });
  });
});

describe('tokenAt', () => {
  it('prefers the token containing the position, then the one ending there', () => {
    const { ledger, byId } = setup('the quick fox');
    expect(tokenAt(ledger, byId, 1)?.id).toBe('t1');
    expect(tokenAt(ledger, byId, 3)?.id).toBe('t1');
    expect(tokenAt(ledger, byId, 4)?.id).toBe('t2');
    expect(tokenAt(ledger, byId, 10)).toBeNull();
  });
});

function apply(text: string, pos: number, kind: 'object' | 'break', form: Form = 'written') {
  const { stream, ledger, byId } = setup(text, form);
  const plan = planInsertion(ledger, byId, form, pos, kind);
  const docText =
    ledger.text.slice(0, plan.change.from) + plan.change.insert + ledger.text.slice(plan.change.to);
  const item: Item =
    kind === 'object'
      ? { kind: 'object', id: 'n1', type: 'space' }
      : { kind: 'break', id: 'n1', type: 'column' };
  const ops: Op[] = [];
  if (plan.split)
    ops.push({
      t: 'split',
      id: plan.split.id,
      at: plan.split.at,
      newId: 'n2',
      join: kind === 'break',
    });
  ops.push({ t: 'insert', after: plan.after, items: [item] });
  const next = applyOps(stream, ops).stream;
  return { plan, docText, next, rendered: render(next, form).text };
}

describe('planInsertion', () => {
  it('inserts an object between two words, replacing the space', () => {
    const { plan, docText, rendered } = apply('the quick fox', 3, 'object');
    expect(plan).toMatchObject<Partial<Insertion>>({
      after: 't1',
      split: null,
      change: { from: 3, to: 4, insert: ' ￼ ' },
    });
    expect(docText).toBe('the ￼ quick ￼ fox');
    expect(rendered).toBe(docText);
    expect(plan.caret).toBe(5);
  });

  it('inserts an object at the start and the end of a line', () => {
    const start = apply('the quick fox\njumps', 0, 'object');
    expect(start.plan.change).toEqual({ from: 0, to: 0, insert: '￼ ' });
    expect(start.docText).toBe('￼ the quick ￼ fox\njumps');
    expect(start.rendered).toBe(start.docText);
    const end = apply('the quick fox\njumps', 15, 'object');
    expect(end.plan.change).toEqual({ from: 15, to: 15, insert: ' ￼' });
    expect(end.docText).toBe('the quick ￼ fox ￼\njumps');
    expect(end.rendered).toBe(end.docText);
    expect(end.plan.caret).toBe(17);
    const lineStart = apply('the quick fox\njumps', 16, 'object');
    expect(lineStart.plan.change).toEqual({ from: 16, to: 16, insert: '￼ ' });
    expect(lineStart.plan.after).toBe('t4');
    expect(lineStart.rendered).toBe('the quick ￼ fox\n￼ jumps');
  });

  it('divides a word when the caret stands inside it', () => {
    const object = apply('the quick fox', 6, 'object');
    expect(object.plan.split).toEqual({ id: 't2', at: 2 });
    expect(object.plan.change).toEqual({ from: 4, to: 9, insert: 'qu ￼ ick' });
    expect(object.docText).toBe('the qu ￼ ick ￼ fox');
    expect(object.rendered).toBe(object.docText);
    expect(object.plan.caret).toBe(8);
    const brk = apply('the quick fox', 6, 'break');
    expect(brk.plan.change).toEqual({ from: 4, to: 9, insert: 'qu\nick' });
    expect(brk.rendered).toBe('the qu\nick ￼ fox');
    expect((brk.next.items[1] as Token).joinNext).toBe(true);
    expect(brk.plan.caret).toBe(7);
  });

  it('counts the split point in code points', () => {
    const { plan } = apply('𐤀𐤁𐤂 b', 4, 'object');
    expect(plan.split).toEqual({ id: 't1', at: 2 });
  });

  it('does not divide a read form that differs from the written form', () => {
    const { stream, byId } = setup('the quick fox', 'read');
    (stream.items[1] as Token).norm = 'swift';
    const ledger = render(stream, 'read');
    const plan = planInsertion(ledger, byId, 'read', 6, 'object');
    expect(plan.split).toBeNull();
    expect(plan.after).toBe('t2');
    expect(plan.change).toEqual({ from: 9, to: 10, insert: ' ￼ ' });
  });

  it('inserts a break between words, dropping the whitespace', () => {
    const { plan, docText, rendered } = apply('the quick fox', 9, 'break');
    expect(plan.change).toEqual({ from: 9, to: 10, insert: '\n' });
    expect(docText).toBe('the quick\n￼ fox');
    expect(rendered).toBe(docText);
    expect(plan.after).toBe('t2');
  });

  it('inserts into an empty document', () => {
    const stream = fromText('', { lang: 'en', ids: sequentialIds() });
    const ledger = render(stream, 'written');
    const plan = planInsertion(ledger, new Map(), 'written', 0, 'object');
    expect(plan).toEqual({
      after: null,
      split: null,
      change: { from: 0, to: 0, insert: '￼' },
      caret: 1,
    });
    expect(
      toText(
        applyOps(stream, [
          { t: 'insert', after: null, items: [{ kind: 'object', id: 'n1', type: 'gap' }] },
        ]).stream,
      ),
    ).toBe('[...]');
  });
});

describe('a break at a line start', () => {
  it('turns the line break into the new break, so no empty line is left', () => {
    const stream = fromText('ab\ncd', { lang: 'en', ids: sequentialIds() });
    const ops: Op[] = [{ t: 'set', id: 't2', fields: { type: 'page', pageId: 'p2' } }];
    const after = applyOps(stream, ops).stream;
    expect(toText(after)).toBe('ab\ncd');
    expect(after.items[1]).toEqual({ kind: 'break', id: 't2', type: 'page', pageId: 'p2' });
  });
});
