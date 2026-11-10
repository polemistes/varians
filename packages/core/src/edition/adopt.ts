/**
 * Editing an edition's text by adopting: the operations that make a
 * reading of a witness, a conjecture, or nothing at all the edition's text
 * at a site. The edition is a stream like any other; these functions only
 * compose operations on it.
 */

import { newId } from '../ids.ts';
import type { Reading, Site } from '../collate/collate.ts';
import type { Id, Item, Stream, Token, TokenSource } from '../stream/items.ts';
import { orphanedLineBreak } from '../stream/move.ts';
import type { Op } from '../stream/ops.ts';
import type { Unit } from '../stream/words.ts';

export interface AdoptOptions {
  ids?: () => Id;
}

/** The ids of the base tokens a site covers, in stream order. */
export function siteTokenIds(site: Site, baseUnits: Unit[]): Id[] {
  const ids: Id[] = [];
  for (let i = site.baseFrom; i < site.baseTo; i++) {
    for (const id of baseUnits[i]?.tokenIds ?? []) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The id of the item an insertion at a site goes after: the last base token before it, or the previous item. */
function anchorBefore(stream: Stream, site: Site, baseUnits: Unit[]): Id | null {
  const previous = baseUnits[site.baseFrom - 1];
  if (previous && previous.tokenIds.length > 0)
    return previous.tokenIds[previous.tokenIds.length - 1]!;
  if (site.baseFrom === 0) {
    // Before the first word of the segment: after whatever item precedes the first base token.
    const first = baseUnits[0]?.tokenIds[0];
    if (!first) return null;
    const index = stream.items.findIndex((i) => i.id === first);
    return index > 0 ? stream.items[index - 1]!.id : null;
  }
  return null;
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
 * Replace the edition's words at a site by new items. With no new items the
 * site's words are removed (the absence of a reading adopted), and with them
 * the line break that would leave an empty line, as moving text away does.
 * The first base token's segment start, if any, moves onto the first new item.
 */
export function replaceAtSite(stream: Stream, site: Site, baseUnits: Unit[], items: Item[]): Op[] {
  const ids = siteTokenIds(site, baseUnits);
  const first = ids[0] ? stream.items.find((i) => i.id === ids[0]) : undefined;
  const carried =
    first && (first.kind === 'token' || first.kind === 'object') ? first.segment : undefined;
  const newItems = items.map((item, index) => {
    if (index === 0 && carried && (item.kind === 'token' || item.kind === 'object'))
      return { ...item, segment: carried };
    return item;
  });
  if (ids.length === 0) {
    const after = anchorBefore(stream, site, baseUnits);
    return newItems.length ? [{ t: 'insert', after, items: newItems }] : [];
  }
  if (newItems.length === 0) {
    const ops: Op[] = [{ t: 'delete', ids }];
    if (carried) {
      // Keep the segment start alive on the item that follows the removed words.
      const lastIndex = stream.items.findIndex((i) => i.id === ids[ids.length - 1]);
      const next = stream.items
        .slice(lastIndex + 1)
        .find((i) => i.kind === 'token' || i.kind === 'object');
      // Not onto the start of the next segment: an omission of the whole segment leaves the segment without words.
      if (next && (next.kind === 'token' || next.kind === 'object') && !next.segment)
        ops.push({ t: 'set', id: next.id, fields: { segment: carried } });
    }
    const orphan = emptiedLineBreak(stream, ids);
    if (orphan !== null) ops.push({ t: 'delete', ids: [orphan] });
    return ops;
  }
  // Contiguous base tokens are replaced in one operation; a discontinuous site is replaced piecewise.
  const indexes = ids.map((id) => stream.items.findIndex((i) => i.id === id));
  const contiguous = indexes.every((idx, k) => k === 0 || idx === indexes[k - 1]! + 1);
  if (contiguous) return [{ t: 'replace', ids, items: newItems }];
  const ops: Op[] = [{ t: 'replace', ids: [ids[0]!], items: newItems }];
  ops.push({ t: 'delete', ids: ids.slice(1) });
  return ops;
}

/** Adopt a witness's reading at a site: its words become the edition's, sourced from the witness. */
export function adoptReading(
  stream: Stream,
  site: Site,
  baseUnits: Unit[],
  reading: Reading,
  textId: Id,
  options: AdoptOptions = {},
): Op[] {
  return replaceAtSite(stream, site, baseUnits, tokensFromReading(reading, textId, options));
}

/** Adopt a conjecture at a site: its reading becomes the edition's; an empty reading deletes the words. */
export function adoptConjecture(
  stream: Stream,
  site: Site,
  baseUnits: Unit[],
  conjecture: { id: Id; reading: string; kind: string },
  options: AdoptOptions = {},
): Op[] {
  if (conjecture.kind === 'lacuna') {
    const ids = options.ids ?? newId;
    const gap: Item = {
      kind: 'object',
      id: ids(),
      type: 'lacuna',
      attrs: { conjectureId: conjecture.id },
    };
    return replaceAtSite(stream, site, baseUnits, [gap]);
  }
  return replaceAtSite(
    stream,
    site,
    baseUnits,
    tokensFromConjecture(conjecture.reading, conjecture.id, {
      ...options,
      supplied: conjecture.kind === 'supplement',
    }),
  );
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
