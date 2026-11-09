/**
 * Marks from a selection.
 *
 * A selection that covers whole words marks whole tokens; a selection inside
 * a word marks a range of its written form, counted in code points. In the
 * read view a range can be placed only where the read form is the written
 * form; otherwise the whole token is marked.
 */

import { isToken, type Id, type Item, type Mark, type Op } from '@varians/core';
import { spanAt, spansIn, tokenText, type Form, type Ledger } from './bridge.ts';
import { codePointIndex, codePointLength } from './unicode.ts';

export type MarkAttrs = Record<string, string | number | boolean | null>;

export interface MarkTarget {
  tokenId: Id;
  /** Code point range of the written form; absent for the whole token. */
  from?: number;
  to?: number;
}

/** The tokens, whole or in part, a selection (UTF-16 document positions) covers. */
export function markTargets(
  ledger: Ledger,
  byId: Map<Id, Item>,
  form: Form,
  from: number,
  to: number,
): MarkTarget[] {
  if (from > to) [from, to] = [to, from];
  if (from === to) {
    const span = spanAt(ledger, from);
    const token = span ? byId.get(span.id) : undefined;
    return isToken(token) ? [{ tokenId: token.id }] : [];
  }
  const out: MarkTarget[] = [];
  for (const span of spansIn(ledger, from, to)) {
    if (span.kind !== 'token') continue;
    const token = byId.get(span.id);
    if (!isToken(token)) continue;
    const start = Math.max(from, span.from);
    const end = Math.min(to, span.to);
    if (end <= start) continue;
    if (start <= span.from && end >= span.to) {
      out.push({ tokenId: token.id });
      continue;
    }
    if (form === 'read' && token.norm !== undefined) {
      out.push({ tokenId: token.id });
      continue;
    }
    const shown = tokenText(token, form);
    const cpFrom = codePointIndex(shown, start - span.from);
    const cpTo = codePointIndex(shown, end - span.from);
    if (cpTo <= cpFrom) continue;
    if (cpFrom === 0 && cpTo >= codePointLength(shown)) out.push({ tokenId: token.id });
    else out.push({ tokenId: token.id, from: cpFrom, to: cpTo });
  }
  return out;
}

function sameAttrs(a: MarkAttrs | undefined, b: MarkAttrs | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => a![k] === b?.[k]);
}

/** Operations adding a mark of `kind` to each target. A target already covered by the kind only has its attributes updated. */
export function addMarkOps(
  byId: Map<Id, Item>,
  targets: MarkTarget[],
  kind: string,
  attrs?: MarkAttrs,
): Op[] {
  const ops: Op[] = [];
  const given = attrs && Object.keys(attrs).length ? attrs : undefined;
  for (const target of targets) {
    const token = byId.get(target.tokenId);
    if (!isToken(token)) continue;
    const marks = token.marks ?? [];
    const whole = target.from === undefined;
    const covering = marks.find(
      (m) =>
        m.kind === kind &&
        (m.from === undefined || (!whole && m.from === target.from && m.to === target.to)),
    );
    if (covering) {
      if (given && !sameAttrs(covering.attrs, given)) {
        const next = marks.map((m) => (m === covering ? { ...m, attrs: given } : m));
        ops.push({ t: 'set', id: token.id, fields: { marks: next } });
      }
      continue;
    }
    const mark: Mark = { kind };
    if (given) mark.attrs = given;
    if (!whole) {
      mark.from = target.from;
      mark.to = target.to;
    }
    // A whole-token mark supersedes ranges of the same kind.
    const kept = whole ? marks.filter((m) => m.kind !== kind) : marks;
    ops.push({ t: 'set', id: token.id, fields: { marks: [...kept, mark] } });
  }
  return ops;
}

