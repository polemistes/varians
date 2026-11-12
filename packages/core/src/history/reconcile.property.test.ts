import { describe, expect, it } from 'vitest';
import { isBreak, isToken, StreamError, type Id, type Item, type Stream } from '../stream/items.ts';
import { moveRun, moveToPage } from '../stream/move.ts';
import { applyOps, type Op } from '../stream/ops.ts';
import {
  Discard,
  RUNS,
  Rng,
  assume,
  clone,
  idsIn,
  membershipOf,
  pageIds,
  picture,
  randomOp,
  randomStream,
  runProperty,
  shrinkList,
  showOp,
  type Property,
} from '../testing/random.ts';
import type { Changeset } from './changeset.ts';
import { reconcile, type Reconciliation } from './reconcile.ts';

const SEGMENTS = ['s1', 's2', 's3', 's4', 's5'];

/** A document and the changesets two installations make to copies of it, each a list of operations. */
interface Case {
  base: Stream;
  left: Op[][];
  right: Op[][];
}

/** One random edit of a copy of the document: a move, a start set or taken away, a word typed, a form changed, a word deleted, a word divided. */
function edit(rng: Rng, content: Stream, who: string, fresh: () => Id, atStart: boolean): Op[] {
  const items = content.items;
  const kind = rng.weighted([
    ['move', 40],
    ['start', 30],
    ['type', 25],
    ['form', 15],
    ['delete', 6],
    ['split', 4],
    ['join', 3],
    ['page', 12],
    ['part', 8],
  ] as const);
  const plain = items.filter((i) => !(isBreak(i) && i.type === 'page'));
  const tokens = items.filter((i) => !isBreak(i));
  switch (kind) {
    case 'move': {
      if (plain.length === 0) return [];
      const at = items.indexOf(rng.pick(plain));
      const run = items.slice(at, at + rng.between(1, 3));
      if (run.some((i) => isBreak(i) && i.type === 'page')) return [];
      const ids = run.map((i) => i.id);
      const others = items.filter((i) => !ids.includes(i.id));
      const after =
        others.length === 0 || (atStart && rng.chance(0.1)) ? null : rng.pick(others).id;
      try {
        return moveRun(content, ids, after);
      } catch (error) {
        if (error instanceof StreamError) return [];
        throw error;
      }
    }
    case 'start': {
      if (tokens.length === 0) return [];
      const t = rng.pick(tokens);
      const has = !isBreak(t) && t.segment !== undefined;
      const segment = has && rng.chance(0.6) ? null : { segmentId: rng.pick(SEGMENTS) };
      return [{ t: 'set', id: t.id, fields: { segment } }];
    }
    case 'type': {
      const after = items.length === 0 || (atStart && rng.chance(0.08)) ? null : rng.pick(items).id;
      return [{ t: 'insert', after, items: [{ kind: 'token', id: fresh(), form: `${who}x` }] }];
    }
    case 'form': {
      const words = items.filter(isToken);
      if (words.length === 0) return [];
      return [{ t: 'set', id: rng.pick(words).id, fields: { form: `${who}y` } }];
    }
    case 'delete': {
      if (tokens.length === 0) return [];
      return [{ t: 'delete', ids: [rng.pick(tokens).id] }];
    }
    case 'page': {
      // Text moved to a page of the witness, or to Staging.
      if (plain.length === 0) return [];
      const at = items.indexOf(rng.pick(plain));
      const run = items.slice(at, at + rng.between(1, 3));
      if (run.some((i) => isBreak(i) && i.type === 'page')) return [];
      const target = rng.chance(0.2) ? null : rng.pick(pageIds(2));
      try {
        return moveToPage(
          content,
          run.map((i) => i.id),
          target,
          { pageOrder: pageIds(2), ids: fresh },
        );
      } catch (error) {
        if (error instanceof StreamError) return [];
        throw error;
      }
    }
    case 'part': {
      // A start with a part number, as a segment in several places has.
      if (tokens.length === 0) return [];
      const t = rng.pick(tokens);
      return [
        {
          t: 'set',
          id: t.id,
          fields: { segment: { segmentId: rng.pick(SEGMENTS), part: rng.between(1, 3) } },
        },
      ];
    }
    default: {
      const made = randomOp(rng, content, { kinds: [kind === 'join' ? 'join' : 'split'], fresh });
      return made ? [made] : [];
    }
  }
}

function makeSide(rng: Rng, base: Stream, who: string, atStart: boolean): Op[][] {
  let n = 0;
  const fresh = () => `${who}${++n}`;
  let content = base;
  const changesets: Op[][] = [];
  for (let c = rng.between(1, 2); c > 0; c--) {
    const ops: Op[] = [];
    for (let k = rng.between(1, 2); k > 0; k--) {
      const made = edit(rng, content, who, fresh, atStart);
      if (made.length === 0) continue;
      content = applyOps(content, made).stream;
      ops.push(...made);
    }
    if (ops.length > 0) changesets.push(ops);
  }
  return changesets;
}

