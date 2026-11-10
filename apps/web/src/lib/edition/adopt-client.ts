/**
 * What the edition editor does when the editor adopts something: compose the
 * operations with the core and hand them to the document session. Pure.
 */
import {
  newId,
  adoptConjecture,
  adoptReading,
  replaceAtSite,
  siteKey,
  siteTokenIds,
  type Attachment,
  type Collation,
  type Id,
  type Op,
  type Reading,
  type Site,
  type Stream,
  type Unit,
} from '@varians/core';

/** The part of a passage's view the client needs for adopting. */
export interface SegmentForAdoption {
  /** The passage's first segment. */
  segmentId: Id;
  collation: Collation;
  /** The edition's units of the passage, each naming the segment its word begins in. */
  baseUnits: Unit[];
  attachments: Record<number, Attachment[]>;
}

/** A map from token id to the site that covers it, over several passages. */
export function sitesByToken(
  segments: Iterable<SegmentForAdoption>,
): Map<Id, { segmentId: Id; site: Site }> {
  const out = new Map<Id, { segmentId: Id; site: Site }>();
  for (const segment of segments) {
    for (const site of segment.collation.sites) {
      for (const id of siteTokenIds(site, segment.baseUnits))
        out.set(id, { segmentId: segment.segmentId, site });
    }
  }
  return out;
}

/** The site at or just before an insertion point: the site whose base range ends at the token, for additions. */
export function insertionSitesAfter(segment: SegmentForAdoption, tokenId: Id): Site[] {
  const index = segment.baseUnits.findIndex((u) => u.tokenIds.includes(tokenId));
  if (index < 0) return [];
  return segment.collation.sites.filter((s) => s.baseFrom === s.baseTo && s.baseFrom === index + 1);
}

/**
 * Operations adopting a witness reading of a site: its words, each in the
 * segment the witness gives it. Words of a segment the edition does not
 * have (at a segment it does not print) stand on a line of their own.
 */
export function opsForReading(
  stream: Stream,
  segment: SegmentForAdoption,
  site: Site,
  reading: Reading,
  textId: Id,
): Op[] {
  return adoptReading(stream, site, segment.baseUnits, reading, textId, { ownLine: true });
}

/**
 * An editorial deletion keeps the words and marks them, so that the edition
 * prints them in its deletion brackets (`surplus`, as TEI calls it).
 */
export function opsForDeletion(
  stream: Stream,
  segment: SegmentForAdoption,
  site: Site,
  conjectureId: Id,
): Op[] {
  const ops: Op[] = [];
  for (const id of siteTokenIds(site, segment.baseUnits)) {
    const token = stream.items.find((item) => item.id === id);
    if (!token || token.kind !== 'token') continue;
    const kept = (token.marks ?? []).filter((m) => !(m.kind === 'surplus' && m.from === undefined));
    ops.push({
      t: 'set',
      id,
      fields: { marks: [...kept, { kind: 'surplus', attrs: { resp: conjectureId } }] },
    });
  }
  return ops;
}

/**
 * Operations adopting a conjecture or reported reading attached to a site.
 * Its words take the segment the record names (`segmentId`), where given.
 */
export function opsForAttachment(
  stream: Stream,
  segment: SegmentForAdoption,
  site: Site,
  attachment: Attachment,
  segmentId?: Id,
): Op[] {
  if (attachment.kind === 'conjecture' && attachment.conjectureKind === 'deletion') {
    return opsForDeletion(stream, segment, site, attachment.id);
  }
  if (attachment.kind === 'reported') {
    const tokens = attachment.text
      .split(/\s+/u)
      .filter((w) => w)
      .map((form) => ({
        kind: 'token' as const,
        id: newId(),
        form,
        source: { kind: 'editor' as const },
      }));
    return replaceAtSite(stream, site, segment.baseUnits, tokens, {
      ownLine: true,
      ...(segmentId !== undefined ? { segments: tokens.map(() => segmentId) } : {}),
    });
  }
  return adoptConjecture(
    stream,
    site,
    segment.baseUnits,
    {
      id: attachment.id,
      reading: attachment.text,
      kind: attachment.conjectureKind ?? 'substitution',
      ...(segmentId !== undefined ? { segmentId } : {}),
    },
    { ownLine: true },
  );
}

/** The review key of a site, from the edition's tokens it covers. */
export function keyOfSite(segment: SegmentForAdoption, site: Site): string {
  return siteKey(site, segment.baseUnits);
}

/** Whether a site needs the editor's attention: a reading other than the base's, or an attachment that is not adopted. A variant the editor judges minor needs none. */
export function needsReview(
  segment: SegmentForAdoption,
  site: Site,
  reviewed: Set<string>,
): boolean {
  if (site.minor || reviewed.has(keyOfSite(segment, site))) return false;
  const substantive = site.readings.some((r) => !r.base);
  const pending = (segment.attachments[site.index] ?? []).some((a) => !a.adopted);
  return substantive || pending;
}

/** How many sites of the given passages still need attention, by the review keys kept under each segment. */
export function countUnreviewed(
  segments: Iterable<SegmentForAdoption>,
  reviewed: Map<Id, Set<string>>,
): number {
  let n = 0;
  for (const segment of segments) {
    const ids = new Set([
      segment.segmentId,
      ...segment.baseUnits.flatMap((u) => u.segmentId ?? []),
    ]);
    const set = new Set([...ids].flatMap((id) => [...(reviewed.get(id) ?? [])]));
    for (const site of segment.collation.sites) if (needsReview(segment, site, set)) n++;
  }
  return n;
}
