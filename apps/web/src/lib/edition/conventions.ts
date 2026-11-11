/**
 * The conventions without `latin`, the setting for Latin abbreviations that an
 * edition stored before November 2026 may still carry and that nothing reads:
 * the print apparatus always says its words in English. Used wherever
 * conventions are written, so that the member goes the next time they are.
 */
export function withoutLatin<T extends object>(conventions: T): Omit<T, 'latin'> {
  const { latin: _latin, ...kept } = conventions as T & { latin?: unknown };
  return kept;
}
