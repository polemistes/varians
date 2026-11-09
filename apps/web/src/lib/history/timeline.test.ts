import { describe, expect, it } from 'vitest';
import { buildTimeline, compareOptions } from './timeline.ts';
import type { HistoryMoment, HistorySession } from './types.ts';
import { emptyCounts } from './summary.ts';

const session = (fromVersion: number, toVersion: number, to = '2026-10-02T10:00:00Z'): HistorySession => ({
  key: `s${fromVersion}`,
  userId: 'u',
  userName: 'U',
  from: to,
  to,
  fromVersion,
  toVersion,
  changesets: [],
  counts: emptyCounts(),
  summary: '',
});

const moment = (id: string, version: number, at = '2026-10-02T11:00:00Z'): HistoryMoment => ({
  id,
  version,
  name: id,
  kind: 'named',
  number: null,
  createdBy: 'u',
  createdByName: 'U',
  at,
});

describe('buildTimeline', () => {
  const timeline = buildTimeline([session(6, 9), session(4, 5), session(1, 3)], [moment('draft', 5), moment('start', 3)]);

  it('lists sessions and moments newest first, a moment above the session it closes', () => {
    expect(timeline.map((e) => e.key)).toEqual(['s6', 'mdraft', 's4', 'mstart', 's1']);
  });

  it('opens a session at its last version with its own changes, a moment with the changes since the moment before', () => {
    const byKey = Object.fromEntries(timeline.map((e) => [e.key, [e.version, e.since]]));
    expect(byKey).toEqual({ s6: [9, 5], mdraft: [5, 3], s4: [5, 3], mstart: [3, 0], s1: [3, 0] });
  });

  it('offers each earlier version once to compare with, and the beginning', () => {
    expect(compareOptions(timeline, 9).map((o) => [o.version, o.entry?.key ?? null])).toEqual([
      [5, 'mdraft'],
      [3, 'mstart'],
      [0, null],
    ]);
    expect(compareOptions(timeline, 3)).toEqual([{ version: 0, entry: null }]);
  });
});
