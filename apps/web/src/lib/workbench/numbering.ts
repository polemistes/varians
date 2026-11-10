/**
 * "Number lines from here": for verse, every line from the
 * caret's to the end of the page gets the next label in sequence on its
 * first word. Pure: which tokens, which labels, which operations.
 */

import { isBreak, isToken, lines, type Id, type Op, type Stream } from '@varians/core';
import { segmentOp } from './segments.ts';

/**
 * The first token of each line, from the line holding `fromItemId` to the
 * end of `stream` (a page), at most `count` of them. Lines without words are
 * passed over, and so is a line whose first word continues a word divided
 * at the previous line's end: a segment cannot begin inside a word.
 */
export function lineStarts(stream: Stream, fromItemId: Id, count?: number): Id[] {
  const index = stream.items.findIndex((item) => item.id === fromItemId);
  if (index < 0) return [];
  const out: Id[] = [];
  let started = false;
  for (const line of lines(stream)) {
    if (!started) {
      // The line holding the item: the item stands in [from, to], a break ends its line.
      if (index > line.to || (index === line.to && !isBreak(stream.items[index]))) continue;
      started = true;
    }
    if (count !== undefined && out.length >= count) break;
    let first: Id | null = null;
    for (let i = line.from; i < line.to; i++) {
      const item = stream.items[i]!;
      if (isToken(item)) {
        first = continuesWord(stream, i) ? null : item.id;
        break;
      }
    }
    if (first) out.push(first);
  }
  return out;
}

/** Whether the token at `index` is the continuation of a word divided at a line's end. */
function continuesWord(stream: Stream, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const item = stream.items[i]!;
    if (isBreak(item)) continue;
    return isToken(item) && item.joinNext === true;
  }
  return false;
}

/** `n` labels from `start`, each the next of the one before; shorter when no label follows. */
export function labelSequence(
  start: string,
  n: number,
  next: (label: string) => string | null,
): string[] {
  const out: string[] = [];
  let label: string | null = start;
  while (label !== null && out.length < n) {
    out.push(label);
    label = next(label);
  }
  return out;
}

/** One set operation per token, giving each the segment at the same index. */
export function numberingOps(tokenIds: Id[], segmentIds: Id[]): Op[] {
  const ops: Op[] = [];
  const n = Math.min(tokenIds.length, segmentIds.length);
  for (let i = 0; i < n; i++) ops.push(segmentOp(tokenIds[i]!, segmentIds[i]!));
  return ops;
}
