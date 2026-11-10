import { describe, expect, it } from 'vitest';
import {
  collate,
  type Attachment,
  type Collation,
  type CollationText,
  type Reading,
  type Site,
  type Unit,
} from '@varians/core';
import {
  explainAttachment,
  explainSite,
  fill,
  listOf,
  plainSentence,
  variantsOf,
  type ExplainContext,
  type SiteExplanation,
} from './explain';
import type { ReaderNote, ReaderSegment, ReaderSiglum } from './types';

const sigla: ReaderSiglum[] = [
  {
    siglum: 'A',
    witnessId: 'wa',
    witnessName: 'Venetus A',
    transcriptionId: 'ta',
    description: null,
  },
  {
    siglum: 'B',
    witnessId: 'wb',
    witnessName: 'Venetus B',
    transcriptionId: 'tb',
    description: null,
  },
  {
    siglum: 'C',
    witnessId: 'wc',
    witnessName: 'Codex Laurentianus',
    transcriptionId: 'tc',
    description: null,
  },
  {
    siglum: 'T',
    witnessId: 'wt',
    witnessName: 'Townleianus',
    transcriptionId: null,
    description: null,
  },
];

const context: ExplainContext = { sigla };

const SIGLUM: Record<string, string> = { ed: 'ed.', ta: 'A', tb: 'B', tc: 'C' };

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

/** A segment of the edition text "μῆνιν ἄειδε θεὰ Πηληϊάδεω" with the given sites. */
function segment(
  sites: (Omit<Site, 'columnFrom' | 'columnTo' | 'kind'> & Partial<Pick<Site, 'kind'>>)[],
  extra: Partial<ReaderSegment> = {},
): ReaderSegment {
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

function explain(seg: ReaderSegment, index = 0, ctx: ExplainContext = context): SiteExplanation {
  const out = explainSite(seg, index, ctx);
  if (!out) throw new Error('no site');
  return out;
}

const plain = (e: SiteExplanation) => ({
  authority: e.authority.map(plainSentence),
  lines: e.lines.map((l) => plainSentence(l.sentence)),
});

/** Latin abbreviations and the like that the explanation must never use. */
const LATIN = /\b(om|add|codd|coni|lac|del|transp|suppl)\.|\bdeest\b|\blacunam\b/;

function conjecture(fields: Partial<Attachment> & Pick<Attachment, 'id' | 'name'>): Attachment {
  return { kind: 'conjecture', text: '', conjectureKind: 'substitution', ...fields };
}

describe('fill and listOf', () => {
  it('fills placeholders with parts and joins text', () => {
    const out = fill('{who} reads {words}.', {
      who: [{ kind: 'witness', name: 'Venetus B', siglum: 'B' }],
      words: [{ kind: 'words', text: 'θῆκε' }],
    });
    expect(out).toEqual([
      { kind: 'witness', name: 'Venetus B', siglum: 'B' },
      { kind: 'text', text: ' reads ' },
      { kind: 'words', text: 'θῆκε' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('lists names as a sentence does', () => {
    const name = (n: string) => [{ kind: 'text' as const, text: n }];
    expect(plainSentence(listOf([name('A')]))).toBe('A');
    expect(plainSentence(listOf([name('A'), name('B')]))).toBe('A and B');
    expect(plainSentence(listOf([name('A'), name('B'), name('C')]))).toBe('A, B and C');
  });
});

describe('explainSite: what the edition prints', () => {
  it('names the witnesses the edition follows, by name with the siglum beside it', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed', 'ta', 'tc']), reading('θεά μοι', ['tb'])],
      },
    ]);
    const e = explain(seg);
    expect(e.words).toBe('θεὰ');
    expect(e.place).toBeNull();
    expect(plain(e)).toEqual({
      authority: ['The edition follows Venetus A and Codex Laurentianus.'],
      lines: ['Venetus B reads θεά μοι.'],
    });
    expect(e.authority[0]).toContainEqual({ kind: 'witness', name: 'Venetus A', siglum: 'A' });
    expect(e.lines[0]!.sentence).toContainEqual({ kind: 'words', text: 'θεά μοι' });
  });

  it('says every witness when all of three or more agree', () => {
    const seg = segment(
      [{ index: 0, baseFrom: 2, baseTo: 3, readings: [reading('θεὰ', ['ed', 'ta', 'tb', 'tc'])] }],
      {
        attachments: { 0: [conjecture({ id: 'c1', name: 'Bentley', text: 'θεᾶς' })] },
        cites: { c1: ['West 1998, 45'] },
      },
    );
    const e = explain(seg);
    expect(plain(e).authority).toEqual(['The edition follows every witness.']);
    expect(plain(e).lines).toEqual(['Bentley proposed θεᾶς.']);
    expect(e.lines[0]!.references).toEqual(['West 1998, 45']);
  });

  it('names an adopted conjecture with no witness behind it', () => {
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
    const e = explain(seg);
    expect(plain(e)).toEqual({
      authority: ['The edition prints a conjecture of Berge; no witness has it.'],
      lines: ['Venetus A, Venetus B and Codex Laurentianus read θεὰ.'],
    });
    expect(e.authorityReferences).toEqual(['Berge 2026, 3']);
  });

  it('says what an editor added or changed without a witness', () => {
    const added = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεὰ', ['ed']), reading('', ['ta', 'tb'])],
      },
    ]);
    expect(plain(explain(added)).authority).toEqual([
      'No witness has these words; the editor added them.',
    ]);
    expect(plain(explain(added)).lines).toEqual(['Venetus A and Venetus B leave these words out.']);

    const changed = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [reading('θεᾶς', ['ed']), reading('θεὰ', ['ta'])],
      },
    ]);
    expect(plain(explain(changed)).authority).toEqual([
      "No witness has this reading; it is the editor's own.",
    ]);
  });

  it('follows a witness known from a report, and says where the report is', () => {
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
      },
    );
    const e = explain(seg);
    expect(plain(e)).toEqual({
      authority: [
        'The edition follows Townleianus.',
        "The reading of Townleianus is known from Allen's apparatus (1931).",
      ],
      lines: ['Venetus A, Venetus B and Codex Laurentianus read θεοί.'],
    });
  });
});

