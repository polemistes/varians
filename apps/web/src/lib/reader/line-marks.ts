/**
 * The marks for variants over whole segments, by the kind of the paragraph
 * the segments are shown in. In verse they are marks in the margin, along the
 * lines they concern or between two lines: a segment that some witnesses do
 * not have, a segment the edition does not print, and segments that witnesses
 * have in another order. The part of a mark that stands on each line is given
 * to that line, and the first part takes the keyboard's focus and carries the
 * name. Marks that would stand over one another on the same lines are set
 * side by side, in at most two lanes. In prose the same variants are marked in
 * the text, like any other: on the words, at the point after the word before
 * a segment the edition does not print (`markSites`), and for the order of
 * segments on their labels (`labelMarks`). A stretch that runs over both kinds
 * of paragraph is marked in each by that paragraph's kind.
 */
import type { Lineation, OrderVariant } from '@varians/core';
import { reader as r } from '$lib/strings/reader';
import { labelsOf, type VariantContext } from './variant';
import { asPassage, orderKey, siteKey, type SegmentSites } from './sites';
import { unprintedAt } from './passages';

/**
 * A segment some witnesses do not have is a plain rule along its lines;
 * segments in another order a bracket along theirs; a segment the edition
 * does not print a caret pointing into the text between two lines.
 */
export type MarginKind = 'wanting' | 'order' | 'unprinted';

/** Where the line stands in a run of a mark's lines: alone, first, within, last. */
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
  /** The verse lines it stands on, in order. */
  lines: number[];
  /** Where it reaches in all, for the lanes: the first and last line of the segments it concerns. */
  from: number;
  to: number;
  name: string;
}

export interface LineMarkInput {
  /** For each line, the segments whose words stand on it. */
  segmentsOfLine: readonly (readonly string[])[];
  /** The kind of the paragraph each line is in; a line without one is verse. */
  lineation?: readonly Lineation[];
  /** The passages, by their first segment. */
  segments: Readonly<Record<string, SegmentSites | undefined>>;
  /** The keys of the sites the reader is shown. */
  shown: { has(key: string): boolean };
  orders: readonly OrderVariant[];
  /** The labels and the order of the segments, for the marks' names. */
  context: Pick<VariantContext, 'labelOf' | 'order'>;
}

