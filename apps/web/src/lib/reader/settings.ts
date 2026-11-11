/**
 * The reader's settings (the gear): kept per browser in localStorage, read
 * after the page has mounted so that the server's markup and the first
 * client render agree. Whatever the storage holds is parsed into a complete,
 * valid settings object; anything unknown falls back to the default.
 */
export const TEXT_SIZES = ['small', 'normal', 'large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface ReaderSettings {
  size: TextSize;
  /** Margin labels as the edition sets them, or at every line where a segment begins. */
  labels: 'edition' | 'every';
  /** The dotted underline under words with variants. */
  underline: boolean;
  /** The variants whose witnesses have the same letters read otherwise: marked and listed when shown, neither when not. */
  showInterpretative: boolean;
  /** The variants the editor judges minor: marked and listed like the others when shown, neither when not. */
  showMinor: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  size: 'normal',
  labels: 'edition',
  underline: true,
  showInterpretative: true,
  showMinor: false,
};

export const SETTINGS_KEY = 'varians.reader';

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Settings from what storage holds: a JSON string, an object, or nothing.
 * What an earlier version stored for choices that are gone (where the print
 * apparatus stands, its form) is left unread. A reader who had chosen not to
 * see interpretative variants, which was stored as `interpretative: 'none'`,
 * still does not see them.
 */
export function parseSettings(raw: unknown): ReaderSettings {
  let source: unknown = raw;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      source = null;
    }
  }
  const s = (
    source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  ) as Record<string, unknown>;
  return {
    size: oneOf(s.size, TEXT_SIZES, DEFAULT_SETTINGS.size),
    labels: oneOf(s.labels, ['edition', 'every'] as const, DEFAULT_SETTINGS.labels),
    underline: typeof s.underline === 'boolean' ? s.underline : DEFAULT_SETTINGS.underline,
    showInterpretative:
      typeof s.showInterpretative === 'boolean'
        ? s.showInterpretative
        : s.interpretative === 'none'
          ? false
          : DEFAULT_SETTINGS.showInterpretative,
    showMinor: typeof s.showMinor === 'boolean' ? s.showMinor : DEFAULT_SETTINGS.showMinor,
  };
}

/** The settings as stored: only what differs from the defaults. */
export function serializeSettings(settings: ReaderSettings): string {
  const out: Partial<ReaderSettings> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ReaderSettings)[]) {
    if (settings[key] !== DEFAULT_SETTINGS[key])
      (out as Record<string, unknown>)[key] = settings[key];
  }
  return JSON.stringify(out);
}

export function isDefault(settings: ReaderSettings): boolean {
  return serializeSettings(settings) === '{}';
}

/** Read the stored settings; storage may be missing or refuse access. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined): ReaderSettings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_KEY) ?? null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  settings: ReaderSettings,
): void {
  try {
    if (isDefault(settings)) storage?.removeItem(SETTINGS_KEY);
    else storage?.setItem(SETTINGS_KEY, serializeSettings(settings));
  } catch {
    // Private windows and full storage: the settings simply do not persist.
  }
}
