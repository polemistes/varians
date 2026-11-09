/**
 * Changesets: the unit of a document's history. Every save is one; the
 * server stores the operations and their reverse. Everything here is pure.
 */

import type { Id } from '../stream/items.ts';
import { touchedIds, type Op } from '../stream/ops.ts';

export interface Changeset {
  id: Id;
  documentId: Id;
  /** The document version this changeset produced. */
  version: number;
  userId: Id;
  /** ISO 8601 time. */
  at: string;
  ops: Op[];
  reverse: Op[];
  message?: string;
}

/** The ids two lists of operations have in common: non-empty means they conflict. */
export function conflictingIds(ops: Op[], others: Op[]): Id[] {
  const mine = new Set(ops.flatMap(touchedIds));
  const out = new Set<Id>();
  for (const op of others) for (const id of touchedIds(op)) if (mine.has(id)) out.add(id);
  return [...out];
}

/**
 * Whether undoing `target` is safe given the changesets made after it:
 * none of them touched an item the target touched.
 */
export function undoConflicts(target: Changeset, later: Changeset[]): Id[] {
  return conflictingIds(
    target.reverse,
    later.flatMap((c) => c.ops),
  );
}

/** Several changesets as one: the operations in order, the reverse in reverse order. */
export function compose(changesets: Changeset[]): Pick<Changeset, 'ops' | 'reverse'> {
  return {
    ops: changesets.flatMap((c) => c.ops),
    reverse: [...changesets].reverse().flatMap((c) => c.reverse),
  };
}

export interface Session {
  userId: Id;
  from: string;
  to: string;
  fromVersion: number;
  toVersion: number;
  changesets: Changeset[];
}

/** Group consecutive changesets by one person within a pause into sessions. */
export function sessions(changesets: Changeset[], pauseMs = 20 * 60 * 1000): Session[] {
  const sorted = [...changesets].sort((a, b) => a.version - b.version);
  const out: Session[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && last.userId === c.userId && Date.parse(c.at) - Date.parse(last.to) <= pauseMs) {
      last.to = c.at;
      last.toVersion = c.version;
      last.changesets.push(c);
    } else {
      out.push({ userId: c.userId, from: c.at, to: c.at, fromVersion: c.version, toVersion: c.version, changesets: [c] });
    }
  }
  return out;
}

export interface ThinningRules {
  /** Changesets older than this are merged by the hour. */
  hourlyAfterMs: number;
  /** Changesets older than this are merged by the day. */
  dailyAfterMs: number;
  /** Versions that must stay as they are: named moments, checkpoints, review marks. */
  keep: Set<number>;
  now: number;
}

/**
 * Thin a history: merge the changesets of one person within one hour (then
 * one day) into one, once they are old enough, never merging across a kept
 * version. The result is a shorter list of changesets covering the same
 * changes; each merged changeset takes the version and time of its last member.
 */
export function thin(changesets: Changeset[], rules: ThinningRules): Changeset[] {
  const sorted = [...changesets].sort((a, b) => a.version - b.version);
  const out: Changeset[] = [];
  let bucket: Changeset[] = [];
  let bucketKey: string | null = null;
  const flush = () => {
    if (bucket.length === 0) return;
    if (bucket.length === 1) out.push(bucket[0]!);
    else {
      const last = bucket[bucket.length - 1]!;
      const composed = compose(bucket);
      out.push({ ...last, ops: composed.ops, reverse: composed.reverse });
    }
    bucket = [];
  };
  for (const c of sorted) {
    const age = rules.now - Date.parse(c.at);
    let granularity: 'none' | 'hour' | 'day' = 'none';
    if (age > rules.dailyAfterMs) granularity = 'day';
    else if (age > rules.hourlyAfterMs) granularity = 'hour';
    if (granularity === 'none') {
      flush();
      out.push(c);
      bucketKey = null;
      continue;
    }
    const date = new Date(c.at);
    const slot =
      granularity === 'day'
        ? date.toISOString().slice(0, 10)
        : date.toISOString().slice(0, 13);
    const key = `${c.userId}|${granularity}|${slot}`;
    if (key !== bucketKey) {
      flush();
      bucketKey = key;
    }
    bucket.push(c);
    if (rules.keep.has(c.version)) {
      flush();
      bucketKey = null;
    }
  }
  flush();
  return out;
}
