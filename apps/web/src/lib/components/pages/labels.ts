/**
 * Page labels: expanding a pattern such as `1r-12v` into the labels it names,
 * proposing the labels that follow a given one, and labels from file names.
 * Pure, so that the pages screen previews in the browser exactly what the
 * server will make.
 *
 * A pattern is a list of parts separated by commas, semicolons or line
 * breaks. A part is one label, or a range of two ends joined by a dash: folio
 * sides (`1r-12v`: 1r, 1v, 2r, ... 12v), numbers (`1-20`, `001-120`), Roman
 * numerals (`i-iv`, `I-IV`) or single letters (`a-d`), each with an optional
 * prefix that the second end may repeat or leave out (`p. 1-20`,
 * `f. 1r - f. 3v`, `col. i-iv`). A part with a dash whose ends are not
 * numbered (`Fly-leaf`) is one label.
 */

import { nextValue } from '@varians/core';
import { pageStrings } from '$lib/strings/pages';

/** The longest label a page may have. */
export const MAX_LABEL_LENGTH = 120;
/** The most pages one pattern may add. */
export const MAX_PAGES_AT_ONCE = 2000;

export type ExpandResult = { ok: true; labels: string[] } | { ok: false; error: string };

type Kind = 'folio' | 'number' | 'roman' | 'letter';
/** Ends of a range are read as these kinds, in this order of preference. */
const KINDS: Kind[] = ['folio', 'number', 'roman', 'letter'];

interface Value {
  kind: Kind;
  prefix: string;
  /** The number, the folio, the value of the numeral or the letter's code. */
  n: number;
  /** Folios: recto or verso. */
  side?: 'r' | 'v';
  /** Folio sides, numerals and letters: written in capitals. */
  upper?: boolean;
  /** Numbers written with leading zeros keep their width. */
  width?: number;
}

const DASH = /[-‐‑‒–—]/u;
const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/** Collapses runs of white space and trims. */
export function normalizeLabel(label: string): string {
  return label.replace(/\s+/gu, ' ').trim();
}

/** Why a label cannot be used, or null when it can. */
export function labelProblem(label: string): string | null {
  const clean = normalizeLabel(label);
  if (clean === '') return pageStrings.labels.required;
  if (clean.length > MAX_LABEL_LENGTH) return pageStrings.labels.tooLong(MAX_LABEL_LENGTH);
  return null;
}

