/**
 * The outline of an edition's passages: of each, only what the editor needs
 * of every passage of the text at once, which is where the places of
 * variation stand (to mark their words, to count them and to step from one
 * to the next) and which words have drifted from their source. The
 * collation of a passage is much larger and is asked for only where the
 * editor looks. Pure, so that the server makes outlines and the page makes
 * them again from a passage it has just been given.
 */
import { siteKey, siteTokenIds, type Id } from '@varians/core';
import { standsIn, unprintedAt, type PassageLike } from '$lib/reader/passages';
import { needsReview, type SegmentForAdoption } from './adopt-client.ts';
import { siteShows } from './workspace.ts';

/** A place of variation that shows in the text. */
export interface SiteOutline {
  index: number;
  baseFrom: number;
  baseTo: number;
  /** The edition's words the place covers; none for an insertion point. */
  tokens: Id[];
  /** The key the review marks of the place are kept under. */
  key: string;
  /** The segments its words lie in, in the order of the passage: the first is where it stands. */
  segments: Id[];
  /** A segment the edition does not print: the place is that segment, standing after the edition's segment `after`. */
  unprinted?: { segmentId: Id; after: Id };
  /** Needs the editor's attention, as far as its readings and attachments say: review marks are not considered. */
  needs: boolean;
}

export interface SegmentOutline {
  /** The passage's first segment. */
  segmentId: Id;
  /** The segments of the passage, in order. */
  segments: { segmentId: Id; printed: boolean }[];
  /** The places that show, in the order their words stand in the passage. */
  sites: SiteOutline[];
  /** The edition's words taken from a witness that now reads otherwise there. */
  drift: Id[];
}

/** The parts of a passage's view an outline is made from. */
export type SegmentForOutline = SegmentForAdoption &
  PassageLike & {
    drift?: { tokenId: Id }[];
  };

/** The outline of a passage. */
export function outlineOf(segment: SegmentForOutline): SegmentOutline {
  const none = new Set<string>();
  const sites = segment.collation.sites
    .filter((site) => siteShows(segment, site))
    .sort((a, b) => a.baseFrom - b.baseFrom || a.baseTo - b.baseTo)
    .map((site): SiteOutline => {
      const unprinted = unprintedAt(segment, site.index);
      return {
        index: site.index,
        baseFrom: site.baseFrom,
        baseTo: site.baseTo,
        tokens: siteTokenIds(site, segment.baseUnits),
        key: siteKey(site, segment.baseUnits),
        segments: [...(segment.siteSegments[site.index] ?? [standsIn(segment, site.index)])],
        ...(unprinted ? { unprinted } : {}),
        needs: needsReview(segment, site, none),
      };
    });
  return {
    segmentId: segment.segmentId,
    segments: segment.segments.map((p) => ({ segmentId: p.segmentId, printed: p.printed })),
    sites,
    drift: (segment.drift ?? []).map((d) => d.tokenId),
  };
}

/**
 * Whether a place is reviewed: its key is kept under the segment it stands
 * in, or under another segment of its passage (where the passages were
 * drawn otherwise when it was reviewed).
 */
export function isReviewedIn(
  outline: Pick<SegmentOutline, 'segments'>,
  key: string,
  reviewed: { get(segmentId: Id): { has(key: string): boolean } | undefined },
): boolean {
  return outline.segments.some((s) => reviewed.get(s.segmentId)?.has(key) === true);
}

/** How many places in the outlines still need the editor's attention. */
export function countNeeding(
  outlines: Record<Id, SegmentOutline>,
  reviewed: Map<Id, Set<string>>,
): number {
  let n = 0;
  for (const outline of Object.values(outlines))
    for (const site of outline.sites)
      if (site.needs && !isReviewedIn(outline, site.key, reviewed)) n++;
  return n;
}
