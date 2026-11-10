/**
 * Written and read forms in the workbench: the profile in
 * force, the read forms the user typed (for the memory), confirming
 * unchecked words, and what switching the written form on or off does to
 * the text. Pure; removals in operations are null, which survives JSON.
 */

import {
  agreeUnderFold,
  defaultProfile,
  isToken,
  profileOf,
  segmentStartOf,
  type ProfileFor,
  type Id,
  type Mark,
  type NormalizationMemory,
  type NormalizationProfile,
  type Op,
  type Stream,
  type Token,
} from '@varians/core';

/** The work's profile with the transcription's overrides; the language's default where there is no work. */
export function effectiveProfile(
  work: NormalizationProfile | null | undefined,
  overrides: Partial<NormalizationProfile> | null | undefined,
  language = 'grc',
): NormalizationProfile {
  const base = work ?? defaultProfile(language);
  if (!overrides) return base;
  return { ...base, ...overrides, fold: { ...base.fold, ...(overrides.fold ?? {}) } };
}

export interface FormPair {
  form: string;
  norm: string;
}

/** A read form typed for a token: the pair to remember once the user has left the word. */
export interface TypedReadForm extends FormPair {
  tokenId: Id;
}

/**
 * The read forms set by operations, read from the stream after them: one
 * entry per token whose read form now differs from its written form. A
 * token whose read form was cleared is reported with `norm` null, so that
 * a pending pair for it can be dropped.
 */
export function typedReadForms(ops: Op[], after: Stream): { tokenId: Id; pair: FormPair | null }[] {
  const touched = new Set<Id>();
  for (const op of ops) if (op.t === 'set' && 'norm' in op.fields) touched.add(op.id);
  if (touched.size === 0) return [];
  const out: { tokenId: Id; pair: FormPair | null }[] = [];
  for (const item of after.items) {
    if (!isToken(item) || !touched.has(item.id)) continue;
    const norm = item.norm;
    out.push({
      tokenId: item.id,
      pair:
        norm !== undefined && norm !== '' && norm !== item.form ? { form: item.form, norm } : null,
    });
  }
  return out;
}

/** Pairs without repeats, in order of first appearance. */
export function distinctPairs(pairs: FormPair[]): FormPair[] {
  const seen = new Set<string>();
  const out: FormPair[] = [];
  for (const pair of pairs) {
    const key = `${pair.form}\u0000${pair.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

/** The unchecked tokens among `tokenIds` (all of the stream when omitted). */
export function uncheckedIn(stream: Stream, tokenIds?: Iterable<Id>): Token[] {
  const wanted = tokenIds ? new Set(tokenIds) : null;
  return stream.items.filter(
    (item): item is Token =>
      isToken(item) && item.unchecked === true && (!wanted || wanted.has(item.id)),
  );
}

/**
 * Confirming the read forms of some tokens as they stand: the operations
 * that clear their check marks and the pairs the memory learns.
 */
export function confirmTokens(
  stream: Stream,
  tokenIds: Iterable<Id>,
  memory?: NormalizationMemory,
): { ops: Op[]; pairs: FormPair[] } {
  const ops: Op[] = [];
  const pairs: FormPair[] = [];
  for (const token of uncheckedIn(stream, tokenIds)) {
    ops.push({ t: 'set', id: token.id, fields: { unchecked: null } });
    if (token.norm !== undefined && token.norm !== token.form) {
      pairs.push({ form: token.form, norm: token.norm });
      memory?.remember(token.form, token.norm);
    }
  }
  return { ops, pairs: distinctPairs(pairs) };
}

/**
 * Tokens among `tokenIds` whose check mark the application clears by
 * itself: their written and read forms agree under the fold (`ΜΗΝΙΝ` read
 * as μῆνιν), so there is nothing for the editor to decide.
 */
export function autoConfirmOps(stream: Stream, tokenIds: Iterable<Id>, profiles: ProfileFor): Op[] {
  return uncheckedIn(stream, tokenIds)
    .filter((token) =>
      agreeUnderFold(token.form, token.norm ?? token.form, profileOf(profiles, token)),
    )
    .map((token) => ({ t: 'set' as const, id: token.id, fields: { unchecked: null } }));
}

/**
 * Turning the written form on: the text as it stands is the read form, and
 * the written form begins as a copy of it. Every token without a read form
 * of its own gets one, so that correcting the written form to what the
 * witness has leaves the read form where it was.
 */
export function keepWrittenFormOps(stream: Stream): Op[] {
  return stream.items
    .filter((item): item is Token => isToken(item) && item.norm === undefined)
    .map((token) => ({ t: 'set' as const, id: token.id, fields: { norm: token.form } }));
}

/**
 * Turning the written form off: the read form becomes the only form. Each
 * token with a read form of its own takes it as its form; marks placed on
 * letters of the old written form cover the whole word instead.
 */
export function dropWrittenFormOps(stream: Stream): Op[] {
  const ops: Op[] = [];
  for (const item of stream.items) {
    if (!isToken(item)) continue;
    if (item.norm === undefined && !item.unchecked) continue;
    const fields: Record<string, unknown> = { norm: null, unchecked: null };
    if (item.norm !== undefined && item.norm !== item.form) {
      fields.form = item.norm;
      const marks = wholeMarks(item.marks);
      if (marks !== item.marks) fields.marks = marks ?? null;
    }
    ops.push({ t: 'set', id: item.id, fields });
  }
  return ops;
}

function wholeMarks(marks: Mark[] | undefined): Mark[] | undefined {
  if (!marks || !marks.some((m) => m.from !== undefined || m.to !== undefined)) return marks;
  const out: Mark[] = [];
  const seen = new Set<string>();
  for (const mark of marks) {
    const whole: Mark = { kind: mark.kind };
    if (mark.attrs) whole.attrs = mark.attrs;
    const key = JSON.stringify(whole);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(whole);
  }
  return out;
}

interface ProfiledWork {
  id: string;
  language: string;
  profile: NormalizationProfile | null;
}

/**
 * The profile each token is read by: that of the work its stretch is
 * assigned to (the segment run it stands in), else that of `fallback`, the
 * first work the transcription is for. The transcription's overrides apply
 * to all. A miscellany of Greek and Latin works reads each by its own rules.
 */
export function profilesByWork(
  stream: Stream,
  segments: Record<string, { workId: string }>,
  works: ProfiledWork[],
  overrides: Partial<NormalizationProfile> | null | undefined,
  fallback: string | null,
): (token: Token) => NormalizationProfile {
  const profiles = new Map(
    works.map((w) => [w.id, effectiveProfile(w.profile, overrides, w.language)] as const),
  );
  const first =
    (fallback && profiles.get(fallback)) ||
    (works[0] ? profiles.get(works[0].id)! : effectiveProfile(null, overrides));
  const workOf = new Map<Id, string | null>();
  let current: string | null = null;
  for (const item of stream.items) {
    const start = segmentStartOf(item);
    if (start) current = start.segmentId ? (segments[start.segmentId]?.workId ?? null) : null;
    if (isToken(item)) workOf.set(item.id, current);
  }
  return (token) => {
    const work = workOf.get(token.id);
    return (work && profiles.get(work)) || first;
  };
}
