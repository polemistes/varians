import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Token } from '../stream/items.ts';
import { fromText } from '../stream/text.ts';
import { layoutLines } from './layout.ts';

function verse(): ReturnType<typeof fromText> {
  const lines = Array.from({ length: 12 }, (_, i) => `word${i + 1} more`);
  const s = fromText(lines.join('\n'), { ids: sequentialIds() });
  let n = 1;
  for (const item of s.items) {
    if (item.kind === 'token' && item.form.startsWith('word'))
      (item as Token).segment = { segmentId: `s${n++}` };
  }
  return s;
}

describe('layoutLines', () => {
  it('prints every fifth label and the first', () => {
    const lines = layoutLines(verse(), (id) => `1.${id.slice(1)}`, { numberEvery: 5 });
    expect(lines).toHaveLength(12);
    expect(lines.map((l) => l.label)).toEqual([
      '1.1',
      null,
      null,
      null,
      '1.5',
      null,
      null,
      null,
      null,
      '1.10',
      null,
      null,
    ]);
    expect(lines[4]!.starts[0]!.segmentId).toBe('s5');
  });

  it('prints every label when asked, and notes paragraphs and pages', () => {
    const s = fromText('a b\nc d', { ids: sequentialIds() });
    (s.items[0] as Token).segment = { segmentId: 'x' };
    (s.items[3] as Token).segment = { segmentId: 'y' };
    s.items[2] = { kind: 'break', id: 'pb', type: 'page', pageId: 'p1' };
    const lines = layoutLines(s, (id) => id.toUpperCase());
    expect(lines.map((l) => l.label)).toEqual(['X', 'Y']);
    expect(lines[1]!.pageId).toBe('p1');
    expect(lines[0]!.items.map((i) => i.id)).toEqual(['t1', 't2']);
  });
});
