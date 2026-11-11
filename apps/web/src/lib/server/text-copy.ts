/**
 * Copying text from a transcript of an edition's conspectus into the
 * edition (docs/design.md, section 3.9), for a range of segments: what the
 * copy would bring, and the copy itself, saved as one change in the
 * edition's history.
 */
import {
  compareAddresses,
  copyFromTranscript,
  parseLabel,
  segmentsToCopy,
  type Address,
  type Stream,
} from '@varians/core';
import {
  editionSigla,
  transcriptionSegments,
  type Database,
  type Edition,
  type Transcription,
} from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { editor as s } from '../strings/editor.ts';
import type { Actor } from './authz.ts';
import { VersionConflict, loadDocument, saveOps } from './documents/service.ts';
import { schemeOfWork, segmentsOfWork } from './segments.ts';
import { loadTranscriptionAccess } from './transcription-access.ts';

/** A request that cannot be done, with the status to answer and a message for the editor. */
export class CopyRefused extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CopyRefused';
  }
}

export interface CopyRange {
  transcriptionId: string;
  /** The first and last segment by label in the work's scheme; empty or absent for the first or last the transcript has. */
  from?: string | null;
  to?: string | null;
}

interface Prepared {
  transcription: Transcription;
  siglum: string;
  /** The transcript's segments of the work within the range. */
  segmentIds: Set<string>;
  /** Every segment of the work, in the work's order, with its label. */
  work: { id: string; label: string }[];
}

/** The transcript, its siglum and the segments of the range, or CopyRefused. */
async function prepare(
  db: Database,
  edition: Edition,
  user: Actor,
  range: CopyRange,
): Promise<Prepared> {
  const [entry] = await db
    .select({ siglum: editionSigla.siglum })
    .from(editionSigla)
    .where(
      and(
        eq(editionSigla.editionId, edition.id),
        eq(editionSigla.transcriptionId, range.transcriptionId),
      ),
    );
  if (!entry) throw new CopyRefused(404, s.dialogs.copyText.notInConspectus);
  const access = await loadTranscriptionAccess(db, user, range.transcriptionId);
  if (!access || !access.canView) throw new CopyRefused(404, s.dialogs.copyText.notInConspectus);

  const { scheme } = await schemeOfWork(db, edition.workId);
  const bound = (label: string | null | undefined): Address | null => {
    const text = label?.trim() ?? '';
    if (text === '') return null;
    const address = parseLabel(scheme, text);
    if (!address) throw new CopyRefused(400, s.dialogs.copyText.unknownLabel(text));
    return address;
  };
  const from = bound(range.from);
  const to = bound(range.to);

  const all = await segmentsOfWork(db, edition.workId);
  const has = new Set(
    (
      await db
        .select({ segmentId: transcriptionSegments.segmentId })
        .from(transcriptionSegments)
        .where(
          and(
            eq(transcriptionSegments.transcriptionId, range.transcriptionId),
            eq(transcriptionSegments.workId, edition.workId),
          ),
        )
    ).map((row) => row.segmentId),
  );
  const segmentIds = new Set(
    all
      .filter(
        (segment) =>
          has.has(segment.id) &&
          (!from || compareAddresses(scheme, segment.address, from) >= 0) &&
          (!to || compareAddresses(scheme, segment.address, to) <= 0),
      )
      .map((segment) => segment.id),
  );
  return {
    transcription: access.transcription,
    siglum: entry.siglum,
    segmentIds,
    work: all.map((segment) => ({ id: segment.id, label: segment.label })),
  };
}

export interface CopyPreview {
  /** How many segments the copy brings. */
  segments: number;
  /** How many of them the edition has text for, which the copy replaces. */
  replaced: number;
}

/** What a copy of this range would do to the edition as it now stands, without changing anything. */
export async function previewCopy(
  db: Database,
  edition: Edition,
  user: Actor,
  range: CopyRange,
): Promise<CopyPreview> {
  const prepared = await prepare(db, edition, user, range);
  if (prepared.segmentIds.size === 0) return { segments: 0, replaced: 0 };
  const current = await loadDocument(db, 'edition', edition.id);
  const found = segmentsToCopy(
    current.content,
    prepared.transcription.content as Stream,
    prepared.segmentIds,
  );
  return { segments: found.copied.length, replaced: found.replaced.length };
}

export interface CopyDone extends CopyPreview {
  version: number;
  changesetId: string;
}

/**
 * Copy the range into the edition, as one change of its history, against
 * the version the editor holds: where the edition has changed since, it is
 * VersionConflict and nothing is done.
 */
export async function copyText(
  db: Database,
  edition: Edition,
  user: Actor,
  range: CopyRange,
  fromVersion: number,
): Promise<CopyDone> {
  const prepared = await prepare(db, edition, user, range);
  const current = await loadDocument(db, 'edition', edition.id);
  if (current.version !== fromVersion)
    throw new VersionConflict({ version: current.version, content: current.content }, []);
  const copy = copyFromTranscript(
    current.content,
    prepared.transcription.content as Stream,
    prepared.transcription.id,
    prepared.segmentIds,
    prepared.work.map((segment) => segment.id),
    { lineation: edition.conventions.lineation ?? 'verse' },
  );
  if (copy.ops.length === 0)
    return { version: current.version, changesetId: '', segments: 0, replaced: 0 };
  // The range the history names: the first and the last segment copied, in the work's order.
  const copied = new Set(copy.copied);
  const labels = prepared.work.filter((segment) => copied.has(segment.id)).map((x) => x.label);
  const first = labels[0]!;
  const last = labels[labels.length - 1]!;
  const saved = await saveOps(
    db,
    'edition',
    edition.id,
    user.id,
    fromVersion,
    copy.ops,
    s.dialogs.copyText.message(first === last ? first : `${first}–${last}`, prepared.siglum),
  );
  return {
    version: saved.version,
    changesetId: saved.changesetId,
    segments: copy.copied.length,
    replaced: copy.replaced.length,
  };
}
