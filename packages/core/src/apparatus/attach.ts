/**
 * Placing conjectures and reported readings at the sites of a segment's
 * collation, by the words they concern.
 */

import type { Collation } from '../collate/collate.ts';
import {
  archetypeLetters,
  fold as foldText,
  type FoldOptions,
  DEFAULT_FOLD,
} from '../normalize/fold.ts';
import type { Unit } from '../stream/words.ts';
import type { Attachment } from './render.ts';

export interface AttachmentCandidate {
  id: string;
  kind: 'conjecture' | 'reported';
  /** The words the record concerns, as text; empty for an addition with no lemma. */
  lemma: string;
  reading: string;
  name: string;
  conjectureKind?: Attachment['conjectureKind'];
  source?: string;
  adopted?: boolean;
  /** Token ids of the edition's or a witness's words the record was anchored to when registered. */
  anchorTokenIds?: string[];
  /**
   * The base's units of the record's own segment, [from, to), where the
   * collation is of a passage of several segments: its lemma is looked for
   * among these units only, so that the same words in a neighbouring
   * segment are not taken. A site is within it when its units are, or, at a
   * point, when the point lies from `from` to `to`. All the units where not
   * given.
   */
  range?: { from: number; to: number };
}

export interface Attached {
  /** The collation with the sites conjectures opened on agreeing text appended. */
  collation: Collation;
  bySite: Record<number, Attachment[]>;
  /** Candidates no site matched; shown at the segment. */
  unplaced: Attachment[];
}

/**
 * A site over base units no witness disagrees about, opened for a conjecture
 * on those words: its only reading is the base's, with every witness that
 * has the words.
 */
function siteOver(
  collation: Collation,
  baseUnits: Unit[],
  from: number,
  to: number,
  index: number,
): Site {
  const sigla = new Set<string>();
  const textIds: string[] = [];
  const units: Record<string, Unit[]> = {};
  const siglumOf = new Map<string, string>(Object.entries(collation.sigla ?? {}));
  for (const site of collation.sites)
    for (const r of site.readings) r.textIds.forEach((id, k) => siglumOf.set(id, r.sigla[k]!));
  // A text that reads otherwise somewhere within these words does not have them: its own places say what it has.
  const departing = new Set<string>();
  for (const site of collation.sites) {
    const overlaps =
      site.baseTo > site.baseFrom
        ? site.baseFrom < to && from < site.baseTo
        : from < site.baseFrom && site.baseFrom < to;
    if (!overlaps) continue;
    for (const r of site.readings) if (!r.base) for (const id of r.textIds) departing.add(id);
  }
  // Every other text in the columns the base units occupy, but not one that has lost any of them: it is not there.
  const lost = new Set<string>();
  for (const column of collation.columns) {
    const baseCell = column.cells.get(collation.baseId);
    if (!baseCell || baseCell.unitIndex < from || baseCell.unitIndex >= to) continue;
    for (const [textId, cell] of column.cells) {
      if (cell.lacunose) lost.add(textId);
      else if (!textIds.includes(textId) && !departing.has(textId)) textIds.push(textId);
    }
  }
  for (const id of lost) if (textIds.includes(id)) textIds.splice(textIds.indexOf(id), 1);
  if (!textIds.includes(collation.baseId)) textIds.unshift(collation.baseId);
  for (const id of textIds) {
    units[id] = id === collation.baseId ? baseUnits.slice(from, to) : [];
    sigla.add(siglumOf.get(id) ?? id);
  }
  const text = baseUnits
    .slice(from, to)
    .map((u) => u.text)
    .join(' ');
  return {
    index,
    columnFrom: 0,
    columnTo: 0,
    baseFrom: from,
    baseTo: to,
    readings: [
      {
        text,
        fold: '',
        textIds,
        sigla: textIds.map((id) => siglumOf.get(id) ?? (id === collation.baseId ? 'ed.' : id)),
        units,
        omission: false,
        lacunose: false,
        base: true,
      },
    ],
    // Until what is attached says otherwise (see attachToSites).
    kind: 'textual',
  };
}

import type { Site } from '../collate/collate.ts';

function toAttachment(c: AttachmentCandidate): Attachment {
  const out: Attachment = { kind: c.kind, id: c.id, text: c.reading, name: c.name };
  if (c.conjectureKind) out.conjectureKind = c.conjectureKind;
  if (c.source) out.source = c.source;
  if (c.adopted) out.adopted = true;
  return out;
}

/**
 * Match each candidate to a site: first by anchor token ids (a site that
 * covers one of them), then by lemma against the base reading, then by
 * lemma against any reading, then by the proposed reading against the base
 * (an adopted conjecture whose lemma is no longer printed).
 */
