import { describe, expect, it } from 'vitest';
import { applySiteKinds, collate, siteKey, type CollationText } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { fromText } from '../stream/text.ts';
import { units } from '../stream/words.ts';
import { exportEditionTei } from './apparatus.ts';

function text(id: string, siglum: string, words: string): CollationText {
  const s = fromText(words, { ids: sequentialIds(id) });
  return { id, siglum, units: units(s, 0, s.items.length) };
}

describe('exportEditionTei', () => {
  it('writes the text with app, lem and rdg for substitution, omission, addition and lacuna', () => {
    const edition = fromText('the quick brown fox\njumps', { ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('A', 'A', 'the quick brown fox jumps'),
      text('B', 'B', 'the slow fox jumps'),
      text('C', 'C', 'the quick brown red fox jumps'),
    ]);
    const xml = exportEditionTei({
      title: 'Test edition',
      editors: ['Someone'],
      language: 'en',
      baseSiglum: 'ed.',
      witnesses: [
        { siglum: 'A', name: 'Codex A' },
        { siglum: 'B', name: 'Codex B' },
        { siglum: 'C' },
      ],
      segments: [
        {
          label: '1.1',
          items: edition.items,
          baseUnits,
          sites: c.sites,
          attachments: {
            0: [
              {
                kind: 'conjecture',
                id: 'c1',
                text: 'swift',
                name: 'Bentley',
                conjectureKind: 'substitution',
              },
            ],
          },
        },
      ],
    });
    expect(xml).toContain('<witness xml:id="wit-A" n="A">Codex A</witness>');
    expect(xml).toContain(
      '<ab n="1.1">the <app><lem wit="#wit-A #wit-C">quick brown</lem><rdg wit="#wit-B">slow</rdg><rdg type="conjecture" resp="Bentley">swift</rdg></app> <app><lem wit="#wit-A #wit-B"/><rdg wit="#wit-C">red</rdg></app> fox<lb/>jumps</ab>',
    );
  });

  it('marks an adopted conjecture on the lemma and names a witness that has lost the words nowhere', () => {
    const edition = fromText('a b c', { ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const lacunose = fromText('a c', { ids: sequentialIds('p') });
    lacunose.items.splice(1, 0, {
      kind: 'object',
      id: 'g',
      type: 'gap',
      attrs: { reason: 'lost' },
    });
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('A', 'A', 'a x c'),
      { id: 'P', siglum: 'P', units: units(lacunose, 0, lacunose.items.length) },
    ]);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'P' }],
      segments: [
        {
          label: '1',
          items: edition.items,
          baseUnits,
          sites: c.sites,
          attachments: {
            0: [
              {
                kind: 'conjecture',
                id: 'c',
                text: 'b',
                name: 'Editor',
                adopted: true,
                conjectureKind: 'substitution',
              },
            ],
          },
        },
      ],
    });
    expect(xml).toContain('<app><lem resp="Editor">b</lem><rdg wit="#wit-A">x</rdg></app>');
  });

  it('types the places of the same letters read otherwise as interpretative', () => {
    const edition = fromText('ἦ μέγα', { ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [text('A', 'A', 'ἢ μέγα')]);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }],
      segments: [{ label: '1', items: edition.items, baseUnits, sites: c.sites }],
    });
    expect(xml).toContain('<app type="interpretative"><lem>ἦ</lem><rdg wit="#wit-A">ἢ</rdg></app>');
  });

  it('writes a place the editor judges minor with its kind, the grade as a subtype of it', () => {
    const edition = fromText('red fox runs', { ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('A', 'A', 'red dog runs'),
      text('B', 'B', 'red fox walks'),
    ]);
    const keyOf = (word: string) =>
      siteKey(c.sites.find((s) => s.readings.some((r) => r.text === word))!, baseUnits);
    const marked = applySiteKinds(
      c,
      baseUnits,
      new Map([
        [keyOf('dog'), { minor: true }],
        [keyOf('walks'), { minor: true, kind: 'interpretative' as const }],
      ]),
    );
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      segments: [{ label: '1', items: edition.items, baseUnits, sites: marked.sites }],
    });
    expect(xml).toContain(
      '<app type="textual" subtype="minor"><lem wit="#wit-B">fox</lem><rdg wit="#wit-A">dog</rdg></app>',
    );
    expect(xml).toContain(
      '<app type="interpretative" subtype="minor"><lem wit="#wit-A">runs</lem><rdg wit="#wit-B">walks</rdg></app>',
    );
  });

  it('writes speakers, headings and marginal notes as typed labels, leaves out variants noted in a carrier, and has no empty witness list', () => {
    const edition = fromText('a b', { ids: sequentialIds('e') });
    edition.items.unshift(
      { kind: 'object', id: 's', type: 'paratext', attrs: { type: 'speaker' }, text: 'ΧΟ.' },
      { kind: 'object', id: 'h', type: 'paratext', attrs: { type: 'head' }, text: 'Α' },
      { kind: 'object', id: 'm', type: 'paratext', attrs: { type: 'margin' }, text: '5' },
      { kind: 'object', id: 'st', type: 'paratext', attrs: { type: 'stage' }, text: 'exit' },
    );
    const last = edition.items[edition.items.length - 1]!;
    if (last.kind === 'token')
      last.marks = [{ kind: 'variant', attrs: { group: 'g', reading: 'c', place: 'margin' } }];
    const baseUnits = units(edition, 0, edition.items.length);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [],
      segments: [{ label: '1', items: edition.items, baseUnits, sites: [] }],
    });
    expect(xml).toContain(
      '<ab n="1"><label type="speaker">ΧΟ.</label> <label type="head">Α</label> <label type="margin">5</label> <stage>exit</stage> a b</ab>',
    );
    expect(xml).not.toContain('<listWit>');
    expect(xml).toContain('<sourceDesc>\n        <p>Edition.</p>\n      </sourceDesc>');
  });
});
