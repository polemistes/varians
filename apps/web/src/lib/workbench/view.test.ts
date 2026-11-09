import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds } from '@varians/core';
import { asWrittenLines, describeSetAside, floatingPosition, lineCount } from './view.ts';
import type { Token } from '@varians/core';

describe('floatingPosition', () => {
  const container = { top: 100, left: 50, width: 600, height: 400 };
  const size = { width: 200, height: 40 };

  it('stands under the selection, aligned with it', () => {
    const at = floatingPosition({ top: 150, bottom: 170, left: 120, right: 200 }, container, size);
    expect(at).toEqual({ top: 78, left: 70, placement: 'below' });
  });

  it('goes above when there is no room below and stays inside sideways', () => {
    const at = floatingPosition({ top: 460, bottom: 480, left: 600, right: 640 }, container, size);
    expect(at.placement).toBe('above');
    expect(at.top).toBe(460 - 100 - 8 - 40);
    expect(at.left).toBe(600 - 200 - 8);
  });
});

describe('lineCount and describeSetAside', () => {
  it('counts lines with words', () => {
    expect(lineCount(fromText('a b\n\nc', { ids: sequentialIds() }))).toBe(2);
    expect(lineCount({ items: [] })).toBe(0);
  });

  it('says what a conflict set aside', () => {
    const typed = fromText('νέον', { ids: sequentialIds('n') });
    const out = describeSetAside([
      { t: 'insert', after: 'x', items: typed.items },
      { t: 'set', id: 'a', fields: { norm: 'ἄειδε' } },
      { t: 'set', id: 'b', fields: { marks: [] } },
      { t: 'delete', ids: ['c', 'd'] },
    ]);
    expect(out).toEqual({ words: ['νέον', 'ἄειδε'], removed: 2, other: 1 });
  });
});

describe('asWrittenLines', () => {
  it('runs the words of a line together, keeping recorded separators', () => {
    const s = fromText('ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΠΗΛΗΙΑΔΕΩ', { ids: sequentialIds() });
    (s.items[2] as Token).sep = 'interpunct';
    expect(asWrittenLines(s)).toEqual(['ΜΗΝΙΝΑΕΙΔΕ·ΘΕΑ', 'ΠΗΛΗΙΑΔΕΩ']);
  });
});
