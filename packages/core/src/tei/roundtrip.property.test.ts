import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import {
  isBreak,
  isObj,
  isToken,
  type Item,
  type Mark,
  type Stream,
  type Token,
} from '../stream/items.ts';
import {
  RUNS,
  pageIds,
  picture,
  randomMarks,
  randomStream,
  runProperty,
  shrinkStream,
  WORDS,
  type MarkKind,
  type Property,
  type Rng,
} from '../testing/random.ts';
import { exportTranscriptionTei, type ExportPage } from './export.ts';
import { importTei } from './import.ts';

/** What a transcript may hold, by TEI: no `supplied`, `surplus` or `corr`, which an editor adds. */
const MARKS: MarkKind[] = [
  'unclear',
  'damage',
  'hi',
  'abbr',
  'del',
  'add',
  'gap',
  'handShift',
  'space',
  'sic',
  'orig',
  'crux',
];

/** Words with what XML must escape, and with letters outside the basic plane. */
const WORDS_WITH_SIGNS = [...WORDS, 'a&b', 'x<y>', '"q"', "d'e", 'ἄ̓ι', '𐅀x'];

const SEGMENT_LABELS: Record<string, string> = { s1: '1.1', s2: '1.2', s3: '1.3', s4: '1.4' };

const PAGES: ExportPage[] = pageIds(3).map((id, k) => ({ id, label: `${12 + k}r` }));

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

function sortedMarks(marks: Mark[] | undefined): Mark[] | undefined {
  if (!marks) return undefined;
  return [...marks].sort(
    (a, b) =>
      (a.from ?? -1) - (b.from ?? -1) ||
      (a.to ?? -1) - (b.to ?? -1) ||
      a.kind.localeCompare(b.kind),
  );
}

/** What the round trip must keep: everything but ids, page ids and segment ids. */
function essence(items: Item[]): unknown[] {
  return items.map((item) => {
    if (isToken(item)) {
      const out: Record<string, unknown> = { form: item.form };
      if (item.norm !== undefined) out.norm = item.norm;
      if (item.joinNext) out.joinNext = true;
      const marks = sortedMarks(item.marks && canonicalMarks(item.form, item.marks));
      if (marks) out.marks = marks;
      return out;
    }
    if (isBreak(item)) {
      const out: Record<string, unknown> = { break: item.type };
      if (item.type !== 'page' && item.label !== undefined) out.label = item.label;
      return out;
    }
    const out: Record<string, unknown> = { object: item.type };
    if (item.attrs) out.attrs = item.attrs;
    if (item.text !== undefined) out.text = item.text;
    return out;
  });
}

/** The starts of labelled segments: item index and label. */
function labelledStarts(stream: Stream): [number, string][] {
  const out: [number, string][] = [];
  stream.items.forEach((item, index) => {
    const segmentId = isBreak(item) ? undefined : item.segment?.segmentId;
    const label =
      segmentId === null || segmentId === undefined ? undefined : SEGMENT_LABELS[segmentId];
    if (label !== undefined) out.push([index, label]);
  });
  return out;
}

