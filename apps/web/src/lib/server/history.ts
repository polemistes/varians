/**
 * The history of a document (PLAN 4.11): its sessions and named moments,
 * the text as it stood at any version with what changed since marked,
 * bringing the text back, undoing one change, and reviewing the changes of
 * others.
 *
 * Everything here reads the changesets the save protocol writes
 * (documents/service.ts) and writes new ones through it: bringing back,
 * undoing and rejecting are changesets of the person who does them, shown in
 * the history like any other and themselves reversible. Nothing is ever
 * rewritten.
 */

import { error, json } from '@sveltejs/kit';
import {
  StreamError,
  applyOps,
  indexOf,
  sessions as groupSessions,
  touchedIds,
  undoConflicts,
  type Changeset,
  type Id,
  type Item,
  type Stream,
} from '@varians/core';
import {
  and,
  asc,
  changesets,
  desc,
  eq,
  gt,
  isNotNull,
  inArray,
  lte,
  moments,
  persons,
  reviewState,
  segments,
  sql,
  users,
  type ChangesetRow,
  type Database,
  type DocumentKind,
  type Moment,
} from '@varians/db';
import { applyWithAuthors } from '../history/authors.ts';
import { deepEqual, diffStates } from '../history/diff.ts';
import { positionIn, slimLine, touchedLines } from '../history/review.ts';
import { walkBack } from '../history/states.ts';
import { addCounts, countChanges, countOps, describeCounts, emptyCounts } from '../history/summary.ts';
import {
  serializeDiff,
  type ChangeCounts,
  type DocumentAtVersion,
  type DocumentHistory,
  type HistoryMoment,
  type HistorySession,
  type ReviewChanges,
  type ReviewItem,
  type ReviewState,
  type RevertResult,
  type UndoResult,
} from '../history/types.ts';
import { revertOps, salvageOps, wordsOf } from '../history/undo.ts';
import { historyStrings } from '../strings/history.ts';
import { isDocumentKind, loadDocumentAccess, type DocumentAccess } from './document-access.ts';
import { VersionConflict, documentAt, history as changesetLog, loadDocument, nameMoment, saveOps } from './documents/service.ts';
import { conformed, transcriptionPageOrder } from './conform.ts';

/** A pause longer than this ends a session. */
export const SESSION_PAUSE_MS = 20 * 60 * 1000;
/** The newest changesets the history lists; older ones are summed up as "older history". */
export const HISTORY_LIMIT = 1000;
/** The most changes a review lists at once. */
export const REVIEW_LIMIT = 500;
/** Saving retries when someone else saved in the moment between reading and writing. */
const ATTEMPTS = 3;

/** A refusal the routes answer with its status. */
export class HistoryError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HistoryError';
  }
}

function toCore(row: ChangesetRow): Changeset {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version ?? 0,
    parentId: row.parentId,
    // An author without an account here (an imported change) is named by their person.
    userId: row.userId ?? row.personId ?? '',
    at: row.at.toISOString(),
    ops: row.ops,
    reverse: row.reverse,
    ...(row.message ? { message: row.message } : {}),
  };
}

async function namesOf(db: Database, ids: Iterable<string | null | undefined>): Promise<Record<string, string>> {
  const list = [...new Set([...ids].filter((id): id is string => !!id))];
  if (list.length === 0) return {};
  // Accounts and their persons share ids; persons without an account are named too.
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list));
  const found = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  const rest = list.filter((id) => !(id in found));
  if (rest.length) for (const p of await db.select({ id: persons.id, name: persons.name }).from(persons).where(inArray(persons.id, rest))) found[p.id] = p.name;
  return found;
}

async function labelsOf(db: Database, ids: Iterable<string | null | undefined>): Promise<Record<string, string>> {
  const list = [...new Set([...ids].filter((id): id is string => !!id))];
  if (list.length === 0) return {};
  const rows = await db.select({ id: segments.id, label: segments.label }).from(segments).where(inArray(segments.id, list));
  return Object.fromEntries(rows.map((r) => [r.id, r.label]));
}

function segmentIdsOf(items: Iterable<Item>): string[] {
  const out: string[] = [];
  for (const item of items) if (item.kind !== 'break' && item.segment?.segmentId) out.push(item.segment.segmentId);
  return out;
}

function personName(people: Record<string, string>, userId: string | null | undefined): string {
  return (userId && people[userId]) || historyStrings.unknownPerson;
}

