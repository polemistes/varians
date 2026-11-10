import { describe, expect, it } from 'vitest';
import { collate, type CollationText } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { applyOps } from '../stream/ops.ts';
import { fromText, toText } from '../stream/text.ts';
import { units, type Unit } from '../stream/words.ts';
import { adoptConjecture, adoptReading, replaceAtSite } from './adopt.ts';

function witness(id: string, siglum: string, text: string): CollationText {
  const stream = fromText(text, { ids: sequentialIds(id) });
  return { id, siglum, units: units(stream, 0, stream.items.length) };
}

describe('adopting', () => {
  it('replaces the edition’s words by a witness’s reading, with provenance', () => {
    const edition = fromText('the quick brown fox', { ids: sequentialIds('e') });
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
    const edition = fromText('the quick brown fox', { ids: sequentialIds('e') });
    (edition.items[0] as { segment?: unknown }).segment = { segmentId: 's1' };
    const baseUnits: Unit[] = units(edition, 0, edition.items.length);
    const stream = fromText('the quick brown fox', { ids: sequentialIds('B') });
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
    const edition = fromText('the quick fox', { ids: sequentialIds('e') });
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
    const edition = fromText('the quick fox\njumps over', { ids: sequentialIds('e') });
    (edition.items[0] as { segment?: unknown }).segment = { segmentId: 's1' };
    (edition.items[4] as { segment?: unknown }).segment = { segmentId: 's2' };
    const baseUnits = units(edition, 0, 3);
    const c = collate({ id: 'E', siglum: 'ed', units: baseUnits }, [
      { id: 'B', siglum: 'B', units: [], present: true },
    ]);
    const site = c.sites.find((x) => x.wanting)!;
    const omission = site.readings.find((r) => r.omission)!;
    const { stream } = applyOps(edition, adoptReading(edition, site, baseUnits, omission, 'B'));
    expect(toText(stream)).toBe('\njumps over');
    expect((stream.items[1] as { segment?: unknown }).segment).toEqual({ segmentId: 's2' });
  });

  it('adopts an addition by inserting after the preceding word', () => {
    const edition = fromText('the quick fox', { ids: sequentialIds('e') });
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
    const edition = fromText('οἰωνοῖσί τε πᾶσι Διὸς', { ids: sequentialIds('e') });
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

  it('replaces a discontinuous site piecewise', () => {
    const edition = fromText('a b c d', { ids: sequentialIds('e') });
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
