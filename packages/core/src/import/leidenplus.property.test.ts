import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import {
  isBreak,
  isToken,
  type Item,
  type Mark,
  type Obj,
  type Stream,
  type Token,
} from '../stream/items.ts';
import { picture, runProperty, shrinkStream, type Property, type Rng } from '../testing/random.ts';
import { importLeidenPlus } from './leidenplus.ts';
import { toLeidenPlus } from './leidenplus-write.ts';

/** Words without a sign Leiden+ reads as notation. */
const FORMS = [
  'μηνιν',
  'αειδε',
  'θεα',
  'Πηληιαδεω',
  'Αχιλλεως',
  'ουλομενην',
  'ἣ',
  'μυρί',
  'ἄλγε',
  'a',
  'bb',
  'ccc',
];

const rendOf = ['erasure', 'slashes', 'cross-strokes'] as const;
const placeOf = [
  'above',
  'below',
  'left',
  'right',
  'top',
  'bottom',
  'interlinear',
  'margin',
] as const;

/**
 * One unit of a line of a transcript, in the shapes the Leiden+ reader makes
 * (its canonical forms, so that what is written reads back as it was): a word
 * alone or with a regularization, an abbreviation, a number, a word with
 * unclear letters or a gap in it, deleted, added or otherwise marked, the
 * scribe's own correction (two words), or an object. Marks cover a whole word
 * unless they are ranged.
 */
function unit(rng: Rng, combos: boolean): Item[] {
  const form = rng.pick(FORMS);
  const length = Array.from(form).length;
  const token = (extra: Partial<Token> = {}): Token => ({ kind: 'token', id: '', form, ...extra });
  const object = (type: Obj['type'], attrs?: Obj['attrs'], text?: string): Obj => ({
    kind: 'object',
    id: '',
    type,
    ...(attrs ? { attrs } : {}),
    ...(text !== undefined ? { text } : {}),
  });
  const mark = (kind: string, attrs?: Mark['attrs'], from?: number, to?: number): Mark => ({
    kind,
    ...(attrs ? { attrs } : {}),
    ...(from !== undefined ? { from, to: to! } : {}),
  });
  if (combos && rng.chance(0.5)) {
    // Several marks on one word, over ranges of its letters, perhaps with a regularization.
    const kinds = rng.shuffle(['unclear', 'gap', 'del', 'add', 'hi', 'foreign', 'q', 'handShift']);
    const marks: Mark[] = [];
    for (const kind of kinds.slice(0, rng.between(2, 3))) {
      const from = rng.between(0, length - 1);
      const to = rng.between(from + 1, length);
      const range = rng.chance(0.5) ? [from, to] : [undefined, undefined];
      switch (kind) {
        case 'unclear':
          marks.push(mark('unclear', undefined, from, to));
          break;
        case 'gap': {
          const at = rng.between(0, length);
          marks.push(
            mark('gap', { reason: 'lost', quantity: rng.between(1, 5), unit: 'character' }, at, at),
          );
          break;
        }
        case 'del':
          marks.push(mark('del', { rend: rng.pick(rendOf) }, range[0], range[1]));
          break;
        case 'add':
          marks.push(mark('add', { place: rng.pick(placeOf) }, range[0], range[1]));
          break;
        case 'hi':
          marks.push(mark('hi', { rend: 'superscript' }, range[0], range[1]));
          break;
        case 'foreign':
          marks.push(mark('foreign', { lang: 'la' }, range[0], range[1]));
          break;
        case 'q':
          marks.push(mark('q', undefined, range[0], range[1]));
          break;
        default:
          marks.push(mark('handShift', { new: 'm2' }));
      }
    }
    return [token({ marks, ...(rng.chance(0.3) ? { norm: `${form}x` } : {}) })];
  }
  switch (rng.int(20)) {
    case 0:
      return [token({ norm: rng.pick(FORMS) === form ? 'xyz' : rng.pick(FORMS) })].map((t) => {
        if (t.norm === form) t.norm = `${form}x`;
        return t;
      });
    case 1:
      return [token({ marks: [mark('abbr', { expan: `${form}ος` })] })];
    case 2:
      return [token({ marks: [mark('abbr', { expan: form, symbol: true })] })];
    case 3:
      return [token({ marks: [mark('abbr')] })];
    case 4:
      return [token({ marks: [mark('num', { value: String(rng.between(1, 99)) })] })];
    case 5: {
      const from = rng.between(0, length - 1);
      return [token({ marks: [mark('unclear', undefined, from, from + 1)] })];
    }
    case 6: {
      // A gap inside the word, where letters are lost or illegible.
      const at = rng.between(0, length);
      return [
        token({
          marks: [
            mark(
              'gap',
              {
                reason: rng.pick(['lost', 'illegible']),
                quantity: rng.between(1, 5),
                unit: 'character',
              },
              at,
              at,
            ),
          ],
        }),
      ];
    }
    case 7:
      return [token({ marks: [mark('del', { rend: rng.pick(rendOf) })] })];
    case 8:
      return [token({ marks: [mark('add', { place: rng.pick(placeOf) })] })];
    case 9:
      return [
        token({
          marks: [mark('hi', { rend: rng.pick(['superscript', 'subscript', 'supraline']) })],
        }),
      ];
    case 10:
      return [token({ marks: [mark('foreign', { lang: 'la' })] })];
    case 11:
      return [token({ marks: [mark('q')] })];
    case 12:
      return [token({ marks: [mark('handShift', { new: 'm2' })] })];
    case 13:
      return [
        token({ marks: [mark('subst'), mark('add', { place: 'inline' })] }),
        {
          ...token({ marks: [mark('subst'), mark('del', { rend: 'corrected' })] }),
          form: rng.pick(FORMS),
        },
      ];
    case 14:
      return [
        object(
          'gap',
          rng.pick([
            { reason: 'lost', quantity: rng.between(1, 9), unit: 'character' },
            { reason: 'illegible', extent: 'unknown', unit: 'character' },
            { reason: 'lost', quantity: rng.between(1, 4), unit: 'line' },
            { reason: 'lost', quantity: 5, unit: 'character', precision: 'low' },
          ]),
        ),
      ];
    case 15:
      return [object('space', { quantity: rng.between(1, 5), unit: 'character' })];
    case 16:
      return [object('mark', { g: 'stauros' })];
    case 17:
      return [object('note', { lang: 'en' }, 'a note')];
    case 18:
      return [object('figure', undefined, 'seal')];
    default:
      return [token()];
  }
}

