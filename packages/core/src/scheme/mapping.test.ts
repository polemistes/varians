import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { fromText } from '../stream/text.ts';
import { addressFromParts, applyStarts, proposeMapping, resolveStarts } from './mapping.ts';
import { SCHEME_PRESETS } from './scheme.ts';

const epic = SCHEME_PRESETS[0]!.scheme;
const stephanus = SCHEME_PRESETS[2]!.scheme;

describe('proposeMapping', () => {
  it('maps units to levels by name and synonym', () => {
    expect(proposeMapping(['book', 'line'], epic)).toEqual({ book: 'book', line: 'line' });
    expect(proposeMapping(['Book', 'l'], epic)).toEqual({ Book: 'book', l: 'line' });
    expect(proposeMapping(['page', 'section'], stephanus)).toEqual({ page: 'page', section: 'section' });
    expect(proposeMapping(['textpart', 'line'], epic)).toEqual({ line: 'line', textpart: 'book' });
  });
});

describe('addressFromParts and resolveStarts', () => {
  it('fills a full address from div and line parts', () => {
    const address = addressFromParts([{ unit: 'book', n: '1' }, { unit: 'line', n: '5' }], { book: 'book', line: 'line' }, epic);
    expect(address).toEqual({ book: '1', line: '5' });
  });

  it('carries higher levels over from the previous start', () => {
    const { resolved, unresolved } = resolveStarts(
      [
        { itemIndex: 0, parts: [{ unit: 'page', n: '17' }, { unit: 'section', n: 'a' }] },
        { itemIndex: 5, parts: [{ unit: 'section', n: 'b' }] },
        { itemIndex: 9, parts: [{ unit: 'page', n: '18' }, { unit: 'section', n: 'a' }] },
      ],
      { page: 'page', section: 'section' },
      stephanus,
    );
    expect(resolved.map((r) => r.label)).toEqual(['17a', '17b', '18a']);
    expect(unresolved).toEqual([]);
  });

  it('reports a start that cannot be completed', () => {
    const { resolved, unresolved } = resolveStarts([{ itemIndex: 0, parts: [{ unit: 'line', n: '5' }] }], { line: 'line' }, epic);
    expect(resolved).toEqual([]);
    expect(unresolved).toHaveLength(1);
  });

  it('lets an unnamed part fill the deepest level', () => {
    expect(addressFromParts([{ unit: null, n: '7' }], {}, epic, { book: '2', line: '6' })).toEqual({ book: '2', line: '7' });
  });
});

describe('applyStarts', () => {
  it('puts starts on tokens, moving off breaks', () => {
    const s = fromText('a b\nc d', { ids: sequentialIds() });
    const out = applyStarts(s, [
      { itemIndex: 0, segmentId: 's1' },
      { itemIndex: 2, segmentId: 's2' },
    ]);
    expect((out.items[0] as { segment?: unknown }).segment).toEqual({ segmentId: 's1' });
    expect((out.items[3] as { segment?: unknown }).segment).toEqual({ segmentId: 's2' });
    expect((out.items[2] as { segment?: unknown }).segment).toBeUndefined();
  });
});
