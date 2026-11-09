import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Stream, type Token } from '@varians/core';
import { orderStatements } from './reader.ts';
import type { EditionContext } from './collation.ts';

function lined(labels: string[], prefix: string): Stream {
  const s = fromText(labels.map((l) => `w${l}`).join('\n'), { ids: sequentialIds(prefix) });
  let k = 0;
  for (const item of s.items) if (item.kind === 'token') (item as Token).segment = { segmentId: labels[k++]! };
  return s;
}

describe('orderStatements', () => {
  it('reports a witness that has a line elsewhere', () => {
    const context = {
      edition: { id: 'e', workId: 'w', content: lined(['976', '977', '978', '1000'], 'e'), version: 1 },
      profile: { language: 'grc' } as EditionContext['profile'],
      sigla: [
        { siglum: 'A', witnessId: 'a', transcriptionId: 'ta', states: [], variantSiglum: null },
        { siglum: 'B', witnessId: 'b', transcriptionId: 'tb', states: [], variantSiglum: null },
      ],
      transcriptions: new Map([
        ['ta', { id: 'ta', content: lined(['976', '977', '978', '1000'], 'a'), version: 1, witnessId: 'a' }],
        ['tb', { id: 'tb', content: lined(['976', '1000', '977', '978'], 'b'), version: 1, witnessId: 'b' }],
      ]),
      siteKinds: new Map(),
      witnessHands: new Map(),
    } satisfies EditionContext;
    expect(orderStatements(context)).toEqual([{ siglum: 'B', moved: ['1000'], after: '976' }]);
  });
});