export function attachToSites(
  collation: Collation,
  baseUnits: Unit[],
  candidates: AttachmentCandidate[],
  fold: FoldOptions = DEFAULT_FOLD,
): Attached {
  const bySite: Record<number, Attachment[]> = {};
  const unplaced: Attachment[] = [];
  const sites: Site[] = [...collation.sites];
  const key = (text: string) =>
    text
      .split(/\s+/u)
      .filter((w) => w)
      .map((w) => foldText(w, fold))
      .join(' ');
  const baseKeys = baseUnits.map((u) => (u.gap ? '' : foldText(u.text, fold)));
  const baseFoldOver = (from: number, to: number) => baseKeys.slice(from, to).join(' ');
  for (const candidate of candidates) {
    const lemma = key(candidate.lemma);
    const reading = key(candidate.reading);
    let found: number | null = null;
    const range = candidate.range;
    const inRange = (from: number, to: number) => !range || (range.from <= from && to <= range.to);
    // The first site within the candidate's own segment that meets the test.
    const first = (test: (site: Site) => boolean): number | null => {
      const k = sites.findIndex((site) => inRange(site.baseFrom, site.baseTo) && test(site));
      return k < 0 ? null : k;
    };
    const anchored = (from: number, to: number): boolean => {
      for (let i = from; i < to; i++)
        if (baseUnits[i]?.tokenIds.some((id) => candidate.anchorTokenIds!.includes(id)))
          return true;
      return false;
    };
    if (candidate.anchorTokenIds?.length) {
      const covering = sites
        .map((site, k) => ({ site, k }))
        .filter(({ site }) => anchored(site.baseFrom, site.baseTo));
      // The site over the lemma's own words first. The site over the whole segment, for the
      // witnesses without it, holds every word of the segment: a record on some of its words is
      // not placed there, or adopting it would replace the whole segment.
      const exact = covering.find(
        ({ site }) => lemma !== '' && baseFoldOver(site.baseFrom, site.baseTo) === lemma,
      );
      found = (exact ?? covering.find(({ site }) => !site.wanting))?.k ?? null;
    }
    if (found === null && lemma !== '') {
      found =
        first((site) =>
          site.readings.some(
            (r) =>
              r.base && (r.fold === lemma || baseFoldOver(site.baseFrom, site.baseTo) === lemma),
          ),
        ) ?? first((site) => site.readings.some((r) => r.fold === lemma));
    }
    if (found === null && reading !== '') {
      found = first((site) =>
        site.readings.some(
          (r) =>
            r.base && (r.fold === reading || baseFoldOver(site.baseFrom, site.baseTo) === reading),
        ),
      );
    }
    if (found === null) {
      // Words the witnesses agree on: open a site for the conjecture there, at the occurrence
      // its anchor names where the words stand more than once.
      const occurrences = (
        lemma !== ''
          ? lemmaOccursIn(baseUnits, candidate.lemma, fold)
          : reading !== ''
            ? lemmaOccursIn(baseUnits, candidate.reading, fold)
            : []
      ).filter((o) => inRange(o.from, o.to));
      const where =
        (candidate.anchorTokenIds?.length
          ? occurrences.find((o) => anchored(o.from, o.to))
          : undefined) ?? occurrences[0];
      if (where) {
        sites.push(siteOver(collation, baseUnits, where.from, where.to, sites.length));
        found = sites.length - 1;
      }
    }
    if (found === null) {
      unplaced.push(toAttachment(candidate));
      continue;
    }
    const site = sites[found]!;
    const attachment = toAttachment(candidate);
    // A candidate whose reading is what the edition prints is the adopted one, whether or not it was recorded as such.
    if (
      !attachment.adopted &&
      reading !== '' &&
      (site.readings.some((r) => r.base && r.fold === reading) ||
        baseFoldOver(site.baseFrom, site.baseTo) === reading)
    ) {
      attachment.adopted = true;
    }
    (bySite[site.index] ??= []).push(attachment);
  }
  // A place only conjectures or reports open is interpretative when they all have the edition's letters.
  for (let i = collation.sites.length; i < sites.length; i++) {
    const site = sites[i]!;
    const letters = archetypeLetters(site.readings[0]!.text);
    const here = bySite[site.index] ?? [];
    if (here.length && here.every((a) => a.text !== '' && archetypeLetters(a.text) === letters))
      sites[i] = { ...site, kind: 'interpretative' };
  }
  return { collation: { ...collation, sites }, bySite, unplaced };
}

/** Whether a candidate's words occur in a segment at all (for anchoring a new conjecture). */
export function lemmaOccursIn(
  baseUnits: Unit[],
  lemma: string,
  fold: FoldOptions = DEFAULT_FOLD,
): { from: number; to: number }[] {
  const words = lemma
    .split(/\s+/u)
    .filter((w) => w)
    .map((w) => foldText(w, fold));
  if (words.length === 0) return [];
  const keys = baseUnits.map((u) => (u.gap ? '' : foldText(u.text, fold)));
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i + words.length <= keys.length; i++) {
    if (words.every((w, k) => keys[i + k] === w)) out.push({ from: i, to: i + words.length });
  }
  return out;
}
