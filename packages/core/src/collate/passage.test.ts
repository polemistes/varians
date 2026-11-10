import { describe, expect, it } from 'vitest';
import type { Item, Stream } from '../stream/items.ts';
import { additionIn, type Collation, type CollationText } from './collate.ts';
import {
  boundaryReason,
  collatePassages,
  linkPassages,
  passageInputs,
  planPassages,
  siteSegments,
  type Passage,
  type SegmentAlone,
  type StreamText,
} from './passage.ts';
import { collate } from './collate.ts';

/**
 * A stream from lines: `s1: a b`, a line that begins the segment s1;
 * `: c d`, a line that goes on in the segment before; a word ending in `-`
 * is divided, its next part beginning the next line.
 */
function stream(prefix: string, ...lines: string[]): Stream {
  const items: Item[] = [];
  let n = 0;
  lines.forEach((line, k) => {
    if (k > 0) items.push({ kind: 'break', id: `${prefix}l${k}`, type: 'line' });
    const [label, text] = line.split(':') as [string, string];
    const segmentId = label.trim();
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
          ...(w === 0 && segmentId ? { segment: { segmentId } } : {}),
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

function summary(collation: Collation): string[] {
  return collation.sites.map((site) =>
    site.readings
      .map(
        (r) =>
          `${r.omission ? 'om.' : r.text} ${r.base ? 'ed' : ''}${r.sigla.filter((s) => s !== 'E' && s !== 'ed.').join('')}`,
      )
      .join(' : '),
  );
}

const ids = (passages: Passage[]) =>
  passages.map((p) => p.segments.map((s) => (s.printed ? s.segmentId : `(${s.segmentId})`)));

describe('collating in passages', () => {
  it('reads a word divided across two segments once, whole, in the segment where it begins', () => {
    const edition = text('E', 's1: μῆνιν ἄει-', 's2: δε θεὰ');
    const { passages } = collatePassages(edition, [
      text('A', 's1: μῆνιν ἄειδε', 's2: θεὰ'),
      text('B', 's1: μῆνιν', 's2: ἄειδε θεός'),
    ]);
    expect(ids(passages)).toEqual([['s1', 's2']]);
    const [passage] = passages;
    expect(passage!.base.units.map((u) => [u.text, u.tokenIds, u.segmentId])).toEqual([
      ['μῆνιν', ['E1'], 's1'],
      ['ἄειδε', ['E2', 'E3'], 's1'],
      ['θεὰ', ['E4'], 's2'],
    ]);
    expect(passage!.segmentStarts).toEqual([0, 2]);
    // B has the word in the other segment: no variant; it reads another word at θεὰ.
    expect(summary(passage!.collation)).toEqual(['θεὰ edA : θεός B']);
    expect(siteSegments(passage!.collation.sites[0]!, passage!.base.units)).toEqual(['s2']);
  });

  it('finds a line a witness assigns to the neighbouring segment where it is, and reports nothing', () => {
    const edition = text('E', 's1: a b', 's2: c d', 's3: e f');
    // A runs its first segment on over the edition's second line.
    const { passages, alone } = collatePassages(edition, [
      text('A', 's1: a b', ': c d', 's3: e f'),
      text('B', 's1: a b', 's2: c x', 's3: e f'),
    ]);
    // Alone, the second segment is not in A, and A adds its words to the first.
    expect(summary(alone.get('s2')!)).toEqual(['d ed : x B', 'c d edB : om. A']);
    expect(summary(alone.get('s1')!)).toEqual(['om. edB : c d A']);
    // Taken together, A reads as the edition, and only B's word is a variant.
    expect(ids(passages)).toEqual([['s1', 's2', 's3']]);
    expect(summary(passages[0]!.collation)).toEqual(['d edA : x B']);
  });

  it('puts a segment the edition does not print in the passage of the segment before it', () => {
    const edition = text('E', 's1: a b', 's3: e f');
    const { passages } = collatePassages(edition, [
      text('A', 's1: a b', 's2: c d', 's3: e f'),
      text('B', 's1: a b', 's3: e f'),
    ]);
    expect(ids(passages)).toEqual([['s1', '(s2)', 's3']]);
    const [passage] = passages;
    expect(summary(passage!.collation)).toEqual(['om. edB : c d A']);
    const site = passage!.collation.sites[0]!;
    expect(siteSegments(site, passage!.base.units)).toEqual(['s2']);
    expect(additionIn(site, 'E', false)).toEqual(['A']);
  });

  it('cuts where nothing crosses a boundary', () => {
    const edition = text('E', 's1: a b c d e f', 's2: g h i j k l', 's3: m n o p q r');
    const { passages } = collatePassages(edition, [
      text('A', 's1: a x c d e f', 's2: g h i j k l', 's3: m n o p q y'),
      text('B', 's1: a b c d e f', 's2: g h i j k l', 's3: m n o p q r'),
    ]);
    expect(ids(passages)).toEqual([['s1'], ['s2'], ['s3']]);
  });

  it('leaves a boundary uncut where a witness departs close to it on both sides', () => {
    const edition = text('E', 's1: a b c d e f', 's2: g h i j k l');
    const { passages } = collatePassages(edition, [
      text('A', 's1: a b c d e g', 's2: f h i j k l'),
    ]);
    expect(ids(passages)).toEqual([['s1', 's2']]);
    expect(summary(passages[0]!.collation)).toEqual(['f g ed : g f A']);
  });

  it('leaves a boundary alone for a witness that is not there on one side', () => {
    const edition = text('E', 's1: a b', 's2: c d', 's3: e f');
    // A's transcript ends with the first segment: it is not there for the others.
    const { passages } = collatePassages(edition, [
      text('A', 's1: a b'),
      text('B', 's1: a b', 's2: c d', 's3: e f'),
    ]);
    expect(ids(passages)).toEqual([['s1'], ['s2'], ['s3']]);
  });

  it('links a word a witness has in another passage nearby, so that it has added nothing there', () => {
    const edition = text('E', 's1: a b c d e f g h', 's2: i j k l m n o p');
    const { passages } = collatePassages(edition, [
      text('A', 's1: b c d e f g h', 's2: i j k l a m n o p'),
      text('B', 's1: a b c d e f g h', 's2: i j k l m n o p'),
    ]);
    expect(ids(passages)).toEqual([['s1'], ['s2']]);
    const absence = passages[0]!.collation.sites[0]!;
    const point = passages[1]!.collation.sites[0]!;
    expect(summary(passages[0]!.collation)).toEqual(['a edB : om. A']);
    expect(summary(passages[1]!.collation)).toEqual(['om. edB : a A']);
    expect(absence.transposition).toEqual({ withSite: 0, textIds: ['A'], inPassage: 's2' });
    expect(point.transposition).toEqual({ withSite: 0, textIds: ['A'], inPassage: 's1' });
    expect(additionIn(point, 'E', false)).toEqual([]);
    // Farther apart than the reach, the two are not linked.
    const [one, other] = linkPassages(
      { ...passages[0]!, collation: collate(passages[0]!.base, passages[0]!.witnesses) },
      { ...passages[1]!, collation: collate(passages[1]!.base, passages[1]!.witnesses) },
      { farReach: 10 },
    );
    expect(one.sites[0]!.transposition).toBeUndefined();
    expect(other.sites[0]!.transposition).toBeUndefined();
  });
});

describe('the plan of passages', () => {
  const alone = (segmentId: string, words: string, divided = false): SegmentAlone => {
    const base: CollationText = {
      id: 'E',
      siglum: 'ed.',
      units: words
        .split(' ')
        .filter(Boolean)
        .map((w, k) => ({ text: w, tokenIds: [`${segmentId}.${k}`] })),
    };
    const witness: CollationText = { ...base, id: 'A', siglum: 'A', present: true };
    return {
      segmentId,
      baseUnits: base.units.length,
      witnesses: [witness],
      collation: collate(base, [witness]),
      ...(divided ? { dividedIntoNext: ['E'] } : {}),
    };
  };

  it('cuts a run held together where it would pass twelve segments', () => {
    const segments = Array.from({ length: 15 }, (_, k) => alone(`s${k + 1}`, 'a b', true));
    expect(planPassages(segments).map((p) => p.length)).toEqual([12, 3]);
    expect(planPassages(segments, { maxSegments: 4 }).map((p) => p.length)).toEqual([4, 4, 4, 3]);
  });

  it('cuts a run held together where it would pass 240 of the edition’s words', () => {
    const long = Array.from({ length: 100 }, (_, k) => `w${k}`).join(' ');
    const segments = Array.from({ length: 5 }, (_, k) => alone(`s${k + 1}`, long, true));
    expect(planPassages(segments).map((p) => p.length)).toEqual([2, 2, 1]);
  });

  it('says why a boundary is left uncut', () => {
    expect(boundaryReason([alone('s1', 'a', true), alone('s2', 'b')], 1)).toEqual({
      kind: 'divided',
      textId: 'E',
    });
    expect(boundaryReason([alone('s1', 'a'), alone('s2', 'b')], 1)).toBeNull();
    const unprinted = { ...alone('s1', 'a'), unprintedAfter: ['A'] };
    expect(boundaryReason([unprinted, alone('s2', 'b')], 1)).toEqual({
      kind: 'words',
      textId: 'A',
    });
  });

  it('measures the reach of a transposition in words, past a segment shorter than it', () => {
    const edition = text('E', 's1: a b c d e f', 's2: g', 's3: h i j k l m');
    // A departs at the end of s1 and at the start of s3, and reads s2 as the edition does.
    const { passages } = collatePassages(edition, [
      text('A', 's1: a b c d e h', 's2: g', 's3: f i j k l m'),
    ]);
    expect(ids(passages)).toEqual([['s1', 's2', 's3']]);
    // With a longer segment between, the departures are too far apart.
    const longer = text('E', 's1: a b c d e f', 's2: g n o p q', 's3: h i j k l m');
    expect(
      ids(
        collatePassages(longer, [text('A', 's1: a b c d e h', 's2: g n o p q', 's3: f i j k l m')])
          .passages,
      ),
    ).toEqual([['s1'], ['s2'], ['s3']]);
  });

  it('links a word a witness has moved past a passage between', () => {
    const edition = text('E', 's1: a b c d e f g h', 's2: i j k l m n o p', 's3: q r s t u v w x');
    const { passages } = collatePassages(edition, [
      text('A', 's1: b c d e f g h', 's2: i j k l m n o p', 's3: q r s t a u v w x'),
      text('B', 's1: a b c d e f g h', 's2: i j k l m n o p', 's3: q r s t u v w x'),
    ]);
    expect(ids(passages)).toEqual([['s1'], ['s2'], ['s3']]);
    expect(passages[0]!.collation.sites[0]!.transposition).toEqual({
      withSite: 0,
      textIds: ['A'],
      inPassage: 's3',
    });
  });

  it('takes a segment without words in a witness together with its neighbours', () => {
    const inputs = passageInputs([
      {
        segmentId: 's1',
        base: { id: 'E', siglum: 'ed.', units: [{ text: 'a', tokenIds: ['e1'] }] },
        witnesses: [{ id: 'A', siglum: 'A', units: [], present: true }],
      },
      {
        segmentId: 's2',
        base: { id: 'E', siglum: 'ed.', units: [{ text: 'b', tokenIds: ['e2'] }] },
        witnesses: [{ id: 'A', siglum: 'A', units: [{ text: 'b', tokenIds: ['a1'] }] }],
      },
      {
        segmentId: 's3',
        base: { id: 'E', siglum: 'ed.', units: [{ text: 'c', tokenIds: ['e3'] }] },
        witnesses: [],
      },
    ]);
    // A runs on without s1, has s2, and has no text for s3.
    expect(inputs.witnesses).toEqual([
      {
        id: 'A',
        siglum: 'A',
        units: [{ text: 'b', tokenIds: ['a1'], segmentId: 's2' }],
        present: true,
        notThere: [{ from: 2, to: 3 }],
      },
    ]);
    const c = collate(inputs.base, inputs.witnesses, { segmentStarts: inputs.segmentStarts });
    expect(summary(c)).toEqual(['a ed : om. A']);
    expect(c.sites[0]!.wanting).toBe(true);
  });
});
