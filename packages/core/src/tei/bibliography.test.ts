import { describe, expect, it } from 'vitest';
import type { BibEntry } from '../bib/biblatex.ts';
import { biblStructXml } from './bibliography.ts';

const entry = (type: string, fields: Record<string, string>): BibEntry => ({
  type,
  key: 'k',
  fields,
});

describe('a work of the bibliography as a biblStruct', () => {
  it('writes a book as a monograph: who wrote and edited it, its title, edition and imprint, its series', () => {
    const xml = biblStructXml(
      entry('book', {
        author: 'West, Martin L.',
        editor: 'Allen, Thomas W. and others',
        title: 'Homeri Ilias',
        subtitle: 'Volumen prius',
        edition: '2',
        location: 'Stuttgart',
        publisher: 'Teubner',
        date: '1998',
        series: 'Bibliotheca Teubneriana',
        number: '12',
        volume: '1',
        isbn: '3-519-01431-9',
        doi: 'https://doi.org/10.1515/9783110951561',
      }),
      { id: '01JBOOK', label: 'West 1998' },
    );
    expect(xml).toBe(
      [
        '<biblStruct xml:id="bib-01JBOOK" type="book" n="West 1998">',
        '<monogr>',
        '<author><forename>Martin L.</forename> <surname>West</surname></author>',
        '<editor><forename>Thomas W.</forename> <surname>Allen</surname></editor>',
        '<title level="m">Homeri Ilias: Volumen prius</title>',
        '<idno type="ISBN">3-519-01431-9</idno>',
        '<idno type="DOI">10.1515/9783110951561</idno>',
        '<edition>2</edition>',
        '<imprint><pubPlace>Stuttgart</pubPlace><publisher>Teubner</publisher><date when="1998">1998</date></imprint>',
        '<biblScope unit="volume">1</biblScope>',
        '</monogr>',
        '<series><title level="s">Bibliotheca Teubneriana</title><biblScope unit="volume">12</biblScope></series>',
        '</biblStruct>',
      ].join(''),
    );
  });

  it('writes an article as a part of its journal: volume, issue and pages with the date in the imprint', () => {
    const xml = biblStructXml(
      entry('article', {
        author: 'Wilamowitz-Moellendorff, Ulrich von',
        title: 'Lesefrüchte',
        journaltitle: 'Hermes',
        volume: '62',
        number: '3',
        pages: '276--298',
        year: '1927',
        doi: '10.1000/example',
        url: 'https://example.org/hermes/62',
      }),
      { id: 'A1' },
    );
    expect(xml).toBe(
      [
        '<biblStruct xml:id="bib-A1" type="article">',
        '<analytic>',
        '<author><forename>Ulrich von</forename> <surname>Wilamowitz-Moellendorff</surname></author>',
        '<title level="a">Lesefrüchte</title>',
        '<idno type="DOI">10.1000/example</idno>',
        '</analytic>',
        '<monogr>',
        '<title level="j">Hermes</title>',
        '<imprint><biblScope unit="volume">62</biblScope><biblScope unit="issue">3</biblScope><biblScope unit="page" from="276" to="298">276–298</biblScope><date when="1927">1927</date></imprint>',
        '</monogr>',
        '<ptr target="https://example.org/hermes/62"/>',
        '</biblStruct>',
      ].join(''),
    );
  });

  it('writes a chapter as a part of its book, the book’s editors with the book', () => {
    const xml = biblStructXml(
      entry('incollection', {
        author: 'Dover, K. J.',
        title: 'The Chorus',
        booktitle: 'Aristophanic Comedy',
        editor: 'Henderson, Jeffrey',
        pages: '10-20',
        publisher: 'Clarendon Press',
        location: 'Oxford',
        date: '1987-05',
      }),
      { id: 'C1' },
    );
    expect(xml).toContain(
      '<analytic><author><forename>K. J.</forename> <surname>Dover</surname></author><title level="a">The Chorus</title></analytic>',
    );
    expect(xml).toContain(
      '<monogr><editor><forename>Jeffrey</forename> <surname>Henderson</surname></editor><title level="m">Aristophanic Comedy</title><imprint><pubPlace>Oxford</pubPlace><publisher>Clarendon Press</publisher><date when="1987-05">1987-05</date></imprint><biblScope unit="page" from="10" to="20">10–20</biblScope></monogr>',
    );
  });

  it('writes a thesis as unpublished, with its institution, a body as it is named, and a date that is no date as it stands', () => {
    const xml = biblStructXml(
      entry('thesis', {
        author: '{Deutsches Archäologisches Institut}',
        title: 'Die Überlieferung',
        institution: 'Universität Oslo',
        date: 'forthcoming',
      }),
      { id: 'T1' },
    );
    expect(xml).toContain('<author>Deutsches Archäologisches Institut</author>');
    expect(xml).toContain('<title level="u">Die Überlieferung</title>');
    expect(xml).toContain(
      '<imprint><publisher>Universität Oslo</publisher><date>forthcoming</date></imprint>',
    );
  });

  it('keeps to what TEI asks for where the entry lacks it: an imprint that says nothing, a title after a name', () => {
    expect(biblStructXml(entry('misc', {}), { id: 'M1' })).toBe(
      '<biblStruct xml:id="bib-M1" type="misc"><monogr><imprint><date/></imprint></monogr></biblStruct>',
    );
    expect(biblStructXml(entry('book', { author: 'Homer' }), { id: 'M2' })).toBe(
      '<biblStruct xml:id="bib-M2" type="book"><monogr><author>Homer</author><title level="m"/><imprint><date/></imprint></monogr></biblStruct>',
    );
    // An address with a space in it is no pointer, and a type that is no name is not written.
    const odd = biblStructXml(entry('my type', { title: 'A & B', url: 'see the web' }), {
      id: 'M3',
    });
    expect(odd).toBe(
      '<biblStruct xml:id="bib-M3"><monogr><title level="m">A &amp; B</title><imprint><date/></imprint></monogr></biblStruct>',
    );
  });
});
