/**
 * The document at earlier versions, rebuilt from the current content back
 * through the reverses of the changesets. One walk serves a whole history:
 * each step hands over the states before and after one changeset, so that
 * only two states are held at a time.
 */

import { applyOps, type Changeset, type Stream } from '@varians/core';

/**
 * Walk back from the current content through the changesets, newest first,
 * calling `step` with each changeset and the states before and after it.
 * Stops at `stopAt` or at a hole in the log (a missing version). Returns
 * the oldest version reached.
 */
export function walkBack(
  current: Stream,
  currentVersion: number,
  log: Changeset[],
  step: (changeset: Changeset, before: Stream, after: Stream) => void,
  stopAt = 0,
): number {
  const sorted = log.filter((c) => c.version <= currentVersion && c.version > stopAt).sort((a, b) => b.version - a.version);
  let stream = current;
  let version = currentVersion;
  for (const c of sorted) {
    if (c.version !== version) break;
    const before = applyOps(stream, c.reverse).stream;
    step(c, before, stream);
    stream = before;
    version = c.version - 1;
  }
  return version;
}
