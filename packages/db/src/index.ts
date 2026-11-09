import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(url: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}

// Query operators, re-exported so that applications reach Drizzle through this
// package and need no dependency on drizzle-orm themselves.
export {
  and,
  asc,
  between,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notExists,
  notIlike,
  notInArray,
  or,
  sql,
  sum,
} from 'drizzle-orm';
export type { InferInsertModel, InferSelectModel, SQL } from 'drizzle-orm';
export { alias } from 'drizzle-orm/pg-core';
