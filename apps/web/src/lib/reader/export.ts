/**
 * The edition as files: the plain text with the apparatus under each
 * segment (the layout of the archive's edition.txt), and the segments the
 * TEI exporter takes. Built from the edition view at the version a visitor
 * sees, so that a download always matches the page it came from.
 */
import {
  apparatusEntries,
  splitEntries,
  formatApparatus,
  segmentRuns,
  shownBreaks,
  type ApparatusConventions,
  type Attachment,
  type Collation,
  type EditionSegmentExport,
  type Item,
  type Lineation,
  type Shown,
  type Site,
  type Stream,
  type Unit,
} from '@varians/core';
import { plainLine, printLine, type EditionSigla } from './marks';
import { labelOfSegments } from './sites';

/** A passage of the edition as the files are made from it. */
export interface ExportSegment {
  /** The passage's first segment. */
  segmentId: string;
  label: string;
  /** Its segments, each with the edition's units it holds. */
  segments: readonly { segmentId: string; from: number; to: number; printed: boolean }[];
  /** The segments of each site's words, by site index, in the order of the passage. */
  siteSegments: Record<number, string[]>;
  collation: Pick<Collation, 'sites'> & Partial<Collation>;
  baseUnits: Unit[];
  attachments: Record<number, Attachment[]>;
  notes?: { segmentId?: string; text: string; author: string | null }[];
}

/** What one segment of the edition prints of the passage it is in: its own words, and the variants that begin in it. */
export interface SegmentShare {
  passage: ExportSegment;
  /** The edition's units of the segment. */
  baseUnits: Unit[];
  /** The variants that begin in the segment, placed among its own units: a variant that runs on into the next segment reaches past them. */
  sites: Site[];
  attachments: Record<number, Attachment[]>;
  notes: { text: string; author: string | null }[];
}

/**
 * Each segment's share of the passages, by segment id. A variant belongs to
 * the segment its words begin in; one at a segment the edition does not
 * print, to the edition's segment it stands after. The print apparatus is
 * kept as built, segment by segment, and so gives a variant across a
 * boundary under the segment it begins in.
 */
export function segmentShares(passages: Iterable<ExportSegment>): Map<string, SegmentShare> {
  const out = new Map<string, SegmentShare>();
  for (const passage of passages) {
    const parts = passage.segments;
    const home = (site: Site): string | undefined => {
      const ids = passage.siteSegments[site.index] ?? [];
      const printed = ids.find((id) => parts.some((p) => p.segmentId === id && p.printed));
      if (printed) return printed;
      // A segment the edition does not print: the edition's segment before it.
      const at = parts.findIndex((p) => p.segmentId === ids[0]);
      for (let k = at; k >= 0; k--) if (parts[k]!.printed) return parts[k]!.segmentId;
      return parts.find((p) => p.printed)?.segmentId;
    };
    for (const part of parts) {
      if (!part.printed) continue;
      out.set(part.segmentId, {
        passage,
        baseUnits: passage.baseUnits.slice(part.from, part.to),
        sites: [],
        attachments: {},
        notes: (passage.notes ?? []).filter(
          (n) => (n.segmentId ?? passage.segmentId) === part.segmentId,
        ),
      });
    }
    for (const site of passage.collation.sites) {
      const id = home(site);
      const share = id ? out.get(id) : undefined;
      const part = parts.find((p) => p.segmentId === id);
      if (!share || !part) continue;
      share.sites.push({
        ...site,
        baseFrom: Math.max(0, site.baseFrom - part.from),
        baseTo: Math.max(0, site.baseTo - part.from),
      });
      const attached = passage.attachments[site.index];
      if (attached) share.attachments[site.index] = attached;
    }
  }
  return out;
}

/** The label of a segment: as the labels give it, or as its passage does. */
function labelIn(
  segmentId: string,
  share: SegmentShare | undefined,
  labelOf: Record<string, string>,
): string {
  const part = share?.passage.segments.find((p) => p.segmentId === segmentId) as
    | { label?: string }
    | undefined;
  return (
    labelOf[segmentId] ??
    part?.label ??
    (share?.passage.segmentId === segmentId ? share.passage.label : undefined) ??
    segmentId
  );
}

/** The entries of a segment's share, each under the label of the segments its words lie in. */
function shareEntries(
  share: SegmentShare,
  label: string,
  labelOf: Record<string, string>,
  conventions: ApparatusConventions,
  siglaOrder: string[],
) {
  const collation = { ...share.passage.collation, sites: share.sites } as Collation;
  return apparatusEntries(collation, label, share.attachments, conventions, siglaOrder).map(
    (entry) => {
      const ids = share.passage.siteSegments[entry.siteIndex];
      return ids?.length ? { ...entry, label: labelOfSegments(ids, labelOf) } : entry;
    },
  );
}

/**
 * The items of each segment, in the order of the text. What opens a line
 * before its first word (a speaker, a heading, a mark) stands in the stream
 * after the break that ends the line above, and so in the run of the segment
 * above: it is given to the segment it opens.
 */
