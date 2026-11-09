import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/** A new permanent id. ULIDs sort by creation time and are safe to make on client and server alike. */
export function newId(): string {
  return ulid();
}

/**
 * A deterministic id source for tests and fixtures: `a1`, `a2`, ... Never used for stored data.
 */
export function sequentialIds(prefix = 't'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
