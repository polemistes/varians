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
import { walkBack } from './states.ts';

/** A log built by applying ops in turn, as the save protocol would. */
function build(start: Stream, steps: Op[][]): { log: Changeset[]; states: Stream[] } {
  const states = [start];
  const log: Changeset[] = [];
  let stream = start;
  steps.forEach((ops, i) => {
    const applied = applyOps(stream, ops);
    stream = applied.stream;
    states.push(stream);
    log.push({
      id: `c${i + 1}`,
      documentId: 'd',
      version: i + 1,
      userId: 'u',
      at: '2026-10-02T10:00:00Z',
      ops,
      reverse: applied.reverse,
    });
  });
  return { log, states };
}

describe('walkBack', () => {
  const start: Stream = { items: [] };
  const { log, states } = build(start, [
    [
      {
        t: 'insert',
        after: null,
        items: fromText('a b c', { lang: 'en', ids: sequentialIds() }).items,
      },
    ],
    [{ t: 'set', id: 't2', fields: { form: 'B' } }],
    [{ t: 'delete', ids: ['t3'] }],
    [{ t: 'insert', after: 't1', items: [{ kind: 'token', id: 'n', form: 'x' }] }],
  ]);
  const current = states[4]!;

  it('hands over the states before and after each changeset, newest first', () => {
    const seen: [number, string, string][] = [];
    const oldest = walkBack(current, 4, log, (c, before, after) =>
      seen.push([c.version, toText(before), toText(after)]),
    );
    expect(oldest).toBe(0);
    expect(seen).toEqual([
      [4, 'a B', 'a x B'],
      [3, 'a B c', 'a B'],
      [2, 'a b c', 'a B c'],
      [1, '', 'a b c'],
    ]);
  });

  it('stops at the version asked and at a hole in the log', () => {
    expect(walkBack(current, 4, log, () => {}, 2)).toBe(2);
    expect(
      walkBack(
        current,
        4,
        log.filter((c) => c.version !== 3),
        () => {},
      ),
    ).toBe(3);
  });
});
