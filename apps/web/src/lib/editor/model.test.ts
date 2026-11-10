import { describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import {
  applyOps,
  fromText,
  sequentialIds,
  toText,
  type Break,
  type Stream,
  type Token,
} from '@varians/core';
import { buildModel, editModel, reconcileModel, withForm, type Model } from './model.ts';

function sample(): Stream {
  const s = fromText('one two\nthree', { ids: sequentialIds() });
  return s;
}

function paged(): Stream {
  const s = fromText('x\na b\nc d', { ids: sequentialIds() });
  (s.items[1] as Break).type = 'page';
  (s.items[1] as Break).pageId = 'p1';
  (s.items[4] as Break).type = 'page';
  (s.items[4] as Break).pageId = 'p2';
  return s;
}

function change(model: Model, from: number, to: number, insert: string) {
  const changes = ChangeSet.of({ from, to, insert }, model.ledger.text.length);
  const docText = model.ledger.text.slice(0, from) + insert + model.ledger.text.slice(to);
  return { changes, docText };
}

describe('buildModel', () => {
  it('renders the whole stream', () => {
    const model = buildModel(sample(), { form: 'written' });
    expect(model.ledger.text).toBe('one two\nthree');
    expect(model.byId.get('t1')).toMatchObject({ form: 'one' });
    expect(model.misaligned).toBe(false);
  });

  it('aligns to a document with other whitespace and flags one that differs', () => {
    const good = buildModel(sample(), { form: 'written' }, 'one  two \nthree');
    expect(good.misaligned).toBe(false);
    expect(good.ledger.text).toBe('one  two \nthree');
    const bad = buildModel(sample(), { form: 'written' }, 'one two\nfour');
    expect(bad.misaligned).toBe(true);
    expect(bad.ledger.text).toBe('one two\nthree');
  });
});

describe('reconcileModel', () => {
  it('turns typing into operations on the whole stream and keeps the ledger on the real text', () => {
    const whole = sample();
    const model = buildModel(whole, { form: 'written' });
    // Type a space and then a letter at the end of the first line.
    const first = change(model, 7, 7, ' ');
    const r1 = reconcileModel(model, first.changes, first.docText, undefined, sequentialIds('n'));
    expect(r1.ops).toEqual([]);
    expect(r1.model.ledger.text).toBe('one two \nthree');
    expect(r1.model.misaligned).toBe(false);
    const second = change(r1.model, 8, 8, 'x');
    const r2 = reconcileModel(
      r1.model,
      second.changes,
      second.docText,
      undefined,
      sequentialIds('n'),
    );
    expect(r2.ops).toEqual([
      { t: 'insert', after: 't2', items: [{ kind: 'token', id: 'n1', form: 'x' }] },
    ]);
    expect(r2.model.ledger.text).toBe('one two x\nthree');
    expect(toText(applyOps(whole, r2.ops).stream)).toBe('one two x\nthree');
  });

  it('applies a join intent after a hyphen-Enter', () => {
    const model = buildModel(sample(), { form: 'written' });
    // "one tw-|o": the hyphen typed first, then Enter replaces it with a newline.
    const typed = change(model, 6, 6, '-');
    const r1 = reconcileModel(model, typed.changes, typed.docText, undefined, sequentialIds('n'));
    expect(r1.ops).toEqual([{ t: 'set', id: 't2', fields: { form: 'tw-o' } }]);
    const enter = change(r1.model, 6, 7, '\n');
    const r2 = reconcileModel(
      r1.model,
      enter.changes,
      enter.docText,
      { join: 't2' },
      sequentialIds('n'),
    );
    expect(r2.model.ledger.text).toBe('one tw\no\nthree');
    expect(r2.ops).toEqual([
      {
        t: 'insert',
        after: 't2',
        items: [
          { kind: 'break', id: 'n1', type: 'line' },
          { kind: 'token', id: 'n2', form: 'o' },
        ],
      },
      { t: 'set', id: 't2', fields: { form: 'tw' } },
      { t: 'set', id: 't2', fields: { joinNext: true } },
    ]);
    expect((r2.model.byId.get('t2') as Token).joinNext).toBe(true);
  });

  it('clears the join when the lines are joined again', () => {
    const whole = fromText('on-\ne two', { ids: sequentialIds(), hyphenJoins: true });
    const model = buildModel(whole, { form: 'written' });
    expect(model.ledger.text).toBe('on\ne two');
    const back = change(model, 2, 3, '');
    const r = reconcileModel(
      model,
      back.changes,
      back.docText,
      { unjoin: 't1' },
      sequentialIds('n'),
    );
    expect(r.model.ledger.text).toBe('one two');
    expect(r.ops).toEqual([
      { t: 'delete', ids: ['t2', 't3'] },
      { t: 'set', id: 't1', fields: { form: 'one' } },
      { t: 'set', id: 't1', fields: { joinNext: undefined } },
    ]);
    expect((r.model.byId.get('t1') as Token).joinNext).toBeUndefined();
  });

  it('lifts an insert at the start of a page to after its break', () => {
    const whole = paged();
    const model = buildModel(whole, { form: 'written', page: 'p2' });
    expect(model.ledger.text).toBe('c d');
    const typed = change(model, 0, 0, 'b ');
    const r = reconcileModel(model, typed.changes, typed.docText, undefined, sequentialIds('n'));
    expect(r.ops).toEqual([
      { t: 'insert', after: 't5', items: [{ kind: 'token', id: 'n1', form: 'b' }] },
    ]);
    expect(toText(applyOps(whole, r.ops).stream)).toBe('x\na b\nb c d');
  });

  it('creates the page break for a page without one on the first edit', () => {
    const whole = paged();
    const model = buildModel(whole, { form: 'written', page: 'p3', pageOrder: ['p1', 'p2', 'p3'] });
    expect(model.ledger.text).toBe('');
    const typed = change(model, 0, 0, 'e');
    const r = reconcileModel(model, typed.changes, typed.docText, undefined, sequentialIds('n'));
    expect(r.ops).toEqual([
      {
        t: 'insert',
        after: 't7',
        items: [{ kind: 'break', id: 'n2', type: 'page', pageId: 'p3' }],
      },
      { t: 'insert', after: 'n2', items: [{ kind: 'token', id: 'n1', form: 'e' }] },
    ]);
    expect(r.model.view.anchor?.id).toBe('n2');
    expect(r.model.view.missing).toBeNull();
    expect(toText(applyOps(whole, r.ops).stream)).toBe('x\na b\nc d\ne');
  });
});

describe('typing on an empty line', () => {
  it('puts the new word after the item before the line, not at the end of the stream', () => {
    const whole = fromText('a\n\nb', { ids: sequentialIds() });
    const model = buildModel(whole, { form: 'written' });
    expect(model.ledger.text).toBe('a\n\nb');
    const typed = change(model, 2, 2, 'x');
    const r = reconcileModel(model, typed.changes, typed.docText, undefined, sequentialIds('n'));
    expect(r.ops).toEqual([
      { t: 'insert', after: 't2', items: [{ kind: 'token', id: 'n1', form: 'x' }] },
    ]);
    expect(toText(applyOps(whole, r.ops).stream)).toBe('a\nx\nb');
    expect(r.model.ledger.text).toBe('a\nx\nb');
    expect(r.model.misaligned).toBe(false);
  });

  it('puts a word typed before a leading page break at the start of the stream', () => {
    const whole = paged();
    const model = buildModel(whole, { form: 'written' });
    expect(model.ledger.text).toBe('x\na b\nc d');
    // Delete `x` first, then type on the empty line that remains.
    const deleted = change(model, 0, 1, '');
    const r1 = reconcileModel(
      model,
      deleted.changes,
      deleted.docText,
      undefined,
      sequentialIds('n'),
    );
    expect(r1.ops).toEqual([{ t: 'delete', ids: ['t1'] }]);
    const typed = change(r1.model, 0, 0, 'y');
    const r2 = reconcileModel(
      r1.model,
      typed.changes,
      typed.docText,
      undefined,
      sequentialIds('n'),
    );
    expect(r2.ops).toEqual([
      { t: 'insert', after: null, items: [{ kind: 'token', id: 'n1', form: 'y' }] },
    ]);
    expect(r2.model.ledger.text).toBe('y\na b\nc d');
  });

  it('leaves the bridge alone when the changed line holds items', () => {
    const model = buildModel(sample(), { form: 'written' });
    const typed = change(model, 7, 7, ' x');
    const r = reconcileModel(model, typed.changes, typed.docText, undefined, sequentialIds('n'));
    expect(r.ops).toEqual([
      { t: 'insert', after: 't2', items: [{ kind: 'token', id: 'n1', form: 'x' }] },
    ]);
  });

  it('types at the end of the stream as before', () => {
    const model = buildModel(sample(), { form: 'written' });
    const typed = change(model, 13, 13, '\nx');
    const r = reconcileModel(model, typed.changes, typed.docText, undefined, sequentialIds('n'));
    expect(r.ops).toEqual([
      {
        t: 'insert',
        after: 't4',
        items: [
          { kind: 'break', id: 'n1', type: 'line' },
          { kind: 'token', id: 'n2', form: 'x' },
        ],
      },
    ]);
  });
});

describe('editModel', () => {
  it('applies operations without a text change and returns their reverse', () => {
    const model = buildModel(sample(), { form: 'written' });
    const r = editModel(
      model,
      [{ t: 'set', id: 't1', fields: { marks: [{ kind: 'unclear' }] } }],
      model.ledger.text,
    );
    expect((r.model.byId.get('t1') as Token).marks).toEqual([{ kind: 'unclear' }]);
    expect(r.reverse).toEqual([{ t: 'set', id: 't1', fields: { marks: null } }]);
    expect(r.model.ledger).toEqual(model.ledger);
  });

  it('applies an insert with its text change', () => {
    const model = buildModel(sample(), { form: 'written' });
    const r = editModel(
      model,
      [{ t: 'insert', after: 't1', items: [{ kind: 'object', id: 'g1', type: 'gap' }] }],
      'one ￼ two\nthree',
    );
    expect(r.model.ledger.text).toBe('one ￼ two\nthree');
    expect(r.model.ledger.spans.map((s) => s.id)).toEqual(['t1', 'g1', 't2', 't3', 't4']);
    expect(r.model.misaligned).toBe(false);
  });
});

describe('withForm', () => {
  it('re-renders the same items in the other form', () => {
    const s = sample();
    (s.items[0] as Token).norm = 'ONE';
    const written = buildModel(s, { form: 'written' });
    const read = withForm(written, 'read');
    expect(read.ledger.text).toBe('ONE two\nthree');
    expect(read.view).toBe(written.view);
  });
});

describe('the segment running into a page', () => {
  function segmented(): Stream {
    const s = paged();
    // x | p1: a b | p2: c d; segment s1 begins at a, s2 at d.
    (s.items[2] as { segment?: unknown }).segment = { segmentId: 's1' };
    (s.items[6] as { segment?: unknown }).segment = { segmentId: 's2' };
    return s;
  }

  it('is the segment of the text before the page, for a page shown alone', () => {
    const whole = segmented();
    expect(buildModel(whole, { form: 'written', page: 'p2' }).inherited).toEqual({
      segmentId: 's1',
    });
    expect(buildModel(whole, { form: 'written', page: 'p1' }).inherited).toBeNull();
    expect(buildModel(whole, { form: 'written', page: 'unplaced' }).inherited).toBeNull();
    expect(buildModel(whole, { form: 'written' }).inherited).toBeNull();
  });

  it('is shown muted in the gutter of the first line when its first word begins nothing', async () => {
    const { lineLabel } = await import('./editor.ts');
    const model = buildModel(segmented(), {
      form: 'written',
      page: 'p2',
      segmentLabels: { s1: '1.1', s2: '1.2' },
    });
    expect(lineLabel(model, { from: 0 })).toEqual({ tokenId: 't6', label: '1.1', running: true });
    const own = buildModel(segmented(), {
      form: 'written',
      page: 'p1',
      segmentLabels: { s1: '1.1' },
    });
    expect(lineLabel(own, { from: 0 })).toEqual({ tokenId: 't3', label: '1.1', running: false });
  });
});

describe('page labels', () => {
  it('treats a page break without a label as a programming error', async () => {
    const { pageLabel, MissingPageLabel } = await import('./decorations.ts');
    const model = buildModel(paged(), { form: 'written', pageLabels: { p1: '12r' } });
    expect(pageLabel(model, { kind: 'break', id: 'b', type: 'page', pageId: 'p1' })).toBe('12r');
    expect(() =>
      pageLabel(model, { kind: 'break', id: 'b', type: 'page', pageId: 'gone' }),
    ).toThrow(MissingPageLabel);
  });
});
