import { describe, expect, it } from 'vitest';
import {
  clone,
  idsIn,
  pageIds,
  picture,
  randomOps,
  randomStream,
  runProperty,
  shrinkOpsCase,
  showOp,
  showOpsCase,
  type OpsCase,
  type Rng,
} from '../testing/random.ts';
import { StreamError, type Stream } from './items.ts';
import { applyOp, applyOps, type Op } from './ops.ts';

function generator(replaceByNothing: boolean) {
  return (rng: Rng, size: number): OpsCase => {
    const stream = randomStream(rng, {
      size,
      marks: ['unclear', 'del', 'add', 'hi', 'gap', 'abbr'],
      norms: true,
      joins: true,
      ...(rng.chance(0.4) ? { pages: pageIds(3) } : {}),
    });
    return {
      stream,
      ops: randomOps(rng, stream, rng.between(1, 2 + size * 2), { replaceByNothing }),
    };
  };
}
const generate = generator(false);

function reverseRestores({ stream, ops }: OpsCase): void {
  const original = clone(stream);
  const applied = applyOps(stream, ops);
  expect(stream, 'the input stream was changed').toStrictEqual(original);
  const back = applyOps(applied.stream, applied.reverse);
  expect(back.stream).toStrictEqual(original);
  const stored = clone(applied.reverse);
  expect(applyOps(applied.stream, stored).stream).toStrictEqual(original);
  // And the reverse of the reverse is the operations' effect again.
  expect(applyOps(back.stream, ops).stream).toStrictEqual(applied.stream);
}

function unique(stream: Stream): void {
  const ids = idsIn(stream);
  expect(new Set(ids).size, `duplicate ids in ${picture(stream)}`).toBe(ids.length);
}

describe('operations (random)', () => {
  it('the reverse operations give back the stream exactly, also after the history stores them as JSON', () => {
    runProperty('ops: apply then reverse restores the stream', {
      generate,
      show: showOpsCase,
      shrink: shrinkOpsCase,
      check: reverseRestores,
    });
  });

  // Counterexample (shrunk): the stream `t1:a` and the single operation
  // `{"t":"replace","ids":["t1"],"items":[]}`. `replace` accepts an empty list
  // of new items (the run is simply removed), but the reverse it returns is
  // `{"t":"replace","ids":[],"items":[t1]}`, and `replace` refuses an empty
  // list of ids ("replace needs at least one item"), so the history holds a
  // reverse that cannot be applied. Either `replace` should refuse an empty
  // `items` (the message suggests that was meant) or its reverse should be an
  // `insert`.
  it.fails('also when a replace puts nothing in place of the items it takes out', () => {
    runProperty('ops: apply then reverse restores the stream (replace by nothing allowed)', {
      generate: generator(true),
      show: showOpsCase,
      shrink: shrinkOpsCase,
      check: reverseRestores,
    });
  });

  it('each operation is undone by the reverse it returns', () => {
    runProperty('ops: every single operation is undone by its own reverse', {
      generate,
      show: showOpsCase,
      shrink: shrinkOpsCase,
      check({ stream, ops }) {
        let current = stream;
        for (const op of ops) {
          const before = clone(current);
          const applied = applyOp(current, op);
          expect(applyOps(applied.stream, clone(applied.reverse)).stream, showOp(op)).toStrictEqual(
            before,
          );
          current = applied.stream;
        }
      },
    });
  });

  it('item ids stay unique and no operation changes the stream it is given', () => {
    runProperty('ops: ids stay unique', {
      generate,
      show: showOpsCase,
      shrink: shrinkOpsCase,
      check({ stream, ops }) {
        let current = stream;
        unique(current);
        for (const op of ops) {
          const before = clone(current);
          current = applyOp(current, op).stream;
          expect(before).toStrictEqual(clone(before));
          unique(current);
        }
      },
    });
  });
});

/** A valid operation with one of the ids it names made one that is not in the stream. */
interface MissingCase {
  stream: Stream;
  op: Op;
}

const GONE = 'no-such-id';

function withMissingId(rng: Rng, op: Op, empty: boolean): Op | null {
  switch (op.t) {
    case 'insert':
      return { ...op, after: GONE, items: empty ? [] : op.items };
    case 'delete': {
      if (empty) return null;
      const ids = op.ids.slice();
      ids[rng.int(ids.length)] = GONE;
      return { ...op, ids };
    }
    case 'set':
      return empty ? null : { ...op, id: GONE };
    case 'move': {
      if (empty) return { t: 'move', ids: [], after: GONE };
      if (rng.chance(0.5)) return { ...op, after: GONE };
      const ids = op.ids.slice();
      ids[rng.int(ids.length)] = GONE;
      return { ...op, ids };
    }
    case 'split':
      return empty ? null : { ...op, id: GONE };
    case 'join':
      return empty ? null : { ...op, id: GONE };
    case 'replace': {
      if (empty) return null;
      const ids = op.ids.slice();
      ids[rng.int(ids.length)] = GONE;
      return { ...op, ids };
    }
  }
}

function missingCase(empty: boolean) {
  return {
    generate(rng: Rng, size: number): MissingCase {
      for (;;) {
        const stream = randomStream(rng, { size, marks: ['unclear'], norms: true });
        for (const op of randomOps(rng, stream, 6)) {
          const broken = withMissingId(rng, op, empty);
          if (broken) return { stream, op: broken };
        }
      }
    },
    show: (c: MissingCase) => `stream: ${picture(c.stream)}\nop: ${showOp(c.op)}`,
    *shrink(c: MissingCase): Generator<MissingCase> {
      for (let i = 0; i < c.stream.items.length; i++)
        yield { stream: { items: c.stream.items.filter((_, k) => k !== i) }, op: c.op };
    },
    check({ stream, op }: MissingCase) {
      const before = clone(stream);
      let error: unknown;
      try {
        applyOp(stream, op);
      } catch (e) {
        error = e;
      }
      expect(error, `applyOp did not throw for ${showOp(op)}`).toBeInstanceOf(StreamError);
      expect(stream).toStrictEqual(before);
      error = undefined;
      try {
        applyOps(stream, [op]);
      } catch (e) {
        error = e;
      }
      expect(error, `applyOps did not throw for ${showOp(op)}`).toBeInstanceOf(StreamError);
      expect(stream).toStrictEqual(before);
    },
  };
}

describe('operations naming an id that is not there (random)', () => {
  it('throw a StreamError and change nothing', () => {
    runProperty('ops: a missing id throws StreamError', missingCase(false));
  });

  // Counterexample (shrunk): the stream `t1:a`, the operation
  // `{"t":"insert","after":"no-such-id","items":[]}` (likewise
  // `{"t":"move","ids":[],"after":"no-such-id"}`). `insert` and `move` return
  // before they look at `after` when there is nothing to insert or move, so
  // an operation that names an item that is not there is accepted. No state
  // is changed by it; the fault is only that the anchor is not checked.
  it.fails('also when there is nothing to insert or to move', () => {
    runProperty(
      'ops: a missing anchor throws, even for an empty insert or move',
      missingCase(true),
    );
  });
});