/** A transcript: the kinds of items a witness's transcript holds, written in a way TEI can say. */
function generateTranscript(
  rng: Rng,
  size: number,
  options: { joins?: boolean; marks?: readonly MarkKind[]; separators?: boolean } = {},
): Stream {
  const marks = options.marks ?? MARKS;
  const stream = randomStream(rng, {
    size,
    marks,
    norms: true,
    joins: options.joins ?? true,
    parts: 'none',
    pages: rng.chance(0.5) ? PAGES.map((p) => p.id) : [],
    objects: true,
    words: WORDS_WITH_SIGNS,
  });
  const items: Item[] = stream.items.map((item): Item => {
    if (isToken(item)) {
      const token = { ...item };
      delete token.unchecked;
      if (!options.separators) delete token.sep;
      // A normalized form that is the written form is no normalization.
      if (token.norm === token.form) delete token.norm;
      // One mark of each kind: two of the same kind over the same letters are one mark.
      if (token.marks) {
        const seen = new Set<string>();
        const kept = token.marks.filter((m) => !seen.has(m.kind) && !!seen.add(m.kind));
        if (kept.length > 0) token.marks = kept;
        else delete token.marks;
      }
      return token;
    }
    if (isObj(item)) {
      const obj = { ...item };
      // A lacuna is an edition's object; a transcript has gaps.
      if (obj.type === 'lacuna') obj.type = 'gap';
      if (obj.type === 'gap') obj.attrs = { reason: 'lost', quantity: 3, unit: 'character' };
      else if (obj.type === 'space') obj.attrs = { quantity: 2, unit: 'character' };
      else if (obj.type === 'note') {
        obj.attrs = { place: 'margin' };
        obj.text = 'a note';
      } else if (obj.type === 'paratext') {
        obj.attrs = { type: 'head' };
        obj.text = 'a head';
      } else if (obj.type === 'figure') {
        obj.text = 'a drawing';
        delete obj.attrs;
      } else if (obj.type === 'mark') {
        obj.attrs = { g: 'stauros' };
        delete obj.text;
      }
      return obj;
    }
    return item;
  });
  return { items };
}

/**
 * Streams with the cases already found left out, so that the next kind can be
 * looked for (each is the subject of a test of its own): `joins` keeps a join
 * only where a token follows, after line, column or page breaks; `spaces` takes
 * away a `space` mark at the edge of a word.
 */
interface Tidy {
  joins?: boolean;
  /** No join between two tokens with nothing between them. */
  adjacent?: boolean;
  spaces?: boolean;
  /** No line or paragraph break at the start or after another break; no line break before a paragraph break. */
  breaks?: boolean;
  /** A paratext object stands at the start of a line. */
  paratext?: boolean;
}

function tidy(stream: Stream, how: Tidy): Stream {
  let items = stream.items;
  if (how.spaces) {
    items = items.map((item) => {
      if (!isToken(item) || !item.marks) return item;
      const length = Array.from(item.form).length;
      const kept = item.marks.filter(
        (m) => !(m.kind === 'space' && (m.from === 0 || m.from === length)),
      );
      if (kept.length === item.marks.length) return item;
      const { marks: _marks, ...rest } = item;
      return kept.length > 0 ? { ...rest, marks: kept } : rest;
    });
  }
  if (how.joins) {
    items = items.map((item, i) => {
      if (!isToken(item) || !item.joinNext) return item;
      let k = i + 1;
      while (
        k < items.length &&
        isBreak(items[k]!) &&
        items[k]!.kind === 'break' &&
        (items[k] as { type: string }).type !== 'paragraph'
      )
        k++;
      if (k < items.length && isToken(items[k]!)) return item;
      const { joinNext: _joinNext, ...rest } = item;
      return rest;
    });
  }
  if (how.adjacent) {
    items = items.map((item, i) => {
      if (!isToken(item) || !item.joinNext || !isToken(items[i + 1])) return item;
      const { joinNext: _joinNext, ...rest } = item;
      return rest;
    });
  }
  if (how.breaks) {
    const kept: Item[] = [];
    items.forEach((item, i) => {
      if (isBreak(item) && (item.type === 'line' || item.type === 'paragraph')) {
        const before = kept[kept.length - 1];
        const next = items[i + 1];
        if (before === undefined || isBreak(before)) return;
        if (item.type === 'line' && isBreak(next) && next.type === 'paragraph') return;
      }
      kept.push(item);
    });
    items = kept;
  }
  if (how.paratext) {
    const lined: Item[] = [];
    for (const item of items) {
      const before = lined[lined.length - 1];
      if (isObj(item) && item.type === 'paratext' && before !== undefined && !isBreak(before))
        lined.push({ kind: 'break', id: `${item.id}-line`, type: 'line' });
      lined.push(item);
    }
    items = lined;
  }
  return { items };
}

