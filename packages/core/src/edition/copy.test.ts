import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { isBreak, isToken, type Item, type Stream, type Token } from '../stream/items.ts';
import { applyOps } from '../stream/ops.ts';
import { copyFromTranscript, segmentsToCopy } from './copy.ts';
import { deriveEdition } from './derive.ts';

const WORK = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

/**
 * A stream from a picture: `[s2]` starts segment s2 at the next item, `/` is
 * a line break, `//` a paragraph break, `+` after a word joins it to the
 * next, `{gap}` a gap, `{lac}` a lacuna, `{sp:text}` a paratext object.
 */
function streamOf(prefix: string, picture: string): Stream {
  const ids = sequentialIds(prefix);
  const items: Item[] = [];
  let start: string | null = null;
  for (const part of picture.split(/\s+/u).filter(Boolean)) {
    if (part === '/' || part === '//') {
      items.push({ kind: 'break', id: ids(), type: part === '/' ? 'line' : 'paragraph' });
      continue;
    }
    const seg = /^\[(\w+)\]$/u.exec(part);
    if (seg) {
      start = seg[1]!;
      continue;
    }
    let item: Item;
    if (part === '{gap}') item = { kind: 'object', id: ids(), type: 'gap' };
    else if (part === '{lac}') item = { kind: 'object', id: ids(), type: 'lacuna' };
    else if (part.startsWith('{sp:'))
      item = { kind: 'object', id: ids(), type: 'paratext', text: part.slice(4, -1) };
    else {
      const token: Token = { kind: 'token', id: ids(), form: part.replace(/\+$/u, '') };
      if (part.endsWith('+')) token.joinNext = true;
      item = token;
    }
    if (start !== null && !isBreak(item)) {
      item.segment = { segmentId: start };
      start = null;
    }
    items.push(item);
  }
  return { items };
}

/** The picture of a stream, as `streamOf` reads it, with each word's source transcript after a colon where it has one. */
function show(stream: Stream, sources = false): string {
  return stream.items
    .map((item) => {
      if (isBreak(item)) return item.type === 'line' ? '/' : '//';
      const start = item.segment?.segmentId ? `[${item.segment.segmentId}] ` : '';
      if (!isToken(item))
        return `${start}{${item.type === 'paratext' ? `sp:${item.text}` : item.type === 'lacuna' ? 'lac' : item.type}}`;
      const from =
        sources && item.source?.kind === 'witness' ? `:${item.source.transcriptionId}` : '';
      return `${start}${item.form}${item.joinNext ? '+' : ''}${from}`;
    })
    .join(' ');
}

let copies = 0;

function copy(
  edition: Stream,
  transcript: Stream,
  segments: string[],
  options: { lineation?: 'verse' | 'prose'; id?: string } = {},
) {
  const result = copyFromTranscript(
    edition,
    transcript,
    options.id ?? 'T',
    new Set(segments),
    WORK,
    {
      ids: sequentialIds(`n${++copies}-`),
      ...(options.lineation ? { lineation: options.lineation } : {}),
    },
  );
  return { ...result, stream: applyOps(edition, result.ops).stream };
}

const A = streamOf(
  'a',
  '[s1] ἄλφα βῆτα / [s2] γάμμα δέλτα / [s3] ἒψιλον ζῆτα / [s4] ἦτα θῆτα // [s5] ἰῶτα κάππα / [s6] λάμβδα μῦ',
);
const B = streamOf(
  'b',
  '[s1] ἄλφα βῆτον / [s2] γάμμον δέλτα / [s3] ἒψιλον ζῆτον / [s4] ἦτον / θῆτα [s5] ἰῶτον κάππα / [s6] λάμβδον μῦ',
);