function generate(rng: Rng, size: number, atStart = true): Case {
  const base = randomStream(rng, {
    size,
    segmentRate: rng.pick([0.1, 0.2, 0.3]),
    parts: rng.pick(['ordered', 'ordered', 'none'] as const),
    ...(rng.chance(0.3) ? { pages: pageIds(2) } : {}),
  });
  return {
    base,
    left: makeSide(rng, base, 'L', atStart),
    right: makeSide(rng, base, 'R', atStart),
  };
}

interface Side {
  log: Changeset[];
  content: Stream;
}

/** An installation's copy after its changesets; Discard when one no longer applies (a shrunk case). */
function side(base: Stream, who: string, changesets: Op[][]): Side {
  let content = base;
  const log: Changeset[] = [];
  try {
    for (const ops of changesets) {
      const { stream, reverse } = applyOps(content, ops);
      log.push({
        id: `${who}-${log.length + 1}`,
        documentId: 'd',
        version: log.length + 1,
        parentId: log.length === 0 ? null : `${who}-${log.length}`,
        userId: who,
        at: '',
        ops,
        reverse,
      });
      content = stream;
    }
  } catch (error) {
    if (error instanceof StreamError) throw new Discard('a changeset no longer applies');
    throw error;
  }
  return { log, content };
}

function show(c: Case): string {
  const lines = [`base: ${picture(c.base)}`];
  for (const [who, list] of [
    ['ours', c.left],
    ['theirs', c.right],
  ] as const)
    list.forEach((ops, k) => lines.push(`${who} ${k + 1}: ${ops.map(showOp).join(' ')}`));
  return lines.join('\n');
}

function* shrink(c: Case): Generator<Case> {
  for (const left of shrinkList(c.left)) yield { ...c, left };
  for (const right of shrinkList(c.right)) yield { ...c, right };
  for (let k = 0; k < c.left.length; k++)
    for (const ops of shrinkList(c.left[k]!, 1)) {
      const left = c.left.slice();
      left[k] = ops;
      yield { ...c, left };
    }
  for (let k = 0; k < c.right.length; k++)
    for (const ops of shrinkList(c.right[k]!, 1)) {
      const right = c.right.slice();
      right[k] = ops;
      yield { ...c, right };
    }
  for (const items of shrinkList(c.base.items)) yield { ...c, base: { items } };
}

interface Merged {
  ours: Side;
  theirs: Side;
  result: Extract<Reconciliation, { kind: 'merge' }>;
  base: Stream;
}

/** Reconcile our changes with theirs, as the server does, and keep the merges. */
function merged(c: Case): Merged {
  const ours = side(c.base, 'L', c.left);
  const theirs = side(c.base, 'R', c.right);
  assume(ours.log.length > 0 && theirs.log.length > 0, 'one side made no change');
  const result = reconcile(ours.log, theirs.log, ours.content, { incomingContent: theirs.content });
  assume(result.kind === 'merge', `the result is ${result.kind}`);
  return { ours, theirs, result, base: c.base };
}

const property = (check: (m: Merged, c: Case) => void, atStart = true): Property<Case> => ({
  generate: (rng, size) => generate(rng, size, atStart),
  maxSize: 24,
  show,
  shrink,
  check(c) {
    check(merged(c), c);
  },
});