describe('explainSite: the alternatives', () => {
  it('explains an addition, with the word it follows', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 2,
        readings: [reading('', ['ed', 'ta', 'tc']), reading('καὶ ὕστερον', ['tb'])],
      },
    ]);
    const e = explain(seg);
    expect(e.words).toBe('');
    expect(e.place).toEqual({ side: 'after', word: 'ἄειδε' });
    expect(plain(e)).toEqual({
      authority: ['The edition follows Venetus A and Codex Laurentianus.'],
      lines: ['Venetus B adds καὶ ὕστερον here.'],
    });
  });

  it('places an addition at the start before the first word', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 0,
        baseTo: 0,
        readings: [reading('', ['ed', 'ta']), reading('καὶ', ['tb'])],
      },
    ]);
    expect(explain(seg).place).toEqual({ side: 'before', word: 'μῆνιν' });
  });

  it('says the edition leaves out what the witnesses have', () => {
    const seg = segment([
      { index: 0, baseFrom: 2, baseTo: 2, readings: [reading('', ['ed']), reading('δὴ', ['ta'])] },
    ]);
    expect(plain(explain(seg))).toEqual({
      authority: ['The editor leaves out what the witnesses have here.'],
      lines: ['Venetus A adds δὴ here.'],
    });
  });

  it('says nothing of a witness that is in no reading, as one that has lost the words is', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 3,
        readings: [reading('ἄειδε θεὰ', ['ed', 'ta']), reading('ἄειδε θεοί', ['tb'])],
      },
    ]);
    expect(plain(explain(seg))).toEqual({
      authority: ['The edition follows Venetus A.'],
      lines: ['Venetus B reads ἄειδε θεοί.'],
    });
  });

  it('explains a change of order in the same place, and a move to another place', () => {
    const order = segment([
      {
        index: 0,
        baseFrom: 0,
        baseTo: 2,
        readings: [reading('μῆνιν ἄειδε', ['ed', 'ta']), reading('ἄειδε μῆνιν', ['tb'])],
        transposition: { withSite: 0, textIds: ['tb'] },
      },
    ]);
    expect(plain(explain(order)).lines).toEqual([
      'Venetus B has these words in another order: ἄειδε μῆνιν.',
    ]);

    const moved = segment([
      {
        index: 0,
        baseFrom: 0,
        baseTo: 1,
        readings: [reading('μῆνιν', ['ed', 'ta']), reading('', ['tb', 'tc'])],
        transposition: { withSite: 1, textIds: ['tb', 'tc'] },
      },
    ]);
    expect(plain(explain(moved)).lines).toEqual([
      'Venetus B and Codex Laurentianus leave these words out.',
      'Venetus B and Codex Laurentianus have these words in another place.',
    ]);
  });

  it('explains reported readings and every kind of conjecture', () => {
    const at = (a: Attachment) => plainSentence(explainAttachment(a, context).sentence);
    expect(
      at({
        kind: 'reported',
        id: 'r',
        text: 'θεὰ',
        name: 'T',
        source: "(Allen's apparatus (1931))",
      }),
    ).toBe("Townleianus is reported to read θεὰ, according to Allen's apparatus (1931).");
    expect(at({ kind: 'reported', id: 'r', text: 'θεὰ', name: 'T' })).toBe(
      'Townleianus is reported to read θεὰ.',
    );
    expect(at({ kind: 'reported', id: 'r', text: '', name: 'T' })).toBe(
      'Townleianus is reported to leave these words out.',
    );
    expect(at(conjecture({ id: 'c', name: 'Bentley', text: 'κύνεσι,' }))).toBe(
      'Bentley proposed κύνεσι.',
    );
    expect(at(conjecture({ id: 'c', name: 'Bentley', conjectureKind: 'deletion' }))).toBe(
      'Bentley proposed deleting these words.',
    );
    expect(at(conjecture({ id: 'c', name: 'Bentley', conjectureKind: 'lacuna' }))).toBe(
      'Bentley thought words are missing here.',
    );
    expect(
      at(conjecture({ id: 'c', name: 'Bentley', conjectureKind: 'supplement', text: 'τε' })),
    ).toBe('Bentley proposed adding τε here.');
    expect(
      at(
        conjecture({
          id: 'c',
          name: 'Bentley',
          conjectureKind: 'transposition',
          text: 'ἄειδε μῆνιν',
        }),
      ),
    ).toBe('Bentley proposed the order ἄειδε μῆνιν.');
    expect(at(conjecture({ id: 'c', name: 'this edition', text: 'θεᾶς' }))).toBe(
      'The editor proposed θεᾶς.',
    );
    expect(at({ kind: 'reported', id: 'r', text: 'θεὰ', name: 'Q' })).toBe(
      'Witness Q is reported to read θεὰ.',
    );
  });

  it('puts a conjecture source and its citations after it', () => {
    const line = explainAttachment(
      conjecture({ id: 'c', name: 'Zenodotus', text: 'δαῖτα', source: '(Ath. 1.12e)' }),
      context,
      { c: ['West 1998, 45'] },
    );
    expect(line.references).toEqual(['Ath. 1.12e', 'West 1998, 45']);
  });

  it('says nothing of the witnesses without the passage', () => {
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
    expect(plain(explain(seg))).toEqual({
      authority: ['The edition follows Venetus A.'],
      lines: ['Venetus B reads θεοί.'],
    });
  });

  it('never uses Latin abbreviations or bare sigla', () => {
    const seg = segment(
      [
        {
          index: 0,
          baseFrom: 0,
          baseTo: 1,
          readings: [reading('μῆνιν', ['ed', 'ta']), reading('', ['tb'])],
        },
        {
          index: 1,
          baseFrom: 2,
          baseTo: 2,
          readings: [reading('', ['ed', 'ta', 'tc']), reading('δή', ['tb'])],
        },
      ],
      {
        attachments: {
          0: [
            conjecture({ id: 'd', name: 'Bentley', conjectureKind: 'deletion' }),
            { kind: 'reported', id: 'r', text: '', name: 'T' },
          ],
        },
      },
    );
    for (const index of [0, 1]) {
      const e = explain(seg, index);
      const sentences = [...e.authority, ...e.lines.map((l) => l.sentence)];
      for (const sentence of sentences) {
        expect(plainSentence(sentence)).not.toMatch(LATIN);
        for (const part of sentence)
          if (part.kind === 'witness') expect(part.name).not.toBe(part.siglum);
        expect(plainSentence(sentence)).not.toMatch(/—/);
      }
    }
  });

  it('carries the notes on its words and returns null for a site that is not there', () => {
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
    expect(explain(seg).notes).toEqual([note]);
    expect(explainSite(seg, 7, context)).toBeNull();
  });
});