describe('copyFromTranscript', () => {
  it('copies into an empty edition what deriveEdition gives', () => {
    const { stream, copied, replaced } = copy({ items: [] }, A, WORK);
    const derived = deriveEdition(A, 'T', { ids: sequentialIds('d') });
    expect(show(stream)).toBe(show(derived));
    expect(copied).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(replaced).toEqual([]);
    const first = stream.items[0] as Token;
    expect(first.source).toEqual({ kind: 'witness', transcriptionId: 'T', tokenIds: ['a1'] });
  });

  it('copies a range, keeping the breaks among its segments', () => {
    const { stream } = copy({ items: [] }, A, ['s3', 's4', 's5']);
    expect(show(stream)).toBe('[s3] ἒψιλον ζῆτα / [s4] ἦτα θῆτα // [s5] ἰῶτα κάππα');
  });

  it('puts segments the edition does not have after the segment before them in the work', () => {
    const edition = copy({ items: [] }, A, ['s1', 's2', 's3']).stream;
    const later = copy(edition, B, ['s4', 's5', 's6']);
    expect(show(later.stream, true)).toBe(
      '[s1] ἄλφα:T βῆτα:T / [s2] γάμμα:T δέλτα:T / [s3] ἒψιλον:T ζῆτα:T / [s4] ἦτον:T / θῆτα:T [s5] ἰῶτον:T κάππα:T / [s6] λάμβδον:T μῦ:T',
    );
    // The edition's items are all there, in their order.
    expect(later.stream.items.slice(0, edition.items.length).map((i) => i.id)).toEqual(
      edition.items.map((i) => i.id),
    );
  });

  it('puts segments before the edition’s first at the beginning, and between two where they fall', () => {
    const edition = copy({ items: [] }, A, ['s3', 's6']).stream;
    expect(show(edition)).toBe('[s3] ἒψιλον ζῆτα / [s6] λάμβδα μῦ');
    const { stream } = copy(edition, B, ['s1', 's2', 's4', 's5'], { id: 'B' });
    expect(show(stream)).toBe(
      '[s1] ἄλφα βῆτον / [s2] γάμμον δέλτα / [s3] ἒψιλον ζῆτα / [s4] ἦτον / θῆτα [s5] ἰῶτον κάππα / [s6] λάμβδα μῦ',
    );
  });

  it('replaces a segment the edition has where it stands, and its transposition stays', () => {
    // The edition has s3 before s2.
    const edition = streamOf('e', '[s1] ἄλφα / [s3] ἒψιλον / [s2] γάμμα / [s4] ἦτα');
    const { stream, replaced } = copy(edition, B, ['s2', 's3'], { id: 'B' });
    expect(replaced).toEqual(['s2', 's3']);
    expect(show(stream, true)).toBe(
      '[s1] ἄλφα / [s3] ἒψιλον:B ζῆτον:B / [s2] γάμμον:B δέλτα:B / [s4] ἦτα',
    );
  });

  it('gives the replaced segments the transcript’s breaks where they stand side by side', () => {
    const edition = copy({ items: [] }, A, WORK).stream;
    const { stream } = copy(edition, B, ['s3', 's4', 's5']);
    expect(show(stream)).toBe(
      '[s1] ἄλφα βῆτα / [s2] γάμμα δέλτα / [s3] ἒψιλον ζῆτον / [s4] ἦτον / θῆτα [s5] ἰῶτον κάππα / [s6] λάμβδα μῦ',
    );
  });

  it('changes nothing but ids when the same segments are copied again', () => {
    const edition = copy({ items: [] }, A, ['s2', 's3', 's4', 's5']).stream;
    const again = copy(edition, A, ['s2', 's3', 's4', 's5']).stream;
    expect(show(again, true)).toBe(show(edition, true));
  });

  it('removes runs of a segment the copy has fewer of, leaving no empty line', () => {
    const edition = streamOf('e', '[s1] ἄλφα / [s2] γάμμα / [s3] ἒψιλον / [s2] δέλτα / [s4] ἦτα');
    edition.items.forEach((item) => {
      if (!isBreak(item) && item.segment?.segmentId === 's2')
        item.segment.part = item.id === 'e3' ? 1 : 2;
    });
    const { stream } = copy(edition, A, ['s2']);
    expect(show(stream)).toBe('[s1] ἄλφα / [s2] γάμμα δέλτα / [s3] ἒψιλον / [s4] ἦτα');
  });

  it('runs new segments on in prose and keeps the transcript’s breaks among them', () => {
    const edition = streamOf('e', '[s1] ἄλφα [s2] γάμμα [s6] λάμβδα');
    const { stream } = copy(edition, A, ['s3', 's4', 's5'], { lineation: 'prose' });
    expect(show(stream)).toBe(
      '[s1] ἄλφα [s2] γάμμα [s3] ἒψιλον ζῆτα / [s4] ἦτα θῆτα // [s5] ἰῶτα κάππα [s6] λάμβδα',
    );
  });

  it('puts new segments on a line of their own in verse', () => {
    const edition = streamOf('e', '[s1] ἄλφα [s2] γάμμα [s6] λάμβδα');
    const { stream } = copy(edition, A, ['s3']);
    expect(show(stream)).toBe('[s1] ἄλφα [s2] γάμμα / [s3] ἒψιλον ζῆτα / [s6] λάμβδα');
  });

  it('keeps gaps, lacunae and paratext, and a word divided within the range', () => {
    const T = streamOf('t', '[s1] ἄλφα {gap} / [s2] {sp:Χο} γάμ+ / μα {lac} / [s3] ἒψιλον');
    const { stream } = copy({ items: [] }, T, ['s1', 's2']);
    expect(show(stream)).toBe('[s1] ἄλφα {gap} / [s2] {sp:Χο} γάμ+ / μα {lac}');
  });

  it('treats a word divided across the edge of the range as deriveEdition does, and joins no word to nothing', () => {
    const T = streamOf('t', '[s1] ἄλφα βῆ+ / [s2] τα γάμμα / [s3] δέλτα');
    // The edition divides a word across s1 and s2 too.
    const edition = streamOf('e', '[s1] ἄλφα κά+ / [s2] λον / [s3] ἒψιλον');
    const { stream } = copy(edition, T, ['s2']);
    expect(show(stream)).toBe('[s1] ἄλφα κά / [s2] τα γάμμα / [s3] ἒψιλον');
  });

  it('keeps a paragraph break that opens the text before segments put at the beginning', () => {
    const edition: Stream = {
      items: [
        { kind: 'break', id: 'p0', type: 'paragraph', lineation: 'prose' },
        ...streamOf('e', '[s5] ἰῶτα').items,
      ],
    };
    const { stream } = copy(edition, A, ['s1']);
    expect(show(stream)).toBe('// [s1] ἄλφα βῆτα [s5] ἰῶτα');
    expect(stream.items[0]).toEqual(edition.items[0]);
  });

  it('tells which segments a copy brings and which of them the edition has', () => {
    const edition = streamOf('e', '[s2] γάμμα / [s9] ὦ');
    expect(segmentsToCopy(edition, A, new Set(['s1', 's2', 's3', 's7']))).toEqual({
      copied: ['s1', 's2', 's3'],
      replaced: ['s2'],
    });
  });

  it('copies nothing where the transcript has nothing of the segments', () => {
    const edition = streamOf('e', '[s2] γάμμα');
    expect(copy(edition, A, ['s7']).ops).toEqual([]);
  });
});
