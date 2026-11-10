import { describe, expect, it } from 'vitest';
import { collatePassages, type Passage, type StreamText } from '../collate/passage.ts';
import { sequentialIds } from '../ids.ts';
import {
  isBreak,
  isToken,
  type Id,
  type Item,
  type Lineation,
  type Stream,
} from '../stream/items.ts';
import { applyOps } from '../stream/ops.ts';
import { segmentRuns } from '../stream/words.ts';
import { adoptConjecture, adoptReading } from './adopt.ts';

/** A stream from lines `s1: a b` (a line beginning the segment s1) and `: c` (going on in it); `ab-` joins the next line's first word. */
function stream(prefix: string, ...lines: string[]): Stream {
  const items: Item[] = [];
  let n = 0;
  lines.forEach((line, k) => {
    if (k > 0) items.push({ kind: 'break', id: `${prefix}l${k}`, type: 'line' });
    const [label, text] = line.split(':') as [string, string];
    text
      .split(/\s+/u)
      .filter(Boolean)
      .forEach((word, w) => {
        const joins = word.endsWith('-');
        items.push({
          kind: 'token',
          id: `${prefix}${++n}`,
          form: joins ? word.slice(0, -1) : word,
          ...(joins ? { joinNext: true } : {}),
          ...(w === 0 && label.trim() ? { segment: { segmentId: label.trim() } } : {}),
        });
      });
  });
  return { items };
}

const text = (id: string, ...lines: string[]): StreamText => ({
  id,
  siglum: id,
  stream: stream(id, ...lines),
});

/** The stream as lines, each word with the segment it belongs to: `a@s1 b@s1 / c@s2`. */
function show(s: Stream): string {
  const segmentOf = new Map<Id, Id | null>();
  for (const run of segmentRuns(s))
    for (let i = run.from; i < run.to; i++) segmentOf.set(s.items[i]!.id, run.segmentId);
  return s.items
    .map((item) =>
      isBreak(item) ? '/' : isToken(item) ? `${item.form}@${segmentOf.get(item.id)}` : item.id,
    )
    .join(' ');
}

/** Adopt the reading of `textId` at the passage's only site (or the one given). */
function adopt(
  edition: StreamText,
  passage: Passage,
  textId: Id,
  options: { ownLine?: boolean; lineation?: Lineation } = {},
  site = 0,
) {
  const at = passage.collation.sites[site]!;
  const reading = at.readings.find((r) => r.textIds.includes(textId))!;
  const ops = adoptReading(edition.stream, at, passage.base.units, reading, textId, {
    ids: sequentialIds('n'),
    ...options,
  });
  return applyOps(edition.stream, ops).stream;
}

/** The edition with its first paragraph marked as verse or prose, by a paragraph break that opens the text. */
function marked(edition: StreamText, lineation: Lineation): StreamText {
  const opening: Item = { kind: 'break', id: 'p0', type: 'paragraph', lineation };
  return { ...edition, stream: { items: [opening, ...edition.stream.items] } };
}

