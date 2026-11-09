/**
 * Reference schemes: how a work's segments are named and sorted.
 *
 * A scheme is an ordered list of levels. A label is the level values run
 * together with each level's separator before it ("1.5", "17a", "3.14.2").
 * Values are free text whatever a level's type; the type only says how
 * values sort and what the next value is likely to be.
 */

export type LevelType = 'number' | 'text';

export interface Level {
  key: string;
  label: string;
  type: LevelType;
  /** The separator printed before this level's value. Ignored for the first level. */
  separator: string;
}

export interface Scheme {
  levels: Level[];
}

/** A fully qualified address: one value per level, as strings. */
export type Address = Record<string, string>;

const PAD = 8;

/** The printed label of an address. Levels without a value are left out, so a partial address formats too. */
export function formatLabel(scheme: Scheme, address: Address): string {
  let out = '';
  scheme.levels.forEach((level, index) => {
    const value = address[level.key];
    if (value === undefined || value === '') return;
    out += (index === 0 ? '' : level.separator) + value;
  });
  return out;
}

/**
 * A key that sorts addresses in the order of the work: numbers by value,
 * text by code point, a numeric value's letter suffix after the bare number
 * ("4" < "4A" < "4a" < "5": an uppercase suffix is a part of a unit, a
 * lowercase one an inserted unit, by convention).
 */
export function sortKey(scheme: Scheme, address: Address): string {
  return scheme.levels
    .map((level) => {
      const value = address[level.key] ?? '';
      if (level.type === 'number') {
        const match = /^(\d*)(.*)$/su.exec(value) ?? ['', '', value];
        return (match[1] ?? '').padStart(PAD, '0') + (match[2] ?? '');
      }
      return value.padEnd(PAD, ' ');
    })
    .join('.');
}

export function compareAddresses(scheme: Scheme, a: Address, b: Address): number {
  const ka = sortKey(scheme, a);
  const kb = sortKey(scheme, b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Parse a label back into an address. Separators divide the label; where two
 * adjacent levels have no separator between them, their types decide the
 * boundary (digits on the number side, anything else on the text side), so
 * "17a" is page 17, section a.
 */
export function parseLabel(scheme: Scheme, label: string): Address | null {
  const trimmed = label.trim();
  if (trimmed === '') return null;
  const levels = scheme.levels;
  let pattern = '^';
  levels.forEach((level, index) => {
    const separator = index === 0 ? '' : level.separator;
    const next = levels[index + 1];
    const nextSeparator = next ? next.separator : null;
    pattern += escape(separator);
    if (nextSeparator === '') {
      // Runs straight into the next level: take all of its own kind.
      pattern += level.type === 'number' ? '(\\d+)' : '([^\\d]+)';
    } else if (index > 0 && separator === '') {
      // Runs on from the previous level: at least one of its own kind, then as little as possible.
      pattern += level.type === 'number' ? '(\\d.*?)' : '([^\\d].*?)';
    } else {
      // A number level begins with a digit ("5", "5a" for an inserted line); a text level may hold anything.
      pattern += level.type === 'number' ? '(\\d.*?)' : '(.+?)';
    }
  });
  pattern += '$';
  const match = new RegExp(pattern, 'su').exec(trimmed);
  if (!match) return null;
  const address: Address = {};
  levels.forEach((level, index) => {
    address[level.key] = (match[index + 1] ?? '').trim();
  });
  if (Object.values(address).some((v) => v === '')) return null;
  return address;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The label most likely to follow a given one: the last level's trailing
 * digits plus one ("1.5" → "1.6", "45a" → "45b", "17a" → "17b"), else the
 * next letter; null when nothing sensible follows.
 */
export function nextLabel(scheme: Scheme, label: string): string | null {
  const address = parseLabel(scheme, label);
  if (!address) return null;
  const last = scheme.levels[scheme.levels.length - 1];
  if (!last) return null;
  const next = nextValue(address[last.key] ?? '');
  if (next === null) return null;
  return formatLabel(scheme, { ...address, [last.key]: next });
}

export function nextValue(value: string): string | null {
  const digits = /^(.*?)(\d+)$/su.exec(value);
  if (digits) {
    const [, head, number] = digits;
    const incremented = String(Number(number) + 1).padStart(number!.length, '0');
    return `${head}${incremented}`;
  }
  const letter = /^(.*?)([a-yA-Y])$/su.exec(value);
  if (letter) {
    const [, head, ch] = letter;
    return `${head}${String.fromCharCode(ch!.charCodeAt(0) + 1)}`;
  }
  return null;
}

/** Problems with a scheme as given, as messages; empty when it is sound. */
export function validateScheme(scheme: Scheme): string[] {
  const problems: string[] = [];
  if (scheme.levels.length === 0) problems.push('A scheme needs at least one level.');
  const keys = new Set<string>();
  scheme.levels.forEach((level, index) => {
    if (!level.key) problems.push(`Level ${index + 1} has no key.`);
    if (keys.has(level.key)) problems.push(`Two levels share the key "${level.key}".`);
    keys.add(level.key);
    if (index > 0 && level.separator === '' && scheme.levels[index - 1]!.type === level.type) {
      problems.push(
        `Levels "${scheme.levels[index - 1]!.label}" and "${level.label}" have no separator between them and the same type, so a label cannot be divided.`,
      );
    }
  });
  return problems;
}

/** Common schemes offered when a work is made. */
export const SCHEME_PRESETS: { name: string; scheme: Scheme }[] = [
  {
    name: 'Book and line (epic)',
    scheme: {
      levels: [
        { key: 'book', label: 'Book', type: 'number', separator: '' },
        { key: 'line', label: 'Line', type: 'number', separator: '.' },
      ],
    },
  },
  {
    name: 'Line (drama, lyric)',
    scheme: { levels: [{ key: 'line', label: 'Line', type: 'number', separator: '' }] },
  },
  {
    name: 'Stephanus page and section (Plato)',
    scheme: {
      levels: [
        { key: 'page', label: 'Page', type: 'number', separator: '' },
        { key: 'section', label: 'Section', type: 'text', separator: '' },
      ],
    },
  },
  {
    name: 'Bekker page, column and line (Aristotle)',
    scheme: {
      levels: [
        { key: 'page', label: 'Page', type: 'number', separator: '' },
        { key: 'column', label: 'Column', type: 'text', separator: '' },
        { key: 'line', label: 'Line', type: 'number', separator: '' },
      ],
    },
  },
  {
    name: 'Book, chapter and section (prose)',
    scheme: {
      levels: [
        { key: 'book', label: 'Book', type: 'number', separator: '' },
        { key: 'chapter', label: 'Chapter', type: 'number', separator: '.' },
        { key: 'section', label: 'Section', type: 'number', separator: '.' },
      ],
    },
  },
  {
    name: 'Chapter and verse',
    scheme: {
      levels: [
        { key: 'chapter', label: 'Chapter', type: 'number', separator: '' },
        { key: 'verse', label: 'Verse', type: 'number', separator: ':' },
      ],
    },
  },
];
