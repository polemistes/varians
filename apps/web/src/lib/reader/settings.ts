/**
 * The reader's settings (the gear): kept per browser in localStorage, read
 * after the page has mounted so that the server's markup and the first
 * client render agree. Whatever the storage holds is parsed into a complete,
 * valid settings object; anything unknown falls back to the default.
 */
import type { ApparatusConventions, InterpretativePlacement } from '@varians/core';

export const TEXT_SIZES = ['small', 'normal', 'large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const APPARATUS_PLACEMENTS = ['none', 'foot', 'side'] as const;
export type ApparatusPlacement = (typeof APPARATUS_PLACEMENTS)[number];

export interface ReaderSettings {
  size: TextSize;
  /**
   * The print apparatus on screen: not shown (the words with variants explain
   * themselves when opened), at the foot of each block, or beside it on wide
   * screens. Printing always shows it at the foot.
   */
  apparatus: ApparatusPlacement;
  /** Positive or negative form; null follows the edition. */
  form: 'positive' | 'negative' | null;
  /** Interpretative variants among the others, in a list of their own, or not shown; null follows the edition. */
  interpretative: InterpretativePlacement | null;
  /** Margin labels as the edition sets them, or at every line where a segment begins. */
  labels: 'edition' | 'every';
  /** The dotted underline under words with variants. */
  underline: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  size: 'normal',
  apparatus: 'none',
  form: null,
  interpretative: null,
  labels: 'edition',
  underline: true,
};

export const SETTINGS_KEY = 'varians.reader';

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Settings from what storage holds: a JSON string, an object, or nothing. */
export function parseSettings(raw: unknown): ReaderSettings {
  let source: unknown = raw;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      source = null;
    }
  }
  const s = (source && typeof source === 'object' && !Array.isArray(source) ? source : {}) as Record<string, unknown>;
  return {
    size: oneOf(s.size, TEXT_SIZES, DEFAULT_SETTINGS.size),
    apparatus: oneOf(s.apparatus, APPARATUS_PLACEMENTS, DEFAULT_SETTINGS.apparatus),
    form: s.form === 'positive' || s.form === 'negative' ? s.form : null,
    interpretative: s.interpretative === 'apparatus' || s.interpretative === 'separate' || s.interpretative === 'none' ? s.interpretative : null,
    labels: oneOf(s.labels, ['edition', 'every'] as const, DEFAULT_SETTINGS.labels),
    underline: typeof s.underline === 'boolean' ? s.underline : DEFAULT_SETTINGS.underline,
  };
}

/** The settings as stored: only what differs from the defaults. */
export function serializeSettings(settings: ReaderSettings): string {
  const out: Partial<ReaderSettings> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ReaderSettings)[]) {
    if (settings[key] !== DEFAULT_SETTINGS[key]) (out as Record<string, unknown>)[key] = settings[key];
  }
  return JSON.stringify(out);
}

export function isDefault(settings: ReaderSettings): boolean {
  return serializeSettings(settings) === '{}';
}

/** The apparatus conventions in force: the edition's, with the reader's choices over them. */
export function effectiveConventions(edition: ApparatusConventions, settings: ReaderSettings): ApparatusConventions {
  return {
    form: settings.form ?? edition.form,
    latin: edition.latin,
    interpretative: settings.interpretative ?? edition.interpretative,
  };
}

/** Read the stored settings; storage may be missing or refuse access. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined): ReaderSettings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_KEY) ?? null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, settings: ReaderSettings): void {
  try {
    if (isDefault(settings)) storage?.removeItem(SETTINGS_KEY);
    else storage?.setItem(SETTINGS_KEY, serializeSettings(settings));
  } catch {
    // Private windows and full storage: the settings simply do not persist.
  }
}
