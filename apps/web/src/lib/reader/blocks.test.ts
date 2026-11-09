import { describe, expect, it } from 'vitest';
import { layoutLines, type Item, type Stream } from '@varians/core';
import { absentRanges, blocksOf, formatRanges, inlineStarts, lineLabels, resolveFocus, segmentOfItems, segmentsByLine } from './blocks';

let next = 0;
const id = () => `i${next++}`;

/** A verse text: one line per label, each line a segment. */
function verse(labels: string[]): Stream {
  const items: Item[] = [];
  labels.forEach((label, k) => {
    if (k > 0) items.push({ kind: 'break', id: id(), type: 'line' });
    items.push({ kind: 'token', id: id(), form: `w${label}`, segment: { segmentId: `s${label}` } });
    items.push({ kind: 'token', id: id(), form: 'καί' });
  });
  return { items };
}

const labelOf = (segmentId: string) => segmentId.slice(1);

function ranges(blocks: { from: number; to: number }[]): [number, number][] {
  return blocks.map((b) => [b.from, b.to]);
}

describe('blocksOf, verse', () => {
  it('closes a block at each printed label, the first line courtesy label excepted', () => {
    const lines = layoutLines(verse(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '1.10', '1.11', '1.12']), labelOf, { numberEvery: 5 });
    const blocks = blocksOf(lines, { lineation: 'verse', numberEvery: 5 });
    expect(ranges(blocks)).toEqual([
      [0, 5],
      [5, 10],
      [10, 12],
    ]);
    expect(blocks[0]!.segmentIds).toEqual(['s1.1', 's1.2', 's1.3', 's1.4', 's1.5']);
    expect(blocks[2]!.segmentIds).toEqual(['s1.11', 's1.12']);
  });

  it('lets a first label that falls on the numbering close its block', () => {
    const lines = layoutLines(verse(['1.5', '1.6', '1.7', '1.8', '1.9', '1.10']), labelOf, { numberEvery: 5 });
    expect(ranges(blocksOf(lines, { lineation: 'verse', numberEvery: 5 }))).toEqual([
      [0, 1],
      [1, 6],
    ]);
  });

  it('makes a block of every line when every line is labelled', () => {
    const lines = layoutLines(verse(['1', '2', '3']), labelOf, { numberEvery: 1 });
    expect(ranges(blocksOf(lines, { lineation: 'verse', numberEvery: 1 }))).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('keeps unassigned lines before the first segment in the first block', () => {
    const stream = verse(['1.1', '1.2']);
    stream.items.unshift({ kind: 'object', id: id(), type: 'paratext', attrs: { type: 'head' }, text: 'Α' }, { kind: 'break', id: id(), type: 'line' });
    const lines = layoutLines(stream, labelOf, { numberEvery: 5 });
    expect(ranges(blocksOf(lines, { lineation: 'verse', numberEvery: 5 }))).toEqual([[0, 3]]);
  });
});

describe('blocksOf, prose', () => {
  it('makes one block per segment, and one for segments that begin on one line', () => {
    const items: Item[] = [
      { kind: 'token', id: 'a', form: 'Ὅτι', segment: { segmentId: 's17a' } },
      { kind: 'token', id: 'b', form: 'μέν' },
      { kind: 'break', id: id(), type: 'paragraph' },
      { kind: 'token', id: 'c', form: 'ὑμεῖς' },
      { kind: 'break', id: id(), type: 'paragraph' },
      { kind: 'token', id: 'd', form: 'ὦ', segment: { segmentId: 's17b' } },
      { kind: 'token', id: 'e', form: 'ἄνδρες', segment: { segmentId: 's17c' } },
      { kind: 'break', id: id(), type: 'paragraph' },
      { kind: 'token', id: 'f', form: 'πεπόνθατε', segment: { segmentId: 's17d' } },
    ];
    const lines = layoutLines({ items }, labelOf, { numberEvery: 1 });
    const blocks = blocksOf(lines, { lineation: 'prose', numberEvery: 1 });
    expect(ranges(blocks)).toEqual([
      [0, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(blocks.map((b) => b.segmentIds)).toEqual([['s17a'], ['s17b', 's17c'], ['s17d']]);
    expect(segmentsByLine(lines)).toEqual([['s17a'], ['s17a'], ['s17b', 's17c'], ['s17d']]);
  });
});

describe('lines and segments', () => {
  it('knows the segment of every item and of every line', () => {
    const items: Item[] = [
      { kind: 'token', id: 'x', form: 'ἀρχή' },
      { kind: 'token', id: 'a', form: 'α', segment: { segmentId: 's1' } },
      { kind: 'break', id: 'br', type: 'line' },
      { kind: 'token', id: 'b', form: 'β' },
      { kind: 'token', id: 'c', form: 'γ', segment: { segmentId: 's2' } },
    ];
    const lines = layoutLines({ items }, labelOf, { numberEvery: 1 });
    const of = segmentOfItems(lines);
    expect(of.get('x')).toBeNull();
    expect(of.get('a')).toBe('s1');
    expect(of.get('b')).toBe('s1');
    expect(of.get('c')).toBe('s2');
    expect(segmentsByLine(lines)).toEqual([['s1'], ['s1', 's2']]);
  });

  it('finds the segments that begin within a line', () => {
    const items: Item[] = [
      { kind: 'token', id: 'a', form: 'α', segment: { segmentId: 's1' } },
      { kind: 'token', id: 'b', form: 'β', segment: { segmentId: 's2' } },
      { kind: 'break', id: 'br', type: 'paragraph' },
      { kind: 'token', id: 'c', form: 'γ', segment: { segmentId: 's3' } },
    ];
    const lines = layoutLines({ items }, labelOf, { numberEvery: 1 });
    expect([...inlineStarts(lines, { s1: '17a', s2: '17b', s3: '17c' })]).toEqual([['b', '17b']]);
  });

  it('labels lines as the edition sets them, or every line where a segment begins', () => {
    const lines = layoutLines(verse(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']), labelOf, { numberEvery: 5 });
    const of = Object.fromEntries(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6'].map((l) => [`s${l}`, l]));
    expect(lineLabels(lines, of, 'edition')).toEqual(['1.1', null, null, null, '1.5', null]);
    expect(lineLabels(lines, of, 'every')).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']);
  });
});

describe('resolveFocus', () => {
  const labels = { s1: '1.5', s2: '1.10' };
  it('finds a segment by its label, or by its id', () => {
    expect(resolveFocus(labels, '1.5')).toEqual({ segmentId: 's1', label: '1.5' });
    expect(resolveFocus(labels, 's2')).toEqual({ segmentId: 's2', label: '1.10' });
  });
  it('says which label is missing, and nothing when none is asked for', () => {
    expect(resolveFocus(labels, '1.611')).toEqual({ missing: '1.611' });
    expect(resolveFocus(labels, undefined)).toBeNull();
    expect(resolveFocus(labels, '')).toBeNull();
  });
});

describe('absentRanges', () => {
  it('runs consecutive segments a witness lacks together', () => {
    const order = [
      { label: '1.1', absent: [] },
      { label: '1.2', absent: ['C'] },
      { label: '1.3', absent: ['B', 'C'] },
      { label: '1.4', absent: [] },
      { label: '1.5', absent: ['C'] },
    ];
    expect(absentRanges(order, 'C')).toEqual([
      ['1.2', '1.3'],
      ['1.5', '1.5'],
    ]);
    expect(formatRanges(absentRanges(order, 'C'))).toBe('1.2–1.3, 1.5');
    expect(absentRanges(order, 'A')).toEqual([]);
  });
});
