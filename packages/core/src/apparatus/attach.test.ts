import { describe, expect, it } from 'vitest';
import { collate, witnessesAt, type CollationText } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { fromText } from '../stream/text.ts';
import { units } from '../stream/words.ts';
import { attachToSites, lemmaOccursIn } from './attach.ts';

function witness(id: string, siglum: string, text: string): CollationText {
  const s = fromText(text, { lang: 'grc', ids: sequentialIds(id) });
  return { id, siglum, units: units(s, 0, s.items.length) };
}

describe('attachToSites', () => {
  it('places a conjecture by its lemma, and marks one whose reading is printed as adopted', () => {
    const edition = fromText('οἰωνοῖσί τε δαῖτα Διὸς', { lang: 'grc', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      witness('A', 'A', 'οἰωνοῖσί τε πᾶσι Διὸς'),
    ]);
    const attached = attachToSites(c, baseUnits, [
      {
        id: 'z',
        kind: 'conjecture',
        lemma: 'πᾶσι',
        reading: 'δαῖτα',
        name: 'Zenodotus',
        conjectureKind: 'substitution',
      },
      {
        id: 'b',
        kind: 'conjecture',
        lemma: 'πᾶσι',
        reading: 'πάντα',
        name: 'Berge',
        conjectureKind: 'substitution',
      },
      { id: 'x', kind: 'conjecture', lemma: 'nowhere', reading: 'else', name: 'Nobody' },
    ]);
    expect(attached.bySite[0]!.map((a) => [a.name, a.adopted ?? false])).toEqual([
      ['Zenodotus', true],
      ['Berge', false],
    ]);
    expect(attached.unplaced.map((a) => a.name)).toEqual(['Nobody']);
  });

  it('opens a site for a conjecture on words every witness agrees about', () => {
    const edition = fromText('οἰωνοῖσί τε πᾶσι Διὸς', { lang: 'grc', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      witness('A', 'A', 'οἰωνοῖσί τε πᾶσι Διὸς'),
      witness('B', 'B', 'οἰωνοῖσί τε πᾶσι Διός'),
    ]);
    const attached = attachToSites(c, baseUnits, [
      {
        id: 'z',
        kind: 'conjecture',
        lemma: 'πᾶσι',
        reading: 'δαῖτα',
        name: 'Zenodotus',
        conjectureKind: 'substitution',
      },
    ]);
    expect(attached.collation.sites).toHaveLength(c.sites.length + 1);
    const opened = attached.collation.sites[attached.collation.sites.length - 1]!;
    expect(opened.baseFrom).toBe(2);
    expect(opened.readings[0]!.sigla).toEqual(['ed.', 'A', 'B']);
    expect(attached.bySite[opened.index]![0]!.name).toBe('Zenodotus');
    expect(attached.unplaced).toEqual([]);
    expect(opened.kind).toBe('textual');
    const accented = attachToSites(c, baseUnits, [
      {
        id: 'y',
        kind: 'conjecture',
        lemma: 'πᾶσι',
        reading: 'πασί',
        name: 'Someone',
        conjectureKind: 'substitution',
      },
    ]);
    expect(accented.collation.sites[accented.collation.sites.length - 1]!.kind).toBe(
      'interpretative',
    );
  });

  it('leaves a witness that has lost the words out of a site opened for a conjecture', () => {
    const edition = fromText('a b c d', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const lost = fromText('a d', { lang: 'en', ids: sequentialIds('p') });
    lost.items.splice(1, 0, { kind: 'object', id: 'g', type: 'gap', attrs: { reason: 'lost' } });
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      witness('A', 'A', 'a b c d'),
      { id: 'P', siglum: 'P', units: units(lost, 0, lost.items.length) },
      witness('Q', 'Q', 'a b c d'),
    ]);
    expect(c.sites).toEqual([]);
    const attached = attachToSites(c, baseUnits, [
      { id: 'z', kind: 'conjecture', lemma: 'b c', reading: 'y', name: 'Z' },
    ]);
    const opened = attached.collation.sites[0]!;
    expect(opened.readings[0]!.sigla).toEqual(['ed.', 'A', 'Q']);
    expect(witnessesAt(opened, 'E', ['A', 'P', 'Q'])).toEqual(['A', 'Q']);
  });

  it('places a reported reading by the base words, and a record by its anchor tokens', () => {
    const edition = fromText('a b c', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [witness('A', 'A', 'a x c')]);
    const attached = attachToSites(c, baseUnits, [
      { id: 'r', kind: 'reported', lemma: 'b', reading: 'y', name: 'T', source: '(Allen)' },
      {
        id: 'k',
        kind: 'conjecture',
        lemma: 'other',
        reading: 'z',
        name: 'K',
        anchorTokenIds: ['e2'],
      },
    ]);
    expect(attached.bySite[0]!.map((a) => a.id)).toEqual(['r', 'k']);
  });

  it('keeps a record on one word off the site over the whole segment', () => {
    const edition = fromText('a b c', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    // B's text runs on without the segment, which makes the site over all of it.
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      witness('A', 'A', 'a b c'),
      { id: 'B', siglum: 'B', units: [], present: true },
    ]);
    const whole = c.sites.find((site) => site.wanting)!;
    expect(whole).toBeDefined();
    const attached = attachToSites(c, baseUnits, [
      {
        id: 'k',
        kind: 'conjecture',
        lemma: 'b',
        reading: 'z',
        name: 'K',
        conjectureKind: 'substitution',
        anchorTokenIds: ['e2'],
      },
      // Its lemma no longer stands in the text: it is listed at the segment, not placed on the whole of it.
      {
        id: 'm',
        kind: 'conjecture',
        lemma: 'other',
        reading: 'y',
        name: 'M',
        anchorTokenIds: ['e3'],
      },
      // A record on the whole segment is placed on it.
      {
        id: 'w',
        kind: 'conjecture',
        lemma: 'a b c',
        reading: '',
        name: 'W',
        anchorTokenIds: ['e1'],
      },
    ]);
    expect(attached.bySite[whole.index]?.map((a) => a.id)).toEqual(['w']);
    const opened = attached.collation.sites[attached.collation.sites.length - 1]!;
    expect([opened.baseFrom, opened.baseTo]).toEqual([1, 2]);
    expect(attached.bySite[opened.index]!.map((a) => a.id)).toEqual(['k']);
    expect(attached.unplaced.map((a) => a.id)).toEqual(['m']);
  });

  it('opens the site at the occurrence the anchor names when the words stand twice', () => {
    const edition = fromText('a b a c', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [witness('A', 'A', 'a b a c')]);
    const attached = attachToSites(c, baseUnits, [
      { id: 'k', kind: 'conjecture', lemma: 'a', reading: 'z', name: 'K', anchorTokenIds: ['e3'] },
    ]);
    const opened = attached.collation.sites[attached.collation.sites.length - 1]!;
    expect([opened.baseFrom, opened.baseTo]).toEqual([2, 3]);
  });

  it('finds where a lemma occurs in a segment', () => {
    const edition = fromText('the quick brown fox', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    expect(lemmaOccursIn(baseUnits, 'quick brown')).toEqual([{ from: 1, to: 3 }]);
    expect(lemmaOccursIn(baseUnits, 'Fox')).toEqual([{ from: 3, to: 4 }]);
    expect(lemmaOccursIn(baseUnits, 'cat')).toEqual([]);
  });
});

