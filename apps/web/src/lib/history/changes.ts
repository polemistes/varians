/**
 * The list of changes between two versions of a document, as a version
 * carries it and the Publish… window shows it: what each changeset between
 * them says of itself (an import, a copy, pages reorganized), and the words
 * added, changed and removed, counted by segment from the difference between
 * the text at the one and at the other. Pure.
 */

import { segmentRuns, type Stream } from '@varians/core';
import type { VersionChanges } from '@varians/db';
import { diffStates } from './diff.ts';

/** A changeset as the list reads it: its place, its time and what it says of itself. */
export interface DescribedChangeset {
  version: number;
  at: string;
  message?: string | null;
}

/** The segment each item of a text lies in, by item id; null for an item before any segment starts. */
function segmentOfItems(stream: Stream): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const run of segmentRuns(stream))
    for (let i = run.from; i < run.to; i++) out.set(stream.items[i]!.id, run.segmentId);
  return out;
}

/** The segments of a text in the order they first appear. */
function segmentOrder(stream: Stream): (string | null)[] {
  const seen = new Set<string | null>();
  const out: (string | null)[] = [];
  for (const run of segmentRuns(stream)) {
    if (seen.has(run.segmentId)) continue;
    seen.add(run.segmentId);
    out.push(run.segmentId);
  }
  return out;
}

/**
 * The changes from the text `before` (at changeset version `from`) to the
 * text `after` (at `to`), with the changesets between them. A word added or
 * changed is counted in the segment it lies in afterwards, a word removed in
 * the segment it lay in; a word only moved is none of these. The segments
 * stand in the order of the text after, those that are gone after them in the
 * order of the text before. A changeset's description is given once where
 * several in a row say the same.
 */
export function changesBetween(
  before: Stream,
  after: Stream,
  from: number,
  to: number,
  changesets: readonly DescribedChangeset[],
  labelOf: (segmentId: string) => string | null,
): VersionChanges {
  const was = segmentOfItems(before);
  const now = segmentOfItems(after);
  const counts = new Map<string | null, { added: number; changed: number; removed: number }>();
  const count = (segmentId: string | null, what: 'added' | 'changed' | 'removed') => {
    const entry = counts.get(segmentId) ?? { added: 0, changed: 0, removed: 0 };
    entry[what] += 1;
    counts.set(segmentId, entry);
  };
  for (const change of diffStates(before, after).changes) {
    switch (change.kind) {
      case 'added':
        if (change.item.kind === 'token') count(now.get(change.item.id) ?? null, 'added');
        break;
      case 'removed':
        if (change.item.kind === 'token') count(was.get(change.item.id) ?? null, 'removed');
        break;
      case 'changed':
        count(now.get(change.after.id) ?? null, 'changed');
        break;
      case 'moved':
        break;
    }
  }
  const order = [...segmentOrder(after), ...segmentOrder(before)];
  const rank = new Map<string | null, number>();
  for (const id of order) if (!rank.has(id)) rank.set(id, rank.size);
  const segments = [...counts]
    .sort((a, b) => (rank.get(a[0]) ?? rank.size) - (rank.get(b[0]) ?? rank.size))
    .map(([segmentId, c]) => ({
      segmentId,
      label: segmentId === null ? null : labelOf(segmentId),
      ...c,
    }));
  const described: VersionChanges['described'] = [];
  for (const c of [...changesets].sort((a, b) => a.version - b.version)) {
    if (c.version <= from || c.version > to || !c.message) continue;
    if (described.at(-1)?.message === c.message) continue;
    described.push({ version: c.version, at: c.at, message: c.message });
  }
  const total = (what: 'added' | 'changed' | 'removed') =>
    segments.reduce((sum, s) => sum + s[what], 0);
  return {
    from,
    to,
    described,
    segments,
    added: total('added'),
    changed: total('changed'),
    removed: total('removed'),
  };
}
