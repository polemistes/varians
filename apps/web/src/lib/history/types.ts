/**
 * The shapes the history API answers with, shared by the server module that
 * builds them and the panel that fetches them. Only types and a few pure
 * conversions live here; nothing touches the database or the DOM.
 */

import type { Change, Id, Item, Stream, StreamDiff, Token } from '@varians/core';

export type DocumentKind = 'transcription' | 'edition';

/** A StreamDiff as JSON carries it: the touched set as a list. */
export interface SerializedDiff {
  changes: Change[];
  touched: Id[];
  added: number;
  removed: number;
  changed: number;
  moved: number;
}

export function serializeDiff(diff: StreamDiff): SerializedDiff {
  return {
    changes: diff.changes,
    touched: [...diff.touched],
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    moved: diff.moved,
  };
}

/** How much a stretch of history changed, counted by what the panel can name. */
export interface ChangeCounts {
  /** Words (tokens) added, removed, re-spelt or otherwise changed, and moved. */
  added: number;
  removed: number;
  changed: number;
  moved: number;
  /** Breaks (line, page, column, paragraph) added, removed, and moved or changed. */
  breaksAdded: number;
  breaksRemoved: number;
  breaksMoved: number;
  /** Objects (gaps, notes, figures and the rest) added, removed, and changed or moved. */
  objectsAdded: number;
  objectsRemoved: number;
  objectsChanged: number;
}

export interface HistoryChangeset {
  id: string;
  version: number;
  /** ISO 8601 time. */
  at: string;
  /** Empty when the person no longer exists. */
  userId: string;
  message?: string;
  /** From the diff between the versions before and after it. */
  counts: ChangeCounts;
}

export interface HistorySession {
  key: string;
  userId: string;
  userName: string;
  from: string;
  to: string;
  fromVersion: number;
  toVersion: number;
  /** Newest first. */
  changesets: HistoryChangeset[];
  /** From diffStreams between the document before the session and after it. */
  counts: ChangeCounts;
  /** "3 words added, 1 changed". */
  summary: string;
}

export interface HistoryMoment {
  id: string;
  version: number;
  name: string;
  kind: 'named' | 'published';
  number: number | null;
  createdBy: string | null;
  createdByName: string | null;
  at: string;
}

export interface DocumentHistory {
  kind: DocumentKind;
  id: string;
  currentVersion: number;
  /** Newest first. */
  sessions: HistorySession[];
  /** Newest first. */
  moments: HistoryMoment[];
  /** User id to name, for everyone who appears. */
  people: Record<string, string>;
  /** Older changesets exist than the ones the sessions cover. */
  truncated: boolean;
}

export interface DocumentAtVersion {
  version: number;
  /** The version the diff compares from. */
  since: number;
  currentVersion: number;
  stream: Stream;
  diff: SerializedDiff;
  /** Item id to the id of the user who last changed it between `since` and `version`, for the items in the diff. */
  authors: Record<Id, string>;
  people: Record<string, string>;
  /** Segment id to label, for the segments the stream and the diff name. */
  labels: Record<string, string>;
}

export interface MomentResult {
  moment: HistoryMoment;
}

export interface RevertResult {
  /** The document's version after the call. */
  version: number;
  /** The new changeset, or null when the text already stood as it did then. */
  changesetId: string | null;
  unchanged: boolean;
}

export type UndoResult =
  | {
      ok: true;
      version: number;
      /** The new changeset, or null when nothing was left to undo. */
      changesetId: string | null;
      /** Reversing operations that could not be applied any more (only when forced). */
      skipped: number;
    }
  | {
      ok: false;
      /** Items the undo would touch that later changes touched too. */
      conflicts: Id[];
      /** Their text, as it stands now or as it last stood. */
      words: Record<Id, string>;
    };

export interface ReviewState {
  fromVersion: number;
  accepted: string[];
}

/** One cell of a line as the history shows it: an item and what happened to it. */
export interface Cell {
  item: Item;
  /** The item's index in its stream, or -1 for an item placed back after removal. */
  index: number;
  added: boolean;
  removed: boolean;
  changed: boolean;
  moved: boolean;
  /** The token as it was before it was changed, when it was. */
  was: Token | null;
  /** Which fields changed (form, norm, marks, segment, joinNext, source). */
  fields: string[];
  /** Who made the change marked on the cell, when known. */
  author: string | null;
  /** In the text as it was: the item moved away from here. */
  away?: boolean;
}

/** A line of a review card: the cells of one line, clipped around what changed (null stands for an ellipsis). */
export interface CompactLine {
  key: string;
  /** The segment the line belongs to, for its label. */
  segmentId: Id | null;
  cells: (Cell | null)[];
}

export interface ReviewItem {
  id: string;
  version: number;
  at: string;
  userId: string;
  userName: string;
  message?: string;
  /** Marked reviewed (accepted, or rejected by an undo). */
  accepted: boolean;
  /** Where in the current text the change stands, for ordering. */
  position: number;
  counts: ChangeCounts;
  summary: string;
  /** The touched lines as they were and as they became, a few at most. */
  before: CompactLine[];
  after: CompactLine[];
  /** How many lines the change touched in all. */
  linesTouched: number;
}

export interface ReviewChanges {
  fromVersion: number;
  currentVersion: number;
  /** In the order of the text, then of time. */
  items: ReviewItem[];
  /** Items not yet accepted. */
  remaining: number;
  people: Record<string, string>;
  labels: Record<string, string>;
  /** More changes exist since the review point than are listed. */
  truncated: boolean;
}
