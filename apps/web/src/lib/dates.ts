/**
 * Dates are rendered as ISO on the server and in the reader's locale after
 * mount, so that the markup the server sends matches what the client
 * hydrates. See LocalDate in the ui components.
 */

export function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** YYYY-MM-DD, the server-side rendering of a date. */
export function isoDate(value: string | Date): string {
  return toDate(value).toISOString().slice(0, 10);
}

export type DateFormat = 'date' | 'datetime';

/** The date in a locale, e.g. "2 Oct 2026" or "2 Oct 2026, 14:05". */
export function formatLocal(
  value: string | Date,
  format: DateFormat = 'date',
  locale?: string,
): string {
  const options: Intl.DateTimeFormatOptions =
    format === 'datetime' ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
  return new Intl.DateTimeFormat(locale, options).format(toDate(value));
}