/** Operations removing marks of `kind` from each target: whole targets lose every such mark, ranges are cut out of the marks they touch. */
export function removeMarkOps(byId: Map<Id, Item>, targets: MarkTarget[], kind: string): Op[] {
  const ops: Op[] = [];
  for (const target of targets) {
    const token = byId.get(target.tokenId);
    if (!isToken(token)) continue;
    const marks = token.marks ?? [];
    if (!marks.some((m) => m.kind === kind)) continue;
    let kept: Mark[];
    if (target.from === undefined || target.to === undefined) {
      kept = marks.filter((m) => m.kind !== kind);
    } else {
      const length = codePointLength(token.form);
      kept = [];
      for (const mark of marks) {
        if (mark.kind !== kind) {
          kept.push(mark);
          continue;
        }
        const from = mark.from ?? 0;
        const to = mark.to ?? length;
        if (to <= target.from || from >= target.to) {
          kept.push(mark);
          continue;
        }
        if (from < target.from) kept.push({ ...mark, from, to: target.from });
        if (to > target.to) kept.push({ ...mark, from: target.to, to });
      }
      if (kept.length === marks.length && kept.every((m, i) => m === marks[i])) continue;
    }
    ops.push({ t: 'set', id: token.id, fields: { marks: kept.length ? kept : undefined } });
  }
  return ops;
}

/** The marks of a kind on a token, whole or ranged. */
export function marksOfKind(token: Item | undefined, kind: string): Mark[] {
  return isToken(token) ? (token.marks ?? []).filter((m) => m.kind === kind) : [];
}

/** Where a variant noted in the carrier stands. */
export type VariantPlace = 'margin' | 'interlinear' | 'other';

/** A variant noted in the carrier, as the dialog gives it (the mark's attrs without the group). */
export interface VariantAttrs {
  /** The variant's words as read; empty: the variant leaves the words out. */
  reading: string;
  place: VariantPlace;
  hand?: string;
}

/** A variant found on tokens: its group and attributes. */
export interface VariantFound extends VariantAttrs {
  group: string;
}

function variantOf(token: Item | undefined): VariantFound | null {
  if (!isToken(token)) return null;
  const mark = (token.marks ?? []).find((m) => m.kind === 'variant');
  const attrs = mark?.attrs;
  if (!attrs || typeof attrs.group !== 'string') return null;
  const place = attrs.place === 'margin' || attrs.place === 'interlinear' ? attrs.place : 'other';
  const found: VariantFound = { group: attrs.group, reading: typeof attrs.reading === 'string' ? attrs.reading : '', place };
  if (typeof attrs.hand === 'string' && attrs.hand !== '') found.hand = attrs.hand;
  return found;
}

/** The distinct variants on the tokens of the targets, in order. */
export function variantsIn(byId: Map<Id, Item>, targets: MarkTarget[]): VariantFound[] {
  const out: VariantFound[] = [];
  for (const target of targets) {
    const found = variantOf(byId.get(target.tokenId));
    if (found && !out.some((v) => v.group === found.group)) out.push(found);
  }
  return out;
}

/** The variant the targets are exactly the span of, if they are. */
export function variantSpanned(byId: Map<Id, Item>, targets: MarkTarget[]): VariantFound | null {
  const found = variantsIn(byId, targets);
  if (found.length !== 1) return null;
  const group = found[0]!.group;
  const targeted = new Set(targets.map((t) => t.tokenId));
  for (const [id, item] of byId) {
    const has = variantOf(item)?.group === group;
    if (has !== targeted.has(id)) return null;
  }
  return found[0]!;
}

function variantMarkOf(group: string, variant: VariantAttrs): Mark {
  const attrs: MarkAttrs = { group, reading: variant.reading.trim().replace(/\s+/gu, ' '), place: variant.place };
  const hand = variant.hand?.trim();
  if (hand) attrs.hand = hand;
  return { kind: 'variant', attrs };
}

/**
 * Operations noting a variant over the whole tokens of the targets: every
 * token gets the `variant` mark with one group. A variant the targets
 * overlap is replaced: its marks go from the tokens outside the targets too,
 * so that no variant is left covering part of its words. When the targets
 * are exactly one variant's span, that variant is changed and keeps its group.
 */
