import { describe, expect, it } from 'vitest';
import { applyOps, fromText, sequentialIds, type Stream, type Token } from '@varians/core';
import { changesBetween } from './changes.ts';

/** Two lines, the first in segment s1 and the second in s2. */
function text(): Stream {
  const stream = fromText('a b c\nd e f', { lang: 'en', ids: sequentialIds() });
  const tokens = stream.items.filter((i): i is Token => i.kind === 'token');
  tokens[0]!.segment = { segmentId: 's1', part: 1 };
  tokens[3]!.segment = { segmentId: 's2', part: 1 };
  return stream;
}

const labels: Record<string, string> = { s1: '1.1', s2: '1.2' };
const labelOf = (id: string) => labels[id] ?? null;

describe('changesBetween', () => {
  it('counts the words added, changed and removed by segment, in the order of the text', () => {
    const before = text();
    const tokens = before.items.filter((i): i is Token => i.kind === 'token');
    const after = applyOps(before, [
      { t: 'set', id: tokens[4]!.id, fields: { form: 'E' } },
      { t: 'delete', ids: [tokens[1]!.id] },
      {
        t: 'insert',
        after: tokens[5]!.id,
        items: [{ kind: 'token', id: 'new', form: 'g', lang: 'en', sep: 'space' }],
      },
    ]).stream;
    const changes = changesBetween(before, after, 0, 3, [], labelOf);
    expect(changes.segments).toEqual([
      { segmentId: 's1', label: '1.1', added: 0, changed: 0, removed: 1 },
      { segmentId: 's2', label: '1.2', added: 1, changed: 1, removed: 0 },
    ]);
    expect([changes.added, changes.changed, changes.removed]).toEqual([1, 1, 1]);
    expect([changes.from, changes.to]).toEqual([0, 3]);
  });

  it('gives what the changesets between say of themselves, once where several say the same', () => {
    const before = text();
    const changes = changesBetween(
      before,
      before,
      2,
      6,
      [
        { version: 2, at: '2026-11-01T00:00:00.000Z', message: 'import' },
        { version: 3, at: '2026-11-02T00:00:00.000Z', message: 'import' },
        { version: 4, at: '2026-11-03T00:00:00.000Z', message: 'import' },
        { version: 5, at: '2026-11-04T00:00:00.000Z', message: null },
        { version: 6, at: '2026-11-05T00:00:00.000Z', message: 'pages reorganized' },
        { version: 7, at: '2026-11-06T00:00:00.000Z', message: 'later' },
      ],
      labelOf,
    );
    expect(changes.described).toEqual([
      { version: 3, at: '2026-11-02T00:00:00.000Z', message: 'import' },
      { version: 6, at: '2026-11-05T00:00:00.000Z', message: 'pages reorganized' },
    ]);
    expect(changes.segments).toEqual([]);
  });

  it('counts the words of a first version as added', () => {
    const after = text();
    const changes = changesBetween({ items: [] }, after, 0, 1, [], labelOf);
    expect(changes.segments.map((s) => [s.label, s.added])).toEqual([
      ['1.1', 3],
      ['1.2', 3],
    ]);
  });
});