/** A transcript of lines of units, with pages, columns and paragraphs between lines, a word divided at a line's end. */
function generate(rng: Rng, size: number, combos: boolean): Stream {
  const items: Item[] = [];
  const lines = rng.between(1, 1 + size);
  for (let l = 0; l < lines; l++) {
    if (l > 0) {
      const roll = rng.int(12);
      if (roll === 0) items.push({ kind: 'break', id: '', type: 'page' });
      else if (roll === 1) items.push({ kind: 'break', id: '', type: 'column' });
      else if (roll === 2) items.push({ kind: 'break', id: '', type: 'paragraph' });
      else items.push({ kind: 'break', id: '', type: 'line' });
    }
    const count = rng.between(1, 1 + Math.floor(size / 2));
    const line: Item[] = [];
    for (let k = 0; k < count; k++) line.push(...unit(rng, combos));
    items.push(...line);
  }
  // A word divided at the end of a line.
  items.forEach((item, i) => {
    const next = items[i + 2];
    const between = items[i + 1];
    if (
      isToken(item) &&
      isBreak(between) &&
      between.type === 'line' &&
      isToken(next) &&
      rng.chance(0.2)
    )
      item.joinNext = true;
  });
  return shape({ items });
}

/** The cases already found, left out so that the next kind can be looked for (each has a test of its own). */
interface Tidy {
  /** No page or column break (written as divisions, which read back as paragraphs). */
  divisions?: boolean;
}

/**
 * The stream in the shape the generator makes: ids in order, no break at the
 * start, at the end or after another break, and a word divided only where a
 * line break and a word follow. (Applied to what the shrinker makes, too.)
 */
function shape(stream: Stream, how: Tidy = {}): Stream {
  const kept: Item[] = [];
  for (const item of stream.items) {
    if (how.divisions && isBreak(item) && (item.type === 'page' || item.type === 'column'))
      continue;
    if (isBreak(item) && (kept.length === 0 || isBreak(kept[kept.length - 1]!))) continue;
    kept.push(item);
  }
  while (kept.length > 0 && isBreak(kept[kept.length - 1]!)) kept.pop();
  // The scribe's correction is two words, the added and then the deleted one; a half left alone is a plain word.
  const whole = (item: Item | undefined, kind: string): boolean =>
    isToken(item) &&
    !!item.marks?.some((m) => m.kind === 'subst') &&
    !!item.marks.some((m) => m.kind === kind);
  const paired = new Set<number>();
  kept.forEach((item, i) => {
    if (whole(item, 'add') && whole(kept[i + 1], 'del')) {
      paired.add(i);
      paired.add(i + 1);
    }
  });
  const ids = sequentialIds('i');
  return {
    items: kept.map((item, i): Item => {
      let withId = { ...item, id: ids() } as Item;
      if (isToken(withId) && withId.marks?.some((m) => m.kind === 'subst') && !paired.has(i)) {
        const marks = withId.marks.filter(
          (m) => m.kind !== 'subst' && m.kind !== 'add' && m.kind !== 'del',
        );
        const { marks: _marks, ...rest } = withId;
        withId = (marks.length > 0 ? { ...rest, marks } : rest) as Item;
      }
      if (isToken(withId) && withId.joinNext) {
        const between = kept[i + 1];
        const next = kept[i + 2];
        if (!(isBreak(between) && between.type === 'line' && isToken(next))) delete withId.joinNext;
      }
      return withId;
    }),
  };
}

interface Case {
  stream: Stream;
}

