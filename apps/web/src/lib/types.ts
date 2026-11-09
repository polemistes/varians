/**
 * Shared client types: what pages receive and what the shell shows. Only
 * types come from @varians/db here; its values would pull the database
 * driver into the browser.
 */
import type { Role } from '@varians/db';

/** The site roles, mirrored from the schema for the browser. */
export const ROLES = ['member', 'editor', 'administrator'] as const satisfies readonly Role[];
export type { Role };

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const FONTS = ['eb-garamond', 'cardo'] as const;
export type Font = (typeof FONTS)[number];

export interface Preferences {
  font: Font;
  theme: Theme;
}

/** The signed-in user as pages and the shell see it: never the password hash. */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  preferences: Preferences;
}

/** What the header shows after the wordmark: the current screen. */
export interface Crumb {
  label: string;
  href?: string;
}
