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
  type ApparatusConventions,
  type Attachment,
  type Collation,
  type EditionSegmentExport,
  type Item,
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

/** Each segment's items, its runs gathered in the order they stand, segments in the order they first appear. */
export function segmentItems(content: Stream): { segmentId: string; items: Item[] }[] {
  const bySegment = new Map<string, Item[]>();
  for (const run of segmentRuns(content)) {
    if (run.segmentId === null) continue;
    const items = bySegment.get(run.segmentId) ?? [];
    items.push(...content.items.slice(run.from, run.to));
    bySegment.set(run.segmentId, items);
  }
  return [...bySegment].map(([segmentId, items]) => ({ segmentId, items }));
}

/** Items split at their breaks into printed lines, empty lines left out. */
function printedLines(items: Item[], sigla: EditionSigla): string[] {
  const lines: Item[][] = [[]];
  for (const item of items) {
    if (item.kind === 'break') lines.push([]);
    else lines[lines.length - 1]!.push(item);
  }
  return lines
    .map((line) => plainLine(printLine(line, sigla)))
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
}

/**
 * The text with its apparatus: each segment's label and words, its
 * continuation lines indented, and under it the entries as the edition
 * prints them (the interpretative ones last when listed apart), then its notes.
 */
export function plainText(input: PlainTextInput): string {
  const out: string[] = [...input.heading];
  if (out.length) out.push('');
  for (const { segmentId, items } of segmentItems(input.content)) {
    const segment = input.segments[segmentId];
    const label = segment?.label ?? input.labelOf[segmentId] ?? segmentId;
    const lines = printedLines(items, input.sigla);
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
