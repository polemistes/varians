/**
 * The editors' word on places of variation (a kind over the letters', and
 * whether a place is minor) as a published version fixes it. A publication
 * records the marks as they stand; the version is read with those, whatever
 * the editors say afterwards.
 */
import type { SiteMark } from '@varians/core';
import type { MomentBasis } from '@varians/db';

/** Marks by segment and site key, as the edition's collation context holds them. */
export type Marks = Map<string, Map<string, SiteMark & { setAt: Date }>>;

type BasisMarks = NonNullable<MomentBasis['siteKinds']>;

/** A mark as a basis records it: the words that are said, and none that is not. */
function recorded(segmentId: string, siteKey: string, mark: SiteMark): BasisMarks[number] {
  return {
    segmentId,
    siteKey,
    ...(mark.kind ? { kind: mark.kind } : {}),
    ...(mark.minor ? { minor: true as const } : {}),
  };
}

/** The marks as a publication records them, in a stable order. */
export function marksForBasis(marks: Marks): BasisMarks {
  return [...marks]
    .flatMap(([segmentId, bySite]) =>
      [...bySite].map(([siteKey, mark]) => recorded(segmentId, siteKey, mark)),
    )
    .sort((a, b) => a.segmentId.localeCompare(b.segmentId) || a.siteKey.localeCompare(b.siteKey));
}

/**
 * A recorded mark (of a basis, or of an archive's `siteKinds`) as the kind
 * and the grade it says. One written when a place could be left out of the
 * apparatus (`kind: 'unreported'`) says that the place is minor; a kind not
 * known says nothing.
 */
export function markOfBasis(entry: { kind?: string | null; minor?: boolean | null }): SiteMark {
  const mark: SiteMark = {};
  if (entry.kind === 'textual' || entry.kind === 'interpretative') mark.kind = entry.kind;
  if (entry.minor || entry.kind === 'unreported') mark.minor = true;
  return mark;
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
    for (const entry of basis.siteKinds) {
      const mark = markOfBasis(entry);
      if (!mark.kind && !mark.minor) continue;
      const bySite = out.get(entry.segmentId) ?? new Map();
      bySite.set(entry.siteKey, { ...mark, setAt: at });
      out.set(entry.segmentId, bySite);
    }
    return out;
  }
  for (const [segmentId, bySite] of current)
    out.set(segmentId, new Map([...bySite].filter(([, mark]) => mark.setAt <= at)));
  return out;
}

/** A basis as the archive writes it: a mark of the earlier kind (`unreported`) said as the minor place it is read as. */
export function basisForArchive(basis: MomentBasis | null): MomentBasis | null {
  if (!basis?.siteKinds) return basis;
  const siteKinds = basis.siteKinds.flatMap((entry) => {
    const mark = markOfBasis(entry);
    return mark.kind || mark.minor ? [recorded(entry.segmentId, entry.siteKey, mark)] : [];
  });
  return { ...basis, siteKinds };
}
