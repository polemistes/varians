import { describe, expect, it } from 'vitest';
import { collate, type Reading } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { isBreak, type Item, type Stream, type Token } from '../stream/items.ts';
import { applyOps } from '../stream/ops.ts';
import { fromText, toText } from '../stream/text.ts';
import { runsOfSegment, segmentAt, units } from '../stream/words.ts';
import { adoptReading } from './adopt.ts';
import { printPlace, printReading, printSegment } from './print.ts';

/**
 * A stream from a short notation: `a1` a word, `a1@s2` or `a1@s2.1` one that
 * starts a segment (with its part), `o1` an object (`o1@s2` one with a start),
 * `/` a line break, `#p` a page break.
 */
function build(spec: string): Stream {
  let breaks = 0;
  return {
    items: spec
      .split(/\s+/u)
      .filter(Boolean)
      .map((word): Item => {
        if (word === '/') return { kind: 'break', id: `l${++breaks}`, type: 'line' };
        if (word.startsWith('#'))
          return { kind: 'break', id: `p${++breaks}`, type: 'page', pageId: word.slice(1) };
        const [id, start] = word.split('@');
        const segment = start
          ? (([segmentId, part]) =>
              part ? { segmentId: segmentId!, part: Number(part) } : { segmentId: segmentId! })(
              start.split('.'),
            )
          : undefined;
        if (id!.startsWith('o'))
          return { kind: 'object', id: id!, type: 'lacuna', ...(segment ? { segment } : {}) };
        return { kind: 'token', id: id!, form: id!, ...(segment ? { segment } : {}) };
      }),
  };
}

/** The stream in the same notation, with new breaks shown as `/` whatever their ids. */
function show(stream: Stream): string {
  return stream.items
    .map((item) => {
      if (isBreak(item)) return item.type === 'page' ? `#${item.pageId}` : '/';
      const start = item.segment;
      if (!start) return item.id;
      return `${item.id}@${start.segmentId}${start.part !== undefined ? `.${start.part}` : ''}`;
    })
    .join(' ');
}

const words = (...ids: string[]): Token[] =>
  ids.map((id) => ({ kind: 'token', id, form: id.toUpperCase() }));

function print(spec: string, after: string, ...ids: string[]): string {
  const stream = build(spec);
  const ops = printSegment(stream, 'new', after, words(...ids), { ids: sequentialIds('brk') });
  return show(applyOps(stream, ops).stream);
}

/** The segment of every token and object, by flow. */
function members(stream: Stream): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  stream.items.forEach((item, i) => {
    if (!isBreak(item)) out[item.id] = segmentAt(stream, i)?.segmentId ?? null;
  });
  return out;
}

