/**
 * Plain text with segment numbering: find the numbering patterns a text
 * uses, then import it as a stream with the numbers stripped and their
 * labels attached to the tokens they govern.
 */

import { newId } from '../ids.ts';
import { nextValue } from '../scheme/scheme.ts';
import type { Stream } from '../stream/items.ts';
import { fromText, type FromTextOptions } from '../stream/text.ts';

export type NumberingKind = 'line-start-number' | 'bracketed' | 'every-line' | 'margin-every-n';

export interface NumberingPattern {
  kind: NumberingKind;
  /** Source of the regular expression that finds a number; its first group is the label. Applied to one line at a time. */
  regex: string;
  /** How many places matched. */
  matches: number;
  /** The first label found, or the first line for `every-line`. */
  sample: string;
  /** For `margin-every-n`: the number of lines between two numbers. */
  interval?: number;
}

export interface PlainTextOptions {
  /** The language of the words (a BCP 47 tag): plain text declares none, so the person importing gives it. */
  lang: string;
  /** The numbering to strip and attach; none when null or undefined, so `detectNumbering(text)[0]` can be passed as it is. */
  pattern?: NumberingPattern | null | undefined;
  ids?: () => string;
  /** A blank line makes a paragraph break instead of line breaks. */
  paragraphs?: boolean;
  /** A hyphen at a line end divides a word: the two parts are joined. */
  hyphenJoins?: boolean;
  /** The label of the first line, for `every-line` and for the lines before the first number of `margin-every-n`. */
  startLabel?: string;
  /** The label that follows a label; defaults to incrementing the last number or letter. */
  nextLabel?: (label: string) => string | null;
}

export interface SegmentStartLabel {
  /** Index in the stream of the token the labelled stretch begins with. */
  itemIndex: number;
  label: string;
}

export interface PlainTextImport {
  stream: Stream;
  segmentStarts: SegmentStartLabel[];
  warnings: string[];
}

/** A label: 1, 1.5, 3:16, 17a, 1094a1. */
const LABEL = String.raw`\d+(?:[.:]\d+)*(?:[a-zA-Z]\d*)?`;
const LINE_START = String.raw`^[ \t]*(${LABEL})[.)]?[ \t]+(?=\S)`;
const LINE_END = String.raw`(?<=\S)[ \t]+(${LABEL})[ \t]*$`;
const MARGIN = `${LINE_START}|${LINE_END}`;
const BRACKETED = String.raw`[\[(](${LABEL})[\])]`;
const EVERY_LINE = String.raw`^.+$`;

/** The numbering patterns a text may use, best first. Empty when nothing looks like numbering. */
export function detectNumbering(text: string): NumberingPattern[] {
  const content = splitLines(text).filter((line) => line.trim() !== '');
  if (content.length === 0) return [];
  const found: { pattern: NumberingPattern; score: number }[] = [];

  const startRegex = new RegExp(LINE_START, 'u');
  const startLabels = content
    .map((line) => labelOf(startRegex.exec(line)))
    .filter((l): l is string => l !== null);
  const marginRegex = new RegExp(MARGIN, 'u');
  const marginHits: { at: number; label: string }[] = [];
  content.forEach((line, at) => {
    const label = labelOf(marginRegex.exec(line));
    if (label !== null) marginHits.push({ at, label });
  });
  const interval = regularInterval(marginHits);
  if (interval !== null) {
    found.push({
      score: 3,
      pattern: {
        kind: 'margin-every-n',
        regex: MARGIN,
        matches: marginHits.length,
        sample: marginHits[0]!.label,
        interval,
      },
    });
  }
  if (startLabels.length > 0) {
    const coverage = startLabels.length / content.length;
    found.push({
      score: (coverage >= 0.5 ? 2 : 1) + coverage,
      pattern: {
        kind: 'line-start-number',
        regex: LINE_START,
        matches: startLabels.length,
        sample: startLabels[0]!,
      },
    });
  }
  const bracketLabels = [...text.matchAll(new RegExp(BRACKETED, 'gu'))].map((m) => m[1]!);
  if (bracketLabels.length > 0) {
    found.push({
      score: bracketLabels.length >= 2 ? 2 + Math.min(1, bracketLabels.length / content.length) : 1,
      pattern: {
        kind: 'bracketed',
        regex: BRACKETED,
        matches: bracketLabels.length,
        sample: bracketLabels[0]!,
      },
    });
  }
  const verse =
    content.length >= 2 &&
    content.filter((line) => line.length <= 100).length / content.length >= 0.9;
  if (verse) {
    const numbered = found.some((f) => f.score >= 2);
    found.push({
      score: numbered ? 0.5 : 2.5,
      pattern: {
        kind: 'every-line',
        regex: EVERY_LINE,
        matches: content.length,
        sample: content[0]!.trim().slice(0, 60),
      },
    });
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.pattern);
}

