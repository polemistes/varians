/** Finding registry entries by a canonical identifier. */
import { sql, type SQL, type witnesses, type works } from '@varians/db';

/**
 * Whether one of an entry's identifiers is the query, letter for letter but
 * for case: the typed identifiers, and the work's primary CTS URN or the
 * witness's catalogue identifier. Pasting Q8275 or a Diktyon number finds
 * the entry.
 */
export function identifierMatches(table: typeof works | typeof witnesses, query: string): SQL {
  const q = query.trim().toLowerCase();
  return sql`(lower(${table.identifier}) = ${q} or exists (select 1 from jsonb_array_elements(${table.identifiers}) as i where lower(i->>'value') = ${q}))`;
}
