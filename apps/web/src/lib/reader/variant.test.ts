import { describe, expect, it } from 'vitest';
import {
  collate,
  type Attachment,
  type Collation,
  type CollationText,
  type Item,
  type Reading,
  type Site,
  type Unit,
} from '@varians/core';
import { EditionText } from './edition-text';
import {
  chipText,
  gather,
  notesAt,
  unplacedRow,
  variantOf,
  variantsOf,
  whereText,
  type Chip,
  type Row,
  type Variant,
  type VariantContext,
  type WitnessChip,
} from './variant';
import type { ReaderNote, ReaderSegment, ReaderSiglum } from './types';

function siglum(
  s: string,
  name: string,
  transcribed = true,
  more: Partial<ReaderSiglum> = {},
): ReaderSiglum {
  return {
    siglum: s,
    witnessId: `w${s}`,
    witnessName: name,
    transcriptionId: transcribed ? `t${s.toLowerCase()}` : null,
    description: null,
    ...more,
  };
}

const sigla: ReaderSiglum[] = [
  siglum('A', 'Venetus A'),
  siglum('B', 'Venetus B'),
  siglum('C', 'Codex Laurentianus'),
  siglum('T', 'Townleianus', false),
];

const context: VariantContext = { sigla };

const SIGLUM: Record<string, string> = { ed: 'ed.', ta: 'A', tb: 'B', tc: 'C', td: 'D', te: 'E' };

/** A reading by hand: its text and the texts that have it; the edition's text is `ed`. */
function reading(
  text: string,
  ids: string[],
  flags: Partial<Pick<Reading, 'omission' | 'lacunose'>> = {},
): Reading {
  return {
    text,
    fold: text,
    textIds: ids,
    sigla: ids.map((id) => SIGLUM[id] ?? id),
    units: {},
    omission: flags.omission ?? text === '',
    lacunose: flags.lacunose ?? false,
    base: ids[0] === 'ed',
  };
}

function units(words: string): Unit[] {
  return words.split(' ').map((w, i) => ({ text: w, tokenIds: [`e${i}`] }));
}

type SiteInput = Omit<Site, 'columnFrom' | 'columnTo' | 'kind'> & Partial<Pick<Site, 'kind'>>;

/** A segment of the edition text "μῆνιν ἄειδε θεὰ Πηληϊάδεω" with the given sites. */
function segment(sites: SiteInput[], extra: Partial<ReaderSegment> = {}): ReaderSegment {
  const collation = {
    columns: [],
    anchors: [],
    baseId: 'ed',
    absent: [],
    sigla: SIGLUM,
    sites: sites.map((s) => ({ columnFrom: 0, columnTo: 0, kind: 'textual', ...s })),
  } as unknown as Collation;
  return {
    segmentId: 's1',
    label: '1.1',
    collation,
    baseUnits: units('μῆνιν ἄειδε θεὰ Πηληϊάδεω'),
    attachments: {},
    aligned: {},
    unplaced: [],
    absent: [],
    notes: [],
    cites: {},
    ...extra,
  };
}

function variant(seg: ReaderSegment, index = 0, ctx: VariantContext = context): Variant {
  const out = variantOf(seg, index, ctx);
  if (!out) throw new Error('no site');
  return out;
}

const sigs = (chips: Chip[]) => chips.map(chipText);

/** A row as a line of text: what it says, its sigla, what it rests on, what it cites. */
function line(row: Row): string {
  const said = [row.lead ? ({ notIn: 'not in' }[row.lead as 'notIn'] ?? row.lead) : '', row.words]
    .filter(Boolean)
    .join(' ');
  const who = row.chips
    .map((chip) =>
      chip.kind === 'witness' && chip.reported
        ? `${chip.siglum} (reported${chip.reported.source ? `, ${chip.reported.source}` : ''})`
        : chipText(chip),
    )
    .join(' ');
  const rest = row.rests
    .map((r) => (r.kind === 'editor' ? 'the editor' : `${r.name}, ${r.what}`))
    .join('; ');
  return [said, who, rest, row.references.join('; ')].filter(Boolean).join(' | ');
}

const lines = (v: Variant) => v.rows.map(line);

function conjecture(fields: Partial<Attachment> & Pick<Attachment, 'id' | 'name'>): Attachment {
  return { kind: 'conjecture', text: '', conjectureKind: 'substitution', ...fields };
}