/**
 * Numbers that stand on every nth line: the gaps between numbered lines
 * are multiples of one interval of at least two lines, and numeric labels
 * advance by the number of lines between them.
 */
function regularInterval(hits: { at: number; label: string }[]): number | null {
  if (hits.length < 2) return null;
  const gaps = hits.slice(1).map((hit, i) => hit.at - hits[i]!.at);
  const interval = Math.min(...gaps);
  if (interval < 2 || !gaps.every((gap) => gap % interval === 0)) return null;
  const numbers = hits.map((hit) => (/^\d+$/u.test(hit.label) ? Number(hit.label) : null));
  if (numbers.every((n) => n !== null)) {
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i]! - numbers[i - 1]! !== gaps[i - 1]) return null;
    }
  }
  return interval;
}

/** A place in the cleaned text where a label's stretch begins. */
interface Place {
  line: number;
  column: number;
  label: string;
}

/** Import plain text, stripping the numbers of a pattern and attaching their labels to tokens. */
export function importPlainText(text: string, options: PlainTextOptions): PlainTextImport {
  const warnings: string[] = [];
  const lines = splitLines(text);
  const next = options.nextLabel ?? nextValue;
  const pattern = options.pattern ?? null;
  let cleaned = lines;
  let places: Place[] = [];
  if (pattern) {
    const regex = compile(pattern, warnings);
    if (pattern.kind === 'every-line') {
      places = everyLine(lines, options.startLabel, next, warnings);
    } else if (regex && pattern.kind === 'margin-every-n') {
      ({ cleaned, places } = marginEveryN(lines, regex, options.startLabel, next, warnings));
    } else if (regex && pattern.kind === 'bracketed') {
      ({ cleaned, places } = bracketed(lines, regex));
    } else if (regex) {
      ({ cleaned, places } = lineStart(lines, regex));
    }
  }
  const textOptions: FromTextOptions = { lang: options.lang, ids: options.ids ?? newId };
  if (options.paragraphs !== undefined) textOptions.paragraphs = options.paragraphs;
  if (options.hyphenJoins !== undefined) textOptions.hyphenJoins = options.hyphenJoins;
  const stream = fromText(cleaned.join('\n'), textOptions);
  const segmentStarts = attach(cleaned, places, stream, options.hyphenJoins === true, warnings);
  const seen = new Set<string>();
  for (const start of segmentStarts) {
    if (seen.has(start.label)) warnings.push(`Label ${start.label} appears more than once.`);
    seen.add(start.label);
  }
  return { stream, segmentStarts, warnings };
}

function compile(pattern: NumberingPattern, warnings: string[]): RegExp | null {
  if (pattern.kind === 'every-line') return null;
  try {
    return new RegExp(pattern.regex, pattern.kind === 'bracketed' ? 'gu' : 'u');
  } catch {
    warnings.push(
      `The numbering pattern "${pattern.regex}" is not a valid regular expression; no numbering was read.`,
    );
    return null;
  }
}

function lineStart(lines: string[], regex: RegExp): { cleaned: string[]; places: Place[] } {
  const places: Place[] = [];
  const cleaned = lines.map((line, index) => {
    const match = regex.exec(line);
    const label = labelOf(match);
    if (!match || label === null) return line;
    places.push({ line: index, column: 0, label });
    return line.slice(0, match.index) + line.slice(match.index + match[0].length);
  });
  return { cleaned, places };
}

function bracketed(lines: string[], regex: RegExp): { cleaned: string[]; places: Place[] } {
  const places: Place[] = [];
  const cleaned = lines.map((line, index) => {
    let removed = 0;
    for (const match of line.matchAll(regex)) {
      const label = labelOf(match);
      if (label === null) continue;
      places.push({ line: index, column: match.index - removed, label });
      removed += match[0].length;
    }
    return line.replace(regex, '');
  });
  return { cleaned, places };
}

