/**
 * The marks in the margin of the text for variants over whole lines: a line
 * that some witnesses do not have, a line the edition does not print, and
 * lines that witnesses have in another order. Each is a mark of its own kind
 * along the lines it concerns, or between two lines: the part of it that
 * stands on each line is given to that line, and the first part takes the
 * keyboard's focus and carries the name. Marks that would stand over one
 * another on the same lines are set side by side, in at most two lanes.
 */
import type { OrderVariant } from '@varians/core';
import { reader as r } from '$lib/strings/reader';
import { labelsOf, type VariantContext } from './variant';
import { asPassage, orderKey, siteKey, type SegmentSites } from './sites';
import { unprintedAt } from './passages';

/**
 * A line some witnesses do not have is a plain rule along it; lines in another
 * order a bracket along them; a line the edition does not print a caret
 * pointing into the text between two lines.
 */
export type MarginKind = 'wanting' | 'order' | 'unprinted';

/** Where the line stands in a mark that runs over several: alone, first, within, last. */
export type MarginEdge = 'solo' | 'start' | 'middle' | 'end';

/** The part of a mark that stands on one line. */
export interface MarginPart {
  /** The keys of the variants the mark opens, space-separated, for its data attribute. */
  keys: string;
  kind: MarginKind;
  edge: MarginEdge;
  /** 0 beside the text, 1 beyond it. */
  lane: number;
  /** The part on the mark's first line: the mark's stop for the keyboard, with its name. */
  first: boolean;
  /** The mark's name. */
  name: string;
}

/** How many marks can stand side by side in the margin; more share the last lane. */
export const MARGIN_LANES = 2;

interface Mark {
  keys: string[];
  kind: MarginKind;
  from: number;
  to: number;
  name: string;
}

export interface LineMarkInput {
  /** For each line, the segments whose words stand on it. */
  segmentsOfLine: readonly (readonly string[])[];
  /** The passages, by their first segment. */
  segments: Readonly<Record<string, SegmentSites | undefined>>;
  /** The keys of the sites the reader is shown. */
  shown: { has(key: string): boolean };
  orders: readonly OrderVariant[];
  /** The labels and the order of the segments, for the marks' names. */
  context: Pick<VariantContext, 'labelOf' | 'order'>;
}

/** The marks of each line, by line index: the lines that have none are left out. */
export function lineMarks(input: LineMarkInput): Map<number, MarginPart[]> {
  const { segmentsOfLine, segments, shown, context } = input;
  const label = (id: string) => context.labelOf?.[id] ?? id;

  // The first and the last line each segment's words stand on.
  const extent = new Map<string, [number, number]>();
  segmentsOfLine.forEach((ids, line) => {
    for (const id of ids) {
      const found = extent.get(id);
      if (found) found[1] = line;
      else extent.set(id, [line, line]);
    }
  });
  const marks: Mark[] = [];
  // Lines the edition does not print: one mark after each line, for all that follow it.
  const after = new Map<string, string[]>();
  for (const passage of Object.values(segments)) {
    if (!passage) continue;
    const of = asPassage(passage);
    for (const site of passage.collation.sites) {
      const key = siteKey(passage.segmentId, site.index);
      if (!shown.has(key)) continue;
      if (site.wanting) {
        // Lines some witnesses do not have: along the lines of the segments the variant's words lie in.
        const ids = (of.siteSegments[site.index] ?? []).filter((id) => extent.has(id));
        if (ids.length === 0) continue;
        const lines = ids.map((id) => extent.get(id)!);
        marks.push({
          keys: [key],
          kind: 'wanting',
          from: Math.min(...lines.map((l) => l[0])),
          to: Math.max(...lines.map((l) => l[1])),
          name: r.variant.lineAt(labelsOf(ids, context)),
        });
        continue;
      }
      const unprinted = unprintedAt(of, site.index);
      if (unprinted) after.set(unprinted.after, [...(after.get(unprinted.after) ?? []), key]);
    }
  }
  for (const [previous, keys] of after) {
    const lines = extent.get(previous);
    if (!lines) continue;
    marks.push({
      keys,
      kind: 'unprinted',
      from: lines[1],
      to: lines[1],
      name: r.variant.pointAfter(label(previous)),
    });
  }

  // Lines in another order: along the stretch, or along the block that stands far from its place.
  input.orders.forEach((order, index) => {
    const lines = order.segments.flatMap((id) => extent.get(id) ?? []);
    if (lines.length === 0) return;
    marks.push({
      keys: [orderKey(index)],
      kind: 'order',
      from: Math.min(...lines),
      to: Math.max(...lines),
      name: r.variant.lineAt(labelsOf(order.segments, context)),
    });
  });

  // Lanes, the longest mark nearest the text: the lines each lane is taken on. A caret between two lines takes both.
  const taken: Set<number>[] = Array.from({ length: MARGIN_LANES }, () => new Set<number>());
  const out = new Map<number, MarginPart[]>();
  marks.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
  for (const mark of marks) {
    const lines: number[] = [];
    const last = mark.kind === 'unprinted' ? mark.to + 1 : mark.to;
    for (let line = mark.from; line <= last; line++) lines.push(line);
    const free = taken.findIndex((lane) => lines.every((line) => !lane.has(line)));
    const lane = free < 0 ? MARGIN_LANES - 1 : free;
    for (const line of lines) taken[lane]!.add(line);
    for (let line = mark.from; line <= mark.to; line++) {
      const edge: MarginEdge =
        mark.from === mark.to
          ? 'solo'
          : line === mark.from
            ? 'start'
            : line === mark.to
              ? 'end'
              : 'middle';
      const part: MarginPart = {
        keys: mark.keys.join(' '),
        kind: mark.kind,
        edge,
        lane,
        first: line === mark.from,
        name: mark.name,
      };
      out.set(line, [...(out.get(line) ?? []), part]);
    }
  }
  for (const parts of out.values()) parts.sort((a, b) => a.lane - b.lane);
  return out;
}
