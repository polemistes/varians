import { describe, expect, it } from 'vitest';
import { site } from './site.ts';

describe('the import report', () => {
  const t = site.import;

  it('words what became of a text', () => {
    expect(t.result('merged')).toBe('changes on both sides taken together');
    expect(t.result('kept', 'segments')).toBe('kept as it is here');
    expect(t.result('something new')).toBe('something new');
  });

  it('words a conflict by its reason', () => {
    const same = 'changed on both sides in the same words: left as it is';
    expect(t.result('conflict')).toBe(same);
    expect(t.result('conflict', 'overlap')).toBe(same);
    expect(t.result('conflict', 'inapplicable')).toBe(same);
    expect(t.result('conflict', 'missing-anchor')).toBe(
      'changed there in words removed here: left as it is',
    );
    expect(t.result('conflict', 'segments')).toBe(
      'changed on both sides so that words would pass into another segment: left as it is',
    );
    // A history that does not fit, however the core or the import names it.
    const history = 'with a history there that does not continue the one here: left as it is';
    for (const reason of ['unrelated', 'rewritten', 'partial-merge', 'the archive is not a chain'])
      expect(t.result('conflict', reason)).toBe(history);
  });
});
