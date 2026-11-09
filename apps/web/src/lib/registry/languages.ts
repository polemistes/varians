/**
 * The languages offered when a work is made. Any ISO 639 code is accepted
 * through the free input; these are the common ones, named in the strings.
 */
import { registry } from '$lib/strings/registry';

export const LANGUAGE_CODES = ['grc', 'la', 'he', 'ar', 'sa', 'cop', 'syc', 'en'] as const;

export const LANGUAGES: { code: string; name: string }[] = LANGUAGE_CODES.map((code) => ({
  code,
  name: registry.languages[code] ?? code,
}));

/** Whether a code is one of the listed languages. */
export function isListedLanguage(code: string): boolean {
  return (LANGUAGE_CODES as readonly string[]).includes(code);
}

/** The name of a language code, or the code itself when it is not on the list. */
export function languageName(code: string): string {
  return registry.languages[code] ?? code;
}

/** A language code: letters and hyphens, as in grc, la, hbo or grc-x-epic. */
export const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i;
