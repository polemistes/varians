/**
 * Printing a segment the edition does not print (docs/design.md, section
 * 3.10, "Whole segments"): the variant of such a segment stands after the
 * edition's segment the work's numbering puts it after, and adopting one of
 * its readings puts the segment's words there, on a line of their own.
 */

import type { Reading } from '../collate/collate.ts';
import { newId } from '../ids.ts';
import { isBreak, isToken, type Id, type Obj, type Stream, type Token } from '../stream/items.ts';
import { repairSegmentStartsFrom } from '../stream/move.ts';
import { applyOp, type Op } from '../stream/ops.ts';
import { runsOfSegment } from '../stream/words.ts';
import { ownLineInsert, tokensFromReading, type AdoptOptions } from './adopt.ts';

/**
 * The item a segment printed after the segment `after` follows: the last
 * word of `after` in content order (in its run of the highest part), or the
 * last of what follows that word on its line within the run (a mark, a note,
 * a lacuna), which stays on the line it is on. Where `after` has no word,
 * the last item of its last run that is not a break. Null when `after` has
 * nothing in the stream.
 */
export function printPlace(stream: Stream, after: Id): Id | null {
  const runs = runsOfSegment(stream, after);
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r]!;
    let last = -1;
    for (let i = run.from; i < run.to; i++) if (isToken(stream.items[i])) last = i;
    if (last < 0) continue;
    let end = last;
    while (end + 1 < run.to && !isBreak(stream.items[end + 1])) end++;
    return stream.items[end]!.id;
  }
  const run = runs[runs.length - 1];
  if (!run) return null;
  for (let i = run.to - 1; i >= run.from; i--) {
    const item = stream.items[i]!;
    if (!isBreak(item)) return item.id;
  }
  return null;
}

/**
 * Print a segment after the segment `after`: the items go after the item
 * `printPlace` names, on a line of their own (a line break before them, and
 * one after them where text follows on the same line; where an empty line
 * follows directly, they fill it), the first of them
 * starting the segment and the others in it. No other word changes segment:
 * where something of `after` follows on a later line (an object before the
 * next segment's start), the inserted line would take it into the new
 * segment, so it is given an explicit start, and the parts of `after` are
 * numbered in content order, as a move numbers them. Nothing when there are
 * no items or `after` has nothing in the stream.
 */
export function printSegment(
  stream: Stream,
  segmentId: Id,
  after: Id,
  items: (Token | Obj)[],
  options: AdoptOptions = {},
): Op[] {
  if (items.length === 0) return [];
  const at = printPlace(stream, after);
  if (at === null) return [];
  const line: (Token | Obj)[] = items.map((item, k) => {
    const { segment: _segment, ...rest } = item;
    void _segment;
    return (k === 0 ? { ...rest, segment: { segmentId } } : rest) as Token | Obj;
  });
  const op = ownLineInsert(stream, at, line, options.ids ?? newId);
  const printed = applyOp(stream, op).stream;
  return [op, ...repairSegmentStartsFrom([stream, { items: line }], printed)];
}

/** Print a segment from a witness's reading of it: its words, sourced from the witness, after the segment `after`. */
export function printReading(
  stream: Stream,
  segmentId: Id,
  after: Id,
  reading: Reading,
  textId: Id,
  options: AdoptOptions = {},
): Op[] {
  return printSegment(
    stream,
    segmentId,
    after,
    tokensFromReading(reading, textId, options),
    options,
  );
}
