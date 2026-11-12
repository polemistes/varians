import { describe, expect, it } from 'vitest';
import { collate, type CollationText } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { applyOps } from '../stream/ops.ts';
import type { Stream, Token } from '../stream/items.ts';
import { fromText, toText } from '../stream/text.ts';
import { units, type Unit } from '../stream/words.ts';
import { adoptConjecture, adoptReading, replaceAtSite } from './adopt.ts';

function witness(id: string, siglum: string, text: string): CollationText {
  const stream = fromText(text, { lang: 'grc', ids: sequentialIds(id) });
  return { id, siglum, units: units(stream, 0, stream.items.length) };
}

describe('adopting', () => {
  it('replaces the edition’s words by a witness’s reading, with provenance', () => {
    const edition = fromText('the quick brown fox', { lang: 'en', ids: sequentialIds('e') });
    (edition.items[0] as { segment?: unknown }).segment = { segmentId: 's1' };
    const baseUnits: Unit[] = units(edition, 0, edition.items.length);
    const b = witness('B', 'B', 'the slow fox');
    const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [b]);
    const site = c.sites[0]!;
    const reading = site.readings.find((r) => r.sigla.includes('B'))!;
    const ops = adoptReading(edition, site, baseUnits, reading, 'B', { ids: sequentialIds('n') });
    const { stream } = applyOps(edition, ops);
    expect(toText(stream)).toBe('the slow fox');
    const slow = stream.items[1]!;
    expect(slow).toMatchObject({
      form: 'slow',
      source: { kind: 'witness', transcriptionId: 'B', tokenIds: ['B2'] },
    });
  });

  it('adopts a variant noted in a witness with the transcription as its source', () => {
    const edition = fromText('the quick brown fox', { lang: 'en', ids: sequentialIds('e') });
    (edition.items[0] as { segment?: unknown }).segment = { segmentId: 's1' };
    const baseUnits: Unit[] = units(edition, 0, edition.items.length);
    const stream = fromText('the quick brown fox', { lang: 'en', ids: sequentialIds('B') });
    for (const index of [1, 2])
      (stream.items[index] as { marks?: unknown }).marks = [
        { kind: 'variant', attrs: { group: 'g', reading: 'swift', place: 'margin' } },
      ];
    const noted: CollationText = {
      id: 'B:variant',
      siglum: 'B v.l.',
      units: units(stream, 0, stream.items.length, 'variant'),
    };
    const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [noted]);
    const site = c.sites[0]!;
    const reading = site.readings.find((r) => r.sigla.includes('B v.l.'))!;
    const { stream: next } = applyOps(
      edition,
      adoptReading(edition, site, baseUnits, reading, 'B:variant', { ids: sequentialIds('n') }),
    );
    expect(toText(next)).toBe('the swift fox');
    expect(next.items[1]).toMatchObject({
      form: 'swift',
      source: { kind: 'witness', transcriptionId: 'B', tokenIds: ['B2', 'B3'] },
    });
  });

  it('adopts an omission by removing the words and keeps the segment start', () => {
    const edition = fromText('the quick fox', { lang: 'en', ids: sequentialIds('e') });
    (edition.items[0] as { segment?: unknown }).segment = { segmentId: 's1' };
    const baseUnits = units(edition, 0, edition.items.length);
    const b = witness('B', 'B', 'quick fox');
    const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [b]);
    const site = c.sites[0]!;
    const omission = site.readings.find((r) => r.omission)!;
    const { stream } = applyOps(edition, adoptReading(edition, site, baseUnits, omission, 'B'));
    expect(toText(stream)).toBe('quick fox');
    expect((stream.items[0] as { segment?: unknown }).segment).toEqual({ segmentId: 's1' });
  });

  it('adopts the omission of a whole segment without taking the next segment', () => {
    const edition = fromText('the quick fox\njumps over', { lang: 'en', ids: sequentialIds('e') });
    (edition.items[0] as { segment?: unknown }).segment = { segmentId: 's1' };
    (edition.items[4] as { segment?: unknown }).segment = { segmentId: 's2' };
    const baseUnits = units(edition, 0, 3);
    const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [
      { id: 'B', siglum: 'B', units: [], present: true },
    ]);
    const site = c.sites.find((x) => x.wanting)!;
    const omission = site.readings.find((r) => r.omission)!;
    const { stream } = applyOps(edition, adoptReading(edition, site, baseUnits, omission, 'B'));
    expect(toText(stream)).toBe('jumps over');
    expect((stream.items[0] as { segment?: unknown }).segment).toEqual({ segmentId: 's2' });
  });

  describe('the absence of a whole line', () => {
    /** The stream with these items starting segments `s1`, `s2`…, and what adopting that B has nothing at items `from` to `to` leaves of it. */
    function absent(edition: Stream, starts: number[], from: number, to: number): Stream {
      starts.forEach((at, k) => {
        (edition.items[at] as { segment?: unknown }).segment = { segmentId: `s${k + 1}` };
      });
      const baseUnits = units(edition, from, to);
      const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [
        { id: 'B', siglum: 'B', units: [], present: true },
      ]);
      const site = c.sites.find((x) => x.wanting)!;
      const omission = site.readings.find((r) => r.omission)!;
      return applyOps(edition, adoptReading(edition, site, baseUnits, omission, 'B')).stream;
    }
    const lines = () =>
      fromText('one two\nthree four\nfive', { lang: 'en', ids: sequentialIds('e') });
    // one(0) two(1) /(2) three(3) four(4) /(5) five(6)

    it('takes its line break with it, from the middle, the start and the end of the text', () => {
      expect(toText(absent(lines(), [0, 3, 6], 3, 5))).toBe('one two\nfive');
      expect(toText(absent(lines(), [0, 3, 6], 0, 2))).toBe('three four\nfive');
      expect(toText(absent(lines(), [0, 3, 6], 6, 7))).toBe('one two\nthree four');
    });

    it('leaves nothing of a text that is that one line', () => {
      expect(
        toText(absent(fromText('one two', { lang: 'en', ids: sequentialIds('e') }), [0], 0, 2)),
      ).toBe('');
    });

    it('takes a line at the end of a page and one at the start of the next, as the page breaks stand', () => {
      const pages = (): Stream => ({
        items: [
          { kind: 'token', id: 'a1', form: 'a1' },
          { kind: 'break', id: 'l1', type: 'line' },
          { kind: 'token', id: 'b1', form: 'b1' },
          { kind: 'break', id: 'p2', type: 'page', pageId: 'P2' },
          { kind: 'token', id: 'c1', form: 'c1' },
          { kind: 'break', id: 'l2', type: 'line' },
          { kind: 'token', id: 'd1', form: 'd1' },
        ],
      });
      const ids = (stream: Stream) => stream.items.map((item) => item.id);
      expect(ids(absent(pages(), [0, 2, 4, 6], 2, 3))).toEqual(['a1', 'p2', 'c1', 'l2', 'd1']);
      expect(ids(absent(pages(), [0, 2, 4, 6], 4, 5))).toEqual(['a1', 'l1', 'b1', 'p2', 'd1']);
    });

    it('leaves the line breaks where other words stand on the line', () => {
      const shared = () => fromText('one two three\nfour', { lang: 'en', ids: sequentialIds('e') });
      // one(0) two(1) three(2) /(3) four(4), where s2 is the last word of the first line.
      expect(toText(absent(shared(), [0, 2, 4], 2, 3))).toBe('one two\nfour');
      expect(toText(absent(shared(), [0, 2, 4], 0, 2))).toBe('three\nfour');
    });

    it('leaves a line holding something besides the words as a line', () => {
      const marked = (): Stream => ({
        items: [
          { kind: 'token', id: 'a1', form: 'a1' },
          { kind: 'object', id: 'o1', type: 'lacuna' },
          { kind: 'break', id: 'l1', type: 'line' },
          { kind: 'token', id: 'b1', form: 'b1' },
        ],
      });
      expect(absent(marked(), [0, 3], 0, 1).items.map((item) => item.id)).toEqual([
        'o1',
        'l1',
        'b1',
      ]);
    });
  });

  it('adopts an addition by inserting after the preceding word', () => {
    const edition = fromText('the quick fox', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = witness('C', 'C', 'the quick brown fox');
    const col = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [c]);
    const site = col.sites[0]!;
    const reading = site.readings.find((r) => r.sigla.includes('C'))!;
    const { stream } = applyOps(
      edition,
      adoptReading(edition, site, baseUnits, reading, 'C', { ids: sequentialIds('n') }),
    );
    expect(toText(stream)).toBe('the quick brown fox');
  });

  it('adopts a conjecture, a supplement and a lacuna', () => {
    const edition = fromText('οἰωνοῖσί τε πᾶσι Διὸς', { lang: 'grc', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const a = witness('A', 'A', 'οἰωνοῖσί τε πάντα Διὸς');
    const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [a]);
    const site = c.sites[0]!;
    const conj = applyOps(
      edition,
      adoptConjecture(
        edition,
        site,
        baseUnits,
        { id: 'c1', reading: 'δαῖτα', kind: 'substitution' },
        { ids: sequentialIds('n') },
      ),
    );
    expect(toText(conj.stream)).toBe('οἰωνοῖσί τε δαῖτα Διὸς');
    expect(conj.stream.items[2]).toMatchObject({
      source: { kind: 'conjecture', conjectureId: 'c1' },
    });
    const suppl = applyOps(
      edition,
      adoptConjecture(
        edition,
        site,
        baseUnits,
        { id: 'c2', reading: 'δαῖτα', kind: 'supplement' },
        { ids: sequentialIds('n') },
      ),
    );
    expect((suppl.stream.items[2] as { marks?: unknown[] }).marks).toEqual([
      { kind: 'supplied', attrs: { resp: 'c2' } },
    ]);
    const lac = applyOps(
      edition,
      adoptConjecture(
        edition,
        site,
        baseUnits,
        { id: 'c3', reading: '', kind: 'lacuna' },
        { ids: sequentialIds('n') },
      ),
    );
    expect(lac.stream.items[2]).toMatchObject({ kind: 'object', type: 'lacuna' });
  });

  it('gives adopted words the language the witness gives them, and a conjecture’s the language of the place', () => {
    const edition = fromText('arma virumque cano', { lang: 'la', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const greek = fromText('arma ἄνδρα cano', { lang: 'grc', ids: sequentialIds('G') });
    const g: CollationText = { id: 'G', siglum: 'G', units: units(greek, 0, greek.items.length) };
    const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [g]);
    const site = c.sites[0]!;
    const reading = site.readings.find((r) => r.textIds.includes('G'))!;
    const adopted = applyOps(
      edition,
      adoptReading(edition, site, baseUnits, reading, 'G', { ids: sequentialIds('n') }),
    ).stream;
    expect(adopted.items.map((i) => (i.kind === 'token' ? `${i.form}:${i.lang}` : ''))).toEqual([
      'arma:la',
      'ἄνδρα:grc',
      'cano:la',
    ]);
    const conjectured = applyOps(
      edition,
      adoptConjecture(
        edition,
        site,
        baseUnits,
        { id: 'c1', reading: 'virum', kind: 'substitution' },
        { ids: sequentialIds('n') },
      ),
    ).stream;
    expect((conjectured.items[1] as Token).lang).toBe('la');
  });

  it('replaces a discontinuous site piecewise', () => {
    const edition = fromText('a b c d', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const site = {
      index: 0,
      columnFrom: 0,
      columnTo: 0,
      baseFrom: 1,
      baseTo: 3,
      readings: [],
      kind: 'textual' as const,
    };
    const ops = replaceAtSite(edition, site, baseUnits, [{ kind: 'token', id: 'n1', form: 'x' }]);
    expect(toText(applyOps(edition, ops).stream)).toBe('a x d');
  });
});
