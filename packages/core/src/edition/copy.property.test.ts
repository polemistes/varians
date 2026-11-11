import { describe, expect, it } from 'vitest';
import { collatePassages } from '../collate/passage.ts';
import { sequentialIds } from '../ids.ts';
import {
  isBreak,
  isToken,
  type Id,
  type Item,
  type Lineation,
  type Stream,
  type Token,
} from '../stream/items.ts';
import { applyOps } from '../stream/ops.ts';
import { runsOfSegment } from '../stream/words.ts';
import { membershipOf, picture, randomStream, runProperty, type Rng } from '../testing/random.ts';
import { copyFromTranscript } from './copy.ts';
import { deriveEdition } from './derive.ts';

/** The work: ten segments, whose ids sort in the order of the work. */
const WORK = Array.from({ length: 10 }, (_, k) => `s${String(k + 1).padStart(2, '0')}`);

const SYLLABLES = ['κα', 'λο', 'μι', 'νε', 'σπο', 'τυ', 'φα', 'χρη', 'ὠ', 'δῆ', 'ῥι', 'γλώ'];

/** A made-up Greek word; in a text whose words are `unique`, one that names its segment and place so that no two words are alike. */
function word(rng: Rng, unique?: string): string {
  const w = rng.pick(SYLLABLES) + rng.pick(SYLLABLES);
  return unique === undefined ? w : `${w}${unique}`;
}

interface TranscriptOptions {
  /** Every word different from every other, so that an alignment cannot hesitate. */
  unique?: boolean;
  /** Words divided across the boundary of two segments. */
  crossJoins?: boolean;
}

/**
 * A transcript of some of the work's segments: mostly a stretch in the
 * work's order, now and then with two segments exchanged, one left out, or
 * one in two runs; words on lines, now and then divided (joined) within a
 * segment, a read form, a gap, a lacuna or a paratext; between segments a
 * line break, a paragraph break, or none.
 */
function randomTranscript(rng: Rng, prefix: string, options: TranscriptOptions = {}): Stream {
  const ids = sequentialIds(prefix);
  const first = rng.int(WORK.length);
  const last = Math.min(WORK.length - 1, first + rng.between(0, 6));
  let order = WORK.slice(first, last + 1).filter(() => rng.chance(0.9));
  if (order.length === 0) order = [WORK[first]!];
  if (order.length >= 2 && rng.chance(0.2)) {
    const k = rng.int(order.length - 1);
    [order[k], order[k + 1]] = [order[k + 1]!, order[k]!];
  }
  // A segment in two runs: its second part stands later.
  const runs: { segmentId: Id; part?: number }[] = order.map((segmentId) => ({ segmentId }));
  if (order.length >= 2 && rng.chance(0.15)) {
    const k = rng.int(order.length - 1);
    const at = rng.between(k + 2, runs.length);
    runs[k] = { segmentId: order[k]!, part: 1 };
    runs.splice(at, 0, { segmentId: order[k]!, part: 2 });
  }
  const items: Item[] = [];
  if (rng.chance(0.15)) items.push({ kind: 'token', id: ids(), form: word(rng) });
  let n = 0;
  runs.forEach((run, r) => {
    if (r > 0 || items.length > 0) {
      const kind = rng.weighted([
        ['line', 70],
        ['paragraph', 12],
        ['none', 13],
        ['page', 5],
      ] as const);
      const previous = items[items.length - 1];
      if (kind === 'none' && options.crossJoins && isToken(previous) && rng.chance(0.4))
        previous.joinNext = true;
      if (kind !== 'none') items.push({ kind: 'break', id: ids(), type: kind });
    }
    const count = rng.between(1, 4);
    let started = false;
    const start = <T extends Item>(item: T): T => {
      if (!started && !isBreak(item)) {
        item.segment = run.part
          ? { segmentId: run.segmentId, part: run.part }
          : { segmentId: run.segmentId };
        started = true;
      }
      return item;
    };
    if (rng.chance(0.1))
      items.push(start({ kind: 'object', id: ids(), type: 'paratext', text: 'Χο' }));
    for (let w = 0; w < count; w++) {
      const unique = options.unique ? `${prefix}${++n}` : undefined;
      const token: Token = start({ kind: 'token', id: ids(), form: word(rng, unique) });
      if (rng.chance(0.1)) token.norm = word(rng, unique === undefined ? undefined : `${unique}n`);
      items.push(token);
      if (w < count - 1) {
        if (rng.chance(0.12)) {
          token.joinNext = true;
          if (rng.chance(0.5)) items.push({ kind: 'break', id: ids(), type: 'line' });
        } else if (rng.chance(0.15)) items.push({ kind: 'break', id: ids(), type: 'line' });
        else if (rng.chance(0.06)) items.push({ kind: 'object', id: ids(), type: 'gap' });
      }
    }
    if (rng.chance(0.06)) items.push({ kind: 'object', id: ids(), type: 'lacuna' });
  });
  return { items };
}

