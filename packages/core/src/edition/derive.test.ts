import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Token } from '../stream/items.ts';
import { fromText, toText } from '../stream/text.ts';
import { deriveEdition, deriveTranscription } from './derive.ts';

describe('deriveEdition', () => {
  it('prints read forms, keeps lines and segment starts, drops page breaks and marks', () => {
    const s = fromText('ΜΗΝΙΝ ΑΕΙΔΕ\nΘΕΑ', { ids: sequentialIds('a') });
    (s.items[0] as Token).norm = 'μῆνιν';
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[0] as Token).marks = [{ kind: 'unclear' }];
    s.items.splice(2, 0, { kind: 'break', id: 'pb', type: 'page', pageId: 'p1' });
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    expect(toText(e)).toBe('μῆνιν ΑΕΙΔΕ\nΘΕΑ');
    const first = e.items[0] as Token;
    expect(first.source).toEqual({ kind: 'witness', transcriptionId: 'T', tokenIds: ['a1'] });
    expect(first.segment).toEqual({ segmentId: 's1' });
    expect(first.marks).toBeUndefined();
    expect(e.items.filter((i) => i.kind === 'break').map((b) => (b as { type: string }).type)).toEqual(['line']);
  });

  it('keeps only the segments asked for', () => {
    const s = fromText('a b\nc d\ne f', { ids: sequentialIds('a') });
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[3] as Token).segment = { segmentId: 's2' };
    (s.items[6] as Token).segment = { segmentId: 's3' };
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e'), segmentIds: new Set(['s2']) });
    expect(toText(e)).toBe('c d');
  });
});

describe('deriveTranscription', () => {
  it('copies everything with new ids and no sources', () => {
    const s = fromText('a b', { ids: sequentialIds('a') });
    (s.items[0] as Token).source = { kind: 'editor' };
    (s.items[0] as Token).marks = [{ kind: 'unclear' }];
    const t = deriveTranscription(s, { ids: sequentialIds('n') });
    expect(t.items.map((i) => i.id)).toEqual(['n1', 'n2']);
    expect((t.items[0] as Token).marks).toEqual([{ kind: 'unclear' }]);
    expect((t.items[0] as Token).source).toBeUndefined();
    expect(toText(t)).toBe('a b');
  });
});