function toMoment(row: Moment, people: Record<string, string>): HistoryMoment {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    kind: row.kind,
    number: row.number,
    createdBy: row.createdBy ?? row.personId,
    createdByName: (row.createdBy ?? row.personId) ? personName(people, (row.createdBy ?? row.personId)!) : null,
    at: row.at.toISOString(),
  };
}

async function momentRows(db: Database, kind: DocumentKind, documentId: string): Promise<Moment[]> {
  return db
    .select()
    .from(moments)
    .where(and(eq(moments.documentKind, kind), eq(moments.documentId, documentId)))
    .orderBy(desc(moments.version), desc(moments.at));
}

/** The named moments of a document, newest first. */
export async function momentsOf(db: Database, kind: DocumentKind, documentId: string): Promise<HistoryMoment[]> {
  const rows = await momentRows(db, kind, documentId);
  const people = await namesOf(db, rows.map((r) => r.createdBy ?? r.personId));
  return rows.map((r) => toMoment(r, people));
}

export interface HistoryOptions {
  /** The newest changesets to cover. */
  limit?: number;
  /** A pause longer than this ends a session. */
  pauseMs?: number;
}

/**
 * A document's history: its changesets grouped into sessions (one person's
 * work before a pause), each with how much it added, removed and changed,
 * counted from the difference between the text before and after it; the
 * named moments; the current version. Newest first.
 */
export async function historyOf(db: Database, kind: DocumentKind, documentId: string, options: HistoryOptions = {}): Promise<DocumentHistory> {
  const limit = options.limit ?? HISTORY_LIMIT;
  const doc = await loadDocument(db, kind, documentId);
  const rows = await changesetLog(db, kind, documentId, 0, limit + 1);
  const truncated = rows.length > limit;
  const log = truncated ? rows.slice(0, limit) : rows;
  const grouped = groupSessions(log, options.pauseMs ?? SESSION_PAUSE_MS);

  // One walk back through the log: each changeset's own difference, and each
  // session's, between the text before its first changeset and after its last.
  const perChangeset = new Map<string, ChangeCounts>();
  const perSession = new Map<number, ChangeCounts>();
  const ends = new Map<number, Stream>();
  const toOf = new Map(grouped.map((s) => [s.fromVersion, s.toVersion]));
  const closing = new Set(grouped.map((s) => s.toVersion));
  walkBack(doc.content, doc.version, log, (c, before, after) => {
    const counts = countChanges(diffStates(before, after));
    perChangeset.set(c.id, counts);
    if (closing.has(c.version)) ends.set(c.version, after);
    const to = toOf.get(c.version);
    if (to === undefined) return;
    const end = ends.get(to);
    ends.delete(to);
    if (!end) return;
    perSession.set(c.version, to === c.version ? counts : countChanges(diffStates(before, end)));
  });

  const momentList = await momentRows(db, kind, documentId);
  const people = await namesOf(db, [...log.map((c) => c.userId), ...momentList.map((m) => m.createdBy ?? m.personId)]);
  const countsOf = (c: Changeset) => perChangeset.get(c.id) ?? countOps(c.ops);

  const sessionList: HistorySession[] = grouped
    .map((s) => {
      const counts = perSession.get(s.fromVersion) ?? s.changesets.reduce((sum, c) => addCounts(sum, countsOf(c)), emptyCounts());
      return {
        key: `s${s.fromVersion}`,
        userId: s.userId,
        userName: personName(people, s.userId),
        from: s.from,
        to: s.to,
        fromVersion: s.fromVersion,
        toVersion: s.toVersion,
        changesets: s.changesets
          .map((c) => ({ id: c.id, version: c.version, at: c.at, userId: c.userId, ...(c.message ? { message: c.message } : {}), counts: countsOf(c) }))
          .reverse(),
        counts,
        summary: describeCounts(counts, historyStrings),
      };
    })
    .reverse();

  return {
    kind,
    id: documentId,
    currentVersion: doc.version,
    sessions: sessionList,
    moments: momentList.map((m) => toMoment(m, people)),
    people,
    truncated,
  };
}

/**
 * The text as it stood at `version`, with what changed since `since` (by
 * default the version before): the difference between the two states, and
 * for each item in it the person who last changed it in between.
 */