describe('explainSite on a real collation', () => {
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
    const site = collation.sites[0]!;
    const e = explain(seg, site.index);
    expect(plain(e).authority).toEqual(['The edition follows Venetus A.']);
    expect(plain(e).lines).toEqual(['Venetus B reads ἄλγεα θῆκε.']);
  });
});

describe('explainSite: states of a witness collated under sub-sigla', () => {
  const SUB: Record<string, string> = { ...SIGLUM, 'ta:variant': 'A v.l.', 'ta:s0': 'A¹' };
  const withSub: ExplainContext = {
    sigla: sigla.map((s) =>
      s.siglum === 'A'
        ? { ...s, states: [{ kind: 'original' as const, siglum: 'A¹' }], variantSiglum: 'A v.l.' }
        : s,
    ),
  };
  function sub(text: string, ids: string[]): Reading {
    return { ...reading(text, ids), sigla: ids.map((id) => SUB[id] ?? id) };
  }

  it('names a variant noted in a witness, opening a sentence and inside one', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [sub('ἄειδε', ['ed', 'ta', 'tb']), sub('ἔννεπε', ['ta:variant'])],
      },
    ]);
    const e = explain(seg, 0, withSub);
    expect(plain(e).lines).toEqual(['A variant noted in Venetus A reads ἔννεπε.']);
    expect(e.lines[0]!.sentence[0]).toEqual({
      kind: 'witness',
      name: 'A variant noted in Venetus A',
      siglum: 'A v.l.',
      atStart: 'A variant noted in Venetus A',
    });

    const along = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [sub('ἄειδε', ['ed', 'ta']), sub('ἔννεπε', ['tb', 'ta:variant'])],
      },
    ]);
    expect(plain(explain(along, 0, withSub)).lines).toEqual([
      'A variant noted in Venetus A and Venetus B read ἔννεπε.',
    ]);

    const followed = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [sub('ἔννεπε', ['ed', 'ta:variant']), sub('ἄειδε', ['ta', 'tb'])],
      },
    ]);
    expect(plain(explain(followed, 0, withSub)).authority).toEqual([
      'The edition follows a variant noted in Venetus A.',
    ]);
  });

  it('names a witness before correction', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 2,
        baseTo: 3,
        readings: [sub('θεὰ', ['ed', 'ta', 'tb']), sub('θεοί', ['ta:s0'])],
      },
    ]);
    expect(plain(explain(seg, 0, withSub)).lines).toEqual([
      'Venetus A before correction reads θεοί.',
    ]);
    expect(explain(seg, 0, withSub).lines[0]!.sentence[0]).toEqual({
      kind: 'witness',
      name: 'Venetus A before correction',
      siglum: 'A¹',
    });
  });

  it('names the states from the text id when the conspectus does not give their sigla, after the witness itself', () => {
    // Where the noted variant agrees with its manuscript, the manuscript alone is named.
    const agreeing = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [reading('ἄειδε', ['ed', 'tb']), reading('ἔννεπε', ['ta:variant', 'ta'])],
      },
    ]);
    expect(plain(explain(agreeing)).lines).toEqual(['Venetus A reads ἔννεπε.']);
    // Where it differs, it is named from its text id.
    const differing = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        readings: [reading('ἄειδε', ['ed', 'tb', 'ta']), reading('ἔννεπε', ['ta:variant'])],
      },
    ]);
    expect(plain(explain(differing)).lines).toEqual(['A variant noted in Venetus A reads ἔννεπε.']);
  });

  it('finds a sub-siglum given as a siglum', () => {
    const line = explainAttachment(
      { kind: 'reported', id: 'r', text: 'θεοί', name: 'A v.l.' },
      withSub,
    );
    expect(plainSentence(line.sentence)).toBe(
      'A variant noted in Venetus A is reported to read θεοί.',
    );
  });
});

