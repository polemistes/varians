import { describe, expect, it } from 'vitest';
import { orderVariants, type OrderWitness } from './order-variants.ts';
import { compareOrder } from './order.ts';

const lines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => String(from + k));

function witness(siglum: string, order: string[]): OrderWitness {
  return { id: `t${siglum}`, siglum, order };
}

/** A variant in short: the stretch, then each reading's order (or block and what it follows) with its sigla. */
function show(variants: ReturnType<typeof orderVariants>): string[] {
  return variants.map(
    (v) =>
      `${v.far ? 'far ' : ''}[${v.segments.join(' ')}] ` +
      v.readings
        .map((r) =>
          'moved' in r
            ? `${r.base ? '*' : ''}${r.moved.join(' ')} after ${r.after ?? '^'}: ${r.sigla.join('')}`
            : `${r.base ? '*' : ''}${r.segments.join(' ')}: ${r.sigla.join('')}`,
        )
        .join(' | '),
  );
}

describe('orderVariants', () => {
  it('finds none where every witness keeps the edition’s order', () => {
    const edition = lines(1, 6);
    expect(orderVariants(edition, [witness('A', edition), witness('B', ['1', '3', '6'])])).toEqual(
      [],
    );
  });

  it('gives one variant over the stretch, the edition’s order first, witnesses with the same order as one reading', () => {
    const edition = lines(1, 6);
    const variants = orderVariants(edition, [
      witness('A', ['1', '2', '4', '3', '5', '6']),
      witness('B', ['1', '2', '4', '3', '5', '6']),
      witness('C', ['1', '4', '2', '3', '5', '6']),
      witness('D', edition),
      // Without 3, the rest of the stretch in the edition's order.
      witness('E', ['1', '2', '4', '5', '6']),
      // One segment of the stretch only: not there.
      witness('F', ['1', '3', '5', '6']),
    ]);
    expect(show(variants)).toEqual(['[2 3 4] *2 3 4: DE | 2 4 3: AB | 4 2 3: C']);
    expect(variants[0]!.readings[1]!.textIds).toEqual(['tA', 'tB']);
  });

  it('keeps stretches that do not overlap apart, in the order of the text', () => {
    const edition = lines(1, 8);
    expect(
      show(
        orderVariants(edition, [
          witness('A', ['1', '2', '3', '4', '5', '7', '6', '8']),
          witness('B', ['2', '1', '3', '4', '5', '6', '7', '8']),
        ]),
      ),
    ).toEqual(['[1 2] *1 2: A | 2 1: B', '[6 7] *6 7: B | 7 6: A']);
  });

  it('gives a block far from its place by the segment it follows, in the edition and in the witness', () => {
    const edition = lines(1, 20);
    const moved = ['1', '2', '15', ...lines(3, 14), ...lines(16, 20)];
    const variants = orderVariants(edition, [
      witness('A', moved),
      witness('B', moved),
      witness('C', edition),
      // Without the block: not there.
      witness(
        'D',
        edition.filter((id) => id !== '15'),
      ),
      // The same block elsewhere: another reading of the one variant.
      witness('E', ['15', ...edition.filter((id) => id !== '15')]),
    ]);
    expect(show(variants)).toEqual(['far [15] *15 after 14: C | 15 after 2: AB | 15 after ^: E']);
  });

  it('leaves a segment a witness has far away out of the stretches it is compared over', () => {
    const edition = lines(1, 20);
    // A has 15 far from its place, and 4 and 5 the other way round.
    const a = ['1', '2', '15', '3', '5', '4', ...lines(6, 14), ...lines(16, 20)];
    const variants = orderVariants(edition, [witness('A', a), witness('B', edition)]);
    expect(show(variants)).toEqual([
      '[4 5] *4 5: B | 5 4: A',
      'far [15] *15 after 14: B | 15 after 2: A',
    ]);
  });

  it('takes the statements the caller has remembered', () => {
    const edition = lines(1, 4);
    const order = ['1', '3', '2', '4'];
    const given = orderVariants(edition, [
      { ...witness('A', order), statements: compareOrder(edition, order) },
    ]);
    expect(given).toEqual(orderVariants(edition, [witness('A', order)]));
  });

  it('bounds the stretch given whole by the option', () => {
    const edition = lines(1, 6);
    const order = ['1', '5', '2', '3', '4', '6'];
    expect(show(orderVariants(edition, [witness('A', order)]))).toEqual([
      '[2 3 4 5] *2 3 4 5:  | 5 2 3 4: A',
    ]);
    expect(show(orderVariants(edition, [witness('A', order)], { far: 3 }))).toEqual([
      'far [5] *5 after 4:  | 5 after 1: A',
    ]);
  });
});
