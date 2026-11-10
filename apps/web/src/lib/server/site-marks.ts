/**
 * The editors' word on places of variation (a kind over the letters', or
 * that a place is not reported) as a published version fixes it. A
 * publication records the marks as they stand; the version is read with
 * those, whatever the editors say afterwards.
 */
import type { MomentBasis, SiteKindMark } from '@varians/db';

/** Marks by segment and site key, as the edition's collation context holds them. */
type Marks = Map<string, Map<string, { kind: SiteKindMark; setAt: Date }>>;

/** The marks as a publication records them, in a stable order. */
export function marksForBasis(marks: Marks): NonNullable<MomentBasis['siteKinds']> {
  return [...marks]
    .flatMap(([segmentId, bySite]) =>
      [...bySite].map(([siteKey, mark]) => ({ segmentId, siteKey, kind: mark.kind })),
    )
    .sort((a, b) => a.segmentId.localeCompare(b.segmentId) || a.siteKey.localeCompare(b.siteKey));
}

/**
 * The marks a published version is read with: those its publication
 * recorded. A version published before they were recorded is read with the
 * marks that had been set by then, which later marks leave alone but later
 * changes of a mark do not.
 */
export function marksAtPublication(current: Marks, basis: MomentBasis, at: Date): Marks {
  const out: Marks = new Map();
  if (basis.siteKinds) {
    for (const { segmentId, siteKey, kind } of basis.siteKinds) {
      const bySite = out.get(segmentId) ?? new Map();
      bySite.set(siteKey, { kind, setAt: at });
      out.set(segmentId, bySite);
    }
    return out;
  }
  for (const [segmentId, bySite] of current)
    out.set(segmentId, new Map([...bySite].filter(([, mark]) => mark.setAt <= at)));
  return out;
}
