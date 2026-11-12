import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Stream } from '@varians/core';
import { alignLedger, minimalChange } from './align.ts';
import { render, spanOf } from './bridge.ts';

function sample(): Stream {
  const s = fromText('the quick fox\njumps over', { lang: 'en', ids: sequentialIds() });
  s.items.splice(2, 0, { kind: 'object', id: 'g1', type: 'gap' });
  return s;
}

describe('alignLedger', () => {
  it('returns the canonical ledger for the canonical text', () => {
    const ledger = render(sample(), 'written');
    expect(alignLedger(ledger, ledger.text)).toBe(ledger);
  });

  it('lays the spans over a text with extra whitespace', () => {
    const ledger = render(sample(), 'written');
    const text = '  the quick  ￼ fox \n\tjumps over  ';
    const aligned = alignLedger(ledger, text);
    expect(aligned).not.toBeNull();
    expect(aligned!.text).toBe(text);
    expect(spanOf(aligned!, 't1')).toMatchObject({ from: 2, to: 5 });
    expect(spanOf(aligned!, 'g1')).toMatchObject({ from: 13, to: 14 });
    expect(spanOf(aligned!, 't3')).toMatchObject({ from: 15, to: 18 });
    expect(spanOf(aligned!, 't4')).toMatchObject({ from: 19, to: 20, kind: 'break' });
    expect(spanOf(aligned!, 't5')).toMatchObject({ from: 21, to: 26 });
    expect(spanOf(aligned!, 't6')).toMatchObject({ from: 27, to: 31 });
  });

  it('accepts an object standing against a word', () => {
    const ledger = render(sample(), 'written');
    const aligned = alignLedger(ledger, 'the quick￼fox\njumps over');
    expect(aligned).not.toBeNull();
    expect(spanOf(aligned!, 'g1')).toMatchObject({ from: 9, to: 10 });
    expect(spanOf(aligned!, 't3')).toMatchObject({ from: 10, to: 13 });
  });

  it('accepts a read form of several words with the document whitespace between them', () => {
    const s = fromText('a b', { lang: 'en', ids: sequentialIds() });
    (s.items[0] as { norm?: string }).norm = 'x y';
    const ledger = render(s, 'read');
    expect(ledger.text).toBe('x y b');
    const aligned = alignLedger(ledger, 'x  y  b');
    expect(spanOf(aligned!, 't1')).toMatchObject({ from: 0, to: 4 });
    expect(spanOf(aligned!, 't2')).toMatchObject({ from: 6, to: 7 });
  });

  it('refuses a text whose words differ', () => {
    const ledger = render(sample(), 'written');
    expect(alignLedger(ledger, 'the quick ￼ fox\njumps overs')).toBeNull();
    expect(alignLedger(ledger, 'the quick ￼ fox\njumps')).toBeNull();
    expect(alignLedger(ledger, 'the quick ￼ fox\njumps over\n')).toBeNull();
    expect(alignLedger(ledger, 'the quick ￼ fox jumps over')).toBeNull();
    expect(alignLedger(ledger, 'the quick ￼ fox\njumps over ￼')).toBeNull();
  });
});

describe('minimalChange', () => {
  it('is null for equal texts', () => {
    expect(minimalChange('abc', 'abc')).toBeNull();
  });

  it('finds the replaced middle', () => {
    expect(minimalChange('the quick fox', 'the slow fox')).toEqual({
      from: 4,
      to: 9,
      insert: 'slow',
    });
    expect(minimalChange('abc', 'abXc')).toEqual({ from: 2, to: 2, insert: 'X' });
    expect(minimalChange('abXc', 'abc')).toEqual({ from: 2, to: 3, insert: '' });
    expect(minimalChange('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' });
    expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
  });

  it('does not cut a surrogate pair', () => {
    const change = minimalChange('𐤀𐤁', '𐤀𐤂')!;
    expect(change).toEqual({ from: 2, to: 4, insert: '𐤂' });
    expect('𐤀𐤁'.slice(0, change.from) + change.insert + '𐤀𐤁'.slice(change.to)).toBe('𐤀𐤂');
  });
});
