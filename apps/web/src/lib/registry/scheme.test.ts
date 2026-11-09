import { describe, expect, it } from 'vitest';
import { SCHEME_PRESETS } from '@varians/core';
import { isListedLanguage, LANGUAGE_CODE, languageName } from './languages';
import {
  exampleLabel,
  joinLevelLabels,
  keepsAddresses,
  keyFromLabel,
  labelRanges,
  parseLevels,
  relabel,
  schemeProblems,
  schemeSentence,
  separatorsChanged,
} from './scheme';
import { slugify } from './slug';

const epic = SCHEME_PRESETS[0]!.scheme;
const stephanus = SCHEME_PRESETS[2]!.scheme;
const prose = SCHEME_PRESETS[4]!.scheme;

describe('scheme sentence', () => {
  it('joins the labels with and', () => {
    expect(joinLevelLabels(epic)).toBe('Book and line');
    expect(joinLevelLabels(prose)).toBe('Book, chapter and section');
    expect(joinLevelLabels({ levels: [epic.levels[1]!] })).toBe('Line');
  });

  it('makes an example label from the types and separators', () => {
    expect(exampleLabel(epic)).toBe('1.5');
    expect(exampleLabel(stephanus)).toBe('1a');
    expect(exampleLabel(prose)).toBe('1.5.2');
    expect(exampleLabel(SCHEME_PRESETS[5]!.scheme)).toBe('1:5');
  });
});

describe('parseLevels', () => {
  it('reads the JSON a form sends and trims', () => {
    const levels = parseLevels(
      JSON.stringify([
        { key: ' book ', label: 'Book', type: 'number', separator: '.' },
        { key: 'line', label: 'Line', type: 'number', separator: '.' },
      ]),
    );
    expect(levels).toEqual([
      { key: 'book', label: 'Book', type: 'number', separator: '' },
      { key: 'line', label: 'Line', type: 'number', separator: '.' },
    ]);
  });

  it('rejects the wrong shape', () => {
    expect(parseLevels('nonsense')).toBeNull();
    expect(parseLevels('{}')).toBeNull();
    expect(
      parseLevels(JSON.stringify([{ key: 'a', label: 'A', type: 'roman', separator: '' }])),
    ).toBeNull();
    expect(
      parseLevels(JSON.stringify([{ key: 'a', label: 'A', type: 'text', separator: '/' }])),
    ).toBeNull();
  });
});

describe('keepsAddresses', () => {
  it('allows new labels and separators but not new keys or types', () => {
    const relabelled = {
      levels: epic.levels.map((l) => ({
        ...l,
        label: l.label.toUpperCase(),
        separator: l.separator === '.' ? ':' : l.separator,
      })),
    };
    expect(keepsAddresses(epic, relabelled)).toBe(true);
    expect(
      keepsAddresses(epic, { levels: [{ ...epic.levels[0]!, key: 'volume' }, epic.levels[1]!] }),
    ).toBe(false);
    expect(
      keepsAddresses(epic, { levels: [epic.levels[0]!, { ...epic.levels[1]!, type: 'text' }] }),
    ).toBe(false);
    expect(keepsAddresses(epic, prose)).toBe(false);
  });
});

describe('small helpers', () => {
  it('derives keys from labels', () => {
    expect(keyFromLabel('Stephanus page')).toBe('stephanus-page');
    expect(keyFromLabel('Línea')).toBe('linea');
  });

  it('slugifies titles and falls back for other scripts', () => {
    expect(slugify('Plato, Symposium')).toBe('plato-symposium');
    expect(slugify('Ἰλιάς', 'work')).toBe('work');
    expect(slugify('  Æneid: Book I ')).toBe('aeneid-book-i');
  });

  it('names languages', () => {
    expect(languageName('grc')).toBe('Ancient Greek');
    expect(languageName('hbo')).toBe('hbo');
    expect(isListedLanguage('la')).toBe(true);
    expect(isListedLanguage('hbo')).toBe(false);
    expect(LANGUAGE_CODE.test('grc-x-epic')).toBe(true);
    expect(LANGUAGE_CODE.test('1x')).toBe(false);
  });
});