describe('attachToSites in a passage of several segments', () => {
  it('looks for a lemma among the units of its own segment only', () => {
    // Two segments, the same word in each; a witness reads it otherwise in both.
    const edition = fromText('a b c a d', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      witness('A', 'A', 'x b c x d'),
    ]);
    const candidate = { id: 'k', kind: 'conjecture' as const, lemma: 'a', reading: 'y', name: 'K' };
    const where = (range?: { from: number; to: number }) => {
      const attached = attachToSites(c, baseUnits, [range ? { ...candidate, range } : candidate]);
      return Object.keys(attached.bySite).map((k) => {
        const site = attached.collation.sites[Number(k)]!;
        return [site.baseFrom, site.baseTo];
      });
    };
    expect(where()).toEqual([[0, 1]]);
    expect(where({ from: 0, to: 3 })).toEqual([[0, 1]]);
    expect(where({ from: 3, to: 5 })).toEqual([[3, 4]]);
    // Words the witnesses agree on: a site is opened within the segment, and not in another.
    const agreed = attachToSites(c, baseUnits, [
      { ...candidate, lemma: 'd', range: { from: 3, to: 5 } },
      { ...candidate, id: 'm', lemma: 'd', range: { from: 0, to: 3 } },
    ]);
    expect(agreed.collation.sites.at(-1)).toMatchObject({ baseFrom: 4, baseTo: 5 });
    expect(agreed.unplaced.map((a) => a.id)).toEqual(['m']);
  });
});
