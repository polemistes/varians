import { describe, expect, it } from 'vitest';
import {
  citationLabel,
  disambiguateLabels,
  latexToUnicode,
  parseBiblatex,
  parseNames,
  serializeBiblatex,
  serializeNames,
  type BibEntry,
} from './biblatex.ts';

describe('parseBiblatex', () => {
  it('reads every value form: braced, quoted, bare, macros and concatenation', () => {
    const result = parseBiblatex(`
      @string{cq = "Classical Quarterly"}
      @comment{ignored {with braces}}
      @preamble{"\\newcommand{\\noop}[1]{}"}
      Stray text between entries is ignored.
      @Article{dover1972,
        Author = {Dover, K. J. and {Oxford Classical Texts}},
        title  = "Aristophanes {and} the
                  {Clouds}",
        journal = cq,
        volume = 22,
        pages = {1--10},
        date = "19" # "72",
      }
    `);
    expect(result.warnings).toEqual([]);
    expect(result.entries).toEqual([
      {
        type: 'article',
        key: 'dover1972',
        fields: {
          author: 'Dover, K. J. and {Oxford Classical Texts}',
          title: 'Aristophanes {and} the {Clouds}',
          journaltitle: 'Classical Quarterly',
          volume: '22',
          pages: '1--10',
          date: '1972',
        },
      },
    ]);
  });

  it('maps BibTeX aliases onto biblatex and makes a date of year and month', () => {
    const result = parseBiblatex(`
      @phdthesis{smith2001,
        author = {Smith, Jane},
        title = {A Thesis},
        school = {Oxford},
        address = {Oxford},
        year = 2001,
        month = may,
      }
      @mastersthesis{jones1999, author = {Jones, A.}, title = {Another}, year = {1999}, type = {Diplomarbeit}}
      @book{old, title = {Old}, year = {c. 1850}, month = {2}}
    `);
    expect(result.warnings).toEqual([]);
    expect(result.entries[0]).toEqual({
      type: 'thesis',
      key: 'smith2001',
      fields: {
        author: 'Smith, Jane',
        title: 'A Thesis',
        institution: 'Oxford',
        location: 'Oxford',
        date: '2001-05',
        type: 'phdthesis',
      },
    });
    expect(result.entries[1]?.fields).toEqual({
      author: 'Jones, A.',
      title: 'Another',
      date: '1999',
      type: 'Diplomarbeit',
    });
    expect(result.entries[2]?.fields).toEqual({ title: 'Old', year: 'c. 1850', month: '2' });
  });

  it('skips what it cannot read and reports it, parentheses included', () => {
    const result = parseBiblatex(`
      @book{, title = {No key}}
      @book(paren1, title = {Parentheses (work)}, date = 1900)
      @book{dup, title = {One}, title = {Two}, note = undefinedmacro}
      @misc{unclosed, title = {Oops}
    `);
    expect(result.entries.map((e) => e.key)).toEqual(['paren1', 'dup']);
    expect(result.entries[0]?.fields).toEqual({ title: 'Parentheses (work)', date: '1900' });
    expect(result.entries[1]?.fields).toEqual({ title: 'Two', note: 'undefinedmacro' });
    expect(result.warnings).toEqual([
      'An @book entry without a key was skipped.',
      '"dup": the macro undefinedmacro is not defined; its name is used as the value.',
      '"dup": the field title is given twice; the last value is kept.',
      'An unclosed @misc entry "unclosed" at the end of the file was ignored.',
    ]);
  });
});

describe('serializeBiblatex', () => {
  const entries: BibEntry[] = [
    {
      type: 'article',
      key: 'dover1987',
      fields: {
        pages: '45--67',
        title: 'Aristophanes',
        keywords: 'comedy',
        author: 'Dover, K. J.',
        journaltitle: 'CQ',
        date: '1987',
        abstract: 'x',
      },
    },
    {
      type: 'book',
      key: 'page1962',
      fields: {
        editor: 'Page, D. L.',
        title: 'Poetae Melici Graeci',
        location: 'Oxford',
        date: '1962',
      },
    },
  ];

  it('writes fields in a stable order', () => {
    expect(serializeBiblatex(entries)).toBe(
      '@article{dover1987,\n  author = {Dover, K. J.},\n  title = {Aristophanes},\n  journaltitle = {CQ},\n  date = {1987},\n  pages = {45--67},\n  abstract = {x},\n  keywords = {comedy},\n}\n\n' +
        '@book{page1962,\n  editor = {Page, D. L.},\n  title = {Poetae Melici Graeci},\n  date = {1962},\n  location = {Oxford},\n}\n',
    );
    expect(serializeBiblatex([])).toBe('');
  });

  it('round-trips through the reader', () => {
    expect(parseBiblatex(serializeBiblatex(entries)).entries).toEqual(entries);
  });
});