function marginEveryN(
  lines: string[],
  regex: RegExp,
  startLabel: string | undefined,
  next: (label: string) => string | null,
  warnings: string[],
): { cleaned: string[]; places: Place[] } {
  const places: Place[] = [];
  let current: string | null = null;
  let stopped = false;
  let unlabeled = 0;
  const cleaned = lines.map((line, index) => {
    if (line.trim() === '') return line;
    const match = regex.exec(line);
    const label = labelOf(match);
    if (match && label !== null) {
      if (current !== null && !stopped) {
        const expected = next(current);
        if (expected !== label) {
          warnings.push(
            `Line ${index + 1} is numbered ${label}, but counting from the previous number gives ${expected ?? 'nothing'}.`,
          );
        }
      }
      current = label;
      stopped = false;
      places.push({ line: index, column: 0, label });
      return line.slice(0, match.index) + line.slice(match.index + match[0].length);
    }
    if (stopped) return line;
    if (current === null) {
      if (startLabel === undefined) {
        unlabeled++;
        return line;
      }
      current = startLabel;
    } else {
      const following = next(current);
      if (following === null) {
        warnings.push(
          `No label follows ${current}; the lines after it are unlabelled until the next number.`,
        );
        stopped = true;
        return line;
      }
      current = following;
    }
    places.push({ line: index, column: 0, label: current });
    return line;
  });
  if (unlabeled > 0) {
    warnings.push(
      `${unlabeled} line${unlabeled === 1 ? '' : 's'} before the first number ${unlabeled === 1 ? 'has' : 'have'} no label; give a start label to count them.`,
    );
  }
  return { cleaned, places };
}

function everyLine(
  lines: string[],
  startLabel: string | undefined,
  next: (label: string) => string | null,
  warnings: string[],
): Place[] {
  if (startLabel === undefined) {
    warnings.push('Numbering every line needs a start label.');
    return [];
  }
  const places: Place[] = [];
  let current: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]!.trim() === '') continue;
    current = current === null ? startLabel : next(current);
    if (current === null) {
      warnings.push(
        `No label follows ${places[places.length - 1]?.label ?? startLabel}; the remaining lines are unlabelled.`,
      );
      break;
    }
    places.push({ line: index, column: 0, label: current });
  }
  return places;
}

/** Attach the labels to the tokens of the stream: the first word at or after each label's place. */
function attach(
  cleaned: string[],
  places: Place[],
  stream: Stream,
  hyphenJoins: boolean,
  warnings: string[],
): SegmentStartLabel[] {
  if (places.length === 0) return [];
  const tokenIndexes: number[] = [];
  stream.items.forEach((item, index) => {
    if (item.kind === 'token') tokenIndexes.push(index);
  });
  const starts: { line: number; column: number }[] = [];
  cleaned.forEach((line, index) => {
    const text = hyphenJoins && index < cleaned.length - 1 ? line.replace(/-$/u, '') : line;
    for (const match of text.matchAll(/\S+/gu)) starts.push({ line: index, column: match.index });
  });
  if (starts.length !== tokenIndexes.length) {
    warnings.push(
      'The numbering could not be attached: the words of the text do not match its tokens.',
    );
    return [];
  }
  const out: SegmentStartLabel[] = [];
  let k = 0;
  for (const place of places) {
    while (k < starts.length) {
      const start = starts[k]!;
      if (start.line > place.line || (start.line === place.line && start.column >= place.column))
        break;
      k++;
    }
    if (k >= starts.length) {
      warnings.push(`Label ${place.label} has no text after it and was dropped.`);
      continue;
    }
    const itemIndex = tokenIndexes[k]!;
    const previous = out[out.length - 1];
    if (previous && previous.itemIndex === itemIndex) {
      warnings.push(
        `Label ${previous.label} has no text before label ${place.label} and was dropped.`,
      );
      out.pop();
    }
    out.push({ itemIndex, label: place.label });
  }
  return out;
}

function labelOf(match: RegExpMatchArray | RegExpExecArray | null): string | null {
  if (!match) return null;
  return match.slice(1).find((group) => group !== undefined) ?? match[0];
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').split('\n');
}