describe('the witnesses that are there', () => {
  it('names those of the conspectus with a transcript that stand in a reading, in its order', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'tc']), reading('θεοί', ['ta'])],
      },
    ]);
    const v = variant(seg);
    expect(v.there).toMatchObject({ count: 2, total: 3, all: false });
    expect(sigs(v.there!.chips)).toEqual(['A', 'C']);
  });

  it('says all of them, without naming them, when every witness with a transcript is there', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'ta', 'tc']), reading('θεοί', ['tb'])],
      },
    ]);
    expect(variant(seg).there).toMatchObject({ count: 3, total: 3, all: true });
  });

  it('does not count a witness known only from a report, nor a state of a witness', () => {
    const withStates: VariantContext = {
      sigla: [
        siglum('A', 'Venetus A', true, {
          states: [{ kind: 'original', siglum: 'A¹' }],
          variantSiglum: 'A v.l.',
        }),
        ...sigla.slice(1),
      ],
    };
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεὰ', ['ed', 'ta']), reading('θεοί', ['ta:s0', 'ta:variant'])],
        },
      ],
      { attachments: { 0: [{ kind: 'reported', id: 'r', text: 'θεά', name: 'T' }] } },
    );
    const v = variant(seg, 0, withStates);
    expect(v.there).toMatchObject({ count: 1, total: 3, all: false });
    expect(sigs(v.there!.chips)).toEqual(['A']);
  });

  it('says nothing where no witness is there', () => {
    const seg = segment(
      [{ index: 0, baseFrom: 2, baseTo: 3, readings: [reading('θεὰ', ['ed'])] }],
      { attachments: { 0: [conjecture({ id: 'c', name: 'Bentley', text: 'θεᾶς' })] } },
    );
    expect(variant(seg).there).toBeNull();
  });

  it('leaves out a witness that is in no reading, as one that has lost the words is', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 3,
        readings: [reading('ἄειδε θεὰ', ['ed', 'ta']), reading('ἄειδε θεοί', ['tb'])],
      },
    ]);
    const v = variant(seg);
    expect(sigs(v.there!.chips)).toEqual(['A', 'B']);
    expect(lines(v)).toEqual(['ἄειδε θεὰ | A', 'ἄειδε θεοί | B']);
  });
});