/** The marks of each line of verse, by line index: the lines that have none, and every line of prose, are left out. */
export function lineMarks(input: LineMarkInput): Map<number, MarginPart[]> {
  const { segmentsOfLine, segments, shown, context } = input;
  const label = (id: string) => context.labelOf?.[id] ?? id;
  const verse = (line: number) => input.lineation?.[line] !== 'prose';

  // The lines each segment's words stand on.
  const linesOf = new Map<string, number[]>();
  segmentsOfLine.forEach((ids, line) => {
    for (const id of ids) {
      const found = linesOf.get(id);
      if (found) found.push(line);
      else linesOf.set(id, [line]);
    }
  });
  /** The lines of verse of some segments, in order, once each, and the first and last line of them all. */
  const along = (ids: readonly string[]) => {
    const all = ids.flatMap((id) => linesOf.get(id) ?? []);
    return {
      lines: [...new Set(all.filter(verse))].sort((a, b) => a - b),
      from: Math.min(...all),
      to: Math.max(...all),
    };
  };
  const marks: Mark[] = [];
  // Segments the edition does not print: one mark after each line, for all that follow it.
  const after = new Map<string, string[]>();
  for (const passage of Object.values(segments)) {
    if (!passage) continue;
    const of = asPassage(passage);
    for (const site of passage.collation.sites) {
      const key = siteKey(passage.segmentId, site.index);
      if (!shown.has(key)) continue;
      if (site.wanting) {
        // Segments some witnesses do not have: along the lines of verse the variant's words lie in.
        const ids = (of.siteSegments[site.index] ?? []).filter((id) => linesOf.has(id));
        const found = along(ids);
        if (found.lines.length === 0) continue;
        marks.push({
          keys: [key],
          kind: 'wanting',
          ...found,
          name: r.variant.segmentAt(labelsOf(ids, context)),
        });
        continue;
      }
      const unprinted = unprintedAt(of, site.index);
      if (unprinted) after.set(unprinted.after, [...(after.get(unprinted.after) ?? []), key]);
    }
  }
  for (const [previous, keys] of after) {
    const lines = linesOf.get(previous);
    const last = lines?.[lines.length - 1];
    // Where the segment before it ends in prose, its mark is the point after the word, in the text.
    if (last === undefined || !verse(last)) continue;
    marks.push({
      keys,
      kind: 'unprinted',
      lines: [last],
      from: last,
      to: last,
      name: r.variant.pointAfter(label(previous)),
    });
  }

  // Segments in another order: along the stretch, or along the block that stands far from its place.
  input.orders.forEach((order, index) => {
    const found = along(order.segments.filter((id) => linesOf.has(id)));
    if (found.lines.length === 0) return;
    marks.push({
      keys: [orderKey(index)],
      kind: 'order',
      ...found,
      name: r.variant.segmentAt(labelsOf(order.segments, context)),
    });
  });

  // Lanes, the longest mark nearest the text: the lines each lane is taken on. A caret between two lines takes both.
  const taken: Set<number>[] = Array.from({ length: MARGIN_LANES }, () => new Set<number>());
  const out = new Map<number, MarginPart[]>();
  marks.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
  for (const mark of marks) {
    const reach = [...mark.lines];
    if (mark.kind === 'unprinted') reach.push(mark.to + 1);
    const free = taken.findIndex((lane) => reach.every((line) => !lane.has(line)));
    const lane = free < 0 ? MARGIN_LANES - 1 : free;
    for (const line of reach) taken[lane]!.add(line);
    mark.lines.forEach((line, k) => {
      // A run of consecutive lines is one stroke; a prose paragraph between two breaks it.
      const joinsBefore = mark.lines[k - 1] === line - 1;
      const joinsAfter = mark.lines[k + 1] === line + 1;
      const edge: MarginEdge = joinsBefore
        ? joinsAfter
          ? 'middle'
          : 'end'
        : joinsAfter
          ? 'start'
          : 'solo';
      const part: MarginPart = {
        keys: mark.keys.join(' '),
        kind: mark.kind,
        edge,
        lane,
        first: k === 0,
        name: mark.name,
      };
      out.set(line, [...(out.get(line) ?? []), part]);
    });
  }
  for (const parts of out.values()) parts.sort((a, b) => a.lane - b.lane);
  return out;
}

/** The labels of prose that mark the order of segments, and where each stands. */
export interface LabelMarks {
  /** The keys of the variants a prose paragraph's label in the margin opens, by the index of its line. */
  margin: Map<number, string>;
  /** The keys of the variants a label in the text opens, by the id of the item where its segment begins. */
  inline: Map<string, string>;
  /** The labels that take the keyboard's focus: the first of each variant, by the index of its line or the id of its item. */
  stops: { margin: Set<number>; inline: Set<string> };
}

/** What a line holds that the labels are placed by. */
export interface LabelLine {
  lineation: Lineation;
  /** The stream index of the line's first item. */
  from: number;
  items: readonly { id: string }[];
  starts: readonly { segmentId: string | null; itemIndex: number }[];
}

/**
 * The labels of the segments in another order that stand in a prose
 * paragraph: a segment's label stands where it begins, in the margin when that
 * is the first item of the paragraph and in the text elsewhere. In verse the
 * order is marked by a bracket in the margin (`lineMarks`).
 */
export function labelMarks(
  lines: readonly LabelLine[],
  orders: readonly OrderVariant[],
): LabelMarks {
  const margin = new Map<number, string>();
  const inline = new Map<string, string>();
  const stops = { margin: new Set<number>(), inline: new Set<string>() };
  const seen = new Set<number>();
  orders.forEach((order, index) => {
    const key = orderKey(index);
    const wanted = new Set(order.segments);
    lines.forEach((line, at) => {
      if (line.lineation !== 'prose') return;
      line.starts.forEach((start, k) => {
        if (start.segmentId === null || !wanted.has(start.segmentId)) return;
        const item = line.items[start.itemIndex - line.from];
        const first = !seen.has(index);
        seen.add(index);
        if (k === 0 && start.itemIndex === line.from) {
          margin.set(at, margin.has(at) ? `${margin.get(at)} ${key}` : key);
          if (first) stops.margin.add(at);
        } else if (item) {
          inline.set(item.id, inline.has(item.id) ? `${inline.get(item.id)} ${key}` : key);
          if (first) stops.inline.add(item.id);
        }
      });
    });
  });
  return { margin, inline, stops };
}
