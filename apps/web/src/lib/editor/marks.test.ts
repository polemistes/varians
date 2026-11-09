import { describe, expect, it } from 'vitest';
import {
  applyOps,
  fromText,
  sequentialIds,
  type Id,
  type Item,
  type Stream,
  type Token,
} from '@varians/core';
import { render } from './bridge.ts';
import { variantEnds } from './decorations.ts';
import {
  addMarkOps,
  correctionIn,
  markTargets,
  removeMarkOps,
  setCorrectionOps,
  removeVariantOps,
  setVariantOps,
  variantSpanned,
  variantsIn,
} from './marks.ts';

function setup(text: string, form: 'written' | 'read' = 'written') {
  const stream = fromText(text, { ids: sequentialIds() });
  const ledger = render(stream, form);
  const byId = new Map<Id, Item>(stream.items.map((i) => [i.id, i]));
  return { stream, ledger, byId };
}

describe('markTargets', () => {
  it('marks whole tokens when the selection covers whole words', () => {
    const { ledger, byId } = setup('the quick fox');
    expect(markTargets(ledger, byId, 'written', 0, 9)).toEqual([
      { tokenId: 't1' },
      { tokenId: 't2' },
    ]);
    // Including the space after the word is still whole.
    expect(markTargets(ledger, byId, 'written', 4, 10)).toEqual([{ tokenId: 't2' }]);
  });

  it('marks the token at a collapsed caret', () => {
    const { ledger, byId } = setup('the quick fox');
    expect(markTargets(ledger, byId, 'written', 6, 6)).toEqual([{ tokenId: 't2' }]);
    expect(markTargets(ledger, byId, 'written', 3, 3)).toEqual([{ tokenId: 't1' }]);
  });

  it('marks a range inside one word in code points', () => {
    const { ledger, byId } = setup('the quick fox');
    expect(markTargets(ledger, byId, 'written', 5, 7)).toEqual([{ tokenId: 't2', from: 1, to: 3 }]);
    // Reversed selections are the same.
    expect(markTargets(ledger, byId, 'written', 7, 5)).toEqual([{ tokenId: 't2', from: 1, to: 3 }]);
  });

  it('counts code points, not UTF-16 units', () => {
    const { ledger, byId } = setup('𐤀𐤁𐤂𐤃');
    // The second and third letters: units 2..6.
    expect(markTargets(ledger, byId, 'written', 2, 6)).toEqual([{ tokenId: 't1', from: 1, to: 3 }]);
    // A selection of every unit is the whole token.
    expect(markTargets(ledger, byId, 'written', 0, 8)).toEqual([{ tokenId: 't1' }]);
  });

  it('marks the edges of a selection across words as ranges', () => {
    const { ledger, byId } = setup('the quick fox');
    expect(markTargets(ledger, byId, 'written', 2, 11)).toEqual([
      { tokenId: 't1', from: 2, to: 3 },
      { tokenId: 't2' },
      { tokenId: 't3', from: 0, to: 1 },
    ]);
  });

  it('marks the whole token in the read view where the read form differs', () => {
    const { stream, byId } = setup('ΜΗΝΙΝ ΑΕΙΔΕ');
    (stream.items[0] as Token).norm = 'μῆνιν';
    const ledger = render(stream, 'read');
    expect(markTargets(ledger, byId, 'read', 1, 3)).toEqual([{ tokenId: 't1' }]);
    // Where the forms agree the range is kept.
    expect(markTargets(ledger, byId, 'read', 7, 9)).toEqual([{ tokenId: 't2', from: 1, to: 3 }]);
  });
});