export function setVariantOps(byId: Map<Id, Item>, targets: MarkTarget[], variant: VariantAttrs, newGroup: () => string): Op[] {
  const targeted = new Set(targets.map((t) => t.tokenId).filter((id) => isToken(byId.get(id))));
  if (targeted.size === 0) return [];
  const overlapped = new Set(variantsIn(byId, targets).map((v) => v.group));
  const group = variantSpanned(byId, targets)?.group ?? newGroup();
  const mark = variantMarkOf(group, variant);
  const ops: Op[] = [];
  for (const [id, item] of byId) {
    if (!isToken(item)) continue;
    const marks = item.marks ?? [];
    const old = variantOf(item);
    let next: Mark[];
    if (targeted.has(id)) next = [...marks.filter((m) => m.kind !== 'variant'), mark];
    else if (old && overlapped.has(old.group)) next = marks.filter((m) => m.kind !== 'variant');
    else continue;
    if (JSON.stringify(next) === JSON.stringify(marks)) continue;
    ops.push({ t: 'set', id, fields: { marks: next.length ? next : null } });
  }
  return ops;
}

/** Operations removing the variants the targets touch, from every token of their spans. */
export function removeVariantOps(byId: Map<Id, Item>, targets: MarkTarget[]): Op[] {
  const groups = new Set(variantsIn(byId, targets).map((v) => v.group));
  if (groups.size === 0) return [];
  const ops: Op[] = [];
  for (const [id, item] of byId) {
    const old = variantOf(item);
    if (!isToken(item) || !old || !groups.has(old.group)) continue;
    const kept = (item.marks ?? []).filter((m) => m.kind !== 'variant');
    ops.push({ t: 'set', id, fields: { marks: kept.length ? kept : null } });
  }
  return ops;
}

/** The attributes of a correction, a deletion or an addition: the hand that made it and the stage it belongs to. */
export interface CorrectionAttrs {
  /** A hand of the witness by id, 'scribe', 'other', or a value as imported. */
  hand?: string;
  /** The order of the layers of correction: 1 for the first. */
  seq?: number;
}

/** The correction found on tokens: which kinds of mark, and the hand and stage of the first that names them. */
export interface CorrectionFound extends CorrectionAttrs {
  kinds: ('del' | 'add')[];
}

function isCorrection(mark: Mark): mark is Mark & { kind: 'del' | 'add' } {
  return mark.kind === 'del' || mark.kind === 'add';
}

/** The deletions and additions the targets touch, with the hand and stage they carry. */
export function correctionIn(byId: Map<Id, Item>, targets: MarkTarget[]): CorrectionFound | null {
  const kinds = new Set<'del' | 'add'>();
  let hand: string | undefined;
  let seq: number | undefined;
  for (const target of targets) {
    const token = byId.get(target.tokenId);
    if (!isToken(token)) continue;
    for (const mark of token.marks ?? []) {
      if (!isCorrection(mark)) continue;
      kinds.add(mark.kind);
      if (hand === undefined && typeof mark.attrs?.hand === 'string' && mark.attrs.hand !== '') hand = mark.attrs.hand;
      if (seq === undefined && typeof mark.attrs?.seq === 'number') seq = mark.attrs.seq;
    }
  }
  if (kinds.size === 0) return null;
  return { kinds: [...kinds], ...(hand !== undefined ? { hand } : {}), ...(seq !== undefined ? { seq } : {}) };
}

/** Operations giving every deletion and addition on the targets' tokens the hand and stage; a missing hand or stage takes it away. */
export function setCorrectionOps(byId: Map<Id, Item>, targets: MarkTarget[], attrs: CorrectionAttrs): Op[] {
  const ops: Op[] = [];
  const done = new Set<Id>();
  for (const target of targets) {
    if (done.has(target.tokenId)) continue;
    done.add(target.tokenId);
    const token = byId.get(target.tokenId);
    if (!isToken(token)) continue;
    const marks = token.marks ?? [];
    let changed = false;
    const next = marks.map((mark) => {
      if (!isCorrection(mark)) return mark;
      const rest: MarkAttrs = { ...(mark.attrs ?? {}) };
      delete rest.hand;
      delete rest.seq;
      if (attrs.hand) rest.hand = attrs.hand;
      if (attrs.seq !== undefined) rest.seq = attrs.seq;
      const updated: Mark = { ...mark };
      if (Object.keys(rest).length) updated.attrs = rest;
      else delete updated.attrs;
      if (!sameAttrs(mark.attrs, updated.attrs)) changed = true;
      return updated;
    });
    if (changed) ops.push({ t: 'set', id: token.id, fields: { marks: next } });
  }
  return ops;
}
