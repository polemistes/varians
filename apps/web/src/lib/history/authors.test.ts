import { describe, expect, it } from 'vitest';
import {
  applyOps,
  fromText,
  sequentialIds,
  toText,
  type Changeset,
  type Op,
  type Stream,
} from '@varians/core';
import { applyWithAuthors, changedIds } from './authors.ts';

const cs = (version: number, userId: string, ops: Op[]): Changeset => ({
  id: `c${version}`,
  documentId: 'd',
  version,
  userId,
  at: '2026-10-02T10:00:00Z',
  ops,
  reverse: [],
});

describe('authors', () => {
  const start: Stream = fromText('a b c', { lang: 'en', ids: sequentialIds() });

  it('names the ids an operation changes, not the anchors it stands beside', () => {
    expect(
      changedIds(start, {
        t: 'insert',
        after: 't1',
        items: [{ kind: 'token', id: 'n', form: 'x' }],
      }),
    ).toEqual(['n']);
    expect(changedIds(start, { t: 'join', id: 't1' })).toEqual(['t1', 't2']);
    expect(changedIds(start, { t: 'move', ids: ['t3'], after: null })).toEqual(['t3']);
    expect(changedIds(start, { t: 'split', id: 't1', at: 1, newId: 's' })).toEqual(['t1', 's']);
  });

  it('applies changesets in order and keeps who changed each item last', () => {
    const { stream, authors } = applyWithAuthors(start, [
      cs(2, 'bob', [{ t: 'set', id: 't2', fields: { form: 'B' } }]),
      cs(1, 'ann', [
        { t: 'set', id: 't1', fields: { form: 'A' } },
        { t: 'set', id: 't2', fields: { form: 'b2' } },
      ]),
      cs(3, 'ann', [{ t: 'join', id: 't2' }]),
    ]);
    expect(toText(stream)).toBe('A Bc');
    expect(Object.fromEntries(authors)).toEqual({ t1: 'ann', t2: 'ann', t3: 'ann' });
    expect(toText(applyOps(start, [{ t: 'set', id: 't1', fields: { form: 'A' } }]).stream)).toBe(
      'A b c',
    );
  });
});
