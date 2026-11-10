/**
 * Editing an edition's text by adopting: the operations that make a
 * reading of a witness, a conjecture, or nothing at all the edition's text
 * at a site. The edition is a stream like any other; these functions only
 * compose operations on it.
 */

import { newId } from '../ids.ts';
import type { Reading, Site } from '../collate/collate.ts';
import {
  isBreak,
  isObj,
  isToken,
  type Break,
  type Id,
  type Item,
  type Stream,
  type Token,
  type TokenSource,
} from '../stream/items.ts';
import { orphanedLineBreak, repairSegmentStartsFrom } from '../stream/move.ts';
import { applyOp, type Op } from '../stream/ops.ts';
import { segmentRuns, type Unit } from '../stream/words.ts';

export interface AdoptOptions {
  ids?: () => Id;
  /**
   * Where adopted words are of a segment the edition does not have, they
   * stand on a line of their own, as a line of verse (true, the default),
   * or in the run of the text, as prose (false).
   */
  ownLine?: boolean;
}

export interface ReplaceOptions extends AdoptOptions {
  /**
   * The segment each new item is to take, by its position among the items.
   * Where none is given for an item, it takes the segment of the place: of
   * the first word replaced, or at a point, of the word before it (the word
   * after it at the very start).
   */
  segments?: readonly (Id | undefined)[];
}

