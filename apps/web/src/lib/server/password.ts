/**
 * Password hashing with argon2id. Kept apart from auth.ts so that scripts
 * (the seeder) can hash a password without the SvelteKit environment.
 */
import { hash, verify, type Options } from '@node-rs/argon2';

/** OWASP's recommended minimum for argon2id: 19 MiB, two passes, one lane. */
export const ARGON2_OPTIONS: Options = {
  // Algorithm.Argon2id; the ambient const enum cannot be read with verbatimModuleSyntax.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** False for a wrong password and for a hash that cannot be parsed. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