describe('citationLabel', () => {
  const label = (type: string, fields: Record<string, string>) =>
    citationLabel({ type, key: 'k', fields });

  it('is author and year, two authors joined, three or more et al.', () => {
    expect(label('book', { author: 'Wilamowitz, Ulrich', date: '1927-05' })).toBe(
      'Wilamowitz 1927',
    );
    expect(label('book', { author: 'Dover, K. and Henderson, J.', year: '1987' })).toBe(
      'Dover and Henderson 1987',
    );
    expect(label('book', { author: 'A, X and B, Y and C, Z', date: '2001/2003' })).toBe(
      'A et al. 2001',
    );
    expect(label('book', { author: 'Smith, J. and others', date: '1999' })).toBe(
      'Smith et al. 1999',
    );
    expect(label('book', { author: 'Maas, Paul' })).toBe('Maas');
  });

  it('falls back to editor, translator, a corporate body, then the title', () => {
    expect(label('collection', { editor: 'Page, D. L.', date: '1962' })).toBe('Page 1962');
    expect(label('book', { translator: 'Lattimore, Richmond', date: '1951' })).toBe(
      'Lattimore 1951',
    );
    expect(
      label('online', { organization: '{Thesaurus Linguae Graecae} and {Others}', date: '2014' }),
    ).toBe('Thesaurus Linguae Graecae 2014');
    expect(label('misc', { title: 'Suda On Line' })).toBe('Suda On Line');
    expect(
      label('misc', { title: 'Lexicon Thucydideum', shorttitle: 'Lex. Thuc.', date: '1843' }),
    ).toBe('Lex. Thuc. 1843');
    expect(
      label('misc', { title: 'A Lexicon of Greek Personal Names: Volume I', date: '1987' }),
    ).toBe('A Lexicon of 1987');
    expect(label('misc', {})).toBe('k');
  });

  it('prints LaTeX accents as letters', () => {
    expect(
      label('book', { author: 'M{\\"u}ller, Karl and Fr\\"ankel, Hermann', date: '1848' }),
    ).toBe('Müller and Fränkel 1848');
  });
});

describe('parseNames', () => {
  it('reads both biblatex forms and serializes to the unambiguous one', () => {
    const names = parseNames(
      'Wilamowitz-Moellendorff, Ulrich von and Kenneth Dover AND {Oxford Classical Texts}',
    );
    expect(names).toEqual([
      { family: 'Wilamowitz-Moellendorff', given: 'Ulrich von' },
      { family: 'Dover', given: 'Kenneth' },
      { family: 'Oxford Classical Texts', given: '' },
    ]);
    expect(serializeNames(names)).toBe(
      'Wilamowitz-Moellendorff, Ulrich von and Dover, Kenneth and {Oxford Classical Texts}',
    );
  });

  it('keeps von parts with the family name', () => {
    expect(parseNames('Ulrich von Wilamowitz-Moellendorff')).toEqual([
      { family: 'von Wilamowitz-Moellendorff', given: 'Ulrich' },
    ]);
    expect(parseNames('Jean de La Fontaine')).toEqual([
      { family: 'de La Fontaine', given: 'Jean' },
    ]);
    expect(parseNames('von Arnim, Hans')).toEqual([{ family: 'von Arnim', given: 'Hans' }]);
  });

  it('handles single names, suffixes and braces', () => {
    expect(parseNames('Maas')).toEqual([{ family: 'Maas', given: '' }]);
    expect(parseNames('Smith, Jr., John')).toEqual([{ family: 'Smith Jr.', given: 'John' }]);
    expect(parseNames('Jean {de la Fontaine}')).toEqual([
      { family: 'de la Fontaine', given: 'Jean' },
    ]);
    expect(parseNames('')).toEqual([]);
  });
});

describe('disambiguateLabels', () => {
  it('suffixes repeated labels in order and leaves the rest alone', () => {
    expect(
      disambiguateLabels(['Henderson 1987', 'Dover 1972', 'Henderson 1987', 'Henderson 1987']),
    ).toEqual(['Henderson 1987a', 'Dover 1972', 'Henderson 1987b', 'Henderson 1987c']);
  });
});

describe('latexToUnicode', () => {
  it('turns accents and special letters into Unicode and drops braces', () => {
    expect(latexToUnicode('L{\\"o}bel')).toBe('Löbel');
    expect(latexToUnicode("{\\'E}cole fran\\c{c}aise")).toBe('École française');
    expect(latexToUnicode('Stra{\\ss}e \\o{}ster \\AA{}ngstr\\"om')).toBe('Straße øster Ångström');
    expect(latexToUnicode("Ma\\'{\\i}z")).toBe('Maíz');
  });
});
