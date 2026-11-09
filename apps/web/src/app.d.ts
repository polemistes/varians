// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Database } from '@varians/db';
import type { Crumb, CurrentUser } from '$lib/types';

declare global {
  /** The version in package.json, fixed at build (vite.config.ts). */
  const __VARIANS_VERSION__: string;
  /** The commit built from, or an empty string (vite.config.ts). */
  const __VARIANS_COMMIT__: string;

  namespace App {
    interface Error {
      message: string;
    }
    interface Locals {
      /** The signed-in user, or null for a visitor. Set by hooks.server.ts. */
      user: CurrentUser | null;
      /** The Drizzle client, one per process. */
      db: Database;
    }
    interface PageData {
      /** From the root layout: the signed-in user, or null. */
      user: CurrentUser | null;
      /** A page may name itself for the header's crumb. */
      crumb?: Crumb;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
