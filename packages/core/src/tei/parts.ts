/**
 * A variant written in parts. The TEI of an edition has one `<ab>` for each
 * segment, and a variant is written in the `<ab>` its words stand in. Where
 * a variant lies across the boundary of two printed segments (the edition's
 * last word of one and first word of the next, against a witness's two
 * words), no single `<ab>` holds it whole: a part is written in each segment
 * the variant's words lie in, true of that segment by itself, and the parts
 * are linked as one variant (docs/formats/tei-subset.md).
 *
 * This is the one place where the rule is made: a variant of a passage, with
 * the passage's segments, gives the part for each printed segment.
 */

import { printedKind, type Attachment } from '../apparatus/render.ts';
import type { Reading, Site, SiteKind } from '../collate/collate.ts';
import { siteSegments, type PassageSegment } from '../collate/passage.ts';
import { agreementFold, DEFAULT_FOLD, type FoldOptions } from '../normalize/fold.ts';
import type { Id, Stream } from '../stream/items.ts';
import { isToken } from '../stream/items.ts';
import { segmentRuns, type Unit } from '../stream/words.ts';

/** What links a part to the others: its name, its neighbours' names, and the kind of the whole variant. */
export interface VariantLink {
  /** The part's name, written as its `xml:id` (made a name by the writer). Unique among the parts of a file. */
  id: string;
  /** The part before it, in the order of the text. */
  prev?: string;
  /** The part after it. */
  next?: string;
  /**
   * The kind the whole variant is printed with, which every part repeats:
   * the attachments of a later part have no words, and would make it textual.
   */
  kind: SiteKind;
  /**
   * The edition's tokens that lie in this segment although the word they
   * belong to begins in an earlier one: a word divided across two segments
   * is one unit, in the segment where it begins, and the lemma of this part
   * has the rest of it. Absent where there are none.
   */
  tail?: Id[];
}

/** A variant as it stands in one printed segment. */
export interface VariantPart {
  segmentId: Id;
  /**
   * The variant over this segment alone: its index, kind and grade as the
   * variant's own, the edition's words in this segment (an empty stretch at
   * the end of the segment for a part before the edition's words, at the
   * start for one after), and each witness's own words of this segment.
   * Its base indexes are those of the segment's units.
   */
  site: Site;
  /** The conjectures and reports of the variant: their words in the first part, only the record in the others. */
  attachments: Attachment[];
  link: VariantLink;
}

export interface VariantPartsOptions {
  /**
   * Names the variant: its parts are named `<key>-1`, `<key>-2` and so on.
   * Unique among the variants of a file, as the first segment of a passage
   * with the site's index is.
   */
  key: string;
  /** How the work compares words, for the witnesses that read alike in a part. */
  fold?: FoldOptions;
  /**
   * The segment of each of the edition's tokens (`tokenSegments`). Where
   * given, a word of the edition that is divided across segments, inside the
   * variant, puts the variant in a part in each segment its tokens lie in.
   */
  tokens?: ReadonlyMap<Id, Id>;
}

/** The segment each token of a stream lies in, by token id: a token of no segment has none. */
export function tokenSegments(stream: Stream): Map<Id, Id> {
  const out = new Map<Id, Id>();
  for (const run of segmentRuns(stream)) {
    if (run.segmentId === null) continue;
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (isToken(item)) out.set(item.id, run.segmentId);
    }
  }
  return out;
}

/**
 * The parts of a variant of a passage: one for each of the edition's
 * printed segments its words lie in, in the order of the passage. Null where
 * the variant lies in fewer than two printed segments, which is written
 * whole as it stands.
 *
 * - The edition's words of a part are its own in that segment; the readings
 *   are the witnesses' own words of that segment. A word of the edition that is
 *   divided across segments is in the part of each segment its tokens lie in
 *   (`tokens` says where), though its unit is in the one where it begins; the
 *   part that has only its later tokens (`VariantLink.tail`) has nothing a
 *   witness's words could agree with. A witness's own divided word is not
 *   divided: it stays whole in the part where it begins. A witness word of a segment
 *   that is no part of the variant goes with the nearest part before it in the
 *   passage's order (the first part, where none comes before): a word of a
 *   segment the edition does not print goes with the printed segment before it.
 * - The witnesses are grouped by the fold of their words in the part, so that
 *   two witnesses that read alike here are one reading here, whatever they
 *   have elsewhere; a witness without words in the part has a reading of
 *   nothing. The witnesses of the edition's reading stand with it in every
 *   part, and so does a witness whose words here have the fold of the
 *   edition's (both nothing included): it agrees here, and has no reading of
 *   its own. A witness in no reading of the variant (it is not there) is in
 *   no part.
 * - The words of a conjecture or a reported reading are in the first part, and
 *   the later parts have the record without words, so that it is not read as
 *   keeping the lemma there. An adopted one is the edition's words and stays.
 */
