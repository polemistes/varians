import { describe, expect, it } from 'vitest';
import { collate, type CollationText } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { fromText } from '../stream/text.ts';
import { units } from '../stream/words.ts';
import { attachToSites, lemmaOccursIn } from './attach.ts';

function witness(id: string, siglum: string, text: string): CollationText {
  const s = fromText(text, { ids: sequentialIds(id) });
  return { id, siglum, units: units(s, 0, s.items.length) };
}

describe('attachToSites', () => {
  it('places a conjecture by its lemma, and marks one whose reading is printed as adopted', () => {
    const edition = fromText('οἰωνοῖσί τε δαῖτα Διὸς', { ids: sequentialIds('e') });
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
    const edition = fromText('οἰωνοῖσί τε πᾶσι Διὸς', { ids: sequentialIds('e') });
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

  it('places a reported reading by the base words, and a record by its anchor tokens', () => {
    const edition = fromText('a b c', { ids: sequentialIds('e') });
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

  it('finds where a lemma occurs in a segment', () => {
    const edition = fromText('the quick brown fox', { ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    expect(lemmaOccursIn(baseUnits, 'quick brown')).toEqual([{ from: 1, to: 3 }]);
    expect(lemmaOccursIn(baseUnits, 'Fox')).toEqual([{ from: 3, to: 4 }]);
    expect(lemmaOccursIn(baseUnits, 'cat')).toEqual([]);
  });
});
