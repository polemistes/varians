import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { shownBreaks } from '../edition/layout.ts';
import { fromText, toText } from './text.ts';

describe('fromText and toText', () => {
  it('round-trips words and lines', () => {
    const text = 'μῆνιν ἄειδε θεὰ\nοὐλομένην, ἣ μυρί᾽';
    expect(toText(fromText(text, { lang: 'grc', ids: sequentialIds() }))).toBe(text);
  });

  it('makes a paragraph break of a blank line when asked', () => {
    const s = fromText('a b\n\nc', { lang: 'en', ids: sequentialIds(), paragraphs: true });
    expect(
      s.items.filter((i) => i.kind === 'break').map((b) => (b as { type: string }).type),
    ).toEqual(['paragraph']);
    expect(toText(s)).toBe('a b\n\nc');
  });

  it('joins a word divided by a hyphen at the line end and prints it whole in the read form', () => {
    const s = fromText('ἄνδ-\nρα μοι', { lang: 'grc', ids: sequentialIds(), hyphenJoins: true });
    expect(toText(s)).toBe('ἄνδ\nρα μοι');
    expect(s.items[0]).toMatchObject({ form: 'ἄνδ', joinNext: true });
  });

  it('writes the hyphen of a divided word where a shown line ends, and runs prose on', () => {
    const s = fromText('ἄνδ-\nρα μοι\nἔν-\nνεπε', {
      lang: 'grc',
      ids: sequentialIds(),
      hyphenJoins: true,
    });
    expect(toText(s, { shown: shownBreaks(s.items, 'verse') })).toBe('ἄνδ-\nρα μοι\nἔν-\nνεπε');
    // Where the lines are not shown the word runs on, and so do the words either side.
    expect(toText(s, { shown: shownBreaks(s.items, 'prose') })).toBe('ἄνδρα μοι ἔννεπε');
  });

  it('prints the read form where asked', () => {
    const s = fromText('ΜΗΝΙΝ ΑΕΙΔΕ', { lang: 'grc', ids: sequentialIds() });
    (s.items[0] as { norm?: string }).norm = 'μῆνιν';
    expect(toText(s, { form: 'read' })).toBe('μῆνιν ΑΕΙΔΕ');
  });

  it('shows attested separators as written', () => {
    const s = fromText('ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ', { lang: 'grc', ids: sequentialIds() });
    (s.items[1] as { sep?: string }).sep = 'none';
    (s.items[2] as { sep?: string }).sep = 'interpunct';
    expect(toText(s, { asWritten: true })).toBe('ΜΗΝΙΝΑΕΙΔΕ·ΘΕΑ');
  });

  it('prints gaps as bracketed dots', () => {
    const s = fromText('a c', { lang: 'en', ids: sequentialIds() });
    s.items.splice(1, 0, {
      kind: 'object',
      id: 'g1',
      type: 'gap',
      attrs: { reason: 'lost', quantity: 3 },
    });
    expect(toText(s)).toBe('a [...] c');
  });
});