export function variantParts(
  site: Site,
  passage: { segments: readonly PassageSegment[]; baseUnits: readonly Unit[] },
  attachments: readonly Attachment[],
  options: VariantPartsOptions,
): VariantPart[] | null {
  const fold = options.fold ?? DEFAULT_FOLD;
  const rank = new Map(passage.segments.map((s, k) => [s.segmentId, k] as const));
  // The tokens of the edition's words the variant covers that lie after the segment their word begins in.
  const tails = new Map<Id, Id[]>();
  if (options.tokens && site.baseTo > site.baseFrom)
    for (let i = site.baseFrom; i < site.baseTo; i++) {
      const unit = passage.baseUnits[i];
      if (!unit || unit.segmentId === undefined) continue;
      for (const id of unit.tokenIds) {
        const at = options.tokens.get(id);
        const place = at === undefined ? undefined : passage.segments[rank.get(at) ?? -1];
        if (at !== undefined && at !== unit.segmentId && place?.printed)
          tails.set(at, [...(tails.get(at) ?? []), id]);
      }
    }
  const places = [...new Set([...siteSegments(site, passage.baseUnits), ...tails.keys()])]
    .map((id) => passage.segments[rank.get(id) ?? -1])
    .filter((s): s is PassageSegment => s !== undefined && s.printed)
    .sort((a, b) => rank.get(a.segmentId)! - rank.get(b.segmentId)!);
  const base = site.readings.find((r) => r.base);
  if (places.length < 2 || !base) return null;
  const kind = printedKind(site, attachments);
  const baseId = base.textIds[0]!;

  /** The part a witness's word belongs to: that of its own segment, or of the nearest printed segment before it. */
  const partOf = (unit: Unit): number => {
    const at = unit.segmentId === undefined ? -1 : (rank.get(unit.segmentId) ?? -1);
    let part = 0;
    places.forEach((place, i) => {
      if (rank.get(place.segmentId)! <= at) part = i;
    });
    return part;
  };
  const wordsIn = (units: readonly Unit[] | undefined, part: number): Unit[] =>
    (units ?? []).filter((u) => !u.gap && partOf(u) === part);
  const textOf = (units: readonly Unit[]) => units.map((u) => u.text).join(' ');
  const keyOf = (units: readonly Unit[]) => units.map((u) => agreementFold(u.text, fold)).join(' ');

  return places.map((place, i): VariantPart => {
    // The edition's units of the segment that the variant covers; none at a point, or where the words lie elsewhere.
    const within = (n: number) => Math.min(Math.max(n, place.from), place.to);
    const from = within(site.baseFrom);
    const to = site.baseTo > site.baseFrom ? within(site.baseTo) : from;
    const covered = passage.baseUnits.slice(from, to);
    const tail = tails.get(place.segmentId) ?? [];
    const words = covered.filter((u) => !u.gap);
    const baseUnits: Record<Id, Unit[]> = { [baseId]: words };
    for (const [id, units] of Object.entries(base.units))
      if (id !== baseId) baseUnits[id] = wordsIn(units, i);
    const edition: Reading = {
      ...base,
      text: textOf(words),
      fold: keyOf(words),
      textIds: [...base.textIds],
      sigla: [...base.sigla],
      units: baseUnits,
      omission: to === from && tail.length === 0,
      lacunose: words.length === 0 && covered.length > 0,
    };

    const groups = new Map<string, Reading>();
    for (const reading of site.readings) {
      if (reading.base) continue;
      reading.textIds.forEach((id, k) => {
        const units = wordsIn(reading.units[id], i);
        const key = keyOf(units);
        let group = groups.get(key);
        if (!group) {
          group = {
            text: textOf(units),
            fold: key,
            textIds: [],
            sigla: [],
            units: {},
            omission: units.length === 0,
            lacunose: false,
            base: false,
          };
          groups.set(key, group);
        }
        group.textIds.push(id);
        group.sigla.push(reading.sigla[k]!);
        group.units[id] = units;
      });
    }

    // A witness that reads as the edition does here, nothing included, stands with the edition's reading, as a witness that agrees does in a variant written whole.
    const alike = tail.length === 0 ? groups.get(edition.fold) : undefined;
    if (alike) {
      groups.delete(edition.fold);
      edition.textIds.push(...alike.textIds);
      edition.sigla.push(...alike.sigla);
      Object.assign(edition.units, alike.units);
    }

    const link: VariantLink = {
      id: `${options.key}-${i + 1}`,
      ...(i > 0 ? { prev: `${options.key}-${i}` } : {}),
      ...(i < places.length - 1 ? { next: `${options.key}-${i + 2}` } : {}),
      kind,
      ...(tail.length > 0 ? { tail } : {}),
    };
    return {
      segmentId: place.segmentId,
      site: {
        ...site,
        baseFrom: from - place.from,
        baseTo: to - place.from,
        readings: [edition, ...groups.values()],
      },
      attachments: attachments.map((a) => (i === 0 || a.adopted ? a : { ...a, text: '' })),
      link,
    };
  });
}
