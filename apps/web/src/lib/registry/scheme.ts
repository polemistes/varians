/**
 * Reference schemes as the registry pages show and edit them: the sentence
 * on the work page ("Book and line, as 1.5"), the separators offered in the
 * editor, and the levels as they travel through a form.
 */
import {
  formatLabel,
  nextValue,
  validateScheme,
  type Address,
  type Level,
  type LevelType,
  type Scheme,
} from '@varians/core';
import { registry } from '$lib/strings/registry';
import { asciiFold } from './slug';

export const SEPARATOR_VALUES = ['', '.', ':', ',', '-', ' '] as const;
export const LEVEL_TYPES: LevelType[] = ['number', 'text'];

const NUMBER_SAMPLES = ['1', '5', '2', '3', '4'];
const TEXT_SAMPLES = ['a', 'b', 'c', 'd', 'e'];

/** "Book and line", "Book, chapter and section". */
export function joinLevelLabels(scheme: Scheme): string {
  const labels = scheme.levels.map((level, index) => {
    const label = level.label.trim() || level.key || `level ${index + 1}`;
    return index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1);
  });
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** A plausible label for a scheme: numbers count up, text levels take letters. */
export function exampleLabel(scheme: Scheme): string {
  let numbers = 0;
  let texts = 0;
  return scheme.levels
    .map((level, index) => {
      const value =
        level.type === 'number'
          ? NUMBER_SAMPLES[numbers++ % NUMBER_SAMPLES.length]!
          : TEXT_SAMPLES[texts++ % TEXT_SAMPLES.length]!;
      return (index === 0 ? '' : level.separator) + value;
    })
    .join('');
}

/** A key proposed for a level from its label: "Line" to "line", "Stephanus page" to "stephanus-page". */
export function keyFromLabel(label: string): string {
  return asciiFold(label)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '');
}

export function emptyLevel(index: number): Level {
  return { key: '', label: '', type: 'number', separator: index === 0 ? '' : '.' };
}

/** Levels as a form sends them (JSON in one field), checked field by field; null when the shape is wrong. */
export function parseLevels(raw: unknown): Level[] | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(data)) return null;
  const levels: Level[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.key !== 'string' || typeof e.label !== 'string') return null;
    if (e.type !== 'number' && e.type !== 'text') return null;
    const separator = typeof e.separator === 'string' ? e.separator : '';
    if (!(SEPARATOR_VALUES as readonly string[]).includes(separator)) return null;
    levels.push({ key: e.key.trim(), label: e.label.trim(), type: e.type, separator });
  }
  if (levels.length > 0) levels[0]!.separator = '';
  return levels;
}

/**
 * Whether a scheme change keeps every existing segment valid: the number
 * of levels, their keys and their types are the same; only labels and
 * separators differ.
 */
export function keepsAddresses(before: Scheme, after: Scheme): boolean {
  if (before.levels.length !== after.levels.length) return false;
  return before.levels.every(
    (level, i) => level.key === after.levels[i]!.key && level.type === after.levels[i]!.type,
  );
}

/** "Book and line, as 1.5": the scheme as the work page states it. */
export function schemeSentence(scheme: Scheme): string {
  if (scheme.levels.length === 0) return '';
  return registry.scheme.sentence(joinLevelLabels(scheme), exampleLabel(scheme));
}

/** Keys as files and addresses use them: a lowercase letter, then letters, digits or hyphens. */
export const LEVEL_KEY = /^[a-z][a-z0-9-]*$/;

/**
 * Problems with levels as the editor holds them: every level needs a label
 * and a well-formed key, and the core's checks (keys present and distinct,
 * adjacent levels divisible). Empty when the scheme is sound.
 */
export function schemeProblems(levels: Level[]): string[] {
  const problems: string[] = [];
  levels.forEach((level, index) => {
    if (!level.label.trim()) problems.push(registry.scheme.labelRequired(index + 1));
    if (level.key.trim() && !LEVEL_KEY.test(level.key.trim()))
      problems.push(registry.scheme.keyInvalid(index + 1));
  });
  const trimmed = levels.map((level, index) => ({
    ...level,
    key: level.key.trim(),
    label: level.label.trim(),
    separator: index === 0 ? '' : level.separator,
  }));
  return [...problems, ...validateScheme({ levels: trimmed })];
}

/** Whether two schemes print labels differently: a separator after the first level differs. */
export function separatorsChanged(before: Scheme, after: Scheme): boolean {
  return after.levels.some(
    (level, index) => index > 0 && level.separator !== before.levels[index]?.separator,
  );
}

/**
 * The labels segments take under a changed scheme: the ones that change,
 * and the labels two segments would share (which make the change unsafe).
 */
export function relabel(
  scheme: Scheme,
  segments: { id: string; address: Address; label: string }[],
): { changed: { id: string; label: string }[]; collisions: string[] } {
  const changed: { id: string; label: string }[] = [];
  const seen = new Map<string, number>();
  for (const segment of segments) {
    const label = formatLabel(scheme, segment.address);
    seen.set(label, (seen.get(label) ?? 0) + 1);
    if (label !== segment.label) changed.push({ id: segment.id, label });
  }
  const collisions = [...seen].filter(([, n]) => n > 1).map(([label]) => label);
  return { changed, collisions };
}

/**
 * Labels in the order of the work with consecutive ones joined into
 * ranges: "1.1–1.611", "17a–17e". Two segments are consecutive when all but
 * the last level agree and the last value is the one that follows the
 * other's (the next number, or the next letter).
 */
export function labelRanges(
  scheme: Scheme,
  segments: { label: string; address: Address }[],
): string[] {
  const last = scheme.levels[scheme.levels.length - 1];
  if (!last) return segments.map((s) => s.label);
  const head = scheme.levels.slice(0, -1);
  const prefix = (address: Address) => head.map((level) => address[level.key] ?? '').join('\u0000');
  const follows = (a: Address, b: Address) => {
    const next = nextValue(a[last.key] ?? '');
    return next !== null && next === b[last.key] && prefix(a) === prefix(b);
  };
  const ranges: string[] = [];
  let start: { label: string; address: Address } | null = null;
  let previous: { label: string; address: Address } | null = null;
  const close = () => {
    if (start && previous)
      ranges.push(start === previous ? start.label : `${start.label}–${previous.label}`);
  };
  for (const segment of segments) {
    if (previous && follows(previous.address, segment.address)) {
      previous = segment;
      continue;
    }
    close();
    start = previous = segment;
  }
  close();
  return ranges;
}