const show = (c: Case): string =>
  `stream: ${picture(c.stream)}\nwritten:\n${toLeidenPlus(c.stream)}marks: ${JSON.stringify(c.stream.items.flatMap((i) => (isToken(i) && i.marks ? [[i.id, i.marks]] : [])))}`;

function* shrink(c: Case, how: Tidy = {}): Generator<Case> {
  for (const stream of shrinkStream(c.stream)) yield { stream: shape(stream, how) };
}

/** A mark over every letter of the token is the mark of the whole token. */
function canonicalMarks(form: string, marks: Mark[]): Mark[] {
  const length = Array.from(form).length;
  return marks.map((mark) => {
    if (mark.from === 0 && mark.to === length) {
      const { from: _from, to: _to, ...rest } = mark;
      return rest;
    }
    return mark;
  });
}

/** What must come back: everything but ids and the numbers of the lines, which Leiden+ makes. */
function essence(items: Item[]): unknown[] {
  return items.map((item) => {
    if (isToken(item)) {
      const out: Record<string, unknown> = { form: item.form };
      if (item.norm !== undefined) out.norm = item.norm;
      if (item.joinNext) out.joinNext = true;
      if (item.marks) {
        out.marks = canonicalMarks(item.form, item.marks).sort(
          (a, b) =>
            (a.from ?? -1) - (b.from ?? -1) ||
            (a.to ?? -1) - (b.to ?? -1) ||
            a.kind.localeCompare(b.kind),
        );
      }
      return out;
    }
    if (isBreak(item)) return { break: item.type };
    const out: Record<string, unknown> = { object: item.type };
    if (item.attrs) out.attrs = item.attrs;
    if (item.text !== undefined) out.text = item.text;
    return out;
  });
}

const property = (how: Tidy = {}, combos = false): Property<Case> => ({
  generate: (rng, size) => ({ stream: shape(generate(rng, size, combos), how) }),
  show,
  shrink: (c) => shrink(c, how),
  check({ stream }) {
    const written = toLeidenPlus(stream);
    const read = importLeidenPlus(written, { ids: sequentialIds('r') });
    expect(read.warnings, written).toStrictEqual([]);
    expect(JSON.stringify(essence(read.stream.items)), written).toBe(
      JSON.stringify(essence(stream.items)),
    );
    // And what is written does not change on a second trip.
    expect(toLeidenPlus(read.stream)).toBe(written);
  },
});

/** A stream for the pinned cases, ids in order. */
function stream(...items: Item[]): Stream {
  const ids = sequentialIds('p');
  return { items: items.map((item) => ({ ...item, id: ids() }) as Item) };
}

const word = (form: string, extra: Partial<Token> = {}): Token => ({
  kind: 'token',
  id: '',
  form,
  ...extra,
});

describe('Leiden+ round trip (random)', () => {
  it('writes a transcript and reads it back as it was, and writes the same text again (tidy)', () => {
    runProperty('leiden+: write, read, write (tidy)', property({ divisions: true }));
  });

  it('with several marks on a word, over ranges of its letters', () => {
    runProperty('leiden+: write, read, write (several marks)', property({ divisions: true }, true));
  });

  // Every stream that is made of what the writer says, with nothing left out,
  // does not come back: a page break and a column break come back as paragraph
  // breaks (pinned below), and they are the only kind left.
  it.fails('writes a transcript and reads it back as it was, whatever it is made of', () => {
    runProperty('leiden+: write, read, write', property({}, true));
  });

  // The reader takes a figure for a word unless a space ends it, so a line
  // that ends in a figure keeps the space.
  it('a figure at the end of a line comes back as a figure', () => {
    property().check({
      stream: stream({ kind: 'object', id: '', type: 'figure', text: 'seal' }),
    });
  });

  // A page break is written as a division, `<D=.12r<= ... =>=D>`, and a column
  // likewise (`<D=.i.column`), and the reader reads every such division as a
  // paragraph break (`<div type="textpart">`): the break comes back as a
  // paragraph, and the page's label is lost.
  it.fails('a page break comes back as a page break', () => {
    property().check({
      stream: stream(word('a'), { kind: 'break', id: '', type: 'page' }, word('b')),
    });
  });
  it.fails('a column break comes back as a column break', () => {
    property().check({
      stream: stream(word('a'), { kind: 'break', id: '', type: 'column' }, word('b')),
    });
  });

  // Where the delimiters of two marks touch they can read as another
  // construct: `~|` then `|^` as `~||`, `\` then `|^` as `\|`. The writer
  // nests such marks the other way round.
  it('a word with a foreign phrase mark and a superscript comes back as it was', () => {
    property().check({
      stream: stream(
        word('αειδε', {
          marks: [
            { kind: 'foreign', attrs: { lang: 'la' } },
            { kind: 'hi', attrs: { rend: 'superscript' } },
          ],
        }),
      ),
    });
  });
  it('a word added above that is also a superscript comes back as it was', () => {
    property().check({
      stream: stream(
        word('αειδε', {
          marks: [
            { kind: 'add', attrs: { place: 'above' } },
            { kind: 'hi', attrs: { rend: 'superscript' } },
          ],
        }),
      ),
    });
  });
});