export async function documentWithChanges(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  version: number,
  since?: number,
): Promise<DocumentAtVersion> {
  const doc = await loadDocument(db, kind, documentId);
  if (!Number.isInteger(version) || version < 0 || version > doc.version) throw new HistoryError(404, 'No such version');
  const from = Math.min(Math.max(0, since ?? version - 1), version);
  const before = from === doc.version ? doc.content : await documentAt(db, kind, documentId, from);
  const rows =
    from < version
      ? await db
          .select()
          .from(changesets)
          .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), gt(changesets.version, from), lte(changesets.version, version)))
          .orderBy(asc(changesets.version))
      : [];
  const forward = rows.map(toCore);
  const complete = forward.length === version - from && forward.every((c, i) => c.version === from + 1 + i);

  let stream: Stream;
  let authors: Map<Id, string>;
  if (complete) {
    ({ stream, authors } = applyWithAuthors(before, forward));
  } else {
    // A gap in the log: rebuild the state another way and name authors by the ids their operations touched.
    stream = await documentAt(db, kind, documentId, version);
    authors = new Map();
    for (const c of forward) for (const op of c.ops) for (const id of touchedIds(op)) authors.set(id, c.userId);
  }

  const diff = diffStates(before, stream);
  const inDiff = new Set<Id>();
  const changedItems: Item[] = [];
  for (const change of diff.changes) {
    if (change.kind === 'changed') {
      inDiff.add(change.after.id);
      changedItems.push(change.before);
    } else {
      inDiff.add(change.item.id);
      if (change.kind === 'removed') changedItems.push(change.item);
    }
  }
  const authorOf: Record<Id, string> = {};
  for (const id of inDiff) {
    const userId = authors.get(id);
    if (userId) authorOf[id] = userId;
  }
  const [people, labels] = await Promise.all([
    namesOf(db, Object.values(authorOf)),
    labelsOf(db, segmentIdsOf([...stream.items, ...changedItems])),
  ]);
  return { version, since: from, currentVersion: doc.version, stream, diff: serializeDiff(diff), authors: authorOf, people, labels };
}

/** Give a version of a document a name. */
export async function addMoment(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  userId: string | null,
  version: number,
  name: string,
): Promise<HistoryMoment> {
  const doc = await loadDocument(db, kind, documentId);
  if (!Number.isInteger(version) || version < 0 || version > doc.version) throw new HistoryError(400, 'No such version');
  const trimmed = name.trim();
  if (!trimmed) throw new HistoryError(400, 'A moment needs a name');
  const id = await nameMoment(db, kind, documentId, version, trimmed, userId, 'named');
  const [row] = await db.select().from(moments).where(eq(moments.id, id));
  return toMoment(row!, await namesOf(db, [userId]));
}

export interface RevertOptions {
  /** The version the person saw as current; when the document has moved on since, nothing is done (409). */
  expectedVersion?: number;
}

/**
 * Bring the whole text back to how it stood at `version`, as one new
 * changeset of the user's: one replacement of all current items by the items
 * as they were, which keeps their ids.
 */
export async function revertTo(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  userId: string | null,
  version: number,
  options: RevertOptions = {},
): Promise<RevertResult> {
  for (let attempt = 1; ; attempt++) {
    const doc = await loadDocument(db, kind, documentId);
    if (options.expectedVersion !== undefined && doc.version !== options.expectedVersion) {
      throw new HistoryError(409, 'The document changed meanwhile', { currentVersion: doc.version });
    }
    if (!Number.isInteger(version) || version < 0 || version > doc.version) throw new HistoryError(404, 'No such version');
    const at = version === doc.version ? doc.content : await documentAt(db, kind, documentId, version);
    // A version from before a page was removed or the pages reordered comes back in the pages' present shape.
    const target = kind === 'transcription' ? conformed(at, await transcriptionPageOrder(db, documentId)) : at;
    if (deepEqual(target.items, doc.content.items)) return { version: doc.version, changesetId: null, unchanged: true };
    try {
      const saved = await saveOps(db, kind, documentId, userId, doc.version, revertOps(doc.content, target), `brought back as of version ${version}`);
      return { version: saved.version, changesetId: saved.changesetId, unchanged: false };
    } catch (cause) {
      if (!(cause instanceof VersionConflict)) throw cause;
      if (options.expectedVersion !== undefined || attempt >= ATTEMPTS) {
        throw new HistoryError(409, 'The document changed meanwhile', { currentVersion: cause.current.version });
      }
    }
  }
}

export interface UndoOptions {
  /** Also mark the change reviewed by the user: a rejection in review. */
  reviewed?: boolean;
}

/**
 * Undo one earlier changeset by applying its reversing operations as a new
 * changeset of the user's. When later changesets touched the same items the
 * undo is refused with those items, unless forced; forced, as much of it is
 * applied as still can be (see salvageOps).
 */
