import { describe, expect, it } from 'vitest';
import * as schema from '@varians/db/schema';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { ARCHIVED_TABLES, DERIVED_TABLES, TRANSIENT_TABLES } from './coverage.ts';

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableName(table))
  .sort();

describe('archive coverage', () => {
  it('classifies every table of the schema as archived, derived or transient', () => {
    const classified = new Set<string>([...ARCHIVED_TABLES, ...DERIVED_TABLES, ...TRANSIENT_TABLES]);
    const unclassified = tables.filter((t) => !classified.has(t));
    expect(unclassified, 'add these tables to archive/coverage.ts').toEqual([]);
  });

  it('names no table that does not exist, and none twice', () => {
    const all = [...ARCHIVED_TABLES, ...DERIVED_TABLES, ...TRANSIENT_TABLES];
    expect(all.filter((t) => !tables.includes(t))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
  });
});