describe('the rows', () => {
  it('puts the edition’s reading first, then one row for each other reading', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'ta', 'tc']), reading('θεά μοι', ['tb'])],
      },
    ]);
    const v = variant(seg);
    expect(v.words).toBe('θεὰ');
    expect(v.place).toBeNull();
    expect(v.rows.map((r) => r.kind)).toEqual(['edition', 'witnesses']);
    expect(lines(v)).toEqual(['θεὰ | A C', 'θεά μοι | B']);
    expect(v.rows[0]!.chips[0]).toEqual({
      kind: 'witness',
      siglum: 'A',
      name: 'Venetus A',
      witness: 'A',
      state: false,
    });
  });

  it('prints the edition’s words as the edition prints them, with its signs', () => {
    const items: Item[] = ['μῆνιν', 'ἄειδε', 'θεὰ,', 'Πηληϊάδεω'].map((form, i) => ({
      kind: 'token',
      id: `e${i}`,
      form,
      ...(i === 2 ? { marks: [{ kind: 'surplus' as const }] } : {}),
    }));
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ,', ['ed', 'ta']), reading('θεοί', ['tb'])],
      },
    ]);
    const v = variant(seg, 0, { ...context, edition: new EditionText(items) });
    expect(lines(v)).toEqual(['[θεὰ] | A', 'θεοί | B']);
    // The head quotes the words without the signs, as before.
    expect(v.words).toBe('θεὰ');
  });

  it('says “not in” where a witness has no words, and nothing of how it came to have none', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'ta']), reading('', ['tb', 'tc'])],
      },
    ]);
    const v = variant(seg);
    expect(lines(v)).toEqual(['θεὰ | A', 'not in | B C']);
    expect(v.rows[1]).toMatchObject({ lead: 'notIn', words: '' });
  });

  it('puts the words of a witness in each order as rows of their own, with no word for the change', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 0,
        baseTo: 2,
        readings: [reading('μῆνιν ἄειδε', ['ed', 'ta']), reading('ἄειδε μῆνιν', ['tb'])],
        transposition: { withSite: 0, textIds: ['tb'] },
      },
    ]);
    const v = variant(seg);
    expect(lines(v)).toEqual(['μῆνιν ἄειδε | A', 'ἄειδε μῆνιν | B']);
    expect(v.rows.every((row) => row.links.length === 0)).toBe(true);
  });

  it('gives each of two variants that name each other a link to the other, on the rows of the witnesses that moved', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 0,
        baseTo: 1,
        readings: [reading('μῆνιν', ['ed', 'ta']), reading('', ['tb', 'tc'])],
        transposition: { withSite: 1, textIds: ['tb', 'tc'] },
      },
      {
        index: 1,
        baseFrom: 3,
        baseTo: 3,
        readings: [reading('', ['ed', 'ta']), reading('μῆνιν', ['tb', 'tc'])],
        transposition: { withSite: 0, textIds: ['tb', 'tc'] },
      },
    ]);
    const first = variant(seg, 0);
    expect(first.rows.map((row) => row.links)).toEqual([
      [],
      [{ key: 's1:1', where: { words: '', place: { side: 'after', word: 'θεὰ' } } }],
    ]);
    const second = variant(seg, 1);
    expect(second.rows.map((row) => row.links)).toEqual([
      [],
      [{ key: 's1:0', where: { words: '', place: { side: 'before', word: 'ἄειδε' } } }],
    ]);
    expect(whereText(first.rows[1]!.links[0]!.where)).toBe('after θεὰ');
  });

  it('keeps the punctuation of a reading where the letters are the same, and trims it otherwise', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        kind: 'interpretative',
        readings: [reading('ἄειδε', ['ed', 'ta']), reading('ἄειδε,', ['tb'])],
      },
    ]);
    const v = variant(seg);
    expect(v.interpretative).toBe(true);
    expect(lines(v)).toEqual(['ἄειδε | A', 'ἄειδε, | B']);
    const trimmed = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [reading('ἄειδε', ['ed', 'ta']), reading('ἔννεπε,', ['tb'])],
      },
    ]);
    expect(variant(trimmed).interpretative).toBe(false);
    expect(lines(variant(trimmed))).toEqual(['ἄειδε | A', 'ἔννεπε | B']);
  });

  it('says what a reading is and nothing of its grammar or of Latin', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [
          reading('θεὰ', ['ed', 'ta']),
          reading('θεοί', ['tb']),
          reading('θεὰ ἄειδε', ['tc']),
        ],
      },
    ]);
    const v = variant(seg);
    expect(lines(v)).toEqual(['θεὰ | A', 'θεοί | B', 'θεὰ ἄειδε | C']);
    expect(lines(v).join(' ')).not.toMatch(
      /\b(om|add|codd|coni|lac|del|transp|suppl)\.|omit|interpol|corrupt|—/u,
    );
  });

  it('says nothing of a witness without the passage', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεὰ', ['ed', 'ta']), reading('θεοί', ['tb'])],
        },
      ],
      { absent: ['C'] },
    );
    const v = variant(seg);
    expect(lines(v)).toEqual(['θεὰ | A', 'θεοί | B']);
    expect(sigs(v.there!.chips)).toEqual(['A', 'B']);
  });
});

