/**
 * User preferences: the text face and the theme. Stored as JSON on users,
 * stamped on <html> as data-font and data-theme (server side for the first
 * paint, kept current by the root layout).
 */
import { FONTS, THEMES, type Font, type Preferences, type Theme } from './types';

export const DEFAULT_PREFERENCES: Preferences = { font: 'eb-garamond', theme: 'system' };

export function isFont(value: unknown): value is Font {
  return typeof value === 'string' && (FONTS as readonly string[]).includes(value);
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Reads whatever the database holds into a complete, valid Preferences. */
export function normalizePreferences(raw: unknown): Preferences {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    font: isFont(source.font) ? source.font : DEFAULT_PREFERENCES.font,
    theme: isTheme(source.theme) ? source.theme : DEFAULT_PREFERENCES.theme,
  };
}

/** The data attributes <html> carries; defaults carry none. */
export function htmlDataAttributes(preferences: Preferences | undefined): Record<string, string> {
  const p = preferences ?? DEFAULT_PREFERENCES;
  const attributes: Record<string, string> = {};
  if (p.theme !== 'system') attributes['data-theme'] = p.theme;
  if (p.font !== DEFAULT_PREFERENCES.font) attributes['data-font'] = p.font;
  return attributes;
}

/** The same attributes as text for the HTML template. */
export function htmlAttributeString(preferences: Preferences | undefined): string {
  return Object.entries(htmlDataAttributes(preferences))
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
}

/** Applies the attributes to a live document root (after a preference changes). */
export function applyPreferences(root: HTMLElement, preferences: Preferences | undefined): void {
  const wanted = htmlDataAttributes(preferences);
  for (const name of ['data-theme', 'data-font']) {
    const value = wanted[name];
    if (value === undefined) root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
}