interface TeiCase {
  stream: Stream;
  words: boolean;
}

function show(c: TeiCase): string {
  return `words: ${c.words}\nstream: ${picture(c.stream)}\nmarks: ${JSON.stringify(c.stream.items.filter(isToken).flatMap((t) => (t.marks ? [[t.id, t.marks]] : [])))}`;
}

function* shrink(c: TeiCase, how: Tidy = {}): Generator<TeiCase> {
  for (const stream of shrinkStream(c.stream)) yield { ...c, stream: tidy(stream, how) };
  // Fewer marks on a token.
  for (let i = 0; i < c.stream.items.length; i++) {
    const item = c.stream.items[i]!;
    if (!isToken(item) || !item.marks || item.marks.length < 2) continue;
    for (let k = 0; k < item.marks.length; k++) {
      const items = c.stream.items.slice();
      items[i] = { ...item, marks: item.marks.filter((_, j) => j !== k) };
      yield { ...c, stream: { items } };
    }
  }
}

function roundTrip(c: TeiCase) {
  const xml = exportTranscriptionTei({
    stream: c.stream,
    title: 'T',
    language: 'grc',
    pages: PAGES,
    segmentLabels: SEGMENT_LABELS,
    words: c.words,
    regularizations: true,
  });
  const result = importTei(xml, { ids: sequentialIds('r'), as: 'verbatim' });
  return { xml, result };
}

const property = (
  words: boolean,
  how: Tidy = {},
  options: Parameters<typeof generateTranscript>[2] = {},
): Property<TeiCase> => ({
  generate: (rng, size) => ({
    stream: tidy(generateTranscript(rng, size, options), how),
    words,
  }),
  show,
  shrink: (c) => shrink(c, how),
  check(c) {
    const { xml, result } = roundTrip(c);
    const body = xml.slice(xml.indexOf('<body>'), xml.indexOf('</body>'));
    expect(essence(result.stream.items), body).toStrictEqual(essence(c.stream.items));
    expect(
      result.segmentStarts.map((s) => [s.itemIndex, s.parts.at(-1)?.n]),
      'segment starts',
    ).toStrictEqual(labelledStarts(c.stream));
  },
});

const ALL_TIDY: Tidy = { joins: true, adjacent: true, spaces: true, breaks: true, paratext: true };

