/**
 * Importing a TEI text into a transcription: parse, map the structure found
 * onto the work's scheme, create the segments, set the segment starts, and
 * save as one changeset.
 */

import {
  applyStarts,
  detectStructure,
  importTei,
  proposeMapping,
  resolveStarts,
  type Stream,
  type UnitMapping,
} from '@varians/core';
import type { Database } from '@varians/db';
import { replaceContent } from '../documents/service.ts';
import { resolveLabels, schemeOfWork } from '../segments.ts';

export interface TeiPreview {
  structure: ReturnType<typeof detectStructure>;
  mapping: UnitMapping;
  header: ReturnType<typeof importTei>['header'];
  witness: ReturnType<typeof importTei>['witness'];
  /** How many starts the mapping resolves, and a few example labels. */
  resolved: number;
  unresolved: number;
  examples: string[];
  words: number;
  warnings: string[];
}

/** What an import would do, before it is confirmed: the structure found and the proposed mapping. */
export async function previewTei(
  db: Database,
  workId: string,
  xml: string,
  mapping?: UnitMapping,
): Promise<TeiPreview> {
  const work = await schemeOfWork(db, workId);
  const structure = detectStructure(xml);
  const result = importTei(xml);
  const units = structure.units.map((u) => u.unit);
  const proposed = mapping ?? proposeMapping(units, work.scheme);
  const { resolved, unresolved } = resolveStarts(result.segmentStarts, proposed, work.scheme);
  const words = result.stream.items.filter((i) => i.kind === 'token').length;
  const preview: TeiPreview = {
    structure,
    mapping: proposed,
    header: result.header,
    witness: result.witness,
    resolved: resolved.length,
    unresolved: unresolved.length,
    examples: resolved.slice(0, 5).map((r) => r.label),
    words,
    warnings: result.warnings,
  };
  return preview;
}

export interface TeiImportResult {
  version: number;
  content: Stream;
  segments: number;
  unresolved: number;
  warnings: string[];
}

/** Import TEI into a transcription, replacing its content. */
export async function importTeiIntoTranscription(
  db: Database,
  input: {
    transcriptionId: string;
    fromVersion: number;
    workId: string;
    xml: string;
    mapping: UnitMapping;
    userId: string | null;
  },
): Promise<TeiImportResult> {
  const work = await schemeOfWork(db, input.workId);
  const result = importTei(input.xml);
  const { resolved, unresolved } = resolveStarts(result.segmentStarts, input.mapping, work.scheme);
  const labels = await resolveLabels(
    db,
    work,
    resolved.map((r) => r.label),
  );
  // Several hints at one item (a line element and its lb) keep the one the mapping resolved last for that index.
  const byIndex = new Map<number, string>();
  for (const r of resolved) {
    const segment = labels.get(r.label);
    if (segment) byIndex.set(r.itemIndex, segment.id);
  }
  const stream = applyStarts(
    result.stream,
    [...byIndex.entries()].map(([itemIndex, segmentId]) => ({ itemIndex, segmentId })),
  );
  const saved = await replaceContent(
    db,
    'transcription',
    input.transcriptionId,
    input.userId,
    input.fromVersion,
    stream,
    'TEI import',
  );
  return {
    version: saved.version,
    content: saved.content,
    segments: byIndex.size,
    unresolved: unresolved.length,
    warnings: result.warnings,
  };
}
