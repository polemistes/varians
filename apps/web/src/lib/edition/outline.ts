/**
 * The outline of an edition's segments: of each, only what the editor needs
 * of every segment of the text at once, which is where the places of variation
 * stand (to mark their words, to count them and to step from one to the next)
 * and which words have drifted from their source. The collation of a segment
 * is much larger and is asked for only where the editor looks. Pure, so that
 * the server makes outlines and the page makes them again from a segment it
 * has just been given.
 */
import { siteKey, siteTokenIds, type Id } from '@varians/core';
import { needsReview, type SegmentForAdoption } from './adopt-client.ts';
import { reviewOrder, siteShows } from './workspace.ts';

/** A place of variation that shows in the text. */
export interface SiteOutline {
  index: number;
  baseFrom: number;
  baseTo: number;
  /** The edition's words the place covers; none for an insertion point. */
  tokens: Id[];
  /** The key the review marks of the place are kept under. */
  key: string;
  /** Needs the editor's attention, as far as its readings and attachments say: review marks are not considered. */
  needs: boolean;
}

export interface SegmentOutline {
  segmentId: Id;
  /** The places that show, in the order they stand in the segment. */
  sites: SiteOutline[];
  /** The edition's words taken from a witness that now reads otherwise there. */
  drift: Id[];
  /** A segment the edition does not print: its variant stands after the edition's segment `after`. */
  unprinted?: { after: Id };
}

/** The parts of a segment view an outline is made from. */
export type SegmentForOutline = SegmentForAdoption & {
  drift?: { tokenId: Id }[];
  unprinted?: { after: Id };
};

/** The outline of a segment. */
export function outlineOf(segment: SegmentForOutline): SegmentOutline {
  const none = new Set<string>();
  const sites = segment.collation.sites
    .filter((site) => siteShows(segment, site))
    .sort((a, b) => a.baseFrom - b.baseFrom || a.baseTo - b.baseTo)
    .map(
      (site): SiteOutline => ({
        index: site.index,
        baseFrom: site.baseFrom,
        baseTo: site.baseTo,
        tokens: siteTokenIds(site, segment.baseUnits),
        key: siteKey(site, segment.baseUnits),
        needs: needsReview(segment, site, none),
      }),
    );
  return {
    segmentId: segment.segmentId,
    sites,
    drift: (segment.drift ?? []).map((d) => d.tokenId),
    ...(segment.unprinted ? { unprinted: { after: segment.unprinted.after } } : {}),
  };
}

/** How many places in the outlines still need the editor's attention. */
export function countNeeding(
  order: Id[],
  outlines: Record<Id, SegmentOutline>,
  reviewed: Map<Id, Set<string>>,
): number {
  let n = 0;
  for (const segmentId of reviewOrder(order, outlines)) {
    const outline = outlines[segmentId];
    if (!outline) continue;
    const done = reviewed.get(segmentId);
    for (const site of outline.sites) if (site.needs && !done?.has(site.key)) n++;
  }
  return n;
}
