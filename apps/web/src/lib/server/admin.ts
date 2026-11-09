/**
 * Administration: the list of users and their site roles.
 */
import { asc, count, eq, sql, users, type Role } from '@varians/db';
import { db } from './db';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export async function listUsers(): Promise<UserSummary[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** The only administrator cannot be demoted. Pure; exported for tests. */
export function canChangeRole(
  target: { role: Role },
  next: Role,
  administratorCount: number,
): boolean {
  if (target.role === 'administrator' && next !== 'administrator' && administratorCount <= 1)
    return false;
  return true;
}

export type SetRoleResult =
  { ok: true; name: string } | { ok: false; error: 'last-administrator' | 'not-found' };

export async function setRole(userId: string, role: Role): Promise<SetRoleResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${users} in share row exclusive mode`);
    const [target] = await tx
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, error: 'not-found' } as const;
    const [{ administrators }] = await tx
      .select({ administrators: count() })
      .from(users)
      .where(eq(users.role, 'administrator'));
    if (!canChangeRole(target, role, administrators))
      return { ok: false, error: 'last-administrator' } as const;
    if (target.role !== role) await tx.update(users).set({ role }).where(eq(users.id, userId));
    return { ok: true, name: target.name } as const;
  });
}