describe('reconciling histories (random)', () => {
  it('puts every word that both sides and the base hold in a segment one of the two gave it', () => {
    runProperty(
      'reconcile: a word ends in a segment one side gave it',
      property(({ ours, theirs, result, base }) => {
        const b = membershipOf(base);
        const l = membershipOf(ours.content);
        const r = membershipOf(theirs.content);
        const m = membershipOf(result.content);
        for (const [id, here] of m) {
          if (!b.has(id) || !l.has(id) || !r.has(id)) continue;
          const given = [l.get(id), r.get(id)];
          expect(
            given,
            `${id}: merged in ${here ?? 'no segment'}, ours ${l.get(id) ?? '-'}, theirs ${r.get(id) ?? '-'}, base ${b.get(id) ?? '-'}\nours: ${picture(ours.content)}\ntheirs: ${picture(theirs.content)}\nmerged: ${picture(result.content)}`,
          ).toContain(here);
        }
      }),
    );
  });

  it('leaves a word neither side gave another segment in its old segment', () => {
    runProperty(
      'reconcile: a word neither side re-segmented keeps its segment',
      property(({ ours, theirs, result, base }) => {
        const b = membershipOf(base);
        const l = membershipOf(ours.content);
        const r = membershipOf(theirs.content);
        const m = membershipOf(result.content);
        for (const [id, here] of m) {
          if (!b.has(id) || !l.has(id) || !r.has(id)) continue;
          if (l.get(id) === b.get(id) && r.get(id) === b.get(id))
            expect(
              here,
              `${id} moved from ${b.get(id) ?? '-'} to ${here ?? '-'} though neither side changed its segment\nours: ${picture(ours.content)}\ntheirs: ${picture(theirs.content)}\nmerged: ${picture(result.content)}`,
            ).toBe(b.get(id));
        }
      }),
    );
  });

  it('keeps our segment for a word that theirs left in its old segment (design 3.12)', () => {
    runProperty(
      'reconcile: a word they left in its segment keeps the segment it has here',
      property(({ ours, theirs, result, base }) => {
        const b = membershipOf(base);
        const l = membershipOf(ours.content);
        const r = membershipOf(theirs.content);
        const m = membershipOf(result.content);
        for (const [id, here] of m) {
          if (!b.has(id) || !l.has(id) || !r.has(id)) continue;
          if (r.get(id) === b.get(id))
            expect(
              here,
              `${id}: theirs left it in ${b.get(id) ?? '-'}, ours ${l.get(id) ?? '-'}, merged ${here ?? '-'}\nours: ${picture(ours.content)}\ntheirs: ${picture(theirs.content)}\nmerged: ${picture(result.content)}`,
            ).toBe(l.get(id));
        }
      }),
    );
  });

  it('is undone by the reverse operations it returns, and is the result of applying its operations', () => {
    runProperty(
      'reconcile: reverse gives back the local text; ops give the merged text',
      property(({ ours, result }) => {
        const before = clone(ours.content);
        expect(applyOps(result.content, clone(result.reverse)).stream).toStrictEqual(before);
        expect(applyOps(ours.content, result.ops).stream).toStrictEqual(result.content);
        // The input was not changed.
        expect(ours.content).toStrictEqual(before);
      }),
    );
  });

  /** The other way round: they pull ours. */
  const converse = (m: Merged): Reconciliation =>
    reconcile(m.theirs.log, m.ours.log, m.theirs.content, { incomingContent: m.ours.content });

  const alike = (m: Merged) => {
    const back = converse(m);
    assume(back.kind === 'merge', `the other way it is ${back.kind}`);
    expect(
      idsIn(back.content),
      `order\nA+B: ${picture(m.result.content)}\nB+A: ${picture(back.content)}`,
    ).toStrictEqual(idsIn(m.result.content));
    expect(
      Object.fromEntries(membershipOf(back.content)),
      `segments\nA+B: ${picture(m.result.content)}\nB+A: ${picture(back.content)}`,
    ).toStrictEqual(Object.fromEntries(membershipOf(m.result.content)));
    // Not only the segments: every item the same.
    expect([...back.content.items].sort((x, y) => x.id.localeCompare(y.id))).toStrictEqual(
      [...m.result.content.items].sort((x, y) => x.id.localeCompare(y.id)),
    );
  };

  it('gives the same words in the same order with the same segments when each side merges the other, where no edit is made at the start of the text', () => {
    runProperty(
      'reconcile: A merges B and B merges A alike (no edit at the start)',
      property(alike, false),
    );
  });

  // Two installations that each put something at the very start of the text
  // share no item, but nothing orders their items: it is the conflict `overlap`.
  it('gives the same words in the same order with the same segments when each side merges the other', () => {
    runProperty('reconcile: A merges B and B merges A alike', property(alike));
  });

  it('gives the same text when each side merges the other (the shrunk case)', () => {
    const base: Stream = { items: [{ kind: 'token', id: 'a', form: 'a' }] };
    const c: Case = {
      base,
      left: [[{ t: 'insert', after: null, items: [{ kind: 'token', id: 'L1', form: 'Lx' }] }]],
      right: [[{ t: 'insert', after: null, items: [{ kind: 'token', id: 'R1', form: 'Rx' }] }]],
    };
    // Neither side merges the other: the same verdict, whoever pulls, naming both words.
    const ours = side(base, 'L', c.left);
    const theirs = side(base, 'R', c.right);
    for (const [here, there] of [
      [ours, theirs],
      [theirs, ours],
    ] as const) {
      const result = reconcile(here.log, there.log, here.content, {
        incomingContent: there.content,
      });
      expect(result.kind).toBe('conflict');
      if (result.kind === 'conflict') {
        expect(result.reason).toBe('overlap');
        expect([...result.ids].sort()).toStrictEqual(['L1', 'R1']);
      }
    }
  });

  // Whether two histories merge should not depend on which installation pulls
  // the other. Counterexample (shrunk): the text `t4@s1 t7 t8` (all three in
  // s1). We give t8 a start of s1 (no word changes segment); they give t7 the
  // start of s3, which moves t8, flowing from t7, into s3 on their side. When we
  // pull theirs the merge is `t4@s1 t7@s3 t8@s1`: t8 ends in s1, ours, which
  // they allow, since they gave it another segment. When they pull ours the
  // same text is a conflict `segments`: we left t8 in its segment, so, by the rule
  // of 3.12, it must keep the one they have (s3). The design's rule is stated
  // from the side that pulls, so the verdict is not symmetric. (The same with a
  // move: `¶ t7 t14` with none in a segment; we move t14 after the break, they
  // give t7 the start of s3.)
  it.fails('is a merge for each side when it is one for the other', () => {
    runProperty(
      'reconcile: A merges B exactly when B merges A',
      property((m) => {
        const back = converse(m);
        expect(
          back.kind,
          `the other way it is ${back.kind}\nours: ${picture(m.ours.content)}\ntheirs: ${picture(m.theirs.content)}`,
        ).toBe('merge');
      }, false),
    );
  });

  it.fails('is a merge for each side when it is one for the other (the shrunk case)', () => {
    const base: Stream = {
      items: [
        { kind: 'object', id: 't4', type: 'gap', segment: { segmentId: 's1' } },
        { kind: 'token', id: 't7', form: 'a' },
        { kind: 'token', id: 't8', form: 'b' },
      ],
    };
    const c: Case = {
      base,
      left: [[{ t: 'set', id: 't8', fields: { segment: { segmentId: 's1' } } }]],
      right: [[{ t: 'set', id: 't7', fields: { segment: { segmentId: 's3' } } }]],
    };
    const m = merged(c);
    expect(converse(m).kind).toBe('merge');
  });

  // Not in the design's wording, which speaks of the words both sides hold: a
  // word that only one side typed. It is put where that side put it, after the
  // word it was typed after, and the other side may have given that word another
  // segment, so it ends in a segment that neither side gave it (the side that
  // typed it saw it in another). Counterexample (shrunk): the text `t5 / t9`,
  // none of it in a segment; we give t5 the start of s5, which takes the rest of
  // the text into s5; they type R1 after t9, in no segment. The merge puts R1
  // in s5, with the t9 it follows, which is how the text reads after our change.
  // I take it for consistent with 3.5 and 3.12 (a word goes with the word it
  // stands after) and the property for too strong.
  it.fails('puts a word one side typed in the segment that side gave it', () => {
    runProperty(
      'reconcile: a word typed on one side keeps the segment its side gave it',
      property(({ ours, theirs, result, base }) => {
        const b = membershipOf(base);
        const l = membershipOf(ours.content);
        const r = membershipOf(theirs.content);
        const m = membershipOf(result.content);
        for (const [id, here] of m) {
          if (b.has(id)) continue;
          const typedBy = l.has(id) ? l : r;
          expect(
            here,
            `${id} typed on ${l.has(id) ? 'our' : 'their'} side in ${typedBy.get(id) ?? '-'}, merged into ${here ?? '-'}\nours: ${picture(ours.content)}\ntheirs: ${picture(theirs.content)}\nmerged: ${picture(result.content)}`,
          ).toBe(typedBy.get(id));
        }
      }),
    );
  });

  it('measures what reconciling the random histories gives', () => {
    const cases = Math.max(RUNS, 300);
    const tally: Record<string, number> = {};
    let asymmetric = 0;
    let both = 0;
    for (let seed = 1; seed <= cases; seed++) {
      const rng = new Rng(seed);
      const c = generate(rng, 1 + (seed % 24));
      let ours: Side;
      let theirs: Side;
      try {
        ours = side(c.base, 'L', c.left);
        theirs = side(c.base, 'R', c.right);
      } catch {
        continue;
      }
      if (ours.log.length === 0 || theirs.log.length === 0) {
        tally['one side made no change'] = (tally['one side made no change'] ?? 0) + 1;
        continue;
      }
      const there = reconcile(ours.log, theirs.log, ours.content, {
        incomingContent: theirs.content,
      });
      const key = there.kind === 'conflict' ? `conflict: ${there.reason}` : there.kind;
      tally[key] = (tally[key] ?? 0) + 1;
      const back = reconcile(theirs.log, ours.log, theirs.content, {
        incomingContent: ours.content,
      });
      if ((there.kind === 'merge') !== (back.kind === 'merge')) asymmetric++;
      if (there.kind === 'merge' && back.kind === 'merge') both++;
    }
    console.log(
      `[measure] reconciling ${cases} random pairs of histories, as ours pulling theirs: ${JSON.stringify(tally)}\n[measure]   merged one way and not the other: ${asymmetric}; merged both ways: ${both}`,
    );
    expect(Object.keys(tally).length).toBeGreaterThan(0);
  });
});