describe('addMarkOps and removeMarkOps', () => {
  it('adds a whole-token mark and removes it again', () => {
    const { stream, byId } = setup('the quick fox');
    const ops = addMarkOps(byId, [{ tokenId: 't2' }], 'unclear');
    expect(ops).toEqual([{ t: 'set', id: 't2', fields: { marks: [{ kind: 'unclear' }] } }]);
    const next: Stream = applyOps(stream, ops).stream;
    const byId2 = new Map<Id, Item>(next.items.map((i) => [i.id, i]));
    expect(removeMarkOps(byId2, [{ tokenId: 't2' }], 'unclear')).toEqual([
      { t: 'set', id: 't2', fields: { marks: undefined } },
    ]);
  });

  it('adds a ranged mark with attributes', () => {
    const { byId } = setup('the quick fox');
    expect(
      addMarkOps(byId, [{ tokenId: 't2', from: 1, to: 3 }], 'supplied', { reason: 'lost' }),
    ).toEqual([
      {
        t: 'set',
        id: 't2',
        fields: { marks: [{ kind: 'supplied', attrs: { reason: 'lost' }, from: 1, to: 3 }] },
      },
    ]);
  });

  it('does not add a mark already there, but updates its attributes', () => {
    const { stream, byId } = setup('the quick fox');
    (stream.items[1] as Token).marks = [{ kind: 'unclear' }];
    expect(addMarkOps(byId, [{ tokenId: 't2' }], 'unclear')).toEqual([]);
    expect(addMarkOps(byId, [{ tokenId: 't2', from: 1, to: 2 }], 'unclear')).toEqual([]);
    expect(addMarkOps(byId, [{ tokenId: 't2' }], 'unclear', { cert: 'low' })).toEqual([
      { t: 'set', id: 't2', fields: { marks: [{ kind: 'unclear', attrs: { cert: 'low' } }] } },
    ]);
  });

  it('a whole-token mark replaces ranges of its kind', () => {
    const { stream, byId } = setup('the quick fox');
    (stream.items[1] as Token).marks = [{ kind: 'unclear', from: 0, to: 2 }, { kind: 'del' }];
    expect(addMarkOps(byId, [{ tokenId: 't2' }], 'unclear')).toEqual([
      { t: 'set', id: 't2', fields: { marks: [{ kind: 'del' }, { kind: 'unclear' }] } },
    ]);
  });

  it('cuts a range out of the marks it touches', () => {
    const { stream, byId } = setup('the quick fox');
    (stream.items[1] as Token).marks = [
      { kind: 'unclear' },
      { kind: 'unclear', from: 3, to: 5 },
      { kind: 'del' },
    ];
    expect(removeMarkOps(byId, [{ tokenId: 't2', from: 1, to: 4 }], 'unclear')).toEqual([
      {
        t: 'set',
        id: 't2',
        fields: {
          marks: [
            { kind: 'unclear', from: 0, to: 1 },
            { kind: 'unclear', from: 4, to: 5 },
            { kind: 'unclear', from: 4, to: 5 },
            { kind: 'del' },
          ],
        },
      },
    ]);
    expect(removeMarkOps(byId, [{ tokenId: 't2', from: 1, to: 4 }], 'add')).toEqual([]);
  });
});