describe('where the edition has no words', () => {
  it('is “not in” in the first row, and the head says where the point is', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 2,
        readings: [reading('', ['ed', 'ta', 'tc']), reading('καὶ ὕστερον', ['tb'])],
      },
    ]);
    const v = variant(seg);
    expect(v.words).toBe('');
    expect(v.place).toEqual({ side: 'after', word: 'ἄειδε' });
    expect(whereText(v)).toBe('after ἄειδε');
    expect(lines(v)).toEqual(['not in | A C', 'καὶ ὕστερον | B']);
    expect(v.rows[0]).toMatchObject({ kind: 'edition', lead: 'notIn' });
  });

  it('is before the first word at the start of a segment', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 0,
        baseTo: 0,
        readings: [reading('', ['ed', 'ta']), reading('καὶ', ['tb'])],
      },
    ]);
    expect(variant(seg).place).toEqual({ side: 'before', word: 'μῆνιν' });
    expect(whereText(variant(seg))).toBe('before μῆνιν');
  });

  it('names the editor where no witness agrees with the edition', () => {
    const seg = segment([
      { index: 0, baseFrom: 2, baseTo: 2, readings: [reading('', ['ed']), reading('δὴ', ['ta'])] },
    ]);
    expect(lines(variant(seg))).toEqual(['not in | the editor', 'δὴ | A']);
  });

  it('says an addition in the witnesses that have words the edition does not', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 2,
        readings: [reading('', ['ed', 'ta']), reading('δὴ', ['tb', 'tc'])],
      },
    ]);
    expect(sigs(variant(seg).addition!)).toEqual(['B', 'C']);
  });

  it('says an addition too where the edition prints all the words as deleted, in the witnesses that read them', () => {
    const items: Item[] = ['μῆνιν', 'ἄειδε', 'θεὰ', 'Πηληϊάδεω'].map((form, i) => ({
      kind: 'token',
      id: `e${i}`,
      form,
      ...(i === 2 ? { marks: [{ kind: 'surplus' as const }] } : {}),
    }));
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'ta', 'tb']), reading('', ['tc'])],
      },
    ]);
    const v = variant(seg, 0, { ...context, edition: new EditionText(items) });
    expect(sigs(v.addition!)).toEqual(['A', 'B']);
    // Words the edition prints as its own, and an absence, are no addition.
    expect(variant(seg).addition).toBeNull();
    const absence = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'ta']), reading('', ['tb'])],
      },
    ]);
    expect(variant(absence).addition).toBeNull();
  });

  it('prints the lacuna sign where the edition has a lacuna mark at the point', () => {
    const items: Item[] = [
      { kind: 'token', id: 'e0', form: 'μῆνιν' },
      { kind: 'token', id: 'e1', form: 'ἄειδε' },
      { kind: 'object', id: 'l', type: 'lacuna' },
      { kind: 'token', id: 'e2', form: 'θεὰ' },
    ];
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 2,
        readings: [reading('', ['ed']), reading('δὴ', ['ta'])],
      },
    ]);
    expect(lines(variant(seg, 0, { ...context, edition: new EditionText(items) }))[0]).toBe(
      '*** | the editor',
    );
  });
});

describe('what the edition’s reading rests on', () => {
  it('names the proposer of an adopted conjecture after the sigla, with its references', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεᾶς', ['ed']), reading('θεὰ', ['ta', 'tb', 'tc'])],
        },
      ],
      {
        attachments: { 0: [conjecture({ id: 'c1', name: 'Berge', text: 'θεᾶς', adopted: true })] },
        cites: { c1: ['Berge 2026, 3'] },
      },
    );
    expect(lines(variant(seg))).toEqual([
      'θεᾶς | Berge, conjecture | Berge 2026, 3',
      'θεὰ | A B C',
    ]);
  });

  it('says what an adopted conjecture did where the words do not say it', () => {
    const deletion = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 2,
          readings: [reading('', ['ed']), reading('θεὰ', ['ta'])],
        },
      ],
      {
        attachments: {
          0: [conjecture({ id: 'd', name: 'Dobree', conjectureKind: 'deletion', adopted: true })],
        },
      },
    );
    expect(lines(variant(deletion))[0]).toBe('not in | Dobree, delete');
    const lacuna = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 2,
          readings: [reading('', ['ed']), reading('θεὰ', ['ta'])],
        },
      ],
      {
        attachments: {
          0: [conjecture({ id: 'h', name: 'Hermann', conjectureKind: 'lacuna', adopted: true })],
        },
      },
    );
    expect(lines(variant(lacuna))[0]).toBe('*** | Hermann, lacuna');
  });

  it('names the editor for a reading no witness and no conjecture gives', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεᾶς', ['ed']), reading('θεὰ', ['ta'])],
      },
    ]);
    expect(lines(variant(seg))).toEqual(['θεᾶς | the editor', 'θεὰ | A']);
    const own = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεᾶς', ['ed']), reading('θεὰ', ['ta'])],
        },
      ],
      {
        attachments: {
          0: [conjecture({ id: 'c', name: 'this edition', text: 'θεᾶς', adopted: true })],
        },
      },
    );
    expect(lines(variant(own))[0]).toBe('θεᾶς | the editor, conjecture');
  });

  it('names the witness of a report the edition follows, with the source of the report', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεά', ['ed']), reading('θεοί', ['ta', 'tb', 'tc'])],
        },
      ],
      {
        attachments: {
          0: [
            {
              kind: 'reported',
              id: 'r1',
              text: 'θεά',
              name: 'T',
              source: "(Allen's apparatus (1931))",
              adopted: true,
            },
          ],
        },
        cites: { r1: ['Allen 1931, 4'] },
      },
    );
    expect(lines(variant(seg))).toEqual([
      "θεά | T (reported, Allen's apparatus (1931)) | Allen 1931, 4",
      'θεοί | A B C',
    ]);
  });
});