export function segmentItems(content: Stream): { segmentId: string; items: Item[] }[] {
  const bySegment = new Map<string, Item[]>();
  let opening: Item[] = [];
  let last: Item[] | null = null;
  for (const run of segmentRuns(content)) {
    let items = content.items.slice(run.from, run.to);
    let next: Item[] = [];
    const lastBreak = items.findLastIndex((item) => item.kind === 'break');
    // Before the first segment there is no break to look for: whatever stands there opens the first line.
    const after = lastBreak >= 0 || run.segmentId === null ? items.slice(lastBreak + 1) : [];
    if (after.length > 0 && after.every((item) => item.kind === 'object')) {
      next = after;
      items = items.slice(0, lastBreak + 1);
    }
    if (run.segmentId === null) {
      // Text of no segment is not printed; what opens the line after it still is.
      opening = next;
      continue;
    }
    const list = bySegment.get(run.segmentId) ?? [];
    list.push(...opening, ...items);
    bySegment.set(run.segmentId, list);
    opening = next;
    last = list;
  }
  // Nothing follows: what stood after the last break stays with the last segment.
  if (opening.length > 0 && last) last.push(...opening);
  const out = [...bySegment].map(([segmentId, items]) => ({ segmentId, items }));
  // A paragraph break that begins the text gives its first paragraph its kind: it goes with the first segment.
  const leading = content.items[0];
  if (leading?.kind === 'break' && leading.type === 'paragraph' && out[0])
    out[0].items.unshift(leading);
  return out;
}

/**
 * Items split at their breaks into printed lines, empty lines left out. A
 * break that is not shown (inside a prose paragraph) does not end a line, and
 * a word divided by the end of a line that is shown has its hyphen there.
 */
function printedLines(items: Item[], sigla: EditionSigla, shown: Shown): string[] {
  const lines: Item[][] = [[]];
  for (const item of items) {
    if (item.kind === 'break' && !shown.hidden.has(item.id)) lines.push([]);
    else lines[lines.length - 1]!.push(item);
  }
  return lines
    .map((line) => {
      const last = line[line.length - 1];
      return plainLine(
        printLine(line, sigla, 'read', last !== undefined && shown.hyphens.has(last.id)),
      );
    })
    .filter((line) => line.trim() !== '');
}

export interface PlainTextInput {
  /** Lines printed above the text: author and work, title, editors, version. */
  heading: string[];
  content: Stream;
  segments: Record<string, ExportSegment>;
  labelOf: Record<string, string>;
  conventions: ApparatusConventions;
  siglaOrder: string[];
  sigla: EditionSigla;
  /** The word that introduces a note. */
  noteWord: string;
  /** The word that introduces an interpretative variant listed apart. */
  interpretativeWord: string;
  /** The edition's convention: the kind of a paragraph that is not marked. Verse where absent. */
  lineation?: Lineation;
}

/**
 * The text with its apparatus: each segment's label and words, its
 * continuation lines indented, and under it the entries as the edition
 * prints them (the interpretative ones last when listed apart), then its notes.
 */
export function plainText(input: PlainTextInput): string {
  const out: string[] = [...input.heading];
  if (out.length) out.push('');
  const shown = shownBreaks(input.content.items, input.lineation ?? 'verse');
  const shares = segmentShares(Object.values(input.segments));
  for (const { segmentId, items } of segmentItems(input.content)) {
    const share = shares.get(segmentId);
    const label = labelIn(segmentId, share, input.labelOf);
    const lines = printedLines(items, input.sigla, shown);
    const indent = ' '.repeat(label.length + 2);
    lines.forEach((line, i) => out.push(i === 0 ? `${label}  ${line}` : `${indent}${line}`));
    if (lines.length === 0) out.push(label);
    if (!share) continue;
    const entries = shareEntries(share, label, input.labelOf, input.conventions, input.siglaOrder);
    const { main, interpretative } = splitEntries(entries, input.conventions);
    for (const line of formatApparatus(main, input.conventions)) out.push(`    ${line}`);
    for (const line of formatApparatus(interpretative, input.conventions))
      out.push(`    ${input.interpretativeWord}: ${line}`);
    for (const note of share.notes)
      out.push(`    ${input.noteWord}: ${note.text}${note.author ? ` (${note.author})` : ''}`);
  }
  return out.join('\n') + '\n';
}

/** The segments of the TEI export: items, the units collation saw, the sites and what is attached to them. */
export function teiSegments(
  content: Stream,
  segments: Record<string, ExportSegment>,
  labelOf: Record<string, string>,
): EditionSegmentExport[] {
  const shares = segmentShares(Object.values(segments));
  return segmentItems(content).map(({ segmentId, items }) => {
    const share = shares.get(segmentId);
    return {
      label: labelIn(segmentId, share, labelOf),
      items,
      baseUnits: share?.baseUnits ?? [],
      sites: share?.sites ?? [],
      attachments: share?.attachments ?? {},
    };
  });
}
