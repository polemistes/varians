import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Id, type Item } from '@varians/core';
import { render, type Ledger } from './bridge.ts';
import { alignLedger } from './align.ts';
import { backspaceUnjoin, hyphenEnter, joinLinesEdit, spanContaining } from './hyphen.ts';
import { reconcile } from './bridge.ts';
import { ChangeSet } from '@codemirror/state';
import type { Token } from '@varians/core';

function setup(text: string, options: { hyphenJoins?: boolean } = {}) {
  const stream = fromText(text, { ids: sequentialIds(), ...options });
  const ledger = render(stream, 'written');
  const byId = new Map<Id, Item>(stream.items.map((i) => [i.id, i]));
  return { stream, ledger, byId };
}

describe('spanContaining', () => {
  it('finds the span whose text holds a character', () => {
    const { ledger } = setup('ab cd\nef');
    expect(spanContaining(ledger, 0)?.id).toBe('t1');
    expect(spanContaining(ledger, 2)).toBeUndefined();
    expect(spanContaining(ledger, 4)?.id).toBe('t2');
    expect(spanContaining(ledger, 5)?.kind).toBe('break');
    expect(spanContaining(ledger, 8)).toBeUndefined();
  });
});

describe('hyphenEnter', () => {
  it('replaces a hyphen at the end of a word by the break and names the token to join', () => {
    const { ledger, byId } = setup('ἄνδ- ρα');
    expect(hyphenEnter(ledger, byId, 4)).toEqual({ from: 3, to: 4, tokenId: 't1' });
  });

  it('works on a hyphen inside a word too', () => {
    const { ledger, byId } = setup('ἄνδ-ρα');
    expect(hyphenEnter(ledger, byId, 4)).toEqual({ from: 3, to: 4, tokenId: 't1' });
  });

  it('is null where the character before the caret is not a hyphen, or the hyphen stands alone', () => {
    const { ledger, byId } = setup('ἄνδ- ρα -');
    expect(hyphenEnter(ledger, byId, 3)).toBeNull();
    expect(hyphenEnter(ledger, byId, 0)).toBeNull();
    expect(hyphenEnter(ledger, byId, 9)).toBeNull();
  });

  it('works on the real text with extra whitespace', () => {
    const { ledger: canonical, byId } = setup('ab cd-');
    const ledger = alignLedger(canonical, 'ab  cd-') as Ledger;
    expect(hyphenEnter(ledger, byId, 7)).toEqual({ from: 6, to: 7, tokenId: 't2' });
  });
});

describe('backspaceUnjoin', () => {
  it('names the joined token when deleting the break after it', () => {
    const { ledger, byId } = setup('ἄνδ-\nρα μοι', { hyphenJoins: true });
    expect(ledger.text).toBe('ἄνδ\nρα μοι');
    expect(backspaceUnjoin(ledger, byId, 4)).toEqual({ from: 3, to: 4, tokenId: 't1' });
  });

  it('is null when the previous token is not joined, or the caret is not at a line start', () => {
    const { ledger, byId } = setup('ἄνδ\nρα μοι');
    expect(backspaceUnjoin(ledger, byId, 4)).toBeNull();
    const joined = setup('ἄνδ-\nρα μοι', { hyphenJoins: true });
    expect(backspaceUnjoin(joined.ledger, joined.byId, 5)).toBeNull();
    expect(backspaceUnjoin(joined.ledger, joined.byId, 0)).toBeNull();
  });

  it('allows trailing whitespace before the break', () => {
    const { ledger: canonical, byId } = setup('ἄνδ-\nρα', { hyphenJoins: true });
    const ledger = alignLedger(canonical, 'ἄνδ \nρα') as Ledger;
    expect(backspaceUnjoin(ledger, byId, 5)).toEqual({ from: 4, to: 5, tokenId: 't1' });
  });
});

describe('joinLinesEdit', () => {
  // Found in the workbench: Backspace at the start of a line fused the last
  // word of the line before with the first word of this one; the second word
  // lost its id, its read form and its zones.
  it('turns the break between two words into a space, from either side', () => {
    const { ledger, byId } = setup('ab cd\nef gh');
    expect(joinLinesEdit(ledger, byId, 6, 'backward')).toEqual({ from: 5, to: 6, insert: ' ' });
    expect(joinLinesEdit(ledger, byId, 5, 'forward')).toEqual({ from: 5, to: 6, insert: ' ' });
    // Elsewhere in a line: the ordinary deletion.
    expect(joinLinesEdit(ledger, byId, 7, 'backward')).toBeNull();
    expect(joinLinesEdit(ledger, byId, 4, 'forward')).toBeNull();
  });

  it('leaves a divided word, an empty line and the stream ends alone', () => {
    const divided = setup('ab\ncd');
    (divided.byId.get('t1') as Token).joinNext = true;
    expect(joinLinesEdit(divided.ledger, divided.byId, 3, 'backward')).toBeNull();
    const empty = setup('ab\n\ncd');
    expect(joinLinesEdit(empty.ledger, empty.byId, 3, 'backward')).toBeNull();
    expect(joinLinesEdit(empty.ledger, empty.byId, 0, 'backward')).toBeNull();
  });

  it('keeps both words and their ids', () => {
    const { stream, ledger, byId } = setup('ab cd\nef gh');
    const edit = joinLinesEdit(ledger, byId, 6, 'backward')!;
    const r = reconcile(stream, ledger, ChangeSet.of(edit, ledger.text.length), 'written');
    expect(r.ops).toEqual([{ t: 'delete', ids: ['t3'] }]);
    expect(r.stream.items.map((i) => i.id)).toEqual(['t1', 't2', 't4', 't5']);
  });
});