describe('adopting across a segment boundary', () => {
  it('replaces a word divided across two segments, and the next segment keeps its words', () => {
    const edition = text('E', 's1: μῆνιν ἄει-', 's2: δε θεὰ');
    const [passage] = collatePassages(edition, [text('B', 's1: μῆνιν ἄειδεν', 's2: θεὰ')]).passages;
    expect(show(adopt(edition, passage!, 'B'))).toBe('μῆνιν@s1 ἄειδεν@s1 / θεὰ@s2');
  });

  it('adopts words in another order across a boundary, each in the segment the witness gives it', () => {
    const edition = text('E', 's1: a b c d e f', 's2: g h i j k l');
    const [passage] = collatePassages(edition, [
      text('A', 's1: a b c d e g', 's2: f h i j k l'),
    ]).passages;
    expect(show(adopt(edition, passage!, 'A'))).toBe(
      'a@s1 b@s1 c@s1 d@s1 e@s1 g@s1 / f@s2 h@s2 i@s2 j@s2 k@s2 l@s2',
    );
  });

  it('puts words added at a boundary on the side of it the witness gives them', () => {
    const edition = text('E', 's1: a b', 's2: c d');
    const at = (witness: StreamText) =>
      show(adopt(edition, collatePassages(edition, [witness]).passages[0]!, witness.id));
    expect(at(text('A', 's1: a b', 's2: x c d'))).toBe('a@s1 b@s1 / x@s2 c@s2 d@s2');
    expect(at(text('B', 's1: a b x', 's2: c d'))).toBe('a@s1 b@s1 x@s1 / c@s2 d@s2');
    expect(at(text('C', 's1: a b x', 's2: y c d'))).toBe('a@s1 b@s1 x@s1 / y@s2 c@s2 d@s2');
  });

  it('prints a segment the edition does not have on a line of its own, or in the run of the text', () => {
    const edition = text('E', 's1: a b', 's3: e f');
    const [passage] = collatePassages(edition, [
      text('A', 's1: a b', 's2: c d', 's3: e f'),
    ]).passages;
    expect(show(adopt(edition, passage!, 'A'))).toBe('a@s1 b@s1 / c@s2 d@s2 / e@s3 f@s3');
    expect(show(adopt(edition, passage!, 'A', { ownLine: false }))).toBe(
      'a@s1 b@s1 c@s2 d@s2 / e@s3 f@s3',
    );
  });

  it('prints it by the kind of the paragraph where it goes: on a line of its own in verse, in the run of the text in prose', () => {
    const plain = text('E', 's1: a b', 's3: e f');
    const witness = text('A', 's1: a b', 's2: c d', 's3: e f');
    const printed = (edition: StreamText, options?: { ownLine?: boolean; lineation?: Lineation }) =>
      show(adopt(edition, collatePassages(edition, [witness]).passages[0]!, 'A', options));
    // The paragraph's own mark decides, whatever the edition's convention is.
    expect(printed(marked(plain, 'verse'), { lineation: 'prose' })).toBe(
      '/ a@s1 b@s1 / c@s2 d@s2 / e@s3 f@s3',
    );
    expect(printed(marked(plain, 'prose'), { lineation: 'verse' })).toBe(
      '/ a@s1 b@s1 c@s2 d@s2 / e@s3 f@s3',
    );
    // Where a paragraph is not marked, the edition's convention does.
    expect(printed(plain, { lineation: 'prose' })).toBe('a@s1 b@s1 c@s2 d@s2 / e@s3 f@s3');
    expect(printed(plain, { lineation: 'verse' })).toBe('a@s1 b@s1 / c@s2 d@s2 / e@s3 f@s3');
    expect(printed(plain)).toBe('a@s1 b@s1 / c@s2 d@s2 / e@s3 f@s3');
    // Said outright, it is as said.
    expect(printed(marked(plain, 'prose'), { ownLine: true })).toBe(
      '/ a@s1 b@s1 / c@s2 d@s2 / e@s3 f@s3',
    );
  });

  it('prints each segment by the paragraph it goes in, in one text of a prose paragraph and a verse paragraph', () => {
    // A prose paragraph (1.1, 1.3), then a verse paragraph (1.4, 1.6); the witness has 1.2 and 1.5 as well.
    const edition = text('E', 's1: a b', 's3: e f', 's4: g h', 's6: k l');
    const items = edition.stream.items;
    items[items.findIndex((item) => item.id === 'El2')] = {
      kind: 'break',
      id: 'p1',
      type: 'paragraph',
      lineation: 'verse',
    };
    items.unshift({ kind: 'break', id: 'p0', type: 'paragraph', lineation: 'prose' });
    const witness = text('A', 's1: a b', 's2: c d', 's3: e f', 's4: g h', 's5: x y', 's6: k l');
    // Nothing crosses the boundary between 1.3 and 1.4: two passages, a variant at a point in each.
    const [inProse, inVerse] = collatePassages(edition, [witness]).passages;
    expect(show(adopt(edition, inProse!, 'A'))).toBe(
      '/ a@s1 b@s1 c@s2 d@s2 / e@s3 f@s3 / g@s4 h@s4 / k@s6 l@s6',
    );
    expect(show(adopt(edition, inVerse!, 'A'))).toBe(
      '/ a@s1 b@s1 / e@s3 f@s3 / g@s4 h@s4 / x@s5 y@s5 / k@s6 l@s6',
    );
  });

  it('takes out the words of a whole segment a witness is without, its line with them', () => {
    const edition = text('E', 's1: a b', 's2: c d', 's3: e f');
    const [passage] = collatePassages(edition, [
      text('A', 's1: a b', 's3: e f'),
      text('B', 's1: a b', 's2: c d', 's3: e f'),
    ]).passages;
    expect(passage!.collation.sites[0]!.wanting).toBe(true);
    expect(show(adopt(edition, passage!, 'A'))).toBe('a@s1 b@s1 / e@s3 f@s3');
  });

  it('gives a conjecture’s words the segment it names', () => {
    const edition = text('E', 's1: a b', 's2: c d');
    const [passage] = collatePassages(edition, [text('A', 's1: a b', 's2: x c d')]).passages;
    const site = passage!.collation.sites[0]!;
    const conjecture = (segmentId?: Id) =>
      show(
        applyOps(
          edition.stream,
          adoptConjecture(
            edition.stream,
            site,
            passage!.base.units,
            { id: 'k', reading: 'z', kind: 'addition', ...(segmentId ? { segmentId } : {}) },
            { ids: sequentialIds('n') },
          ),
        ).stream,
      );
    expect(conjecture('s2')).toBe('a@s1 b@s1 / z@s2 c@s2 d@s2');
    expect(conjecture()).toBe('a@s1 b@s1 z@s1 / c@s2 d@s2');
  });
});