/** The ids of the base tokens a site covers, in stream order. */
export function siteTokenIds(site: Site, baseUnits: Unit[]): Id[] {
  const ids: Id[] = [];
  for (let i = site.baseFrom; i < site.baseTo; i++) {
    for (const id of baseUnits[i]?.tokenIds ?? []) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** New edition tokens carrying a witness reading, with their source. */
export function tokensFromReading(
  reading: Reading,
  textId: Id,
  options: AdoptOptions = {},
): Token[] {
  const ids = options.ids ?? newId;
  const units = reading.units[textId] ?? [];
  // Units of one word (a read form with spaces) share token ids; print them as one edition token each.
  return units
    .filter((u) => !u.gap)
    .map((u) => ({
      kind: 'token' as const,
      id: ids(),
      form: u.text,
      // A witness collated in its state before correction goes by "<id>:original", with the variants it notes by
      // "<id>:variant"; the source is the transcription either way.
      source: {
        kind: 'witness',
        transcriptionId: textId.replace(/:(original|variant)$/u, ''),
        tokenIds: u.tokenIds,
      } satisfies TokenSource,
    }));
}

/** New edition tokens for a conjecture's reading. */
export function tokensFromConjecture(
  text: string,
  conjectureId: Id,
  options: AdoptOptions & { supplied?: boolean } = {},
): Token[] {
  const ids = options.ids ?? newId;
  return text
    .split(/\s+/u)
    .filter((w) => w.length > 0)
    .map((form) => {
      const token: Token = {
        kind: 'token',
        id: ids(),
        form,
        source: { kind: 'conjecture', conjectureId },
      };
      if (options.supplied) token.marks = [{ kind: 'supplied', attrs: { resp: conjectureId } }];
      return token;
    });
}

/**
 * The line break that stays behind when these words are all there is on their
 * line: a removal that left it would keep an empty line in the text. Null
 * where the words are not one unbroken stretch, or where something else
 * stands on their line.
 */
function emptiedLineBreak(stream: Stream, ids: readonly Id[]): Id | null {
  const gone = new Set(ids);
  const first = stream.items.findIndex((item) => item.id === ids[0]);
  const last = stream.items.findIndex((item) => item.id === ids[ids.length - 1]);
  if (first < 0 || last < first || last - first + 1 !== gone.size) return null;
  if (!stream.items.slice(first, last + 1).every((item) => gone.has(item.id))) return null;
  return orphanedLineBreak(stream.items[first - 1], stream.items[last + 1], gone);
}

/**
 * Put items on a line of their own after the item `at` (null: at the start
 * of the text): a line break before them unless `at` ends a line already,
 * and one after them where text follows on the same line. Where an empty
 * line follows directly (one left in the text, as an editor leaves a blank
 * line, or one at the end of the text), the items fill it.
 */
export function ownLineInsert(
  stream: Stream,
  at: Id | null,
  items: Item[],
  ids: () => Id = newId,
): Op {
  const lineBreak = (): Break => ({ kind: 'break', id: ids(), type: 'line' });
  if (at === null) {
    const first = stream.items[0];
    return {
      t: 'insert',
      after: null,
      items: first && !isBreak(first) ? [...items, lineBreak()] : items,
    };
  }
  const index = stream.items.findIndex((item) => item.id === at);
  const here = stream.items[index];
  const next = stream.items[index + 1];
  const following = stream.items[index + 2];
  if (isBreak(here))
    return {
      t: 'insert',
      after: at,
      items: next && !isBreak(next) ? [...items, lineBreak()] : items,
    };
  if (isBreak(next) && next.type === 'line' && (following === undefined || isBreak(following)))
    return { t: 'insert', after: next.id, items };
  const inserted: Item[] = [lineBreak(), ...items];
  if (next && !isBreak(next)) inserted.push(lineBreak());
  return { t: 'insert', after: at, items: inserted };
}

/** The segment every token and object of a stream belongs to by flow (null: unassigned). */
function segmentsOf(stream: Stream): Map<Id, Id | null> {
  const out = new Map<Id, Id | null>();
  for (const run of segmentRuns(stream))
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (isToken(item) || isObj(item)) out.set(item.id, run.segmentId);
    }
  return out;
}

/** A place new words can take at a site: after a word, over the site's words of one segment, or before a word. */
type Place =
  | { kind: 'after'; id: Id; segment: Id | null }
  | { kind: 'words'; ids: Id[]; segment: Id | null }
  | { kind: 'before'; id: Id; segment: Id | null };

/**
 * Replace the edition's words at a site by new items. With no new items the
 * site's words are removed (the absence of a reading adopted), and with them
 * the line break that would leave an empty line, as moving text away does.
 *
 * Each new item takes the segment `options.segments` gives it, or the
 * segment of the place. The new items of a segment go in place of the
 * site's words of that segment; where the site has none of them, after the
 * edition's word before the site, or before the word after it, whichever
 * stands in that segment (so that at a boundary between two segments the
 * words go to their own side of it); and where the segment is one the
 * edition does not have at all, on a line of their own after what precedes
 * them (`ownLine`, the default), or in the run of the text. No other word of
 * the edition changes segment: the segment starts are repaired as a move
 * repairs them, and the parts of a segment numbered in content order.
 */
export function replaceAtSite(
  stream: Stream,
  site: Site,
  baseUnits: Unit[],
  items: Item[],
  options: ReplaceOptions = {},
): Op[] {
  const makeId = options.ids ?? newId;
  const ids = siteTokenIds(site, baseUnits);
  const segmentOf = segmentsOf(stream);
  const inStream = (id: Id | undefined): id is Id => id !== undefined && segmentOf.has(id);
  const replaced = new Set(ids);
  // The edition's word before the site and the word after it, passing over units that name nothing in the stream.
  let before: Id | undefined;
  for (let i = site.baseFrom - 1; i >= 0 && before === undefined; i--) {
    const unit = baseUnits[i]!;
    const id = unit.tokenIds.length ? unit.tokenIds[unit.tokenIds.length - 1] : unit.gap?.id;
    if (inStream(id) && !replaced.has(id)) before = id;
  }
  let after: Id | undefined;
  for (let i = site.baseTo; i < baseUnits.length && after === undefined; i++) {
    const unit = baseUnits[i]!;
    const id = unit.tokenIds.length ? unit.tokenIds[0] : unit.gap?.id;
    if (inStream(id) && !replaced.has(id)) after = id;
  }
  const places: Place[] = [];
  if (before !== undefined)
    places.push({ kind: 'after', id: before, segment: segmentOf.get(before)! });
  for (const id of ids) {
    const segment = segmentOf.get(id) ?? null;
    const last = places[places.length - 1];
    if (last?.kind === 'words' && last.segment === segment) last.ids.push(id);
    else places.push({ kind: 'words', ids: [id], segment });
  }
  if (after !== undefined)
    places.push({ kind: 'before', id: after, segment: segmentOf.get(after)! });
  const placeSegment: Id | null =
    ids.length > 0
      ? (segmentOf.get(ids[0]!) ?? null)
      : before !== undefined
        ? segmentOf.get(before)!
        : after !== undefined
          ? segmentOf.get(after)!
          : null;

  // The new items in runs of one segment each: the first of a run starts its segment, the others
  // lose the starts they bring. The repair below takes away a start that the place does not need.
  interface Group {
    segment: Id | null;
    items: Item[];
  }
  const groups: Group[] = [];
  items.forEach((item, k) => {
    const copy = { ...item } as Item;
    if (isToken(copy) || isObj(copy)) delete copy.segment;
    const segment = options.segments?.[k] ?? placeSegment;
    const last = groups[groups.length - 1];
    if (last && last.segment === segment) last.items.push(copy);
    else {
      if (isToken(copy) || isObj(copy)) copy.segment = { segmentId: segment };
      groups.push({ segment, items: [copy] });
    }
  });

  // Each run to a place of its segment, in order: in place of the site's words of it first.
  const known = new Set(segmentOf.values());
  const placed: { group: Group; at: number; fits: boolean }[] = [];
  const taken = new Set<number>();
  let cursor = 0;
  for (const group of groups) {
    let at = -1;
    for (let p = cursor; p < places.length; p++) {
      const place = places[p]!;
      if (place.segment !== group.segment || taken.has(p)) continue;
      if (place.kind === 'words') {
        at = p;
        break;
      }
      if (at < 0) at = p;
    }
    if (at >= 0) {
      if (places[at]!.kind === 'words') taken.add(at);
      cursor = at;
    }
    placed.push({ group, at: at >= 0 ? at : cursor, fits: at >= 0 });
  }

  const ops: Op[] = [];
  let current = stream;
  const push = (op: Op) => {
    current = applyOp(current, op).stream;
    ops.push(op);
  };
  const itemBefore = (id: Id): Id | null => {
    const index = current.items.findIndex((item) => item.id === id);
    return index > 0 ? current.items[index - 1]!.id : null;
  };
  /** The item a new line goes after: `id`, or the last of what follows it on its line that is not a word. */
  const lineEnd = (id: Id): Id => {
    let index = current.items.findIndex((item) => item.id === id);
    while (index + 1 < current.items.length && isObj(current.items[index + 1])) index++;
    return current.items[index]!.id;
  };
  let last: Id | null = null;
  for (const { group, at, fits } of placed) {
    const place = places[at];
    if (!place) {
      // A site in a text with no words: at the start.
      push({ t: 'insert', after: last, items: group.items });
    } else if (fits && place.kind === 'words') {
      const indexes = place.ids.map((id) => current.items.findIndex((item) => item.id === id));
      const contiguous = indexes.every((idx, k) => k === 0 || idx === indexes[k - 1]! + 1);
      if (contiguous) push({ t: 'replace', ids: place.ids, items: group.items });
      else {
        push({ t: 'replace', ids: [place.ids[0]!], items: group.items });
        push({ t: 'delete', ids: place.ids.slice(1) });
      }
    } else if (fits && place.kind === 'before') {
      push({ t: 'insert', after: itemBefore(place.id), items: group.items });
    } else if (fits) {
      push({
        t: 'insert',
        after: last ?? (place.kind === 'after' ? place.id : null),
        items: group.items,
      });
    } else {
      // A segment the edition does not have here: after what was put last, or where the place is.
      const anchor =
        last ??
        (place.kind === 'after'
          ? place.id
          : itemBefore(place.kind === 'words' ? place.ids[0]! : place.id));
      const fresh = group.segment !== null && !known.has(group.segment);
      if (fresh && options.ownLine !== false) {
        const end =
          anchor !== null && !isBreak(current.items.find((i) => i.id === anchor))
            ? lineEnd(anchor)
            : anchor;
        push(ownLineInsert(current, end, group.items, makeId));
      } else push({ t: 'insert', after: anchor, items: group.items });
    }
    last = group.items[group.items.length - 1]!.id;
  }

  // The site's words that no new word took the place of, and the line break they would leave empty.
  const left = places.filter((place, p) => place.kind === 'words' && !taken.has(p)) as Extract<
    Place,
    { kind: 'words' }
  >[];
  if (left.length > 0) {
    const orphans = new Set<Id>();
    if (groups.length === 0) {
      const orphan = emptiedLineBreak(current, ids);
      if (orphan !== null) orphans.add(orphan);
    } else
      for (const place of left) {
        const orphan = emptiedLineBreak(current, place.ids);
        if (orphan !== null) orphans.add(orphan);
      }
    push({ t: 'delete', ids: left.flatMap((place) => place.ids) });
    if (orphans.size > 0) push({ t: 'delete', ids: [...orphans] });
  }

  // Every word keeps its segment, and each new one takes its own: the starts the moves need, those
  // on new items written into the items themselves.
  const reference: Stream = { items: groups.flatMap((g) => g.items.map((item) => ({ ...item }))) };
  const fresh = new Map(groups.flatMap((g) => g.items).map((item) => [item.id, item] as const));
  const repairs: Op[] = [];
  for (const op of repairSegmentStartsFrom([stream, reference], current)) {
    const item = op.t === 'set' ? fresh.get(op.id) : undefined;
    if (op.t !== 'set' || !item || !(isToken(item) || isObj(item))) {
      repairs.push(op);
      continue;
    }
    const segment = op.fields.segment;
    if (segment === null || segment === undefined) delete item.segment;
    else item.segment = segment as NonNullable<Token['segment']>;
  }
  return [...ops, ...repairs];
}

/**
 * The segment a witness gives each word of its reading, by position among
 * the tokens `tokensFromReading` makes of it: the segment its unit begins
 * in, where the collation was of a passage of several segments.
 */
export function readingSegments(reading: Reading, textId: Id): (Id | undefined)[] {
  return (reading.units[textId] ?? []).filter((u) => !u.gap).map((u) => u.segmentId);
}

/**
 * Adopt a witness's reading at a site: its words become the edition's,
 * sourced from the witness, each taking the segment the witness gives it
 * (`readingSegments`) where the collation says so.
 */
export function adoptReading(
  stream: Stream,
  site: Site,
  baseUnits: Unit[],
  reading: Reading,
  textId: Id,
  options: AdoptOptions = {},
): Op[] {
  return replaceAtSite(stream, site, baseUnits, tokensFromReading(reading, textId, options), {
    ...options,
    segments: readingSegments(reading, textId),
  });
}

/**
 * Adopt a conjecture at a site: its reading becomes the edition's; an empty
 * reading deletes the words. Its words take the conjecture's segment
 * (`segmentId`) where given, else the segment of the place.
 */
export function adoptConjecture(
  stream: Stream,
  site: Site,
  baseUnits: Unit[],
  conjecture: { id: Id; reading: string; kind: string; segmentId?: Id },
  options: AdoptOptions = {},
): Op[] {
  const ids = options.ids ?? newId;
  const items: Item[] =
    conjecture.kind === 'lacuna'
      ? [{ kind: 'object', id: ids(), type: 'lacuna', attrs: { conjectureId: conjecture.id } }]
      : tokensFromConjecture(conjecture.reading, conjecture.id, {
          ...options,
          supplied: conjecture.kind === 'supplement',
        });
  return replaceAtSite(stream, site, baseUnits, items, {
    ...options,
    ...(conjecture.segmentId !== undefined
      ? { segments: items.map(() => conjecture.segmentId) }
      : {}),
  });
}

/** Mark the edition's own words at a site as the editor's, when none of them has a source yet. */
export function markEditorial(stream: Stream, tokenIds: Id[]): Op[] {
  const ops: Op[] = [];
  for (const id of tokenIds) {
    const item = stream.items.find((i) => i.id === id);
    if (item && item.kind === 'token' && !item.source)
      ops.push({ t: 'set', id, fields: { source: { kind: 'editor' } } });
  }
  return ops;
}

/** Tokens of an edition whose source transcription now reads differently: the token's form against the source's current read forms. */
export function staleSources(
  stream: Stream,
  currentReadForm: (transcriptionId: Id, tokenIds: Id[]) => string | null,
  compare: (a: string, b: string) => boolean,
): { tokenId: Id; now: string }[] {
  const out: { tokenId: Id; now: string }[] = [];
  for (const item of stream.items) {
    if (item.kind !== 'token' || !item.source || item.source.kind !== 'witness') continue;
    const now = currentReadForm(item.source.transcriptionId, item.source.tokenIds);
    if (now === null) continue;
    if (!compare(item.form, now)) out.push({ tokenId: item.id, now });
  }
  return out;
}
