/**
 * The shape of the reading page: lines grouped into blocks, each with its
 * apparatus at the foot; which segments stand on which line; the labels
 * printed in the margin; the segment a permalink asks for.
 */
import { defaultLastNumber, type LayoutLine } from '@varians/core';

export interface BlockOptions {
  numberEvery: number;
}

export interface Block {
  index: number;
  /** Line indexes in `lines`, end exclusive. */
  from: number;
  to: number;
  /** The segments whose text begins in this block, in order; their entries stand at its foot. */
  segmentIds: string[];
}

function firstStart(line: LayoutLine): string | null {
  return line.starts.find((s) => s.segmentId !== null)?.segmentId ?? null;
}

/**
 * Group lines into blocks, each paragraph by its own kind (`line.lineation`),
 * and a block never holds both kinds. Verse: a block runs up to and including
 * the next line with a printed label; the courtesy label of the first
 * numbered line, printed only because it is the first, does not close a
 * block, so that blocks follow the numbering (1 to 5, 6 to 10). Prose: a
 * block is one segment, from the line where it begins to the line before the
 * next begins; segments that begin on one line (a prose paragraph is one
 * line) share its block.
 */
export function blocksOf(lines: LayoutLine[], options: BlockOptions): Block[] {
  const every = Math.max(1, options.numberEvery || 1);
  const blocks: Block[] = [];
  let from = 0;
  let firstLabelSeen = false;
  let blockHasStart = false;
  const close = (to: number) => {
    if (to > from) blocks.push({ index: blocks.length, from, to, segmentIds: [] });
    from = to;
    blockHasStart = false;
  };
  lines.forEach((line, i) => {
    if (i > 0 && line.lineation !== lines[i - 1]!.lineation) close(i);
    if (line.lineation === 'prose') {
      const starts = firstStart(line) !== null;
      if (starts && blockHasStart) close(i);
      if (starts) blockHasStart = true;
      return;
    }
    if (line.label === null) return;
    const n = defaultLastNumber(line.label);
    const courtesy = !firstLabelSeen && every > 1 && (n === null || n % every !== 0);
    firstLabelSeen = true;
    if (!courtesy) close(i + 1);
  });
  close(lines.length);
  // Each segment's entries stand once, in the block where its text begins.
  const placed = new Set<string>();
  for (const block of blocks) {
    for (let i = block.from; i < block.to; i++) {
      for (const start of lines[i]!.starts) {
        if (start.segmentId === null || placed.has(start.segmentId)) continue;
        placed.add(start.segmentId);
        block.segmentIds.push(start.segmentId);
      }
    }
  }
  return blocks;
}

/** For each line, the segments whose words stand on it, in order: the one running on from before, then those that begin. */
export function segmentsByLine(lines: LayoutLine[]): string[][] {
  let current: string | null = null;
  return lines.map((line) => {
    const out: string[] = [];
    // A line's items stand at stream indexes from `line.from` on; breaks are not among them.
    const opensWithStart = line.starts[0]?.itemIndex === line.from;
    if (current !== null && !opensWithStart && line.items.length > 0) out.push(current);
    for (const start of line.starts) {
      current = start.segmentId;
      if (start.segmentId !== null && !out.includes(start.segmentId)) out.push(start.segmentId);
    }
    return out;
  });
}

/** The words of the paragraphs that are prose: where a variant over whole segments is marked on the words, in the text. */
export function proseTokens(lines: readonly LayoutLine[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines)
    if (line.lineation === 'prose')
      for (const item of line.items) if (item.kind === 'token') out.add(item.id);
  return out;
}

/** The segment each item of the text belongs to, null where the text is unassigned. */
export function segmentOfItems(lines: LayoutLine[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let current: string | null = null;
  for (const line of lines) {
    for (const item of line.items) {
      if ((item.kind === 'token' || item.kind === 'object') && item.segment)
        current = item.segment.segmentId;
      out.set(item.id, current);
    }
  }
  return out;
}

/**
 * The label printed beside each line: as the edition sets them, or every line
 * where a segment begins. A prose paragraph has the label of its first word
 * in the margin, and every other where its segment begins.
 */
export function lineLabels(
  lines: LayoutLine[],
  labelOf: Record<string, string>,
  mode: 'edition' | 'every',
): (string | null)[] {
  if (mode === 'edition') return lines.map((line) => line.label);
  return lines.map((line) => {
    if (line.lineation === 'prose') return line.label;
    const id = firstStart(line);
    return id === null ? line.label : (labelOf[id] ?? line.label);
  });
}

/**
 * Segments that begin within a line, after its first item: the item where each
 * begins, with its label. In a prose paragraph every segment is labelled where
 * it begins; in verse only when `verse` asks for it.
 */
export function inlineStarts(
  lines: LayoutLine[],
  labelOf: Record<string, string>,
  verse: boolean,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    if (line.lineation !== 'prose' && !verse) continue;
    for (const start of line.starts) {
      if (start.segmentId === null || start.itemIndex === line.from) continue;
      const item = line.items[start.itemIndex - line.from];
      if (item) map.set(item.id, labelOf[start.segmentId] ?? '');
    }
  }
  return map;
}

/** The segment a permalink names, by label (or by id), within the segments the edition has. */
export function resolveFocus(
  labelOf: Record<string, string>,
  param: string | undefined | null,
): { segmentId: string; label: string } | { missing: string } | null {
  if (!param) return null;
  const wanted = param.trim();
  for (const [segmentId, label] of Object.entries(labelOf))
    if (label === wanted) return { segmentId, label };
  if (labelOf[wanted] !== undefined) return { segmentId: wanted, label: labelOf[wanted]! };
  return { missing: wanted };
}

/**
 * Where a siglum is absent, as ranges of consecutive segments in the order
 * of the edition: `[['1.3', '1.3'], ['1.6', '1.8']]`.
 */
export function absentRanges(
  order: { label: string; absent: string[] }[],
  siglum: string,
): [string, string][] {
  const out: [string, string][] = [];
  let open: [string, string] | null = null;
  for (const segment of order) {
    if (segment.absent.includes(siglum)) {
      if (open) open[1] = segment.label;
      else {
        open = [segment.label, segment.label];
        out.push(open);
      }
    } else open = null;
  }
  return out;
}

/** Ranges as text: "1.3, 1.6–1.8". */
export function formatRanges(ranges: [string, string][]): string {
  return ranges.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(', ');
}