describe('variants noted in the carrier', () => {
  const groups = () => {
    let n = 0;
    return () => `g${++n}`;
  };
  const index = (stream: Stream) => new Map<Id, Item>(stream.items.map((i) => [i.id, i]));
  const marksOf = (stream: Stream) =>
    stream.items.map((i) => (i.kind === 'token' ? (i.marks ?? []).map((m) => `${m.kind}:${m.attrs?.group ?? ''}:${m.attrs?.reading ?? ''}`).join(',') : '|'));

  it('notes a variant over whole words with one group, from a selection that cuts into words', () => {
    const { stream, ledger, byId } = setup('the quick brown fox');
    const targets = markTargets(ledger, byId, 'written', 5, 12);
    const ops = setVariantOps(byId, targets, { reading: ' swift  red ', place: 'margin', hand: ' m2 ' }, groups());
    const next = applyOps(stream, ops).stream;
    expect(next.items[1]).toMatchObject({ marks: [{ kind: 'variant', attrs: { group: 'g1', reading: 'swift red', place: 'margin', hand: 'm2' } }] });
    expect(next.items[2]).toMatchObject({ marks: [{ kind: 'variant', attrs: { group: 'g1', reading: 'swift red', place: 'margin', hand: 'm2' } }] });
    expect(marksOf(next)).toEqual(['', 'variant:g1:swift red', 'variant:g1:swift red', '']);
  });

  it('keeps the other marks of a word, and changes a variant in place when its words are selected again', () => {
    const { stream, byId } = setup('the quick brown fox');
    (stream.items[1] as Token).marks = [{ kind: 'unclear' }];
    const once = applyOps(stream, setVariantOps(byId, [{ tokenId: 't2' }, { tokenId: 't3' }], { reading: 'x', place: 'margin' }, groups())).stream;
    expect(marksOf(once)).toEqual(['', 'unclear::,variant:g1:x', 'variant:g1:x', '']);
    const ids = index(once);
    expect(variantSpanned(ids, [{ tokenId: 't2' }, { tokenId: 't3' }])).toEqual({ group: 'g1', reading: 'x', place: 'margin' });
    expect(variantSpanned(ids, [{ tokenId: 't2' }])).toBeNull();
    const twice = applyOps(once, setVariantOps(ids, [{ tokenId: 't2' }, { tokenId: 't3' }], { reading: '', place: 'interlinear' }, () => 'new')).stream;
    expect(marksOf(twice)).toEqual(['', 'unclear::,variant:g1:', 'variant:g1:', '']);
  });

  it('replaces a variant the new one overlaps, on all its words', () => {
    const { stream, byId } = setup('the quick brown fox');
    const once = applyOps(stream, setVariantOps(byId, [{ tokenId: 't2' }, { tokenId: 't3' }], { reading: 'x', place: 'margin' }, groups())).stream;
    const twice = applyOps(once, setVariantOps(index(once), [{ tokenId: 't3' }, { tokenId: 't4' }], { reading: 'y', place: 'other' }, () => 'g2')).stream;
    expect(marksOf(twice)).toEqual(['', '', 'variant:g2:y', 'variant:g2:y']);
  });

  it('finds the variants a selection touches and removes them from all their words', () => {
    const { stream, byId } = setup('the quick brown fox');
    const once = applyOps(stream, setVariantOps(byId, [{ tokenId: 't2' }, { tokenId: 't3' }], { reading: 'x', place: 'margin' }, groups())).stream;
    const ids = index(once);
    expect(variantsIn(ids, [{ tokenId: 't3' }, { tokenId: 't4' }]).map((v) => v.group)).toEqual(['g1']);
    expect(variantsIn(ids, [{ tokenId: 't1' }])).toEqual([]);
    const ops = removeVariantOps(ids, [{ tokenId: 't3' }]);
    expect(ops).toEqual([
      { t: 'set', id: 't2', fields: { marks: null } },
      { t: 'set', id: 't3', fields: { marks: null } },
    ]);
    expect(marksOf(applyOps(once, ops).stream)).toEqual(['', '', '', '']);
    expect(removeVariantOps(ids, [{ tokenId: 't1' }])).toEqual([]);
  });

  it('finds the last word of each variant, across a line and between neighbouring variants', () => {
    const { stream, byId } = setup('a b\nc d e');
    const tokens = stream.items.filter((i) => i.kind === 'token').map((t) => t.id);
    let next = applyOps(stream, setVariantOps(byId, [{ tokenId: tokens[1]! }, { tokenId: tokens[2]! }], { reading: 'x', place: 'margin' }, () => 'g1')).stream;
    next = applyOps(next, setVariantOps(index(next), [{ tokenId: tokens[3]! }], { reading: 'y', place: 'margin' }, () => 'g2')).stream;
    expect([...variantEnds(next.items)]).toEqual([tokens[2], tokens[3]]);
  });
});

describe('corrections: hand and stage', () => {
  it('finds the deletions and additions of a selection and gives them a hand and a stage', () => {
    const { stream, ledger, byId } = setup('alpha beta gamma');
    const all = markTargets(ledger, byId, 'written', 0, 'alpha beta gamma'.length);
    const beta = all.filter((t) => t.tokenId === stream.items[1]!.id);
    expect(correctionIn(byId, all)).toBeNull();
    const marked = applyOps(stream, addMarkOps(byId, beta, 'del')).stream;
    const byId2 = new Map<Id, Item>(marked.items.map((i) => [i.id, i]));
    expect(correctionIn(byId2, all)).toEqual({ kinds: ['del'] });
    const ops = setCorrectionOps(byId2, beta, { hand: 'h2', seq: 2 });
    const corrected = applyOps(marked, ops).stream;
    const byId3 = new Map<Id, Item>(corrected.items.map((i) => [i.id, i]));
    expect((corrected.items[1] as Token).marks).toEqual([{ kind: 'del', attrs: { hand: 'h2', seq: 2 } }]);
    expect(correctionIn(byId3, all)).toEqual({ kinds: ['del'], hand: 'h2', seq: 2 });
    // Taking the stage away keeps the hand; nothing to change is no operation.
    const again = applyOps(corrected, setCorrectionOps(byId3, beta, { hand: 'h2' })).stream;
    expect((again.items[1] as Token).marks).toEqual([{ kind: 'del', attrs: { hand: 'h2' } }]);
    const byId4 = new Map<Id, Item>(again.items.map((i) => [i.id, i]));
    expect(setCorrectionOps(byId4, beta, { hand: 'h2' })).toEqual([]);
    // Words without a correction are left alone.
    expect(setCorrectionOps(byId4, all, { hand: 'h1' })).toHaveLength(1);
  });
});