describe('reported readings and conjectures', () => {
  it('joins a report to the row that gives its words, marked as reported with the source', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεὰ', ['ed', 'ta']), reading('θεοί', ['tb'])],
        },
      ],
      {
        attachments: {
          0: [
            {
              kind: 'reported',
              id: 'r',
              text: 'θεοί,',
              name: 'T',
              source: "(Allen's apparatus (1931))",
            },
          ],
        },
        cites: { r: ['Allen 1931, 4'] },
      },
    );
    expect(lines(variant(seg))).toEqual([
      'θεὰ | A',
      "θεοί | B T (reported, Allen's apparatus (1931)) | Allen 1931, 4",
    ]);
  });

  it('gives a report of other words a row of its own, after the witnesses’ rows and before the conjectures', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεὰ', ['ed', 'ta']), reading('θεοί', ['tb'])],
        },
      ],
      {
        attachments: {
          0: [
            conjecture({ id: 'c', name: 'Bentley', text: 'θεᾶς', source: '(Bentley 1710, 12)' }),
            { kind: 'reported', id: 'r', text: 'θεᾷ', name: 'T' },
            { kind: 'reported', id: 'q', text: '', name: 'Q' },
          ],
        },
      },
    );
    const v = variant(seg);
    expect(v.rows.map((row) => row.kind)).toEqual([
      'edition',
      'witnesses',
      'reported',
      'reported',
      'conjecture',
    ]);
    expect(lines(v)).toEqual([
      'θεὰ | A',
      'θεοί | B',
      'θεᾷ | T (reported)',
      'not in | Q (reported)',
      'θεᾶς | Bentley, conjecture | Bentley 1710, 12',
    ]);
    // A witness the conspectus does not list is named by its siglum, and cannot be opened.
    expect(v.rows[3]!.chips[0]).toMatchObject({ name: 'Witness Q', witness: null });
  });

  it('joins an empty report to a row of witnesses that have no words', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεὰ', ['ed', 'ta']), reading('', ['tb'])],
        },
      ],
      { attachments: { 0: [{ kind: 'reported', id: 'r', text: '', name: 'T' }] } },
    );
    expect(lines(variant(seg))).toEqual(['θεὰ | A', 'not in | B T (reported)']);
  });

  it('states what each kind of conjecture proposes', () => {
    const at = (a: Attachment) => line(unplacedRow(a, context));
    expect(at(conjecture({ id: 'c', name: 'Bentley', text: 'κύνεσι,' }))).toBe(
      'κύνεσι | Bentley, conjecture',
    );
    expect(at(conjecture({ id: 'c', name: 'Bentley', conjectureKind: 'deletion' }))).toBe(
      'delete | Bentley, conjecture',
    );
    expect(at(conjecture({ id: 'c', name: 'Bentley', conjectureKind: 'lacuna' }))).toBe(
      'lacuna | Bentley, conjecture',
    );
    expect(
      at(conjecture({ id: 'c', name: 'Bentley', conjectureKind: 'supplement', text: 'τε' })),
    ).toBe('add τε | Bentley, conjecture');
    expect(
      at(
        conjecture({
          id: 'c',
          name: 'Bentley',
          conjectureKind: 'transposition',
          text: 'ἄειδε μῆνιν',
        }),
      ),
    ).toBe('ἄειδε μῆνιν | Bentley, conjecture');
    expect(at(conjecture({ id: 'c', name: 'Bentley', conjectureKind: 'transposition' }))).toBe(
      'move | Bentley, conjecture',
    );
    expect(at(conjecture({ id: 'c', name: 'this edition', text: 'θεᾶς' }))).toBe(
      'θεᾶς | the editor, conjecture',
    );
  });

  it('puts a conjecture’s source and its citations after it', () => {
    const row = unplacedRow(
      conjecture({ id: 'c', name: 'Zenodotus', text: 'δαῖτα', source: '(Ath. 1.12e)' }),
      context,
      { c: ['West 1998, 45'] },
    );
    expect(row.references).toEqual(['Ath. 1.12e', 'West 1998, 45']);
  });

  it('rows the reports that stand at no variant by the witness they name', () => {
    expect(line(unplacedRow({ kind: 'reported', id: 'r', text: 'θεὰ', name: 'T' }, context))).toBe(
      'θεὰ | T (reported)',
    );
    expect(
      line(
        unplacedRow(
          {
            kind: 'reported',
            id: 'r',
            text: 'θεὰ',
            name: 'T',
            source: "(Allen's apparatus (1931))",
          },
          context,
        ),
      ),
    ).toBe("θεὰ | T (reported, Allen's apparatus (1931))");
  });
});