describe('the scheme as a sentence', () => {
  it('says how labels look', () => {
    expect(schemeSentence(epic)).toBe('Book and line, as 1.5');
    expect(schemeSentence(stephanus)).toBe('Page and section, as 1a');
    expect(schemeSentence({ levels: [] })).toBe('');
  });
});

describe('schemeProblems', () => {
  it('passes a sound scheme', () => {
    expect(schemeProblems(epic.levels)).toEqual([]);
    expect(schemeProblems(stephanus.levels)).toEqual([]);
  });

  it('wants labels, well-formed keys and divisible labels', () => {
    const problems = schemeProblems([
      { key: 'Book', label: '', type: 'number', separator: '' },
      { key: 'line', label: 'Line', type: 'number', separator: '' },
    ]);
    expect(problems).toContain('Level 1 has no label.');
    expect(problems.some((p) => p.includes('key of level 1'))).toBe(true);
    expect(problems.some((p) => p.includes('cannot be divided'))).toBe(true);
    expect(schemeProblems([])).toEqual(['A scheme needs at least one level.']);
    expect(schemeProblems([{ key: '', label: 'Book', type: 'number', separator: '' }])).toEqual([
      'Level 1 has no key.',
    ]);
  });

  it('ignores the separator of the first level', () => {
    expect(
      schemeProblems([{ key: 'line', label: 'Line', type: 'number', separator: '.' }]),
    ).toEqual([]);
  });
});

describe('changing separators', () => {
  const colon = { levels: epic.levels.map((l, i) => (i === 1 ? { ...l, separator: ':' } : l)) };

  it('notices a separator change but not a label change', () => {
    expect(separatorsChanged(epic, colon)).toBe(true);
    expect(
      separatorsChanged(epic, { levels: epic.levels.map((l) => ({ ...l, label: 'X' })) }),
    ).toBe(false);
    expect(
      separatorsChanged(epic, {
        levels: epic.levels.map((l, i) => (i === 0 ? { ...l, separator: '-' } : l)),
      }),
    ).toBe(false);
  });

  it('gives the new labels and finds collisions', () => {
    const segments = [
      { id: 'a', address: { book: '1', line: '1' }, label: '1.1' },
      { id: 'b', address: { book: '1', line: '2' }, label: '1.2' },
    ];
    expect(relabel(colon, segments)).toEqual({
      changed: [
        { id: 'a', label: '1:1' },
        { id: 'b', label: '1:2' },
      ],
      collisions: [],
    });
    expect(relabel(epic, segments).changed).toEqual([]);
    const run = { levels: epic.levels.map((l, i) => (i === 1 ? { ...l, separator: '' } : l)) };
    const clash = [
      { id: 'a', address: { book: '1', line: '12' }, label: '1.12' },
      { id: 'b', address: { book: '11', line: '2' }, label: '11.2' },
    ];
    expect(relabel(run, clash).collisions).toEqual(['112']);
  });
});

describe('labelRanges', () => {
  const at = (...labels: string[]) =>
    labels.map((label) => {
      const [book, line] = label.split('.');
      return { label, address: { book: book!, line: line! } };
    });

  it('joins consecutive lines of a book and keeps books apart', () => {
    expect(labelRanges(epic, at('1.1', '1.2', '1.3', '1.5', '2.1', '2.2'))).toEqual([
      '1.1–1.3',
      '1.5',
      '2.1–2.2',
    ]);
  });

  it('joins lettered sections', () => {
    const segments = ['17a', '17b', '17c', '18a'].map((label) => ({
      label,
      address: { page: label.slice(0, 2), section: label.slice(2) },
    }));
    expect(labelRanges(stephanus, segments)).toEqual(['17a–17c', '18a']);
  });

  it('leaves single labels and odd values as they are', () => {
    const drama = SCHEME_PRESETS[1]!.scheme;
    const lines = ['1', '2', '2a', '3', '10'].map((label) => ({ label, address: { line: label } }));
    expect(labelRanges(drama, lines)).toEqual(['1–2', '2a', '3', '10']);
    expect(labelRanges(drama, [])).toEqual([]);
  });
});
