/**
 * The order of whole segments as variants: where witnesses have some of the
 * edition's segments in another order, a variant over a stretch of the
 * edition's segments whose readings are the segments in each order. Built
 * from what comparing the orders says (`compareOrder`), pure, never stored.
 *
 * A statement says that a witness has a block of segments elsewhere, after a
 * segment of its own order. The stretch it concerns is the smallest run of
 * the edition's segments that holds the block and the place the witness puts
 * it. Stretches that overlap are one variant, so that statements of several
 * witnesses about the same block, or about blocks that cross, are readings
 * of one. Over the stretch every witness is compared by the segments of it
 * that it has: in the edition's order it stands with the edition, in another
 * order it has a reading of its own (witnesses with the same order are one
 * reading), and with fewer than two of them it is not there.
 *
 * A block far from its place (its stretch longer than `far` segments) is not
 * given by the whole stretch, which would list every segment in between, but
 * by the block and the segment it follows: in the edition, and in each
 * witness that has it elsewhere.
 */
import { compareOrder, type OrderStatement } from './order.ts';

/** A witness as its order is compared: the edition's segments it has, in its order. */
export interface OrderWitness {
  id: string;
  siglum: string;
  order: string[];
  /** What comparing the edition's order with this one gave, when the caller has it already. */
  statements?: readonly OrderStatement[];
}

interface OrderReadingBase {
  /** The edition's reading, which comes first. */
  base: boolean;
  /** The witnesses that have the reading, in the order they were given. The edition itself is not named. */
  textIds: string[];
  sigla: string[];
}

/** A reading of a stretch: its segments in this order (those the reading's witnesses have of them). */
export interface StretchReading extends OrderReadingBase {
  segments: string[];
}

/** A reading of a block far from its place: the block in this order, and the segment it follows (null where it opens the text). */
export interface BlockReading extends OrderReadingBase {
  moved: string[];
  after: string | null;
}

export type OrderVariant =
  | {
      far: false;
      /** The edition's segments concerned, in the edition's order. */
      segments: string[];
      readings: StretchReading[];
    }
  | {
      far: true;
      /** The block, in the edition's order. */
      segments: string[];
      readings: BlockReading[];
    };

/** The longest stretch given as a whole: a block whose stretch is longer is given by the segment it follows. */
export const FAR_STRETCH = 8;

interface Placed {
  witness: number;
  statement: OrderStatement;
  /** The stretch, by position in the edition's order: [lo, hi], both included. */
  lo: number;
  hi: number;
  /** The block's segments in the edition's order, joined: the block's key. */
  block: string;
}

/** The variants of the order of whole segments, in the order of the edition's text. */
export function orderVariants(
  edition: readonly string[],
  witnesses: readonly OrderWitness[],
  options: { far?: number } = {},
): OrderVariant[] {
  const bound = options.far ?? FAR_STRETCH;
  const position = new Map(edition.map((id, k) => [id, k] as const));
  const placed: Placed[] = [];
  witnesses.forEach((w, witness) => {
    const statements = w.statements ?? compareOrder([...edition], w.order);
    for (const statement of statements) {
      const at = statement.moved.map((id) => position.get(id)).filter((k) => k !== undefined);
      if (at.length === 0) continue;
      // The place the witness puts the block: before the edition's segment after the one it follows.
      const point = statement.after === null ? 0 : (position.get(statement.after) ?? -1) + 1;
      const lo = at.reduce((m, k) => Math.min(m, k), point);
      const hi = at.reduce((m, k) => Math.max(m, k), point - 1);
      const block = [...at]
        .sort((a, b) => a - b)
        .map((k) => edition[k]!)
        .join('\u0000');
      placed.push({ witness, statement, lo, hi, block });
    }
  });

  // A block that some witness has far from its place is given by what it follows, by every witness that moves it.
  const farBlocks = new Set(placed.filter((p) => p.hi - p.lo + 1 > bound).map((p) => p.block));
  const near = placed.filter((p) => !farBlocks.has(p.block));
  // What each witness has far from its place is reported there, and left out of the stretches.
  const movedFar = witnesses.map(() => new Set<string>());
  for (const p of placed)
    if (farBlocks.has(p.block)) for (const id of p.statement.moved) movedFar[p.witness]!.add(id);

  // Where each witness has each segment, found when first asked.
  const places: (Map<string, number> | undefined)[] = [];
  const placeIn = (k: number) =>
    (places[k] ??= new Map(witnesses[k]!.order.map((id, i) => [id, i] as const)));

  const out: { at: number; variant: OrderVariant }[] = [];

  // Stretches that overlap are one.
  const spans = near.map((p) => [p.lo, p.hi] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [lo, hi] of spans) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  for (const [lo, hi] of merged) {
    const segments = edition.slice(lo, hi + 1);
    const base: StretchReading = { segments, base: true, textIds: [], sigla: [] };
    const others = new Map<string, StretchReading>();
    witnesses.forEach((w, k) => {
      // The stretch's segments the witness has, in its order.
      const at = placeIn(k);
      const has = segments
        .filter((id) => at.has(id) && !movedFar[k]!.has(id))
        .sort((x, y) => at.get(x)! - at.get(y)!);
      if (has.length < 2) return;
      const inOrder = has.every(
        (id, i) => i === 0 || position.get(has[i - 1]!)! < position.get(id)!,
      );
      let reading = inOrder ? base : others.get(has.join('\u0000'));
      if (!reading) {
        reading = { segments: has, base: false, textIds: [], sigla: [] };
        others.set(has.join('\u0000'), reading);
      }
      reading.textIds.push(w.id);
      reading.sigla.push(w.siglum);
    });
    if (others.size === 0) continue;
    out.push({ at: lo, variant: { far: false, segments, readings: [base, ...others.values()] } });
  }

  for (const key of farBlocks) {
    const segments = key.split('\u0000');
    const first = position.get(segments[0]!)!;
    const base: BlockReading = {
      moved: segments,
      after: first > 0 ? edition[first - 1]! : null,
      base: true,
      textIds: [],
      sigla: [],
    };
    const others = new Map<string, BlockReading>();
    const inBlock = new Set(segments);
    witnesses.forEach((w, k) => {
      const own = placed.find((p) => p.witness === k && p.block === key);
      if (own) {
        const readingKey = `${own.statement.moved.join('\u0000')}\u0001${own.statement.after ?? ''}`;
        let reading = others.get(readingKey);
        if (!reading) {
          reading = {
            moved: [...own.statement.moved],
            after: own.statement.after,
            base: false,
            textIds: [],
            sigla: [],
          };
          others.set(readingKey, reading);
        }
        reading.textIds.push(w.id);
        reading.sigla.push(w.siglum);
        return;
      }
      // With the edition: a witness that has some of the block and moves none of it; one that moves some of it otherwise is reported there.
      const at = placeIn(k);
      if (!segments.some((id) => at.has(id))) return;
      const moves = placed.some(
        (p) => p.witness === k && p.statement.moved.some((id) => inBlock.has(id)),
      );
      if (moves) return;
      base.textIds.push(w.id);
      base.sigla.push(w.siglum);
    });
    out.push({ at: first, variant: { far: true, segments, readings: [base, ...others.values()] } });
  }

  return out.sort((a, b) => a.at - b.at).map((o) => o.variant);
}