describe('groups', () => {
  const many: ReaderSiglum[] = [
    siglum('A', 'Venetus A'),
    siglum('B', 'Venetus B'),
    siglum('C', 'Codex C'),
    siglum('D', 'Codex D'),
    siglum('E', 'Codex E'),
    siglum('F', 'Codex F'),
  ];
  const groups = [{ siglum: 'φ', members: ['C', 'D', 'E'], note: 'consensus codicum CDE' }];
  const grouped: VariantContext = { sigla: many, groups };
  const witnessChip = (s: string): WitnessChip => ({
    kind: 'witness',
    siglum: s,
    name: `Codex ${s}`,
    witness: s,
    state: false,
  });

  it('gathers the members of a group where all of them stand together, and never hides them', () => {
    const chips = gather(['A', 'B', 'C', 'D', 'E', 'F'].map(witnessChip), groups);
    expect(chips.map(chipText)).toEqual(['A', 'B', 'φ (C D E)', 'F']);
    const group = chips[2]!;
    expect(group).toMatchObject({ kind: 'group', siglum: 'φ', note: 'consensus codicum CDE' });
    expect(group.kind === 'group' && group.members.map((m) => m.siglum)).toEqual(['C', 'D', 'E']);
  });

  it('names the members apart where not all of them are there', () => {
    expect(gather(['A', 'C', 'D', 'F'].map(witnessChip), groups).map(chipText)).toEqual([
      'A',
      'C',
      'D',
      'F',
    ]);
  });

  it('gathers in the head and in a row, in the order of the conspectus', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'ta', 'tb']), reading('θεοί', ['tf', 'te', 'tc', 'td'])],
      },
    ]);
    const v = variant(seg, 0, grouped);
    expect(v.there).toMatchObject({ count: 6, total: 6, all: true });
    expect(lines(v)).toEqual(['θεὰ | A B', 'θεοί | φ (C D E) F']);
    expect(sigs(v.there!.chips)).toEqual(['A', 'B', 'φ (C D E)', 'F']);
  });

  it('gathers a group in the witnesses of an addition too', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 2,
        readings: [reading('', ['ed', 'ta']), reading('δὴ', ['tb', 'tc', 'td', 'te'])],
      },
    ]);
    expect(sigs(variant(seg, 0, grouped).addition!)).toEqual(['B', 'φ (C D E)']);
  });
});

