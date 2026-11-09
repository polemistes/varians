import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds } from '@varians/core';
import { highlightDecorations } from './highlight.ts';
import { buildModel } from './model.ts';

describe('highlightDecorations', () => {
  it('puts the classes on the shown tokens and skips unknown ids', () => {
    const stream = fromText('the quick fox\njumps', { ids: sequentialIds() });
    const model = buildModel(stream, { form: 'written' });
    const set = highlightDecorations({ t2: 'site', t5: 'lit site', nope: 'x', t4: 'line' }, model);
    const found: [number, number, string][] = [];
    set.between(0, model.ledger.text.length, (from, to, value) => {
      found.push([from, to, (value.spec as { class: string }).class]);
    });
    expect(found).toEqual([
      [4, 9, 'site'],
      [14, 19, 'lit site'],
    ]);
  });
});