describe('variantsOf', () => {
  it('lists the shown places of each segment in text order, with the notes and unplaced conjectures of the segment', () => {
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
    expect(group!.unplaced.map((l) => plainSentence(l.sentence))).toEqual([
      'Tester thought words are missing here.',
    ]);
  });

  it('leaves out segments where nothing varies', () => {
    const seg = segment([
      { index: 0, baseFrom: 0, baseTo: 1, readings: [reading('μῆνιν', ['ed', 'ta'])] },
    ]);
    expect(variantsOf(['s1'], { s1: seg }, new Set<string>(), context)).toEqual([]);
  });
});

describe('explainSite: how a reading stands to the edition’s words', () => {
  it('says what a reading is, and nothing of its grammar: another order only where the words are the same', () => {
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
    expect(plain(explain(seg)).lines).toEqual([
      'Venetus B reads θεοί.',
      'Codex Laurentianus reads θεὰ ἄειδε.',
    ]);
  });

  it('says where the same letters are read otherwise, keeping the punctuation', () => {
    const seg = segment([
      {
        index: 0,
        baseFrom: 1,
        baseTo: 2,
        kind: 'interpretative',
        readings: [reading('ἄειδε', ['ed', 'ta']), reading('ἄειδε,', ['tb'])],
      },
    ]);
    expect(plain(explain(seg)).lines).toEqual([
      'Venetus B reads the same letters otherwise: ἄειδε,',
    ]);
  });
});
