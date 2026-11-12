import { describe, expect, it } from 'vitest';
import { compareOrder, fromText, sequentialIds, type Stream, type Token } from '@varians/core';
import { orderStatements } from './reader.ts';
import type { EditionContext } from './collation.ts';

function lined(labels: string[], prefix: string): Stream {
  const s = fromText(labels.map((l) => `w${l}`).join('\n'), {
    lang: 'grc',
    ids: sequentialIds(prefix),
  });
  let k = 0;
  for (const item of s.items)
    if (item.kind === 'token') (item as Token).segment = { segmentId: labels[k++]! };
  return s;
}

describe('orderStatements', () => {
  it('reports a witness that has a line elsewhere', () => {
    const context = {
      edition: {
        id: 'e',
        workId: 'w',
        content: lined(['976', '977', '978', '1000'], 'e'),
        version: 1,
      },
      sigla: [
        { siglum: 'A', witnessId: 'a', transcriptionId: 'ta', states: [], variantSiglum: null },
        { siglum: 'B', witnessId: 'b', transcriptionId: 'tb', states: [], variantSiglum: null },
      ],
      transcriptions: new Map([
        [
          'ta',
          {
            id: 'ta',
            content: lined(['976', '977', '978', '1000'], 'a'),
            version: 1,
            witnessId: 'a',
          },
        ],
        [
          'tb',
          {
            id: 'tb',
            content: lined(['976', '1000', '977', '978'], 'b'),
            version: 1,
            witnessId: 'b',
          },
        ],
      ]),
      siteKinds: new Map(),
      witnessHands: new Map(),
    } satisfies EditionContext;
    expect(orderStatements(context)).toEqual([{ siglum: 'B', moved: ['1000'], after: '976' }]);
  });

  it('says what comparing the orders says, for witnesses that keep the order, drop segments, move them and have others', () => {
    const edition = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const witnessOrders: Record<string, string[]> = {
      keeps: edition,
      drops: ['1', '3', '4', '8'],
      moves: ['1', '4', '5', '2', '3', '6', '7', '8'],
      reverses: [...edition].reverse(),
      other: ['9', '1', '2', '10', '3'],
      nothing: ['9', '10'],
    };
    const ids = Object.keys(witnessOrders);
    const context = {
      edition: { id: 'e', workId: 'w', content: lined(edition, 'e'), version: 1 },
      sigla: ids.map((id) => ({
        siglum: id,
        witnessId: `w${id}`,
        transcriptionId: `t${id}`,
        states: [],
        variantSiglum: null,
      })),
      transcriptions: new Map(
        ids.map((id) => [
          `t${id}`,
          { id: `t${id}`, content: lined(witnessOrders[id]!, id), version: 1, witnessId: `w${id}` },
        ]),
      ),
      siteKinds: new Map(),
      witnessHands: new Map(),
    } satisfies EditionContext;
    const expected = ids.flatMap((id) =>
      compareOrder(
        edition,
        witnessOrders[id]!.filter((x) => edition.includes(x)),
      ).map((statement) => ({ siglum: id, moved: statement.moved, after: statement.after })),
    );
    expect(orderStatements(context)).toEqual(expected);
    // Asked again, with the orders remembered, it says the same.
    expect(orderStatements(context)).toEqual(expected);
    expect(expected.map((x) => x.siglum)).not.toContain('keeps');
    expect(expected.map((x) => x.siglum)).not.toContain('drops');
  });
});