/** An edition to copy into: empty, one made by copying, or any stream at all with segments of the work. */
function randomEdition(rng: Rng, size: number): Stream {
  const kind = rng.weighted([
    ['empty', 2],
    ['copied', 4],
    ['random', 4],
  ] as const);
  if (kind === 'empty') return { items: [] };
  if (kind === 'copied') {
    let edition: Stream = { items: [] };
    for (let k = rng.between(1, 2); k > 0; k--) {
      const source = randomTranscript(rng, `w${k}-`);
      edition = applyOps(
        edition,
        copyFromTranscript(
          edition,
          source,
          `W${k}`,
          new Set(WORK.filter(() => rng.chance(0.7))),
          WORK,
          {
            ids: sequentialIds(`e${k}-`),
          },
        ).ops,
      ).stream;
    }
    return edition;
  }
  return randomStream(rng, {
    size,
    segments: WORK,
    prefix: 'e',
    joins: true,
    norms: false,
    segmentRate: 0.3,
    words: SYLLABLES,
  });
}

interface Case {
  edition: Stream;
  transcript: Stream;
  segments: Id[];
  lineation: Lineation;
}

function generate(rng: Rng, size: number, transcript: TranscriptOptions = {}): Case {
  const edition = randomEdition(rng, size);
  const t = randomTranscript(rng, 't', transcript);
  const from = rng.int(WORK.length);
  const to = Math.min(WORK.length - 1, from + rng.between(0, 5));
  return {
    edition,
    transcript: t,
    segments: WORK.slice(from, to + 1),
    lineation: rng.chance(0.3) ? 'prose' : 'verse',
  };
}

const show = (c: Case): string =>
  [
    `edition:    ${picture(c.edition)}`,
    `transcript: ${picture(c.transcript)}`,
    `segments:   ${c.segments.join(' ')} (${c.lineation})`,
  ].join('\n');

function copyCase(c: Case, edition = c.edition, prefix = 'n') {
  const result = copyFromTranscript(edition, c.transcript, 'T', new Set(c.segments), WORK, {
    ids: sequentialIds(prefix),
    lineation: c.lineation,
  });
  return { ...result, stream: applyOps(edition, result.ops).stream };
}

/** An item without its id, and a token's source by the tokens named: what two copies may share. */
function canonical(item: Item): string {
  const { id: _id, ...rest } = item as Item & Record<string, unknown>;
  void _id;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/** The tokens of a segment in content order: each its form and the transcript tokens it was taken from. */
function wordsOf(stream: Stream, segmentId: Id): string[] {
  const out: string[] = [];
  for (const run of runsOfSegment(stream, segmentId))
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (isToken(item)) {
        const source = item.source?.kind === 'witness' ? item.source : null;
        out.push(
          `${item.form}<${source ? `${source.transcriptionId}:${source.tokenIds.join(',')}` : '-'}`,
        );
      }
    }
  return out;
}

/** What every copy keeps: no empty line, no break at either end and no join to nothing that the edition did not have already. */
function wellFormed(before: Stream, after: Stream): void {
  const old = new Map(before.items.map((item, k) => [item.id, k] as const));
  const sideBySide = (a: Item, b: Item) =>
    old.has(a.id) && old.has(b.id) && old.get(b.id) === old.get(a.id)! + 1;
  after.items.forEach((item, k) => {
    const next = after.items[k + 1];
    if (isBreak(item) && isBreak(next) && !sideBySide(item, next))
      throw new Error(`an empty line between ${item.id} and ${next.id}`);
  });
  const first = after.items[0];
  if (isBreak(first) && first.type === 'line' && old.get(first.id) !== 0)
    throw new Error(`a line break ${first.id} opens the text`);
  const last = after.items[after.items.length - 1];
  if (isBreak(last) && old.get(last.id) !== before.items.length - 1)
    throw new Error(`a break ${last.id} ends the text`);
  const nextWord = (items: Item[], k: number) => {
    let j = k + 1;
    while (isBreak(items[j])) j++;
    return items[j];
  };
  after.items.forEach((item, k) => {
    if (!isToken(item) || !item.joinNext) return;
    const next = nextWord(after.items, k);
    if (isToken(next)) return;
    const was = old.get(item.id);
    if (was !== undefined && nextWord(before.items, was)?.id === next?.id) return;
    throw new Error(`${item.id} is joined to nothing`);
  });
}

