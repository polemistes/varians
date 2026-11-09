/**
 * From the structure an import finds (div subtypes, line numbers,
 * milestone units) to addresses in a work's scheme.
 */

import { formatLabel, type Address, type Scheme } from './scheme.ts';
import type { Item, Stream } from '../stream/items.ts';

/** A unit name found in a source (a div subtype, a milestone unit, "line") to a level key of the scheme. */
export type UnitMapping = Record<string, string>;

export interface FoundPart {
  unit: string | null;
  n: string;
}

export interface FoundStart {
  itemIndex: number;
  parts: FoundPart[];
}

const SYNONYMS: Record<string, string[]> = {
  book: ['book', 'liber', 'bk', 'rhapsody', 'song', 'canto'],
  line: ['line', 'l', 'verse', 'v', 'linea'],
  chapter: ['chapter', 'cap', 'caput', 'ch'],
  section: ['section', 'sec', 'sect', 'paragraph', 'par', 'subsection'],
  page: ['page', 'p', 'pag', 'stephanus', 'bekker', 'pagina'],
  column: ['column', 'col'],
  verse: ['verse', 'v'],
  fragment: ['fragment', 'fr', 'frag'],
  poem: ['poem', 'carmen', 'ode', 'epigram'],
  letter: ['letter', 'epistle', 'ep'],
  act: ['act'],
  scene: ['scene'],
};

/** Propose which level each found unit fills, by name; units nobody maps stay out. */
export function proposeMapping(units: string[], scheme: Scheme): UnitMapping {
  const mapping: UnitMapping = {};
  const used = new Set<string>();
  const normalized = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  for (const unit of units) {
    const u = normalized(unit);
    let match = scheme.levels.find((l) => !used.has(l.key) && (normalized(l.key) === u || normalized(l.label) === u));
    if (!match) {
      match = scheme.levels.find((l) => {
        if (used.has(l.key)) return false;
        const names = SYNONYMS[normalized(l.key)] ?? SYNONYMS[normalized(l.label)] ?? [];
        return names.includes(u);
      });
    }
    if (match) {
      mapping[unit] = match.key;
      used.add(match.key);
    }
  }
  // One unmapped unit and one free level: pair them.
  const free = scheme.levels.filter((l) => !used.has(l.key));
  const unmapped = units.filter((u) => !(u in mapping));
  if (free.length === 1 && unmapped.length === 1) mapping[unmapped[0]!] = free[0]!.key;
  return mapping;
}

/**
 * The address a start's parts give, with higher levels carried over from
 * the previous address when the source does not repeat them (milestones).
 * Null when some level is still missing.
 */
export function addressFromParts(parts: FoundPart[], mapping: UnitMapping, scheme: Scheme, previous?: Address): Address | null {
  const address: Address = {};
  for (const part of parts) {
    const key = part.unit === null ? null : mapping[part.unit];
    if (key) address[key] = part.n.trim();
  }
  // A part without a unit fills the deepest level not yet given.
  const unnamed = parts.filter((p) => p.unit === null || !mapping[p.unit]);
  for (const part of unnamed) {
    const level = [...scheme.levels].reverse().find((l) => !(l.key in address));
    if (level) address[level.key] = part.n.trim();
  }
  const filled = Object.keys(address);
  if (filled.length === 0) return null;
  const deepestFilled = Math.max(...scheme.levels.map((l, i) => (l.key in address ? i : -1)));
  for (let i = 0; i < deepestFilled; i++) {
    const level = scheme.levels[i]!;
    if (!(level.key in address)) {
      const inherited = previous?.[level.key];
      if (inherited === undefined) return null;
      address[level.key] = inherited;
    }
  }
  for (const level of scheme.levels) if (!(level.key in address) || address[level.key] === '') return null;
  return address;
}

export interface ResolvedStart {
  itemIndex: number;
  address: Address;
  label: string;
}

/** Resolve every found start to an address and label; starts that cannot be resolved are reported. */
export function resolveStarts(
  starts: FoundStart[],
  mapping: UnitMapping,
  scheme: Scheme,
): { resolved: ResolvedStart[]; unresolved: FoundStart[] } {
  const resolved: ResolvedStart[] = [];
  const unresolved: FoundStart[] = [];
  let previous: Address | undefined;
  for (const start of starts) {
    const address = addressFromParts(start.parts, mapping, scheme, previous);
    if (!address) {
      unresolved.push(start);
      continue;
    }
    previous = address;
    resolved.push({ itemIndex: start.itemIndex, address, label: formatLabel(scheme, address) });
  }
  return { resolved, unresolved };
}

/**
 * Put segment starts on a stream's items. A start pointing at a break moves
 * to the next token or object; two starts landing on one item keep the last.
 */
export function applyStarts(stream: Stream, starts: { itemIndex: number; segmentId: string }[]): Stream {
  const items: Item[] = stream.items.map((item) => ({ ...item }));
  for (const start of starts) {
    let index = start.itemIndex;
    while (index < items.length && items[index]!.kind === 'break') index++;
    const item = items[index];
    if (!item || item.kind === 'break') continue;
    item.segment = { segmentId: start.segmentId };
  }
  return { items };
}