describe('states of a witness collated under sigla of their own', () => {
  const SUB: Record<string, string> = { ...SIGLUM, 'ta:variant': 'A v.l.', 'ta:s0': 'A¹' };
  const withSub: VariantContext = {
    sigla: sigla.map((s) =>
      s.siglum === 'A'
        ? { ...s, states: [{ kind: 'original' as const, siglum: 'A¹' }], variantSiglum: 'A v.l.' }
        : s,
    ),
  };
  function sub(text: string, ids: string[]): Reading {
    return { ...reading(text, ids), sigla: ids.map((id) => SUB[id] ?? id) };
  }

  it('names a variant noted in a witness, by its own siglum and the witness’s name', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [sub('ἄειδε', ['ed', 'ta', 'tb']), sub('ἔννεπε', ['ta:variant'])],
      },
    ]);
    const v = variant(seg, 0, withSub);
    expect(lines(v)).toEqual(['ἄειδε | A B', 'ἔννεπε | A v.l.']);
    expect(v.rows[1]!.chips[0]).toEqual({
      kind: 'witness',
      siglum: 'A v.l.',
      name: 'Variant noted in Venetus A',
      witness: 'A',
      state: true,
    });
    // A state is not counted among the witnesses that are there.
    expect(v.there).toMatchObject({ count: 2 });
  });

  it('names a witness before correction, after its witness', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [sub('θεὰ', ['ed', 'ta', 'tb']), sub('θεοί', ['ta:s0'])],
      },
    ]);
    const v = variant(seg, 0, withSub);
    expect(lines(v)).toEqual(['θεὰ | A B', 'θεοί | A¹']);
    expect(v.rows[1]!.chips[0]).toMatchObject({
      siglum: 'A¹',
      name: 'Venetus A before correction',
      witness: 'A',
      state: true,
    });
    const along = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [sub('θεὰ', ['ed', 'tb']), sub('θεοί', ['tc', 'ta:s0', 'ta'])],
      },
    ]);
    expect(lines(variant(along, 0, withSub))[1]).toBe('θεοί | A A¹ C');
  });

  it('names a state once, with its witness, where they agree', () => {
    const agreeing = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [reading('ἄειδε', ['ed', 'tb']), reading('ἔννεπε', ['ta:variant', 'ta'])],
      },
    ]);
    expect(lines(variant(agreeing))).toEqual(['ἄειδε | B', 'ἔννεπε | A']);
    // Where it differs, it is named from its text id when the conspectus does not give its siglum.
    const differing = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [reading('ἄειδε', ['ed', 'tb', 'ta']), reading('ἔννεπε', ['ta:variant'])],
      },
    ]);
    expect(lines(variant(differing))).toEqual(['ἄειδε | A B', 'ἔννεπε | A v.l.']);
    expect(variant(differing).rows[1]!.chips[0]).toMatchObject({
      name: 'Variant noted in Venetus A',
      state: true,
    });
  });

  it('finds a state named by its siglum in a report', () => {
    const seg = segment(
      [{ index: 0, baseFrom: 2, baseTo: 3, readings: [reading('θεὰ', ['ed', 'ta'])] }],
      { attachments: { 0: [{ kind: 'reported', id: 'r', text: 'θεοί', name: 'A v.l.' }] } },
    );
    const row = variant(seg, 0, withSub).rows[1]!;
    expect(row.chips[0]).toMatchObject({
      siglum: 'A v.l.',
      name: 'Variant noted in Venetus A',
      reported: { source: '' },
    });
  });
});

describe('the head of a variant', () => {
  it('says interpretative and minor', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        kind: 'interpretative',
        minor: true,
        readings: [reading('ἄειδε', ['ed', 'ta']), reading('ἄειδε,', ['tb'])],
      },
    ]);
    const v = variant(seg);
    expect(v).toMatchObject({ interpretative: true, minor: true, label: '1.1', key: 's1:0' });
    // A conjecture of other words makes the variant textual, whatever the witnesses have.
    const textual = segment(
      [
        {
          index: 0,
          baseFrom: 1,
          baseTo: 2,
          kind: 'interpretative',
          readings: [reading('ἄειδε', ['ed', 'ta']), reading('ἄειδε,', ['tb'])],
        },
      ],
      { attachments: { 0: [conjecture({ id: 'c', name: 'Bentley', text: 'ἔννεπε' })] } },
    );
    expect(variant(textual)).toMatchObject({ interpretative: false, minor: false });
  });

  it('carries the notes on its words and is null for a site that is not there', () => {
    const note: ReaderNote = { id: 'n1', tokenIds: ['e2'], text: 'Cf. 1.5.', author: null };
    const other: ReaderNote = {
      id: 'n2',
      tokenIds: ['e0'],
      text: 'On the first word.',
      author: null,
    };
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεὰ', ['ed', 'ta']), reading('θεοί', ['tb'])],
        },
      ],
      { notes: [note, other] },
    );
    expect(variant(seg).notes).toEqual([note]);
    expect(notesAt(seg, 0)).toEqual([note]);
    expect(variantOf(seg, 7, context)).toBeNull();
  });
});

describe('on a real collation', () => {
  function text(id: string, siglum: string, words: string): CollationText {
    return {
      id,
      siglum,
      units: words.split(' ').map((w, i) => ({ text: w, tokenIds: [`${id}${i}`] })),
    };
  }

  it('reads what collate produces', () => {
    const ed = text('ed', 'ed.', 'ἄλγε᾽ ἔθηκε πολλὰς');
    const collation = collate(ed, [
      text('ta', 'A', 'ἄλγε᾽ ἔθηκε πολλὰς'),
      text('tb', 'B', 'ἄλγεα θῆκε πολλὰς'),
    ]);
    const seg = segment([], { collation, baseUnits: ed.units });
    const v = variant(seg, collation.sites[0]!.index);
    expect(lines(v)).toEqual(['ἄλγε᾽ ἔθηκε | A', 'ἄλγεα θῆκε | B']);
    expect(v.there).toMatchObject({ count: 2, total: 3 });
  });
});