describe('copying text from a transcript, random cases', () => {
  it('a. copying all a transcript has into an empty edition gives what deriveEdition gives', () => {
    runProperty('copy everything into nothing', {
      generate: (rng) => randomTranscript(rng, 't', { crossJoins: true }),
      show: picture,
      check: (t) => {
        const result = copyFromTranscript({ items: [] }, t, 'T', new Set(WORK), WORK, {
          ids: sequentialIds('n'),
        });
        const copied = applyOps({ items: [] }, result.ops).stream;
        const derived = deriveEdition(t, 'T', {
          ids: sequentialIds('d'),
          segmentIds: new Set(WORK),
        });
        expect(copied.items.map(canonical)).toEqual(derived.items.map(canonical));
      },
    });
  });

  it('b. the segments copied read as the transcript, and collating it finds no variant inside them', () => {
    runProperty('copied segments read as the transcript', {
      generate: (rng, size) => generate(rng, size, { unique: true }),
      show,
      check: (c) => {
        const { stream, copied } = copyCase(c);
        wellFormed(c.edition, stream);
        const derived = deriveEdition(c.transcript, 'T', { segmentIds: new Set(c.segments) });
        for (const segmentId of copied)
          expect(wordsOf(stream, segmentId), segmentId).toEqual(wordsOf(derived, segmentId));
        const membership = membershipOf(stream);
        const inCopy = new Set(copied);
        const { passages } = collatePassages({ id: 'E', siglum: 'ed', stream }, [
          { id: 'T', siglum: 'T', stream: c.transcript },
        ]);
        for (const passage of passages)
          for (const site of passage.collation.sites) {
            if (site.baseTo === site.baseFrom) continue;
            if (!site.readings.some((r) => !r.base && r.textIds.includes('T'))) continue;
            const units = passage.base.units.slice(site.baseFrom, site.baseTo);
            const inside = units.every((u) =>
              [...u.tokenIds, ...(u.gap ? [u.gap.id] : [])].every((id) =>
                inCopy.has(membership.get(id) ?? ''),
              ),
            );
            if (inside)
              throw new Error(
                `a variant inside the copy: ${units.map((u) => u.text).join(' ')} / ${site.readings
                  .map((r) => `${r.text}:${r.textIds.join(',')}`)
                  .join(' | ')}`,
              );
          }
      },
    });
  });

  it('c. what the edition had outside the segments copied keeps its ids and its order', () => {
    runProperty('the rest of the edition stays', {
      generate: (rng, size) => generate(rng, size, { crossJoins: true }),
      show,
      check: (c) => {
        const { stream, copied } = copyCase(c);
        wellFormed(c.edition, stream);
        const replaced = new Set(copied);
        const before = membershipOf(c.edition);
        const outside = c.edition.items
          .filter((item) => !isBreak(item) && !replaced.has(before.get(item.id) ?? ''))
          .map((item) => item.id);
        const present = new Set(outside);
        const after = stream.items.filter((item) => present.has(item.id)).map((item) => item.id);
        expect(after).toEqual(outside);
        // And they stay in the segments they were in.
        const now = membershipOf(stream);
        for (const id of outside) expect(now.get(id), id).toBe(before.get(id));
      },
    });
  });

  it('d. copying the same segments again changes nothing but ids', () => {
    runProperty('copying twice is copying once', {
      generate: (rng, size) => generate(rng, size, { crossJoins: true }),
      show,
      check: (c) => {
        const once = copyCase(c).stream;
        const twice = copyCase(c, once, 'm').stream;
        wellFormed(once, twice);
        expect(twice.items.map(canonical)).toEqual(once.items.map(canonical));
      },
    });
  });

  it('e. two ranges from two transcripts, in either order, each read as its own transcript', () => {
    runProperty('two transcripts, two ranges', {
      generate: (rng, size) => {
        const c = generate(rng, size, { crossJoins: true });
        const cut = rng.between(1, WORK.length - 1);
        return {
          edition: c.edition,
          lineation: c.lineation,
          first: { transcript: c.transcript, segments: WORK.slice(rng.int(cut), cut) },
          second: {
            transcript: randomTranscript(rng, 'u', { crossJoins: true }),
            segments: WORK.slice(cut, rng.between(cut + 1, WORK.length)),
          },
        };
      },
      show: (c) =>
        [
          `edition: ${picture(c.edition)}`,
          `T: ${picture(c.first.transcript)} for ${c.first.segments.join(' ')}`,
          `U: ${picture(c.second.transcript)} for ${c.second.segments.join(' ')}`,
        ].join('\n'),
      check: (c) => {
        const ranges = [
          { id: 'T', ...c.first },
          { id: 'U', ...c.second },
        ];
        for (const order of [ranges, [...ranges].reverse()]) {
          let stream = c.edition;
          const copied: Id[][] = [];
          for (const [k, range] of order.entries()) {
            const result = copyFromTranscript(
              stream,
              range.transcript,
              range.id,
              new Set(range.segments),
              WORK,
              { ids: sequentialIds(`n${k}-`), lineation: c.lineation },
            );
            const next = applyOps(stream, result.ops).stream;
            wellFormed(stream, next);
            stream = next;
            copied.push(result.copied);
          }
          order.forEach((range, k) => {
            const derived = deriveEdition(range.transcript, range.id, {
              segmentIds: new Set(range.segments),
            });
            for (const segmentId of copied[k]!)
              expect(wordsOf(stream, segmentId), `${range.id} ${segmentId}`).toEqual(
                wordsOf(derived, segmentId),
              );
          });
        }
      },
    });
  });
});