describe('printing a segment the edition does not print', () => {
  it('puts it on a line of its own after the last word of the segment it follows', () => {
    expect(print('a1@s1 a2 / b1@s2 b2', 's1', 'n1', 'n2')).toBe('a1@s1 a2 / n1@new n2 / b1@s2 b2');
  });

  it('goes in the run of the text where the word it follows stands in prose', () => {
    const verse = build('a1@s1 a2 / b1@s2 b2');
    const prose: Stream = {
      items: [{ kind: 'break', id: 'pp', type: 'paragraph', lineation: 'prose' }, ...verse.items],
    };
    const printed = (stream: Stream, options: Parameters<typeof printSegment>[4]) =>
      show(
        applyOps(
          stream,
          printSegment(stream, 'new', 's1', words('n1', 'n2'), {
            ids: sequentialIds('brk'),
            ...options,
          }),
        ).stream,
      );
    // The paragraph's mark decides; where there is none, the edition's convention; said outright, as said.
    expect(printed(prose, {})).toBe('/ a1@s1 a2 n1@new n2 / b1@s2 b2');
    expect(printed(prose, { lineation: 'verse' })).toBe('/ a1@s1 a2 n1@new n2 / b1@s2 b2');
    expect(printed(verse, { lineation: 'prose' })).toBe('a1@s1 a2 n1@new n2 / b1@s2 b2');
    expect(printed(verse, {})).toBe('a1@s1 a2 / n1@new n2 / b1@s2 b2');
    expect(printed(prose, { ownLine: true })).toBe('/ a1@s1 a2 / n1@new n2 / b1@s2 b2');
    // No other word changes segment.
    const next = applyOps(
      prose,
      printSegment(prose, 'new', 's1', words('n1', 'n2'), { ids: sequentialIds('brk') }),
    ).stream;
    expect(members(next)).toMatchObject({ a1: 's1', a2: 's1', n1: 'new', n2: 'new', b1: 's2' });
  });

  it('after the last line of the text, ends the text', () => {
    expect(print('a1@s1 / b1@s2 b2', 's2', 'n1')).toBe('a1@s1 / b1@s2 b2 / n1@new');
  });

  it('where the next segment goes on in the same line, breaks the line after it as well', () => {
    expect(print('a1@s1 a2 b1@s2 b2', 's1', 'n1')).toBe('a1@s1 a2 / n1@new / b1@s2 b2');
  });

  it('leaves what follows the last word on its line on that line', () => {
    expect(print('a1@s1 a2 o1 / b1@s2', 's1', 'n1')).toBe('a1@s1 a2 o1 / n1@new / b1@s2');
  });

  it('keeps the segment of an object of the segment on the next line, as a second part', () => {
    const stream = build('a1@s1 a2 / o1 b1@s2');
    const ops = printSegment(stream, 'new', 's1', words('n1'), { ids: sequentialIds('brk') });
    const next = applyOps(stream, ops).stream;
    expect(show(next)).toBe('a1@s1.1 a2 / n1@new / o1@s1.2 b1@s2');
    const before = members(stream);
    const after = members(next);
    for (const id of Object.keys(before)) expect(after[id]).toBe(before[id]);
  });

  it('follows the last part of a segment in several runs, wherever it stands', () => {
    expect(print('a1@s1.2 / b1@s2 / c1@s1.1', 's1', 'n1')).toBe(
      'a1@s1.2 / n1@new / b1@s2 / c1@s1.1',
    );
  });

  it('follows the segment where the edition has it, not where the numbering would', () => {
    expect(print('a1@s1 / d1@s4 / b1@s2 / e1@s5', 's2', 'n1')).toBe(
      'a1@s1 / d1@s4 / b1@s2 / n1@new / e1@s5',
    );
  });

  it('after the last word of a page, ends that page', () => {
    expect(print('a1@s1 #p2 b1@s2', 's1', 'n1')).toBe('a1@s1 / n1@new #p2 b1@s2');
  });

  it('follows a segment that has only an object', () => {
    expect(print('a1@s1 / o1@s2 / b1@s3', 's2', 'n1')).toBe('a1@s1 / o1@s2 / n1@new / b1@s3');
  });

  it('does nothing without words, or when the segment it would follow is not in the text', () => {
    const stream = build('a1@s1 / b1@s2');
    expect(printSegment(stream, 'new', 's1', [])).toEqual([]);
    expect(printSegment(stream, 'new', 's9', words('n1'))).toEqual([]);
    expect(printPlace(stream, 's9')).toBeNull();
  });

  it('takes a start the items bring off all but the first', () => {
    const items: Token[] = [
      { kind: 'token', id: 'n1', form: 'x', segment: { segmentId: 'other' } },
      { kind: 'token', id: 'n2', form: 'y', segment: { segmentId: 'other' } },
    ];
    const stream = build('a1@s1');
    const next = applyOps(stream, printSegment(stream, 'new', 's1', items)).stream;
    expect(show(next)).toBe('a1@s1 / n1@new n2');
  });

  it('prints a witness’s reading with its source, the words of the witness chosen, and no gap', () => {
    const reading: Reading = {
      text: 'eta theta',
      fold: 'eta theta',
      textIds: ['A', 'D:original'],
      sigla: ['A', 'D'],
      units: {
        A: [
          { text: 'eta', tokenIds: ['A7'] },
          { text: 'theta', tokenIds: ['A8'] },
        ],
        'D:original': [
          { text: 'ἠτα', tokenIds: ['D3'] },
          { text: '', tokenIds: [], gap: { kind: 'object', id: 'g', type: 'gap' } },
          { text: 'theta', tokenIds: ['D4'] },
        ],
      },
      omission: false,
      lacunose: false,
      base: false,
    };
    const stream = build('a1@s1 / b1@s2');
    const next = applyOps(
      stream,
      printReading(stream, 's3', 's1', reading, 'D:original', { ids: sequentialIds('n') }),
    ).stream;
    const printed = next.items.filter((item) => item.kind === 'token' && item.id.startsWith('n'));
    expect(printed).toEqual([
      {
        kind: 'token',
        id: 'n1',
        form: 'ἠτα',
        segment: { segmentId: 's3' },
        source: { kind: 'witness', transcriptionId: 'D', tokenIds: ['D3'] },
      },
      {
        kind: 'token',
        id: 'n2',
        form: 'theta',
        source: { kind: 'witness', transcriptionId: 'D', tokenIds: ['D4'] },
      },
    ]);
    expect(show(next)).toBe('a1@s1 / n1@s3 n2 / b1@s2');
  });

  it('fills an empty line that follows directly, and one at the end of the text', () => {
    expect(print('a1@s1 / / b1@s2', 's1', 'n1')).toBe('a1@s1 / n1@new / b1@s2');
    expect(print('a1@s1 /', 's1', 'n1')).toBe('a1@s1 / n1@new');
  });

  describe('a line taken out of the text', () => {
    // The edition prints s1 s2 s3; A has them all, B runs on without the one at issue.
    const segmentOf = (spec: string, id: string, segmentId: string) => {
      const stream = fromText(spec, { ids: sequentialIds(id) });
      (stream.items[0] as Token).segment = { segmentId };
      return stream;
    };
    const lines = (...streams: Stream[]): Stream => ({
      items: streams.flatMap((s, k) =>
        k === 0
          ? s.items
          : [{ kind: 'break' as const, id: `br${k}`, type: 'line' as const }, ...s.items],
      ),
    });
    const text = { s1: 'alpha beta', s2: 'gamma delta', s3: 'epsilon' } as const;
    const edition = () =>
      lines(
        segmentOf(text.s1, 'e1-', 's1'),
        segmentOf(text.s2, 'e2-', 's2'),
        segmentOf(text.s3, 'e3-', 's3'),
      );

    /** Take the line `segmentId` out of the edition by adopting that B has nothing there. */
    function takeOut(segmentId: 's2' | 's3') {
      const stream = edition();
      const a = fromText(text[segmentId], { ids: sequentialIds('A') });
      const witnesses = [{ id: 'A', siglum: 'A', units: units(a, 0, a.items.length) }];
      const absent = { id: 'B', siglum: 'B', units: [], present: true };
      const run = runsOfSegment(stream, segmentId)[0]!;
      const baseUnits = units(stream, run.from, run.to);
      const whole = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [...witnesses, absent]);
      const wanting = whole.sites.find((site) => site.wanting)!;
      const notIn = wanting.readings.find((r) => r.textIds.includes('B'))!;
      const applied = applyOps(stream, adoptReading(stream, wanting, baseUnits, notIn, 'B'));
      const unprinted = collate({ id: 'E', siglum: 'ed.', units: [] }, [...witnesses, absent]);
      return {
        stream,
        without: applied.stream,
        reverse: applied.reverse,
        reading: unprinted.sites[0]!.readings.find((r) => r.textIds.includes('A'))!,
      };
    }

    it('leaves no empty line, and is given back as it stood, with its words from the witness chosen', () => {
      const { stream, without, reading } = takeOut('s2');
      expect(toText(without)).toBe('alpha beta\nepsilon');
      const back = applyOps(
        without,
        printReading(without, 's2', 's1', reading, 'A', { ids: sequentialIds('n') }),
      ).stream;
      expect(toText(back)).toBe(toText(stream));
      expect(back.items.map((i) => i.kind)).toEqual(stream.items.map((i) => i.kind));
      const printed = runsOfSegment(back, 's2');
      expect(printed).toHaveLength(1);
      expect(
        back.items
          .slice(printed[0]!.from, printed[0]!.to)
          .flatMap((t) => (t.kind === 'token' ? [t.source] : [])),
      ).toEqual([
        { kind: 'witness', transcriptionId: 'A', tokenIds: ['A1'] },
        { kind: 'witness', transcriptionId: 'A', tokenIds: ['A2'] },
      ]);
    });

    it('is given back at the end of the text as it stood', () => {
      const { stream, without, reading } = takeOut('s3');
      expect(toText(without)).toBe('alpha beta\ngamma delta');
      const back = applyOps(
        without,
        printReading(without, 's3', 's2', reading, 'A', { ids: sequentialIds('n') }),
      ).stream;
      expect(toText(back)).toBe(toText(stream));
      expect(back.items.map((i) => i.kind)).toEqual(stream.items.map((i) => i.kind));
    });

    it('is taken back by the reverse of the operations that took it out', () => {
      for (const which of ['s2', 's3'] as const) {
        const { stream, without, reverse } = takeOut(which);
        expect(applyOps(without, reverse).stream).toEqual(stream);
      }
    });
  });

  it('is taken back by the reverse of its operations', () => {
    const stream = build('a1@s1 a2 / o1 b1@s2 b2');
    const applied = applyOps(stream, printSegment(stream, 'new', 's1', words('n1', 'n2')));
    expect(applyOps(applied.stream, applied.reverse).stream).toEqual(stream);
  });
});
