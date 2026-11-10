/**
 * The lines of an edition in the editor: dividing a word where Enter is
 * pressed inside it, putting it together again, what is shown of the breaks
 * (the hyphen, the line breaks of a prose paragraph), and marking paragraphs as
 * verse or prose.
 */
import { describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import {
  sequentialIds,
  type Break,
  type Item,
  type Lineation,
  type Stream,
  type Token,
} from '@varians/core';
import { buildRunOn, shownOf } from './decorations.ts';
import { divideWord, rejoinWord, type Planned } from './hyphen.ts';
import { buildModel, editModel, reconcileModel, type Model } from './model.ts';
import {
  lineationIn,
  markLineation,
  paragraphAt,
  paragraphsIn,
  type Marking,
} from './paragraphs.ts';

/**
 * An edition's text from a spec: words separated by spaces, `/` a line break,
 * `//` a paragraph break (`//p` and `//v` marked as prose and verse), a
 * trailing `+` a join, `@s` a segment start on a word.
 */
function text(spec: string): Stream {
  const items: Item[] = [];
  let n = 0;
  for (const word of spec.split(/\s+/u)) {
    n++;
    if (word === '/') {
      items.push({ kind: 'break', id: `b${n}`, type: 'line' });
      continue;
    }
    if (word.startsWith('//')) {
      const brk: Break = { kind: 'break', id: `b${n}`, type: 'paragraph' };
      if (word === '//p') brk.lineation = 'prose';
      if (word === '//v') brk.lineation = 'verse';
      items.push(brk);
      continue;
    }
    const joined = word.endsWith('+');
    const [form, start] = (joined ? word.slice(0, -1) : word).split('@');
    const token: Token = {
      kind: 'token',
      id: `t${n}`,
      form: form!,
      source: { kind: 'witness', transcriptionId: 'T', tokenIds: [`w${n}`] },
    };
    if (joined) token.joinNext = true;
    if (start) token.segment = { segmentId: start };
    items.push(token);
  }
  return { items };
}

function modelOf(stream: Stream, lineation: Lineation | null = 'verse'): Model {
  return buildModel(stream, { form: 'written', lineation });
}

/** The model after a plan, as the editor makes it: the operations on the items, the document as the change leaves it. */
function apply(model: Model, plan: Planned | Marking): Model {
  const change = plan.change ?? { from: 0, to: 0, insert: '' };
  const doc =
    model.ledger.text.slice(0, change.from) + change.insert + model.ledger.text.slice(change.to);
  const result = editModel(model, plan.ops, doc, sequentialIds('n'));
  expect(result.model.misaligned).toBe(false);
  return result.model;
}

const forms = (model: Model) =>
  model.view.stream.items.map((item) =>
    item.kind === 'token'
      ? item.form + (item.joinNext ? '+' : '')
      : item.kind === 'break'
        ? item.type === 'paragraph'
          ? '//'
          : '/'
        : '·',
  );

describe('divideWord', () => {
  it('divides a word where Enter is pressed inside it, into two joined parts with a line between', () => {
    const model = modelOf(text('ἀνα στασις δε'));
    const plan = divideWord(model.ledger, model.byId, 'written', 7, sequentialIds('n'))!;
    expect(plan.change).toEqual({ from: 7, to: 7, insert: '\n' });
    expect(plan.caret).toBe(8);
    const next = apply(model, plan);
    expect(forms(next)).toEqual(['ἀνα', 'στα+', '/', 'σις', 'δε']);
    expect(next.ledger.text).toBe('ἀνα στα\nσις δε');
  });

  it('keeps the segment start with the first part, and the source with both', () => {
    const model = modelOf(text('ἀνα στασις@s2 δε'));
    const next = apply(
      model,
      divideWord(model.ledger, model.byId, 'written', 7, sequentialIds('n'))!,
    );
    const [, first, , second] = next.view.stream.items as Token[];
    expect(first!.segment).toEqual({ segmentId: 's2' });
    expect(second!.segment).toBeUndefined();
    expect(second!.source).toEqual(first!.source);
  });

  it('is null at the start or the end of a word, between words, and in a read form that differs', () => {
    const model = modelOf(text('ἀνα στασις'));
    for (const pos of [0, 3, 4, 10])
      expect(divideWord(model.ledger, model.byId, 'written', pos, sequentialIds('n'))).toBeNull();
    const read = text('ἀνα στασις');
    (read.items[1] as Token).norm = 'στάσις';
    const readModel = buildModel(read, { form: 'read', lineation: 'verse' });
    expect(divideWord(readModel.ledger, readModel.byId, 'read', 6, sequentialIds('n'))).toBeNull();
  });
});

describe('rejoinWord', () => {
  it('gives the word back whole where both parts are in one segment', () => {
    const model = modelOf(text('ἀνα@s1+ / στασις δε'));
    expect(model.ledger.text).toBe('ἀνα\nστασις δε');
    const plan = rejoinWord(model.ledger, model.byId, 4, 'backward')!;
    const next = apply(model, plan);
    expect(forms(next)).toEqual(['ἀναστασις', 'δε']);
    const word = next.view.stream.items[0] as Token;
    expect(word.id).toBe('t1');
    expect(word.segment).toEqual({ segmentId: 's1' });
    expect(word.source).toEqual({ kind: 'witness', transcriptionId: 'T', tokenIds: ['w1', 'w3'] });
    expect(next.ledger.text).toBe('ἀναστασις δε');
    expect(plan.caret).toBe(3);
  });

  it('works from the end of the line as well', () => {
    const model = modelOf(text('ἀνα+ / στασις'));
    const plan = rejoinWord(model.ledger, model.byId, 3, 'forward')!;
    expect(forms(apply(model, plan))).toEqual(['ἀναστασις']);
  });

  it('keeps two joined parts, and draws no hyphen, where the second begins a segment', () => {
    const model = modelOf(text('ἀνα@s1+ / στασις@s2 δε'));
    const plan = rejoinWord(model.ledger, model.byId, 4, 'backward')!;
    expect(plan.change).toEqual({ from: 3, to: 4, insert: ' ' });
    const next = apply(model, plan);
    expect(forms(next)).toEqual(['ἀνα+', 'στασις', 'δε']);
    expect((next.view.stream.items[1] as Token).segment).toEqual({ segmentId: 's2' });
    expect(shownOf(next).hyphens.size).toBe(0);
    // The space the document has between them is not shown: they are one word.
    const hidden = buildRunOn(next);
    const ranges: [number, number][] = [];
    hidden.between(0, next.ledger.text.length, (from, to) => void ranges.push([from, to]));
    expect(ranges).toEqual([[3, 4]]);
  });

  it('is null where the break is not inside a word', () => {
    const model = modelOf(text('ab cd / ef'));
    expect(rejoinWord(model.ledger, model.byId, 6, 'backward')).toBeNull();
    expect(rejoinWord(model.ledger, model.byId, 5, 'forward')).toBeNull();
  });
});

describe('what the editor shows of breaks', () => {
  it('draws a hyphen after a joined word that a line ends, and none where no break follows', () => {
    const model = modelOf(text('ἀνα+ / στασις δε@s3+ ησις@s4'));
    expect([...shownOf(model).hyphens]).toEqual(['t1']);
  });

  it('draws one at the end of a page of a transcript where a page break follows', () => {
    const stream = text('ἀνα στασις+');
    const view = buildModel(stream, { form: 'written', lineation: null });
    expect(shownOf(view).hyphens.size).toBe(0);
    const paged = { ...view, view: { ...view.view, trailingBreak: true } } as Model;
    expect([...shownOf(paged).hyphens]).toEqual(['t2']);
  });

  it('shows a transcript as it is, with every line break', () => {
    const model = buildModel(text('ἀνα+ / στασις //p δε / μοι'), { form: 'written' });
    expect(shownOf(model).hidden.size).toBe(0);
    expect(buildRunOn(model).size).toBe(0);
    expect([...shownOf(model).hyphens]).toEqual(['t1']);
  });

  it('hides the line breaks of a prose paragraph, with a space between words and nothing inside one', () => {
    const model = modelOf(text('ἀνα+ / στασις δε / μοι'), 'prose');
    expect(shownOf(model).hidden.size).toBe(2);
    expect(shownOf(model).hyphens.size).toBe(0);
    const ranges: [number, number, boolean][] = [];
    buildRunOn(model).between(0, model.ledger.text.length, (from, to, value) => {
      const widget = (value.spec as { widget: { space: boolean } }).widget;
      ranges.push([from, to, widget.space]);
    });
    // The text is `ἀνα\nστασις δε\nμοι`: inside the first word nothing, between δε and μοι a space.
    expect(model.ledger.text).toBe('ἀνα\nστασις δε\nμοι');
    expect(ranges).toEqual([
      [3, 4, false],
      [13, 14, true],
    ]);
  });

  it('shows the break that opens a paragraph, and takes each paragraph by its own kind', () => {
    const model = modelOf(text('a / b //v c / d //p e / f'), 'prose');
    const hidden = [...shownOf(model).hidden];
    expect(hidden).toEqual(['b2', 'b10']);
  });

  it('hides the empty line above a paragraph break that begins the text', () => {
    const model = modelOf(text('//p ἀνα στασις'), 'verse');
    const ranges: [number, number][] = [];
    buildRunOn(model).between(
      0,
      model.ledger.text.length,
      (from, to) => void ranges.push([from, to]),
    );
    expect(ranges).toEqual([[0, 1]]);
  });
});

describe('paragraphs', () => {
  const stream = () => text('a b / c //p d e / f //v g //x h');
  // The text is `a b\nc\nd e\nf\ng\nh`.

  it('knows the kind of the paragraph a position is in, by its opening break or the convention', () => {
    const model = modelOf(stream(), 'verse');
    expect(model.ledger.text).toBe('a b\nc\nd e\nf\ng\nh');
    expect(paragraphAt(model, 0)).toMatchObject({ opener: null, kind: 'verse' });
    expect(paragraphAt(model, 5)).toMatchObject({ kind: 'verse' });
    expect(paragraphAt(model, 6)).toMatchObject({ kind: 'prose' });
    expect(paragraphAt(model, 9)).toMatchObject({ kind: 'prose' });
    // At the end of a line above a paragraph break, the position is in the paragraph above it.
    expect(paragraphAt(model, 5).opener).toBeNull();
    // A convention of prose makes the unmarked paragraphs prose.
    expect(paragraphAt(modelOf(stream(), 'prose'), 0).kind).toBe('prose');
  });

  it('takes the paragraphs a selection touches, and not the one it ends at the start of', () => {
    const model = modelOf(stream(), 'verse');
    expect(paragraphsIn(model, 0, 4).map((p) => p.kind)).toEqual(['verse']);
    expect(paragraphsIn(model, 0, 8).map((p) => p.kind)).toEqual(['verse', 'prose']);
    expect(paragraphsIn(model, 0, 6).map((p) => p.kind)).toEqual(['verse']);
    expect(lineationIn(model, 0, 8)).toBeNull();
    expect(lineationIn(model, 6, 9)).toBe('prose');
  });

  it('marks a paragraph on the break that opens it', () => {
    const model = modelOf(stream(), 'verse');
    const marking = markLineation(model, 6, 6, 'verse', sequentialIds('n'))!;
    expect(marking.ops).toEqual([{ t: 'set', id: 'b5', fields: { lineation: 'verse' } }]);
    expect(marking.change).toBeUndefined();
    // Nothing to do where the paragraphs are of the kind already.
    expect(markLineation(model, 0, 4, 'verse', sequentialIds('n'))).toBeNull();
  });

  it('gives the first paragraph, which no break opens, a break of its own that begins the text', () => {
    const model = modelOf(stream(), 'verse');
    const marking = markLineation(model, 0, 3, 'prose', sequentialIds('n'))!;
    expect(marking.change).toEqual({ from: 0, to: 0, insert: '\n' });
    const next = apply(model, marking);
    expect(next.view.stream.items[0]).toMatchObject({
      kind: 'break',
      type: 'paragraph',
      lineation: 'prose',
    });
    expect(next.ledger.text).toBe('\na b\nc\nd e\nf\ng\nh');
    expect(paragraphAt(next, 0)).toMatchObject({ kind: 'prose' });
    expect(paragraphAt(next, 1)).toMatchObject({ kind: 'prose' });
    // The paragraph is now marked, and marking it verse again changes the same break.
    expect(markLineation(next, 1, 1, 'verse', sequentialIds('m'))!.ops).toEqual([
      { t: 'set', id: next.view.stream.items[0]!.id, fields: { lineation: 'verse' } },
    ]);
  });

  it('marks every paragraph of a selection that is not of the kind', () => {
    const model = modelOf(stream(), 'verse');
    const marking = markLineation(model, 0, 16, 'prose', sequentialIds('n'))!;
    // The first paragraph gets a break; the verse paragraph (b10) is marked; the unmarked verse one at the end ('x') too.
    expect(marking.ops.map((op) => op.t)).toEqual(['insert', 'set', 'set']);
  });
});

describe('Enter in a prose paragraph', () => {
  it('makes a paragraph break, of the kind the paragraph is marked as', () => {
    const model = modelOf(text('a b //p c d'), 'verse');
    const text0 = model.ledger.text;
    const at = text0.indexOf('c') + 1;
    const doc = text0.slice(0, at) + '\n' + text0.slice(at);
    const changes = ChangeSet.of({ from: at, to: at, insert: '\n' }, text0.length);
    const change = reconcileModel(
      model,
      changes,
      doc,
      { paragraph: { lineation: 'prose' } },
      sequentialIds('n'),
    );
    const made = change.model.view.stream.items.filter(
      (item): item is Break => item.kind === 'break' && item.id.startsWith('n'),
    );
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ type: 'paragraph', lineation: 'prose' });
    // It is undone with the typing: the reverse removes the break again.
    expect(change.typed?.reverse.some((op) => op.t === 'delete')).toBe(true);
  });
});
