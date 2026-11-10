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

export interface ExportSegment {
  segmentId: string;
  label: string;
  collation: Pick<Collation, 'sites'>;
  baseUnits: Unit[];
  attachments: Record<number, Attachment[]>;
  notes?: { text: string; author: string | null }[];
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
  for (const { segmentId, items } of segmentItems(input.content)) {
    const segment = input.segments[segmentId];
    const label = segment?.label ?? input.labelOf[segmentId] ?? segmentId;
    const lines = printedLines(items, input.sigla, shown);
    const indent = ' '.repeat(label.length + 2);
    lines.forEach((line, i) => out.push(i === 0 ? `${label}  ${line}` : `${indent}${line}`));
    if (lines.length === 0) out.push(label);
    if (!segment) continue;
    const entries = apparatusEntries(
      segment.collation as Collation,
      label,
      segment.attachments,
      input.conventions,
      input.siglaOrder,
    );
    const { main, interpretative } = splitEntries(entries, input.conventions);
    for (const line of formatApparatus(main, input.conventions)) out.push(`    ${line}`);
    for (const line of formatApparatus(interpretative, input.conventions))
      out.push(`    ${input.interpretativeWord}: ${line}`);
    for (const note of segment.notes ?? [])
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
  return segmentItems(content).map(({ segmentId, items }) => {
    const segment = segments[segmentId];
    const sites: Site[] = segment?.collation.sites ?? [];
    return {
      label: segment?.label ?? labelOf[segmentId] ?? segmentId,
      items,
      baseUnits: segment?.baseUnits ?? [],
      sites,
      attachments: segment?.attachments ?? {},
    };
  });
}