export async function undoChangeset(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  userId: string | null,
  changesetId: string,
  force = false,
  options: UndoOptions = {},
): Promise<UndoResult> {
  const [row] = await db
    .select()
    .from(changesets)
    // A changeset kept for its provenance and never applied here cannot be undone.
    .where(and(eq(changesets.id, changesetId), eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), isNotNull(changesets.version)));
  if (!row) throw new HistoryError(404, 'No such change');
  const target = toCore(row);
  const message = options.reviewed ? `rejected version ${target.version}` : `undid version ${target.version}`;
  const markReviewed = async () => {
    if (options.reviewed && userId) await acceptChangesets(db, kind, documentId, userId, [target.id]);
  };

  for (let attempt = 1; ; attempt++) {
    const doc = await loadDocument(db, kind, documentId);
    const later = (
      await db
        .select()
        .from(changesets)
        .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), gt(changesets.version, target.version)))
        .orderBy(asc(changesets.version))
    ).map(toCore);
    const carried = [...target.ops, ...target.reverse, ...later.flatMap((c) => [...c.ops, ...c.reverse])];
    const conflicts = undoConflicts(target, later);
    if (conflicts.length && !force) return { ok: false, conflicts, words: wordsOf(conflicts, [doc.content], carried) };

    const salvage = async () => {
      const references = await Promise.all([documentAt(db, kind, documentId, target.version - 1), documentAt(db, kind, documentId, target.version)]);
      return salvageOps(doc.content, target.reverse, references);
    };
    let plan: { ops: typeof target.reverse; skipped: number } = { ops: target.reverse, skipped: 0 };
    if (conflicts.length) plan = await salvage();
    else {
      try {
        applyOps(doc.content, plan.ops);
      } catch (cause) {
        if (!(cause instanceof StreamError)) throw cause;
        if (!force) return { ok: false, conflicts: cause.ids, words: wordsOf(cause.ids, [doc.content], carried) };
        plan = await salvage();
      }
    }

    if (plan.ops.length === 0) {
      await markReviewed();
      return { ok: true, version: doc.version, changesetId: null, skipped: plan.skipped };
    }
    try {
      const saved = await saveOps(db, kind, documentId, userId, doc.version, plan.ops, message);
      await markReviewed();
      return { ok: true, version: saved.version, changesetId: saved.changesetId, skipped: plan.skipped };
    } catch (cause) {
      if (!(cause instanceof VersionConflict)) throw cause;
      if (attempt >= ATTEMPTS) throw new HistoryError(409, 'The document changed meanwhile', { currentVersion: cause.current.version });
    }
  }
}

// Review

function reviewKey(kind: DocumentKind, documentId: string, userId: string) {
  return and(eq(reviewState.documentKind, kind), eq(reviewState.documentId, documentId), eq(reviewState.userId, userId));
}

/** Where a person reviews a document from, and what they accepted since; the beginning when they never reviewed it. */
export async function getReviewState(db: Database, kind: DocumentKind, documentId: string, userId: string): Promise<ReviewState> {
  const [row] = await db.select().from(reviewState).where(reviewKey(kind, documentId, userId));
  return row ? { fromVersion: row.fromVersion, accepted: row.accepted } : { fromVersion: 0, accepted: [] };
}

/** Review from another version: what was accepted at or before it no longer needs keeping. */
export async function setReviewFrom(db: Database, kind: DocumentKind, documentId: string, userId: string, version: number): Promise<ReviewState> {
  const doc = await loadDocument(db, kind, documentId);
  if (!Number.isInteger(version) || version < 0 || version > doc.version) throw new HistoryError(400, 'No such version');
  const current = await getReviewState(db, kind, documentId, userId);
  const kept = current.accepted.length
    ? (
        await db
          .select({ id: changesets.id })
          .from(changesets)
          .where(
            and(
              eq(changesets.documentKind, kind),
              eq(changesets.documentId, documentId),
              inArray(changesets.id, current.accepted),
              gt(changesets.version, version),
            ),
          )
      ).map((r) => r.id)
    : [];
  await db
    .insert(reviewState)
    .values({ documentKind: kind, documentId, userId, fromVersion: version, accepted: kept })
    .onConflictDoUpdate({
      target: [reviewState.documentKind, reviewState.documentId, reviewState.userId],
      set: { fromVersion: version, accepted: kept, updatedAt: new Date() },
    });
  return { fromVersion: version, accepted: kept };
}

