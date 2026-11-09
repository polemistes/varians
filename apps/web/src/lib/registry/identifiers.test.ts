import { describe, expect, it } from 'vitest';
import { parseWitnessForm, parseWorkForm } from './forms';
import {
  IDENTIFIER_SCHEMES,
  identifierHref,
  identifierRows,
  normalizeIdentifier,
  parseIdentifiers,
  unionIdentifiers,
} from './identifiers';

const json = (rows: unknown) => JSON.stringify(rows);

describe('normalizeIdentifier', () => {
  it('takes a CTS URN of a work and refuses one of a passage', () => {
    expect(normalizeIdentifier('cts', ' urn:cts:greekLit:tlg0012.tlg001 ')).toEqual({ ok: true, value: 'urn:cts:greekLit:tlg0012.tlg001' });
    expect(normalizeIdentifier('cts', 'urn:cts:greekLit:tlg0012.tlg001:1.1').ok).toBe(false);
    expect(normalizeIdentifier('cts', 'tlg0012.tlg001').ok).toBe(false);
  });

  it('takes a Wikidata item, with a capital Q', () => {
    expect(normalizeIdentifier('wikidata', 'Q8275')).toEqual({ ok: true, value: 'Q8275' });
    expect(normalizeIdentifier('wikidata', 'q8275')).toEqual({ ok: true, value: 'Q8275' });
    expect(normalizeIdentifier('wikidata', 'Q')).toMatchObject({ ok: false });
    expect(normalizeIdentifier('wikidata', 'P31')).toMatchObject({ ok: false });
    expect(normalizeIdentifier('wikidata', 'Q08')).toMatchObject({ ok: false });
  });

  it('takes digits only for Diktyon, Trismegistos and VIAF', () => {
    for (const scheme of ['diktyon', 'trismegistos', 'viaf'] as const) {
      expect(normalizeIdentifier(scheme, ' 16630 ')).toEqual({ ok: true, value: '16630' });
      expect(normalizeIdentifier(scheme, 'TM 16630').ok).toBe(false);
      expect(normalizeIdentifier(scheme, '16630a').ok).toBe(false);
    }
  });

  it('takes an http or https address only', () => {
    expect(normalizeIdentifier('url', 'https://example.org/ms/1')).toEqual({ ok: true, value: 'https://example.org/ms/1' });
    expect(normalizeIdentifier('url', 'http://example.org').ok).toBe(true);
    expect(normalizeIdentifier('url', 'ftp://example.org').ok).toBe(false);
    expect(normalizeIdentifier('url', 'example.org').ok).toBe(false);
    expect(normalizeIdentifier('url', 'javascript:alert(1)').ok).toBe(false);
    expect(normalizeIdentifier('url', 'https://exa mple.org').ok).toBe(false);
  });

  it('takes anything for Other, within the length', () => {
    expect(normalizeIdentifier('other', 'Rahlfs 1').ok).toBe(true);
    expect(normalizeIdentifier('other', 'x'.repeat(301)).ok).toBe(false);
    expect(normalizeIdentifier('other', '   ').ok).toBe(false);
  });
});

describe('parseIdentifiers', () => {
  it('trims, drops empty rows and keeps each scheme and value once', () => {
    const parsed = parseIdentifiers(
      json([
        { scheme: 'wikidata', value: ' q8275 ' },
        { scheme: 'wikidata', value: 'Q8275' },
        { scheme: 'diktyon', value: '' },
        { scheme: 'viaf', value: '   ' },
        { scheme: 'other', value: 'Q8275' },
        { scheme: 'diktyon', value: '16630' },
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      identifiers: [
        { scheme: 'wikidata', value: 'Q8275' },
        { scheme: 'other', value: 'Q8275' },
        { scheme: 'diktyon', value: '16630' },
      ],
    });
  });

  it('is empty for an empty field', () => {
    expect(parseIdentifiers('')).toEqual({ ok: true, identifiers: [] });
    expect(parseIdentifiers('[]')).toEqual({ ok: true, identifiers: [] });
  });

  it('names the value that is wrong', () => {
    const parsed = parseIdentifiers(json([{ scheme: 'viaf', value: 'abc' }]));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/^abc: .*VIAF/u);
  });

  it('refuses an unknown scheme, unreadable JSON and too many rows', () => {
    expect(parseIdentifiers(json([{ scheme: 'isbn', value: '1' }])).ok).toBe(false);
    expect(parseIdentifiers('{').ok).toBe(false);
    expect(parseIdentifiers(json({ scheme: 'cts' })).ok).toBe(false);
    expect(parseIdentifiers(json([null])).ok).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({ scheme: 'diktyon', value: String(i + 1) }));
    expect(parseIdentifiers(json(many)).ok).toBe(false);
  });

  it('offers every scheme of the format', () => {
    expect([...IDENTIFIER_SCHEMES]).toEqual(['cts', 'diktyon', 'trismegistos', 'wikidata', 'viaf', 'url', 'other']);
  });
});

