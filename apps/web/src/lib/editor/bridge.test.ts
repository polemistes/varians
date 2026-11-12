import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { fromText, sequentialIds, toText, type Stream, type Token } from '@varians/core';
import { reconcile, render, spanAt, spanOf } from './bridge.ts';

function sample(): Stream {
  const s = fromText('the quick fox\njumps over', { lang: 'en', ids: sequentialIds() });
  (s.items[0] as Token).segment = { segmentId: 's1' };
  return s;
}

function change(ledger: { text: string }, from: number, to: number, insert: string): ChangeSet {
  return ChangeSet.of({ from, to, insert }, ledger.text.length);
}

function edit(
  stream: Stream,
  find: string,
  replaceWith: string,
  form: 'written' | 'read' = 'written',
) {
  const ledger = render(stream, form);
  const from = ledger.text.indexOf(find);
  if (from < 0) throw new Error(`no ${find}`);
  return reconcile(stream, ledger, change(ledger, from, from + find.length, replaceWith), form, {
    ids: sequentialIds('n'),
  });
}

describe('render', () => {
  it('lays tokens out with spaces and breaks as newlines', () => {
    const ledger = render(sample(), 'written');
    expect(ledger.text).toBe('the quick fox\njumps over');
    expect(spanOf(ledger, 't2')).toEqual({ from: 4, to: 9, id: 't2', kind: 'token' });
    expect(spanOf(ledger, 't4')).toEqual({ from: 13, to: 14, id: 't4', kind: 'break' });
    expect(spanAt(ledger, 6)?.id).toBe('t2');
    expect(spanAt(ledger, 9)?.id).toBe('t2');
  });

  it('shows the read form when asked', () => {
    const s = sample();
    (s.items[1] as Token).norm = 'swift';
    expect(render(s, 'read').text).toBe('the swift fox\njumps over');
  });
});