describe('a word in another place of its segment, on a real collation', () => {
  function text(id: string, siglum: string, words: string): CollationText {
    return {
      id,
      siglum,
      units: words.split(' ').map((w, i) => ({ text: w, tokenIds: [`${id}${i}`] })),
    };
  }

  it('gives each of the two variants a link to the other, on the row of the witness that moved the word', () => {
    const words = 'ἄλγε ἔθηκε πολλὰς δὲ ψυχὰς Ἄϊδι προΐαψεν ἡρώων αὐτοὺς δὲ ἑλώρια';
    const ed = text('ed', 'ed.', words);
    const collation = collate(ed, [
      text('ta', 'A', words),
      text('tb', 'B', 'ἔθηκε πολλὰς δὲ ψυχὰς Ἄϊδι προΐαψεν ἡρώων αὐτοὺς δὲ ἑλώρια ἄλγε'),
    ]);
    const seg = segment([], { collation, baseUnits: ed.units });
    const [from, to] = collation.sites;
    expect(from!.transposition?.withSite).toBe(to!.index);
    expect(to!.transposition?.withSite).toBe(from!.index);

    const first = variant(seg, from!.index);
    expect(lines(first)).toEqual(['ἄλγε | A', 'not in | B']);
    expect(first.rows[1]!.links).toEqual([
      { key: `s1:${to!.index}`, where: { words: '', place: { side: 'after', word: 'ἑλώρια' } } },
    ]);
    const second = variant(seg, to!.index);
    expect(lines(second)).toEqual(['not in | A', 'ἄλγε | B']);
    expect(second.rows[1]!.links).toEqual([
      {
        key: `s1:${from!.index}`,
        where: { words: '', place: { side: 'before', word: 'ἔθηκε' } },
      },
    ]);
    // The witness that did not move has no link, and no word is said of any move.
    expect(first.rows[0]!.links).toEqual([]);
    expect(second.addition).toEqual([expect.objectContaining({ siglum: 'B' })]);
  });
});

describe('variantsOf', () => {
  it('lists the shown variants of each segment in text order, with the notes and unplaced conjectures of the segment', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 2,
          baseTo: 3,
          readings: [reading('θεὰ', ['ed', 'ta']), reading('θεοί', ['tb'])],
        },
        { index: 1, baseFrom: 0, baseTo: 1, readings: [reading('μῆνιν', ['ed', 'ta', 'tb'])] },
        {
          index: 2,
          baseFrom: 2,
          baseTo: 2,
          readings: [reading('', ['ed', 'ta']), reading('δή', ['tb'])],
        },
        {
          index: 3,
          baseFrom: 3,
          baseTo: 4,
          readings: [reading('Πηληϊάδεω', ['ed', 'ta']), reading('Πηλεΐδεω', ['tb'])],
        },
      ],
      {
        attachments: { 1: [conjecture({ id: 'c', name: 'Bentley', text: 'μῆνιν δή' })] },
        notes: [
          { id: 'n1', tokenIds: ['e2'], text: 'On the goddess.', author: null },
          { id: 'n2', tokenIds: ['e3'], text: 'On the patronymic.', author: 'R. Berge' },
        ],
        unplaced: [conjecture({ id: 'u', name: 'Tester', conjectureKind: 'lacuna' })],
      },
    );
    const shown = new Set(['s1:0', 's1:1', 's1:2']);
    const [group, ...rest] = variantsOf(['s1', 'missing'], { s1: seg }, shown, context);
    expect(rest).toEqual([]);
    expect(group!.label).toBe('1.1');
    expect(group!.places.map((p) => p.siteIndex)).toEqual([1, 2, 0]);
    expect(group!.places[2]!.notes.map((n) => n.id)).toEqual(['n1']);
    expect(group!.notes.map((n) => n.id)).toEqual(['n2']);
    expect(group!.unplaced.map(line)).toEqual(['lacuna | Tester, conjecture']);
  });

  it('leaves out segments where nothing varies', () => {
    const seg = segment([
      { index: 0, baseFrom: 0, baseTo: 1, readings: [reading('μῆνιν', ['ed', 'ta'])] },
    ]);
    expect(variantsOf(['s1'], { s1: seg }, new Set<string>(), context)).toEqual([]);
  });
});
