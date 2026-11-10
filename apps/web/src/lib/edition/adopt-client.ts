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

/** The part of a segment view the client needs for adopting. */
export interface SegmentForAdoption {
  segmentId: Id;
  collation: Collation;
  baseUnits: Unit[];
  attachments: Record<number, Attachment[]>;
}

/** A map from token id to the site that covers it, over several segments. */
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

/** Operations adopting a witness reading of a site. */
export function opsForReading(
  stream: Stream,
  segment: SegmentForAdoption,
  site: Site,
  reading: Reading,
  textId: Id,
): Op[] {
  return adoptReading(stream, site, segment.baseUnits, reading, textId);
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

/** Operations adopting a conjecture or reported reading attached to a site. */
export function opsForAttachment(
  stream: Stream,
  segment: SegmentForAdoption,
  site: Site,
  attachment: Attachment,
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
    return replaceAtSite(stream, site, segment.baseUnits, tokens);
  }
  return adoptConjecture(stream, site, segment.baseUnits, {
    id: attachment.id,
    reading: attachment.text,
    kind: attachment.conjectureKind ?? 'substitution',
  });
}

/** The review key of a site, from the edition's tokens it covers. */
export function keyOfSite(segment: SegmentForAdoption, site: Site): string {
  return siteKey(site, segment.baseUnits);
}

/** Whether a site needs the editor's attention: a non-base reading that is not merely lost, or an attachment that is not adopted. A place the editor leaves out of the apparatus needs none. */
export function needsReview(
  segment: SegmentForAdoption,
  site: Site,
  reviewed: Set<string>,
): boolean {
  if (site.unreported || reviewed.has(keyOfSite(segment, site))) return false;
  const substantive = site.readings.some((r) => !r.base && !(r.lacunose && r.text === ''));
  const pending = (segment.attachments[site.index] ?? []).some((a) => !a.adopted);
  return substantive || pending;
}

/** How many sites of the given segments still need attention. */
export function countUnreviewed(
  segments: Iterable<SegmentForAdoption>,
  reviewed: Map<Id, Set<string>>,
): number {
  let n = 0;
  for (const segment of segments) {
    const set = reviewed.get(segment.segmentId) ?? new Set<string>();
    for (const site of segment.collation.sites) if (needsReview(segment, site, set)) n++;
  }
  return n;
}
