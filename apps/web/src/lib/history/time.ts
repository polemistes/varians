/**
 * Times as the history shows them: "Today, 14:02 to 14:40", "2 Oct 2026,
 * 14:02", "Yesterday, 09:10 to 2 Oct 2026, 08:00". Pure; the locale and the
 * current time are parameters so that this is testable.
 */

import type { HistoryStrings } from '../strings/history.ts';

export interface TimeOptions {
  locale?: string;
  now?: Date;
  timeZone?: string;
}

function sameDay(a: Date, b: Date, timeZone?: string): boolean {
  const key = (d: Date) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone }).format(d);
  return key(a) === key(b);
}

export function formatTime(value: string | Date, options: TimeOptions = {}): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(options.locale, { timeStyle: 'short', timeZone: options.timeZone }).format(date);
}

/** The day of a date relative to now: "Today", "Yesterday" or "2 Oct 2026". */
export function formatDay(value: string | Date, t: Pick<HistoryStrings, 'today' | 'yesterday'>, options: TimeOptions = {}): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const now = options.now ?? new Date();
  if (sameDay(date, now, options.timeZone)) return t.today;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (sameDay(date, yesterday, options.timeZone)) return t.yesterday;
  return new Intl.DateTimeFormat(options.locale, { dateStyle: 'medium', timeZone: options.timeZone }).format(date);
}

/** "Today, 14:02" */
export function formatMoment(value: string | Date, t: Pick<HistoryStrings, 'today' | 'yesterday'>, options: TimeOptions = {}): string {
  return `${formatDay(value, t, options)}, ${formatTime(value, options)}`;
}

/** "Today, 14:02 to 14:40"; across days, "Yesterday, 23:50 to Today, 00:10"; one instant, "Today, 14:02". */
export function formatSpan(
  from: string | Date,
  to: string | Date,
  t: Pick<HistoryStrings, 'today' | 'yesterday' | 'to'>,
  options: TimeOptions = {},
): string {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  const start = formatMoment(a, t, options);
  if (Math.abs(b.getTime() - a.getTime()) < 60 * 1000) return start;
  if (sameDay(a, b, options.timeZone)) return `${start} ${t.to} ${formatTime(b, options)}`;
  return `${start} ${t.to} ${formatMoment(b, t, options)}`;
}