/** Mark changesets of the document reviewed by the user. Ids of other documents are ignored. */
export async function acceptChangesets(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  userId: string,
  changesetIds: string[],
): Promise<ReviewState> {
  const valid = changesetIds.length
    ? (
        await db
          .select({ id: changesets.id })
          .from(changesets)
          .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), inArray(changesets.id, changesetIds)))
      ).map((r) => r.id)
    : [];
  if (valid.length) {
    // Merged in the database, so that two quick accepts cannot lose one another.
    await db
      .insert(reviewState)
      .values({ documentKind: kind, documentId, userId, fromVersion: 0, accepted: valid })
      .onConflictDoUpdate({
        target: [reviewState.documentKind, reviewState.documentId, reviewState.userId],
        set: {
          accepted: sql`(select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from jsonb_array_elements(${reviewState.accepted} || excluded.accepted) as e)`,
          updatedAt: new Date(),
        },
      });
  }
  return getReviewState(db, kind, documentId, userId);
}

/**
 * The changes by others since the user's review point, in the order of the
 * text: each with its author, what it added, removed and changed, the lines
 * it touched as they were and as they became, and whether it was accepted.
 */
export async function reviewChanges(db: Database, kind: DocumentKind, documentId: string, userId: string): Promise<ReviewChanges> {
  const state = await getReviewState(db, kind, documentId, userId);
  const doc = await loadDocument(db, kind, documentId);
  const rows = await changesetLog(db, kind, documentId, state.fromVersion, REVIEW_LIMIT + 1);
  const truncated = rows.length > REVIEW_LIMIT;
  const log = truncated ? rows.slice(0, REVIEW_LIMIT) : rows;
  const accepted = new Set(state.accepted);
  const current = indexOf(doc.content);

  const found: Omit<ReviewItem, 'userName' | 'summary'>[] = [];
  const reached = new Set<string>();
  walkBack(
    doc.content,
    doc.version,
    log,
    (c, before, after) => {
      reached.add(c.id);
      if (c.userId === userId) return;
      const diff = diffStates(before, after);
      const lines = touchedLines(before, after, diff);
      found.push({
        id: c.id,
        version: c.version,
        at: c.at,
        userId: c.userId,
        ...(c.message ? { message: c.message } : {}),
        accepted: accepted.has(c.id),
        position: positionIn(current, diff, after),
        counts: countChanges(diff),
        before: lines.before.map(slimLine),
        after: lines.after.map(slimLine),
        linesTouched: lines.total,
      });
    },
    state.fromVersion,
  );
  // Changesets the walk could not reach (a gap in the log) are listed without their lines.
  for (const c of log) {
    if (reached.has(c.id) || c.userId === userId) continue;
    found.push({
      id: c.id,
      version: c.version,
      at: c.at,
      userId: c.userId,
      ...(c.message ? { message: c.message } : {}),
      accepted: accepted.has(c.id),
      position: Number.MAX_SAFE_INTEGER,
      counts: countOps(c.ops),
      before: [],
      after: [],
      linesTouched: 0,
    });
  }

  const segmentIds = found.flatMap((f) => [...f.before, ...f.after].map((l) => l.segmentId));
  const [people, labels] = await Promise.all([namesOf(db, found.map((f) => f.userId)), labelsOf(db, segmentIds)]);
  const items: ReviewItem[] = found
    .map((f) => ({ ...f, userName: personName(people, f.userId), summary: describeCounts(f.counts, historyStrings) }))
    .sort((a, b) => a.position - b.position || a.version - b.version);
  return {
    fromVersion: state.fromVersion,
    currentVersion: doc.version,
    items,
    remaining: items.filter((i) => !i.accepted).length,
    people,
    labels,
    truncated,
  };
}

// For the routes

/**
 * The document a request names, with the user's rights on it: 404 for an
 * unknown kind or document and for one the user may not see, 403 when the
 * route needs editing and the user may only view.
 */
export async function requireDocument(
  locals: App.Locals,
  params: Partial<Record<'kind' | 'id', string>>,
  need: 'view' | 'edit',
): Promise<DocumentAccess> {
  const kind = params.kind ?? '';
  if (!isDocumentKind(kind)) error(404, 'No such document');
  const access = await loadDocumentAccess(locals.db, locals.user, kind, params.id ?? '');
  if (!access || !access.canView) error(404, 'No such document');
  if (need === 'edit' && (!access.canEdit || !locals.user)) error(403, 'You may not edit this document');
  return access;
}

/** A HistoryError as a JSON answer with its status; anything else is thrown on. */
export function historyErrorResponse(cause: unknown): Response {
  if (cause instanceof HistoryError) return json({ message: cause.message, ...cause.details }, { status: cause.status });
  throw cause;
}