describe('reconcile', () => {
  it('retypes a word in place, keeping its id', () => {
    const r = edit(sample(), 'quick', 'slow');
    expect(toText(r.stream)).toBe('the slow fox\njumps over');
    expect(r.ops).toEqual([{ t: 'set', id: 't2', fields: { form: 'slow' } }]);
    expect(r.ledger.text).toBe('the slow fox\njumps over');
  });

  it('types a letter inside a word', () => {
    const s = sample();
    const ledger = render(s, 'written');
    const r = reconcile(s, ledger, change(ledger, 6, 6, 'c'), 'written');
    expect(toText(r.stream)).toBe('the quckick fox\njumps over'.replace('quckick', 'qucick'));
    expect(r.ops[0]).toEqual({ t: 'set', id: 't2', fields: { form: 'qucick' } });
  });

  it('inserts a new word between two words', () => {
    const r = edit(sample(), 'quick fox', 'quick brown fox');
    expect(toText(r.stream)).toBe('the quick brown fox\njumps over');
    expect(r.ops).toEqual([
      { t: 'insert', after: 't2', items: [{ kind: 'token', id: 'n1', form: 'brown' }] },
    ]);
  });

  it('deletes a word and the space after it', () => {
    const r = edit(sample(), 'quick ', '');
    expect(toText(r.stream)).toBe('the fox\njumps over');
    expect(r.ops).toEqual([{ t: 'delete', ids: ['t2'] }]);
  });

  it('splits a word with a space: the first half keeps the id', () => {
    const r = edit(sample(), 'quick', 'qu ick');
    expect(toText(r.stream)).toBe('the qu ick fox\njumps over');
    expect(r.ops).toEqual([
      { t: 'insert', after: 't2', items: [{ kind: 'token', id: 'n1', form: 'ick' }] },
      { t: 'set', id: 't2', fields: { form: 'qu' } },
    ]);
  });

  it('joins two words by deleting the space between them', () => {
    const r = edit(sample(), 'quick fox', 'quickfox');
    expect(toText(r.stream)).toBe('the quickfox\njumps over');
    expect(r.ops).toEqual([
      { t: 'delete', ids: ['t3'] },
      { t: 'set', id: 't2', fields: { form: 'quickfox' } },
    ]);
  });

  it('inserts a line break and removes it again', () => {
    const r = edit(sample(), 'quick fox', 'quick\nfox');
    expect(toText(r.stream)).toBe('the quick\nfox\njumps over');
    expect(r.ops).toEqual([
      { t: 'insert', after: 't2', items: [{ kind: 'break', id: 'n1', type: 'line' }] },
    ]);
    const back = edit(r.stream, 'quick\nfox', 'quick fox');
    expect(toText(back.stream)).toBe('the quick fox\njumps over');
    expect(back.ops).toEqual([{ t: 'delete', ids: ['n1'] }]);
  });

  it('moves a segment start onto the next word when its word is deleted', () => {
    const r = edit(sample(), 'the ', '');
    expect(toText(r.stream)).toBe('quick fox\njumps over');
    expect((r.stream.items[0] as Token).segment).toEqual({ segmentId: 's1' });
    expect(r.ops).toEqual([
      { t: 'delete', ids: ['t1'] },
      { t: 'set', id: 't2', fields: { segment: { segmentId: 's1' } } },
    ]);
  });

  it('edits the read form without touching the written form', () => {
    const s = sample();
    const r = edit(s, 'quick', 'swift', 'read');
    const token = r.stream.items[1] as Token;
    expect(token.form).toBe('quick');
    expect(token.norm).toBe('swift');
    expect(r.ledger.text).toBe('the swift fox\njumps over');
    const back = edit(r.stream, 'swift', 'quick', 'read');
    expect((back.stream.items[1] as Token).norm).toBeUndefined();
  });

  it('marks a token unchecked when its written form changes under a read form', () => {
    const s = sample();
    (s.items[1] as Token).norm = 'swift';
    const r = edit(s, 'quick', 'quicke');
    const token = r.stream.items[1] as Token;
    expect(token.norm).toBe('swift');
    expect(token.unchecked).toBe(true);
  });

  it('keeps ranged marks in place through an edit elsewhere in the word', () => {
    const s = sample();
    (s.items[1] as Token).marks = [{ kind: 'unclear', from: 3, to: 5 }];
    const r = edit(s, 'quick', 'Xquick');
    const token = r.stream.items[1] as Token;
    expect(token.form).toBe('Xquick');
    expect(token.marks).toEqual([{ kind: 'unclear', from: 4, to: 6 }]);
  });

  it('keeps an object placeholder as the object', () => {
    const s = sample();
    s.items.splice(2, 0, { kind: 'object', id: 'g1', type: 'gap', attrs: { reason: 'lost' } });
    const ledger = render(s, 'written');
    expect(ledger.text).toBe('the quick ￼ fox\njumps over');
    const r = reconcile(s, ledger, change(ledger, 4, 9, 'slow'), 'written');
    expect(r.stream.items[2]!.kind).toBe('object');
    expect(toText(r.stream)).toBe('the slow [...] fox\njumps over');
  });

  it('types a whole new line at the end', () => {
    const s = sample();
    const ledger = render(s, 'written');
    const r = reconcile(
      s,
      ledger,
      change(ledger, ledger.text.length, ledger.text.length, '\nthe end'),
      'written',
      { ids: sequentialIds('n') },
    );
    expect(toText(r.stream)).toBe('the quick fox\njumps over\nthe end');
    expect(r.ops).toEqual([
      {
        t: 'insert',
        after: 't6',
        items: [
          { kind: 'break', id: 'n1', type: 'line' },
          { kind: 'token', id: 'n2', form: 'the' },
          { kind: 'token', id: 'n3', form: 'end' },
        ],
      },
    ]);
  });

  it('starts from an empty stream', () => {
    const s: Stream = { items: [] };
    const ledger = render(s, 'written');
    const r = reconcile(
      s,
      ledger,
      ChangeSet.of({ from: 0, to: 0, insert: 'μῆνιν ἄειδε' }, 0),
      'written',
      { ids: sequentialIds('n') },
    );
    expect(toText(r.stream)).toBe('μῆνιν ἄειδε');
    expect(r.ops).toEqual([
      {
        t: 'insert',
        after: null,
        items: [
          { kind: 'token', id: 'n1', form: 'μῆνιν' },
          { kind: 'token', id: 'n2', form: 'ἄειδε' },
        ],
      },
    ]);
  });

  it('applies a multi-change set in one go', () => {
    const s = sample();
    const ledger = render(s, 'written');
    const changes = ChangeSet.of(
      [
        { from: 0, to: 3, insert: 'The' },
        { from: 14, to: 19, insert: 'leaps' },
      ],
      ledger.text.length,
    );
    const r = reconcile(s, ledger, changes, 'written');
    expect(toText(r.stream)).toBe('The quick fox\nleaps over');
    expect(r.ops.map((o) => o.t)).toEqual(['set', 'set']);
    expect(Text.of(r.ledger.text.split('\n')).toString()).toBe('The quick fox\nleaps over');
  });
});

describe('a word divided across lines', () => {
  // Found in the workbench: undoing an Enter after a hyphen put the word's
  // two parts together again, and the word kept the join to the next line.
  it('put together again takes the join of its last part', () => {
    const s = fromText('ab\ncd ef', { lang: 'en', ids: sequentialIds() });
    (s.items[0] as Token).joinNext = true; // ab and cd are one word
    const r = edit(s, 'ab\ncd', 'ab-cd');
    expect(toText(r.stream)).toBe('ab-cd ef');
    expect((r.stream.items[0] as Token).joinNext).toBeUndefined();
    expect(r.ops).toContainEqual({ t: 'set', id: 't1', fields: { form: 'ab-cd' } });
    expect(r.ops).toContainEqual({ t: 'set', id: 't1', fields: { joinNext: undefined } });
  });

  it('keeps the join when its last part still continues on the next line', () => {
    const s = fromText('ab\ncd\nef', { lang: 'en', ids: sequentialIds() });
    (s.items[0] as Token).joinNext = true;
    (s.items[2] as Token).joinNext = true; // ab, cd and ef are one word
    const r = edit(s, 'ab\ncd', 'abcd');
    expect((r.stream.items[0] as Token).joinNext).toBe(true);
    expect(r.ops).toContainEqual({ t: 'set', id: 't1', fields: { form: 'abcd' } });
  });
});