export function romanValue(text: string): number | null {
  if (text === '' || (text !== text.toLowerCase() && text !== text.toUpperCase())) return null;
  const lower = text.toLowerCase();
  if (!ROMAN.test(lower)) return null;
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let i = 0; i < lower.length; i++) {
    const value = values[lower[i]!]!;
    const next = values[lower[i + 1] ?? ''] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

export function toRoman(n: number, upper = false): string {
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let rest = n;
  let out = '';
  for (const [value, numeral] of table) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return upper ? out.toUpperCase() : out;
}

function widthOf(digits: string): number | undefined {
  return digits.length > 1 && digits.startsWith('0') ? digits.length : undefined;
}

/** Every way an end of a range can be read, in order of preference. */
function readValues(text: string): Value[] {
  const out: Value[] = [];
  const folio = /^(.*?)(\d+)([rRvV])$/u.exec(text);
  if (folio) {
    const side = folio[3]!;
    out.push({
      kind: 'folio',
      prefix: folio[1]!,
      n: Number(folio[2]),
      side: side.toLowerCase() as 'r' | 'v',
      upper: side === side.toUpperCase(),
      width: widthOf(folio[2]!),
    });
  }
  const number = /^(.*?)(\d+)$/u.exec(text);
  if (number) out.push({ kind: 'number', prefix: number[1]!, n: Number(number[2]), width: widthOf(number[2]!) });
  const roman = /^(|.*[^\p{L}])([ivxlcdm]+|[IVXLCDM]+)$/u.exec(text);
  if (roman) {
    const value = romanValue(roman[2]!);
    if (value !== null && value < 4000) {
      out.push({ kind: 'roman', prefix: roman[1]!, n: value, upper: roman[2] === roman[2]!.toUpperCase() });
    }
  }
  const letter = /^(|.*[^\p{L}])([a-zA-Z])$/u.exec(text);
  if (letter) {
    const ch = letter[2]!;
    out.push({ kind: 'letter', prefix: letter[1]!, n: ch.toLowerCase().charCodeAt(0), upper: ch === ch.toUpperCase() });
  }
  return out;
}

function pad(n: number, width?: number): string {
  return width ? String(n).padStart(width, '0') : String(n);
}

function render(value: Value): string {
  switch (value.kind) {
    case 'folio': {
      const side = value.upper ? value.side!.toUpperCase() : value.side!;
      return `${value.prefix}${pad(value.n, value.width)}${side}`;
    }
    case 'number':
      return `${value.prefix}${pad(value.n, value.width)}`;
    case 'roman':
      return `${value.prefix}${toRoman(value.n, value.upper)}`;
    case 'letter': {
      const ch = String.fromCharCode(value.n);
      return `${value.prefix}${value.upper ? ch.toUpperCase() : ch}`;
    }
  }
}

/** Folio sides as one ordinal: 1r = 2, 1v = 3, 2r = 4, ... */
function ordinal(value: Value): number {
  return value.kind === 'folio' ? value.n * 2 + (value.side === 'v' ? 1 : 0) : value.n;
}

/** The value at an ordinal, in the manner of `like`. */
function atOrdinal(like: Value, i: number): Value {
  return like.kind === 'folio' ? { ...like, n: Math.floor(i / 2), side: i % 2 === 0 ? 'r' : 'v' } : { ...like, n: i };
}

/** The second end may repeat the prefix of the first or leave it out. */
function samePrefix(a: string, b: string): boolean {
  return b === '' || a.replace(/\s+/gu, '') === b.replace(/\s+/gu, '');
}

/** A part of a pattern, read but not yet expanded. */
type Plan =
  | { kind: 'label'; label: string }
  | { kind: 'range'; from: Value; to: number; size: number }
  | { kind: 'error'; error: string };

function planPart(part: string): Plan {
  const text = normalizeLabel(part);
  let mismatch: string | null = null;
  for (let i = 0; i < text.length; i++) {
    if (!DASH.test(text[i]!)) continue;
    const left = text.slice(0, i).trim();
    const right = text.slice(i + 1).trim();
    if (left === '' || right === '') continue;
    const leftValues = readValues(left);
    const rightValues = readValues(right);
    for (const kind of KINDS) {
      const a = leftValues.find((v) => v.kind === kind);
      const b = rightValues.find((v) => v.kind === kind);
      if (!a || !b) continue;
      if (!samePrefix(a.prefix, b.prefix)) return { kind: 'error', error: pageStrings.labels.prefixes(text) };
      const from = ordinal(a);
      const to = ordinal(b);
      if (to < from) return { kind: 'error', error: pageStrings.labels.backwards(text) };
      return { kind: 'range', from: a, to, size: to - from + 1 };
    }
    if (leftValues.length > 0 && rightValues.length > 0) mismatch = pageStrings.labels.mixed(text);
  }
  if (DASH.test(text[0] ?? '') || DASH.test(text[text.length - 1] ?? '')) {
    const end = text.replace(/^[-‐‑‒–—]\s*|\s*[-‐‑‒–—]$/gu, '');
    if (readValues(end).length > 0) return { kind: 'error', error: pageStrings.labels.incomplete(text) };
  }
  if (mismatch) return { kind: 'error', error: mismatch };
  const problem = labelProblem(text);
  if (problem) return { kind: 'error', error: problem };
  return { kind: 'label', label: text };
}

/**
 * The labels a pattern names, in order, or a message saying what is wrong
 * with it. At most `max` labels (MAX_PAGES_AT_ONCE by default).
 */
export function expandLabels(spec: string, max = MAX_PAGES_AT_ONCE): ExpandResult {
  const parts = spec
    .split(/[,;\n\r]+/u)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return { ok: false, error: pageStrings.labels.required };
  const plans = parts.map(planPart);
  let total = 0;
  for (const plan of plans) {
    if (plan.kind === 'error') return { ok: false, error: plan.error };
    total += plan.kind === 'range' ? plan.size : 1;
  }
  if (total > max) return { ok: false, error: pageStrings.labels.tooMany(total, max) };
  const labels: string[] = [];
  for (const plan of plans) {
    if (plan.kind === 'label') labels.push(plan.label);
    else if (plan.kind === 'range') {
      for (let i = ordinal(plan.from); i <= plan.to; i++) labels.push(render(atOrdinal(plan.from, i)));
    }
  }
  return { ok: true, labels };
}

/**
 * The label that follows a folio side (12r → 12v → 13r), a number
 * (p. 12 → p. 13, 009 → 010) or a Roman numeral (col. iv → col. v), or
 * null when the label is none of these.
 */
export function followingLabel(label: string): string | null {
  const text = normalizeLabel(label);
  const values = readValues(text);
  const folio = values.find((v) => v.kind === 'folio');
  if (folio) return render(atOrdinal(folio, ordinal(folio) + 1));
  if (values.some((v) => v.kind === 'number')) return nextValue(text);
  const roman = values.find((v) => v.kind === 'roman');
  // A lone c, d, l or m is more likely a letter than a numeral.
  if (roman && !/^[cdlm]$/iu.test(text.slice(roman.prefix.length)) && roman.n < 3999) {
    return render({ ...roman, n: roman.n + 1 });
  }
  return null;
}

/** The `count` labels that follow `last`, or null when no sequence follows it. */
export function labelsAfter(last: string | null | undefined, count: number): string[] | null {
  if (!last) return null;
  const labels: string[] = [];
  let current = last;
  for (let i = 0; i < count; i++) {
    const next = followingLabel(current);
    if (next === null) return null;
    labels.push(next);
    current = next;
  }
  return count === 0 && followingLabel(last) === null ? null : labels;
}

/** A page label from a file name: the name without its extension. */
export function labelFromFileName(name: string): string {
  const base = name.replace(/^.*[/\\]/u, '');
  const stem = base.replace(/\.[^.]+$/u, '');
  const label = normalizeLabel(stem === '' ? base : stem);
  return label.slice(0, MAX_LABEL_LENGTH) || '?';
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Compares file names as people read them: numbers as numbers (page-2 before page-10). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Files in the order of their names. */
export function sortByName<T extends { name: string }>(files: Iterable<T>): T[] {
  return [...files].sort((a, b) => compareNames(a.name, b.name));
}
