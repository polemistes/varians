import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Stream } from './items.ts';
import { fromText } from './text.ts';
import { lines, runsOfSegment, segmentIds, segmentRuns, segmentUnits, units, words } from './words.ts';

function withSegments(): Stream {
  const s = fromText('μῆνιν ἄειδε θεὰ\nοὐλομένην ἣ\nπολλὰς δ᾽', { ids: sequentialIds() });
  // t1 t2 t3 | t4 (break) t5 t6 | t7 (break) t8 t9
  (s.items[0] as { segment?: unknown }).segment = { segmentId: 's1' };
  (s.items[4] as { segment?: unknown }).segment = { segmentId: 's2' };
  (s.items[7] as { segment?: unknown }).segment = { segmentId: 's3' };
  return s;
}

describe('words', () => {
  it('reads one token as one word and joined tokens as one word across a break', () => {
    const s = fromText('ἄνδ-\nρα μοι', { ids: sequentialIds(), hyphenJoins: true });
    const w = words(s);
    expect(w.map((x) => x.form)).toEqual(['ἄνδρα', 'μοι']);
    expect(w[0]!.tokens.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('uses the first token’s read form for the whole word', () => {
    const s = fromText('ἄνδ-\nρα', { ids: sequentialIds(), hyphenJoins: true });
    (s.items[0] as { norm?: string }).norm = 'ἄνδρας';
    expect(words(s)[0]!.norm).toBe('ἄνδρας');
  });
});

describe('segmentRuns', () => {
  it('divides a stream at its segment starts', () => {
    const runs = segmentRuns(withSegments());
    expect(runs.map((r) => [r.segmentId, r.from, r.to])).toEqual([
      ['s1', 0, 4],
      ['s2', 4, 7],
      ['s3', 7, 9],
    ]);
    expect(segmentIds(withSegments())).toEqual(['s1', 's2', 's3']);
  });

  it('treats text before the first start as unassigned', () => {
    const s = fromText('a b\nc', { ids: sequentialIds() });
    (s.items[3] as { segment?: unknown }).segment = { segmentId: 's1' };
    expect(segmentRuns(s).map((r) => r.segmentId)).toEqual([null, 's1']);
  });

  it('orders a segment’s runs by part, not by position', () => {
    const s = fromText('one two three four', { ids: sequentialIds() });
    (s.items[0] as { segment?: unknown }).segment = { segmentId: 's1', part: 2 };
    (s.items[2] as { segment?: unknown }).segment = { segmentId: 's1', part: 1 };
    expect(runsOfSegment(s, 's1').map((r) => r.from)).toEqual([2, 0]);
    expect(segmentUnits(s, 's1').map((u) => u.text)).toEqual(['three', 'four', 'one', 'two']);
  });
});

describe('units', () => {
  it('divides a read form with spaces into several units sharing the token', () => {
    const s = fromText('ΚΑΓΩ εἶπον', { ids: sequentialIds() });
    (s.items[0] as { norm?: string }).norm = 'καὶ ἐγώ';
    const u = units(s, 0, s.items.length);
    expect(u.map((x) => x.text)).toEqual(['καὶ', 'ἐγώ', 'εἶπον']);
    expect(u[0]!.tokenIds).toEqual(['t1']);
    expect(u[1]!.tokenIds).toEqual(['t1']);
  });

  it('leaves out words the scribe deleted, and in the original state words the scribe added', () => {
    const s = fromText('a b c', { ids: sequentialIds() });
    (s.items[1] as { marks?: unknown }).marks = [{ kind: 'del' }];
    (s.items[2] as { marks?: unknown }).marks = [{ kind: 'add', attrs: { place: 'above' } }];
    expect(units(s, 0, 3).map((u) => u.text)).toEqual(['a', 'c']);
    expect(units(s, 0, 3, 'original').map((u) => u.text)).toEqual(['a', 'b']);
  });

  it('reads the variants noted in the carrier in place of the words they concern', () => {
    const s = fromText('a b c d e', { ids: sequentialIds() });
    const variant = (group: string, reading: string) => ({ kind: 'variant', attrs: { group, reading, place: 'margin' } });
    (s.items[1] as { marks?: unknown }).marks = [variant('g1', 'x y z')];
    (s.items[2] as { marks?: unknown }).marks = [variant('g1', 'x y z')];
    (s.items[4] as { marks?: unknown }).marks = [{ kind: 'del' }];
    const u = units(s, 0, s.items.length, 'variant');
    expect(u.map((x) => x.text)).toEqual(['a', 'x', 'y', 'z', 'd']);
    expect(u[1]!.tokenIds).toEqual(['t2', 't3']);
    // The other states do not see the variant.
    expect(units(s, 0, s.items.length).map((x) => x.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(units(s, 0, s.items.length, 'original').map((x) => x.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('reads nothing for a variant that leaves the words out, and keeps neighbouring variants apart', () => {
    const s = fromText('a b c d', { ids: sequentialIds() });
    (s.items[1] as { marks?: unknown }).marks = [{ kind: 'variant', attrs: { group: 'g1', reading: '', place: 'interlinear' } }];
    (s.items[2] as { marks?: unknown }).marks = [{ kind: 'variant', attrs: { group: 'g2', reading: 'q', place: 'margin' } }];
    expect(units(s, 0, s.items.length, 'variant').map((x) => x.text)).toEqual(['a', 'q', 'd']);
  });

  it('reads a variant across a line break once, where its span begins', () => {
    const s = fromText('a b\nc d', { ids: sequentialIds() });
    const mark = { kind: 'variant', attrs: { group: 'g', reading: 'bc', place: 'margin' } };
    const tokens = s.items.filter((i) => i.kind === 'token');
    (tokens[1] as { marks?: unknown }).marks = [mark];
    (tokens[2] as { marks?: unknown }).marks = [mark];
    expect(units(s, 0, s.items.length, 'variant').map((x) => x.text)).toEqual(['a', 'bc', 'd']);
    // A stretch that begins inside the span leaves the variant to the stretch where it begins.
    const second = s.items.indexOf(tokens[2]!);
    expect(units(s, second, s.items.length, 'variant').map((x) => x.text)).toEqual(['d']);
  });

  it('keeps a gap as a unit of its own', () => {
    const s = fromText('a c', { ids: sequentialIds() });
    s.items.splice(1, 0, { kind: 'object', id: 'g1', type: 'gap', attrs: { reason: 'lost', quantity: 3 } });
    const u = units(s, 0, 3);
    expect(u.map((x) => x.text)).toEqual(['a', '', 'c']);
    expect(u[1]!.gap?.id).toBe('g1');
  });
});

describe('lines', () => {
  it('finds the lines between breaks', () => {
    const s = withSegments();
    const l = lines(s);
    expect(l.map((x) => [x.from, x.to])).toEqual([
      [0, 3],
      [4, 6],
      [7, 9],
    ]);
    expect(l[1]!.opener?.kind).toBe('break');
  });
});

describe('units: states by stage and by hand', () => {
  it('applies the corrections of the stages up to the one asked, and those of the hands named', () => {
    const s = fromText('a b c d', { ids: sequentialIds() });
    // b added by hand h2 at stage 2; c deleted by the scribe (h1) at stage 1; d deleted by an unknown hand, no stage.
    (s.items[1] as { marks?: unknown }).marks = [{ kind: 'add', attrs: { hand: 'h2', seq: 2 } }];
    (s.items[2] as { marks?: unknown }).marks = [{ kind: 'del', attrs: { hand: 'h1', seq: 1 } }];
    (s.items[3] as { marks?: unknown }).marks = [{ kind: 'del' }];
    const text = (state: Parameters<typeof units>[3]) => units(s, 0, s.items.length, state).map((u) => u.text).join(' ');
    expect(text('corrected')).toBe('a b');
    expect(text('original')).toBe('a c d');
    expect(text({ kind: 'stage', upTo: 1 })).toBe('a d');
    expect(text({ kind: 'stage', upTo: 2 })).toBe('a b d');
    expect(text({ kind: 'hand', hands: ['h2'] })).toBe('a b c d');
    expect(text({ kind: 'hand', hands: ['h1', 'scribe'] })).toBe('a d');
    expect(text({ kind: 'hand', hands: ['other'] })).toBe('a c d');
  });
});
