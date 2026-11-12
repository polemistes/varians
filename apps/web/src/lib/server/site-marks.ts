/**
 * The editors' word on places of variation (a kind over the letters', and
 * whether a place is minor) as a version fixes it and an archive records it.
 */
import type { SiteMark } from '@varians/core';
import type { EditionSnapshot } from '@varians/db';

/** Marks by segment and site key, as the edition's collation context holds them. */
export type Marks = Map<string, Map<string, SiteMark & { setAt: Date }>>;

/**
 * A recorded mark (of a version's snapshot, or of an archive's `siteKinds`)
 * as the kind and the grade it says. One written when a place could be left
 * out of the apparatus (`kind: 'unreported'`) says that the place is minor; a
 * kind not known says nothing.
 */
export function markOfBasis(entry: { kind?: string | null; minor?: boolean | null }): SiteMark {
  const mark: SiteMark = {};
  if (entry.kind === 'textual' || entry.kind === 'interpretative') mark.kind = entry.kind;
  if (entry.minor || entry.kind === 'unreported') mark.minor = true;
  return mark;
}

/** The marks a version is read with: those its snapshot recorded, a mark that says nothing left out. */
export function marksOfSnapshot(siteKinds: EditionSnapshot['siteKinds']): Marks {
  const out: Marks = new Map();
  for (const entry of siteKinds) {
    const mark = markOfBasis(entry);
    if (!mark.kind && !mark.minor) continue;
    const bySite = out.get(entry.segmentId) ?? new Map();
    bySite.set(entry.siteKey, {
      ...mark,
      setAt: entry.setAt ? new Date(entry.setAt) : new Date(0),
    });
    out.set(entry.segmentId, bySite);
  }
  return out;
}
