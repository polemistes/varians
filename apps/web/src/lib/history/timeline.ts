/**
 * The history as the panel lists it: sessions and named moments in one
 * column, newest first, each knowing the version it opens and the version
 * its changes are counted from. Pure.
 */

import type { HistoryMoment, HistorySession } from './types.ts';

export type TimelineEntry =
  | {
      type: 'session';
      key: string;
      /** The version opening the entry shows. */
      version: number;
      /** The version its changes are marked from. */
      since: number;
      session: HistorySession;
    }
  | {
      type: 'moment';
      key: string;
      version: number;
      since: number;
      moment: HistoryMoment;
    };

/**
 * Sessions and moments, newest first. A session opens at its last version
 * and marks its own changes; a named moment opens at its version and marks
 * what changed since the named moment before it (or since the beginning).
 * At one version a moment stands above the session it closes.
 */
export function buildTimeline(sessions: HistorySession[], moments: HistoryMoment[]): TimelineEntry[] {
  const momentVersions = [...new Set(moments.map((m) => m.version))].sort((a, b) => a - b);
  const previousMoment = (version: number): number => {
    let found = 0;
    for (const v of momentVersions) {
      if (v < version) found = v;
      else break;
    }
    return found;
  };
  const entries: TimelineEntry[] = [
    ...sessions.map(
      (session): TimelineEntry => ({
        type: 'session',
        key: `s${session.fromVersion}`,
        version: session.toVersion,
        since: Math.max(0, session.fromVersion - 1),
        session,
      }),
    ),
    ...moments.map(
      (moment): TimelineEntry => ({
        type: 'moment',
        key: `m${moment.id}`,
        version: moment.version,
        since: previousMoment(moment.version),
        moment,
      }),
    ),
  ];
  const at = (e: TimelineEntry) => (e.type === 'moment' ? Date.parse(e.moment.at) : Date.parse(e.session.to));
  return entries.sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version;
    if (a.type !== b.type) return a.type === 'moment' ? -1 : 1;
    return at(b) - at(a);
  });
}

export interface CompareOption {
  version: number;
  /** The entry that stands at that version, or null for the beginning. */
  entry: TimelineEntry | null;
}

/**
 * What an opened version can be compared with: every earlier version the
 * timeline names (each version once, the first entry naming it), then the
 * beginning.
 */
export function compareOptions(timeline: TimelineEntry[], version: number): CompareOption[] {
  const seen = new Set<number>();
  const out: CompareOption[] = [];
  for (const entry of timeline) {
    if (entry.version >= version || seen.has(entry.version)) continue;
    seen.add(entry.version);
    out.push({ version: entry.version, entry });
  }
  if (!seen.has(0)) out.push({ version: 0, entry: null });
  return out;
}
