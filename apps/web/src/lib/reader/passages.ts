/**
 * Passages as the screens read them. The server collates the text in
 * passages (one segment, or several consecutive segments taken together)
 * and gives each under its first segment, with where each of its segments
 * begins among the edition's words and the segments of each variant's
 * words. A variant is then labelled, listed and stepped to by where its
 * words stand, not by the passage that delivered it. Pure.
 */

/** What these helpers read of a passage. */
export interface PassageLike {
  /** The passage's first segment. */
  segmentId: string;
  segments: readonly { segmentId: string; from: number; to: number; printed: boolean }[];
  siteSegments: Readonly<Record<number, readonly string[]>>;
}

/** For each segment, the first segment of the passage that holds it. */
export function passageIndex(passages: Iterable<PassageLike>): Map<string, string> {
  const out = new Map<string, string>();
  for (const passage of passages)
    for (const part of passage.segments) out.set(part.segmentId, passage.segmentId);
  return out;
}

/** The passages that hold some segments, by their first segment, each once, in the order the segments come. */
export function passagesOf(
  segmentIds: readonly string[],
  index: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const id of segmentIds) {
    const passage = index.get(id);
    if (passage !== undefined && !out.includes(passage)) out.push(passage);
  }
  return out;
}

/** The segment a variant stands in: the first its words lie in, or the passage's first where nothing says. */
export function standsIn(passage: PassageLike, siteIndex: number): string {
  return passage.siteSegments[siteIndex]?.[0] ?? passage.segmentId;
}

/**
 * The segment the edition does not print that a variant is, where it is
 * one: a variant at a point at which a witness has words of such a segment.
 * With the edition's segment it stands after. Null for any other variant.
 */
export function unprintedAt(
  passage: PassageLike,
  siteIndex: number,
): { segmentId: string; after: string } | null {
  const ids = passage.siteSegments[siteIndex] ?? [];
  const at = passage.segments.findIndex((p) => !p.printed && ids.includes(p.segmentId));
  if (at < 0) return null;
  for (let k = at - 1; k >= 0; k--) {
    const part = passage.segments[k]!;
    if (part.printed) return { segmentId: passage.segments[at]!.segmentId, after: part.segmentId };
  }
  return null;
}

/** The edition's units a segment of the passage holds, [from, to); null for one it does not hold. */
export function rangeOf(
  passage: PassageLike,
  segmentId: string,
): { from: number; to: number } | null {
  const part = passage.segments.find((p) => p.segmentId === segmentId);
  return part ? { from: part.from, to: part.to } : null;
}

/**
 * Passages put together with more that have come: a passage that has come
 * takes the place of any given before that holds one of its segments, so
 * that where the passages have been drawn otherwise meanwhile, a segment is
 * in one passage only.
 */
export function mergePassages<T extends PassageLike>(
  given: Readonly<Record<string, T>>,
  more: Readonly<Record<string, T>>,
): Record<string, T> {
  const taken = new Set(Object.values(more).flatMap((p) => p.segments.map((s) => s.segmentId)));
  const out: Record<string, T> = {};
  for (const [id, passage] of Object.entries(given))
    if (!passage.segments.some((s) => taken.has(s.segmentId))) out[id] = passage;
  return { ...out, ...more };
}

/** The segments of the passage the edition prints. */
export function printedSegments(passage: PassageLike): string[] {
  return passage.segments.filter((p) => p.printed).map((p) => p.segmentId);
}
