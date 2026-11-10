/**
 * Segment starts in the workbench: the label proposed for a
 * token, the part number of a segment that already has a run elsewhere, and
 * the operation that sets or removes a start. Pure.
 */

import {
  isBreak,
  nextLabel,
  segmentStartOf,
  type Id,
  type Op,
  type Scheme,
  type SegmentStart,
  type Stream,
} from '@varians/core';

/** What the workbench knows of a segment the stream names. */
export interface SegmentInfo {
  label: string;
  workId: string;
}

/** The nearest segment start strictly before an item, with the item carrying it; null when there is none. */
export function startBefore(
  stream: Stream,
  itemId: Id,
): { itemId: Id; start: SegmentStart } | null {
  const index = stream.items.findIndex((item) => item.id === itemId);
  for (let i = (index < 0 ? stream.items.length : index) - 1; i >= 0; i--) {
    const item = stream.items[i]!;
    const start = segmentStartOf(item);
    if (start) return { itemId: item.id, start };
  }
  return null;
}

export interface LabelProposal {
  /** The label to pre-fill: the one shown at the token, else the one after the previous start's. */
  label: string;
  /** The work the label belongs to, when it is known. */
  workId: string | null;
  /** The token begins a segment already. */
  current: boolean;
}

/**
 * The label proposed for a segment beginning at `tokenId`: the label of the
 * start the token carries, else the label after the previous start in the
 * stream (through the scheme of that start's work), else empty.
 */
export function proposeLabel(
  stream: Stream,
  tokenId: Id,
  segments: Record<string, SegmentInfo>,
  schemeOf: (workId: string) => Scheme | undefined,
): LabelProposal {
  const item = stream.items.find((i) => i.id === tokenId);
  const own = item ? segmentStartOf(item) : undefined;
  if (own?.segmentId) {
    const info = segments[own.segmentId];
    if (info) return { label: info.label, workId: info.workId, current: true };
  }
  const previous = startBefore(stream, tokenId);
  const info = previous?.start.segmentId ? segments[previous.start.segmentId] : undefined;
  if (info) {
    const scheme = schemeOf(info.workId);
    const next = scheme ? nextLabel(scheme, info.label) : null;
    return { label: next ?? '', workId: info.workId, current: Boolean(own) };
  }
  return { label: '', workId: null, current: Boolean(own) };
}

/**
 * The part number a new start of `segmentId` at `tokenId` takes: undefined
 * when the segment has no other run in the stream (one piece), else one more
 * than the highest part among its other runs.
 */
export function partFor(stream: Stream, segmentId: Id, tokenId: Id): number | undefined {
  let highest = 0;
  for (const item of stream.items) {
    if (item.id === tokenId || isBreak(item)) continue;
    const start = segmentStartOf(item);
    if (start?.segmentId === segmentId) highest = Math.max(highest, start.part ?? 1);
  }
  return highest === 0 ? undefined : highest + 1;
}

/** Labels of the other runs of a segment, for saying where it already begins. */
export function otherRuns(stream: Stream, segmentId: Id, tokenId: Id): Id[] {
  const out: Id[] = [];
  for (const item of stream.items) {
    if (item.id === tokenId) continue;
    if (segmentStartOf(item)?.segmentId === segmentId) out.push(item.id);
  }
  return out;
}

/**
 * The operation that sets a token's segment start: a segment (with a part
 * when it has one), `null` for "unassigned from here", or `undefined` to
 * remove the start. Removal is sent as null, which survives JSON.
 */
export function segmentOp(tokenId: Id, segmentId: Id | null | undefined, part?: number): Op {
  if (segmentId === undefined) return { t: 'set', id: tokenId, fields: { segment: null } };
  const segment: SegmentStart = { segmentId };
  if (part !== undefined && part > 1) segment.part = part;
  return { t: 'set', id: tokenId, fields: { segment } };
}

/** Segment ids the stream names that the label map does not know yet. */
export function unknownSegments(stream: Stream, segments: Record<string, SegmentInfo>): Id[] {
  const out = new Set<Id>();
  for (const item of stream.items) {
    const start = segmentStartOf(item);
    if (start?.segmentId && !segments[start.segmentId]) out.add(start.segmentId);
  }
  return [...out];
}