/** A stream in a short notation, for the pinned counterexamples: a word, `/` `|` `¶` `#` a line, column, paragraph and page break, `H` a heading, `+` after a word joins it to the next, `@s1` begins segment s1, `{space:2}` a mark. */
function spec(text: string): Stream {
  let n = 0;
  const items: Item[] = text
    .split(' ')
    .filter(Boolean)
    .map((w): Item => {
      const id = `x${++n}`;
      if (w === '/') return { kind: 'break', id, type: 'line' };
      if (w === '|') return { kind: 'break', id, type: 'column' };
      if (w === '¶') return { kind: 'break', id, type: 'paragraph' };
      if (w === '#') return { kind: 'break', id, type: 'page', pageId: 'P1' };
      if (w === 'H')
        return { kind: 'object', id, type: 'paratext', attrs: { type: 'head' }, text: 'a head' };
      const token: Token = { kind: 'token', id, form: w.replace(/[+@{].*$/u, '') };
      if (w.includes('+')) token.joinNext = true;
      const start = /@(\w+)/u.exec(w);
      if (start) token.segment = { segmentId: start[1]! };
      const mark = /\{(\w+):(\d+)\}/u.exec(w);
      if (mark)
        token.marks = [
          { kind: mark[1]!, from: Number(mark[2]), to: Number(mark[2]), attrs: { quantity: 2 } },
        ];
      return token;
    });
  return { items };
}

describe('TEI round trip (random)', () => {
  it('tidy: gives back the same items apart from ids, with every word written as <w>', () => {
    runProperty('tei: round trip with words (tidy)', property(true, ALL_TIDY));
  });

  it('tidy: gives back the same items from the plain text form', () => {
    runProperty('tei: round trip as plain text (tidy)', property(false, ALL_TIDY));
  });

  // The streams as they come, with nothing left out, do not all come back. Each
  // kind that does not has a pinned case below. Counterexample from the first
  // run (shrunk): the stream `t5:ἣ+`, a word joined to a next one that is not
  // there (the stretch ends).
  it.fails('gives back the same items apart from ids, with every word written as <w>', () => {
    runProperty('tei: round trip with words', property(true));
  });

  it.fails('gives back the same items from the plain text form', () => {
    runProperty('tei: round trip as plain text', property(false));
  });

  // A word joined to the next, with nothing after it, loses the join. The join
  // is written on the break that follows (`<lb break="no"/>`), and there is
  // none. A transcript that ends in a divided word (one page of a text) holds
  // exactly this.
  it.fails('a join at the end of the stretch is kept', () => {
    property(true).check({ stream: spec('a+'), words: true });
  });

  // A `space` mark (a vacat inside a word) at the start or the end of a word
  // is read back as a space object beside the word; between its letters it is a
  // mark again. Shrunk: `ab` with a space at 2.
  it.fails('a space mark at the edge of a word stays a mark', () => {
    property(true).check({ stream: spec('ab{space:2}'), words: true });
  });

  // A line break is not read back where it starts the text, stands after
  // another break or stands before a paragraph break (the importer takes it
  // for an empty line); likewise a paragraph break at the start or after
  // another break. Shrunk: `/ a`, `# / a`, `a / /`, `a / ¶ b`, `a ¶ ¶ b`,
  // `# ¶ a`. A page's first line is normally begun by a break after the page
  // break, so `# / a` is the usual shape of a page.
  for (const text of ['/ a', '# / a', '| / a', 'a / /', 'a / ¶ b', 'a ¶ ¶ b', '# ¶ a', 'a | ¶ b']) {
    it.fails(`empty lines are kept: ${text}`, () => {
      property(true).check({ stream: spec(text), words: true });
    });
  }

  // A paratext (a heading) that does not stand at the start of a line has a
  // line break put before it: `a H` comes back as `a / H`.
  it.fails('a heading after a word does not gain a line break', () => {
    property(true).check({ stream: spec('a H b'), words: true });
  });

  // A word joined across a paragraph break is not read back as joined: a
  // paragraph's end is not a line's end (`a+ ¶ b`). A word cannot divide there;
  // the stream allows it.
  it.fails('a join across a paragraph break is kept', () => {
    property(true).check({ stream: spec('a+ ¶ b'), words: true });
  });

  // Two tokens joined with nothing between them (what `split` with `join`
  // makes): in the plain text form they run together as one token; written as
  // words they stay two, but the start of a segment on the second is read back
  // on the first (`a+ b@s1`: start at item 0, not 1).
  it.fails('two directly joined tokens stay two tokens in the plain text form', () => {
    property(false).check({ stream: spec('a+ b'), words: false });
  });
  it.fails('the start of a segment on the second of two joined tokens stays there', () => {
    property(true).check({ stream: spec('a+ b@s1'), words: true });
  });

  // The attested separator before a token (`sep`) is data of the transcript
  // (specification: `sep`) and the TEI does not write it, so it does not come back.
  it.fails('the separator before a token comes back', () => {
    const stream: Stream = {
      items: [
        { kind: 'token', id: 'a', form: 'ab' },
        { kind: 'token', id: 'b', form: 'cd', sep: 'interpunct' },
      ],
    };
    const { result } = roundTrip({ stream, words: true });
    expect(result.stream.items.map((i) => (isToken(i) ? i.sep : undefined))).toStrictEqual([
      undefined,
      'interpunct',
    ]);
  });
});

void RUNS;