describe('identifierRows and unionIdentifiers', () => {
  it('shows rows again as they were sent, and nothing for unreadable input', () => {
    expect(identifierRows(json([{ scheme: 'viaf', value: 'abc' }, { value: 'x' }]))).toEqual([
      { scheme: 'viaf', value: 'abc' },
      { scheme: 'other', value: 'x' },
    ]);
    expect(identifierRows('nonsense')).toEqual([]);
    expect(identifierRows(null)).toEqual([]);
  });

  it('joins two lists without repeating', () => {
    expect(
      unionIdentifiers(
        [{ scheme: 'wikidata', value: 'Q1' }],
        [
          { scheme: 'wikidata', value: 'Q1' },
          { scheme: 'viaf', value: '2' },
        ],
      ),
    ).toEqual([
      { scheme: 'wikidata', value: 'Q1' },
      { scheme: 'viaf', value: '2' },
    ]);
  });
});

describe('identifierHref', () => {
  it('links the schemes with a resolver', () => {
    expect(identifierHref({ scheme: 'wikidata', value: 'Q8275' })).toBe('https://www.wikidata.org/wiki/Q8275');
    expect(identifierHref({ scheme: 'viaf', value: '123' })).toBe('https://viaf.org/viaf/123');
    expect(identifierHref({ scheme: 'trismegistos', value: '59341' })).toBe('https://www.trismegistos.org/text/59341');
    expect(identifierHref({ scheme: 'diktyon', value: '16630' })).toBe('https://pinakes.irht.cnrs.fr/notices/cote/16630/');
    expect(identifierHref({ scheme: 'url', value: 'https://example.org/x' })).toBe('https://example.org/x');
  });

  it('links nothing else, and nothing malformed', () => {
    expect(identifierHref({ scheme: 'cts', value: 'urn:cts:greekLit:tlg0012.tlg001' })).toBeNull();
    expect(identifierHref({ scheme: 'other', value: 'https://example.org' })).toBeNull();
    expect(identifierHref({ scheme: 'url', value: 'javascript:alert(1)' })).toBeNull();
    expect(identifierHref({ scheme: 'viaf', value: '12/../x' })).toBeNull();
  });
});

describe('the registry forms', () => {
  function form(entries: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  }

  it('reads the identifiers of a work beside its primary CTS URN', () => {
    const parsed = parseWorkForm(
      form({
        title: 'Iliad',
        language: 'grc',
        identifier: 'urn:cts:greekLit:tlg0012.tlg001',
        identifiers: json([{ scheme: 'wikidata', value: 'q8275' }]),
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.identifier).toBe('urn:cts:greekLit:tlg0012.tlg001');
      expect(parsed.data.identifiers).toEqual([{ scheme: 'wikidata', value: 'Q8275' }]);
    }
  });

  it('reports a wrong identifier beside the other errors and keeps what was typed', () => {
    const typed = json([{ scheme: 'wikidata', value: 'Iliad' }]);
    const parsed = parseWorkForm(form({ title: '', language: 'grc', identifiers: typed }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.title).toBeTruthy();
      expect(parsed.errors.identifiers?.[0]).toMatch(/^Iliad: /u);
      expect(parsed.values.identifiers).toBe(typed);
    }
  });

  it('reads the identifiers of a witness', () => {
    const ok = parseWitnessForm(form({ siglum: 'A', name: 'Venetus A', identifiers: json([{ scheme: 'diktyon', value: '69437' }]) }));
    expect(ok.ok && ok.data.identifiers).toEqual([{ scheme: 'diktyon', value: '69437' }]);
    const bad = parseWitnessForm(form({ siglum: 'A', name: 'Venetus A', identifiers: json([{ scheme: 'diktyon', value: 'Marc. gr. 454' }]) }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.identifiers).toHaveLength(1);
  });
});
