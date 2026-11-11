/**
 * A gap that marks a stretch as not transcribed: what it prints, and that it
 * keeps its reason through every format a transcript is written in.
 */

import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { importLeidenPlus } from '../import/leidenplus.ts';
import { toLeidenPlus } from '../import/leidenplus-write.ts';
import { toLeiden } from '../import/leiden.ts';
import { exportEditionTei } from '../tei/apparatus.ts';
import { exportTranscriptionTei } from '../tei/export.ts';
import { collationText, editionSegments } from '../tei/fixtures.ts';
import { importTei } from '../tei/import.ts';
import {
  NOT_TRANSCRIBED_ATTRS,
  isNotTranscribed,
  isObj,
  type Item,
  type Obj,
  type Stream,
} from './items.ts';
import { NOT_TRANSCRIBED_TEXT, gapText, toText } from './text.ts';

const word = (id: string, form: string): Item => ({ kind: 'token', id, form });
const line = (id: string): Item => ({ kind: 'break', id, type: 'line' });
const gap = (id: string, attrs: NonNullable<Obj['attrs']>): Obj => ({
  kind: 'object',
  id,
  type: 'gap',
  attrs,
});

/** Words, a stretch not transcribed between two of them, one on a line of its own, and one lost for comparison. */
function stream(): Stream {
  return {
    items: [
      word('a', 'μῆνιν'),
      gap('n1', { ...NOT_TRANSCRIBED_ATTRS }),
      word('b', 'ἄειδε'),
      line('l1'),
      gap('n2', { ...NOT_TRANSCRIBED_ATTRS, quantity: 3, unit: 'line' }),
      line('l2'),
      word('c', 'θεά'),
      gap('lost', { reason: 'lost', quantity: 4, unit: 'character' }),
      word('d', 'Πηληϊάδεω'),
    ],
  };
}

/** The gaps of a stream with their reasons, in order. */
function reasons(items: Item[]): unknown[] {
  return items.filter((i): i is Obj => isObj(i) && i.type === 'gap').map((g) => g.attrs?.reason);
}

describe('a gap that is not transcribed', () => {
  it('is told by its reason, the ellipsis of EpiDoc', () => {
    expect(isNotTranscribed(NOT_TRANSCRIBED_ATTRS)).toBe(true);
    expect(isNotTranscribed({ reason: 'ellipsis', quantity: 2, unit: 'line' })).toBe(true);
    expect(isNotTranscribed({ reason: 'lost' })).toBe(false);
    expect(isNotTranscribed({ reason: 'illegible' })).toBe(false);
    expect(isNotTranscribed({})).toBe(false);
    expect(isNotTranscribed(undefined)).toBe(false);
  });

  it('prints as "(not transcribed)" and not as lost text, whatever its extent', () => {
    expect(gapText({ ...NOT_TRANSCRIBED_ATTRS })).toBe('(not transcribed)');
    expect(gapText({ reason: 'ellipsis', quantity: 3, unit: 'line' })).toBe(NOT_TRANSCRIBED_TEXT);
    expect(gapText({ reason: 'lost', quantity: 3 })).toBe('[...]');
    expect(toText(stream())).toBe(
      'μῆνιν (not transcribed) ἄειδε\n(not transcribed)\nθεά [....] Πηληϊάδεω',
    );
  });

  it('prints so in Leiden notation, which has no sign for it', () => {
    expect(toLeiden(stream())).toContain('(not transcribed)');
    expect(toLeiden(stream())).not.toContain('[---]');
  });

  it('keeps its reason through TEI out and in, in both forms of the export', () => {
    for (const words of [true, false]) {
      const xml = exportTranscriptionTei({ stream: stream(), title: 'T', words });
      expect(xml).toContain('<gap reason="ellipsis"><desc>non transcribed</desc></gap>');
      expect(xml).toContain('<gap reason="ellipsis" quantity="3" unit="line">');
      const back = importTei(xml, { ids: sequentialIds(), as: 'verbatim' });
      expect(back.warnings).toEqual([]);
      expect(reasons(back.stream.items)).toEqual(['ellipsis', 'ellipsis', 'lost']);
      const gaps = back.stream.items.filter((i): i is Obj => isObj(i) && i.type === 'gap');
      expect(gaps[0]!.attrs).toEqual({ ...NOT_TRANSCRIBED_ATTRS });
      expect(gaps[1]!.attrs).toEqual({ ...NOT_TRANSCRIBED_ATTRS, quantity: 3, unit: 'line' });
    }
  });

  it('keeps its reason through Leiden+ out and in', () => {
    const written = toLeidenPlus(stream());
    expect(written).toContain('(Chars: ? non transcribed)');
    expect(written).toContain('(Lines: 3 non transcribed)');
    const back = importLeidenPlus(written, { ids: sequentialIds() });
    expect(back.warnings).toEqual([]);
    expect(reasons(back.stream.items)).toEqual(['ellipsis', 'ellipsis', 'lost']);
    const gaps = back.stream.items.filter((i): i is Obj => isObj(i) && i.type === 'gap');
    expect(gaps[0]!.attrs).toMatchObject({ ...NOT_TRANSCRIBED_ATTRS });
    expect(gaps[1]!.attrs).toMatchObject({ ...NOT_TRANSCRIBED_ATTRS, quantity: 3, unit: 'line' });
    // A second trip changes nothing.
    expect(toLeidenPlus(back.stream)).toBe(written);
  });

  it('is written in an edition as the same ellipsis, never as a loss', () => {
    const text = editionSegments({
      label: '1',
      text: 'a b',
      witnesses: [collationText('A', 'A', 'a b')],
    });
    text.runs[0]!.items.splice(1, 0, gap('n', { ...NOT_TRANSCRIBED_ATTRS }));
    const xml = exportEditionTei({
      title: 't',
      language: 'grc',
      witnesses: [{ siglum: 'A' }],
      ...text,
    });
    expect(xml).toContain('<gap reason="ellipsis"><desc>non transcribed</desc></gap>');
    expect(xml).not.toContain('<gap reason="lost"');
  });
});
