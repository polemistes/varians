import { describe, expect, it } from 'vitest';
import {
  checked,
  describeDependents,
  field,
  parseCitations,
  parseConjectureForm,
  parseEmail,
  parseName,
  parseReadingForm,
  parseSchemeChoice,
  parseTranscriptionForm,
  parseWitnessForm,
  parseWorkForm,
  withParam,
} from './forms';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('fields', () => {
  it('reads text and checkboxes', () => {
    const data = form({ a: 'x', on: 'on', off: 'off' });
    expect(field(data, 'a')).toBe('x');
    expect(field(data, 'missing')).toBe('');
    expect(checked(data, 'on')).toBe(true);
    expect(checked(data, 'off')).toBe(false);
    expect(checked(data, 'missing')).toBe(false);
  });
});

describe('parseWorkForm', () => {
  it('trims and takes a listed language', () => {
    const parsed = parseWorkForm(
      form({
        title: '  Iliad ',
        author: 'Homer',
        language: 'grc',
        identifier: '',
        description: '',
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        title: 'Iliad',
        author: 'Homer',
        language: 'grc',
        identifier: '',
        identifiers: [],
        description: '',
      },
    });
  });

  it('takes the code typed for Other', () => {
    const parsed = parseWorkForm(
      form({ title: 'Genesis', language: 'other', languageCode: ' hbo ' }),
    );
    expect(parsed.ok && parsed.data).toMatchObject({ language: 'hbo' });
  });

  it('knows nothing of a work being private: a form that says so gives a work like any other', () => {
    const parsed = parseWorkForm(
      form({ title: 'Genesis', language: 'hbo', visibility: 'private' }),
    );
    expect(parsed.ok && parsed.data).not.toHaveProperty('visibility');
  });

  it('reports what is wrong with what was typed', () => {
    const parsed = parseWorkForm(form({ title: ' ', language: 'other', languageCode: '1x' }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.title).toEqual(['Give the work a title.']);
    expect(parsed.errors.language?.[0]).toMatch(/language code/);
    expect(parsed.values.languageCode).toBe('1x');
  });
});

describe('parseSchemeChoice', () => {
  it('takes a preset by name', () => {
    expect(parseSchemeChoice(form({ scheme: 'Chapter and verse' }))).toEqual({
      ok: true,
      scheme: { preset: 'Chapter and verse' },
    });
    expect(parseSchemeChoice(form({ scheme: 'Nonsense' }))).toEqual({
      ok: false,
      errors: ['This scheme is not on the list.'],
    });
    expect(parseSchemeChoice(form({}))).toEqual({ ok: false, errors: ['Choose a scheme.'] });
  });

  it('checks custom levels', () => {
    const good = JSON.stringify([
      { key: 'folio', label: 'Folio', type: 'number', separator: '' },
      { key: 'side', label: 'Side', type: 'text', separator: '' },
    ]);
    const parsed = parseSchemeChoice(form({ scheme: 'custom', levels: good }));
    expect(
      parsed.ok && 'levels' in parsed.scheme && parsed.scheme.levels.map((l) => l.key),
    ).toEqual(['folio', 'side']);
    const bad = JSON.stringify([
      { key: 'a', label: 'A', type: 'number', separator: '' },
      { key: 'b', label: 'B', type: 'number', separator: '' },
    ]);
    const refused = parseSchemeChoice(form({ scheme: 'custom', levels: bad }));
    expect(refused.ok).toBe(false);
    expect(parseSchemeChoice(form({ scheme: 'custom', levels: 'not json' }))).toEqual({
      ok: false,
      errors: ['The scheme is not sound yet.'],
    });
  });
});

describe('parseWitnessForm', () => {
  it('requires a siglum and a name', () => {
    const parsed = parseWitnessForm(form({ siglum: '', name: 'Venetus A' }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.siglum).toEqual(['Give the witness a siglum.']);
    expect(parsed.values.name).toBe('Venetus A');
  });

  it('reads the hands as a list, keeping ids and settling on one main hand', () => {
    const none = parseWitnessForm(form({ siglum: 'A', name: 'A' }));
    expect(none.ok && none.data.hands).toEqual([]);
    const two = parseWitnessForm(
      form({
        siglum: 'A',
        name: 'A',
        hands: JSON.stringify([
          { id: 'abc12345', label: ' m1 ', description: '', main: false },
          { id: '', label: 'm2', description: 'a later hand', main: false },
        ]),
      }),
    );
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.data.hands[0]).toMatchObject({
      id: 'abc12345',
      label: 'm1',
      description: null,
      main: true,
    });
    expect(two.data.hands[1]).toMatchObject({
      label: 'm2',
      description: 'a later hand',
      main: false,
    });
    expect(two.data.hands[1]!.id).toMatch(/^[0-9a-f]{8}$/);
    const unlabelled = parseWitnessForm(
      form({ siglum: 'A', name: 'A', hands: JSON.stringify([{ label: '', description: 'who?' }]) }),
    );
    expect(unlabelled.ok).toBe(false);
    if (!unlabelled.ok) expect(unlabelled.errors.hands?.[0]).toBeTruthy();
    const broken = parseWitnessForm(form({ siglum: 'A', name: 'A', hands: '{not json' }));
    expect(broken.ok).toBe(false);
  });

  it('takes the material from the list, or as free text under Other', () => {
    const listed = parseWitnessForm(form({ siglum: 'P', name: 'P', material: 'papyrus' }));
    expect(listed.ok && listed.data.material).toBe('papyrus');
    const other = parseWitnessForm(
      form({ siglum: 'L', name: 'L', material: 'other', materialOther: ' lead ' }),
    );
    expect(other.ok && other.data.material).toBe('lead');
    const none = parseWitnessForm(form({ siglum: 'N', name: 'N', material: '' }));
    expect(none.ok && none.data.material).toBe('');
    const unknown = parseWitnessForm(form({ siglum: 'G', name: 'G', material: 'granite' }));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.material?.[0]).toBeTruthy();
  });

  it('defaults the category', () => {
    const parsed = parseWitnessForm(form({ siglum: 'A', name: 'Venetus A' }));
    expect(parsed.ok && parsed.data).toMatchObject({
      siglum: 'A',
      category: 'manuscript',
      shelfmark: '',
    });
    expect(parseWitnessForm(form({ siglum: 'A', name: 'A', category: 'scroll' })).ok).toBe(false);
    expect(parseWitnessForm(form({ siglum: 'A', name: 'A', category: 'papyrus' })).ok).toBe(false);
  });

  it('keeps the format for manuscripts and the quoting work for indirect sources', () => {
    const papyrus = parseWitnessForm(
      form({ siglum: 'P', name: 'P. Oxy. 1', material: 'papyrus', format: 'roll' }),
    );
    expect(papyrus.ok && papyrus.data).toMatchObject({
      category: 'manuscript',
      format: 'roll',
      material: 'papyrus',
    });
    const unsaid = parseWitnessForm(form({ siglum: 'Q', name: 'Q' }));
    expect(unsaid.ok && unsaid.data).toMatchObject({ format: 'unknown' });
    const quoted = parseWitnessForm(
      form({
        siglum: 'Ath',
        name: 'Athenaeus',
        category: 'indirect',
        format: 'codex',
        sourceAuthor: 'Athenaeus',
        sourceWork: 'Deipnosophistae',
      }),
    );
    expect(quoted.ok && quoted.data).toMatchObject({
      format: null,
      sourceAuthor: 'Athenaeus',
      sourceWork: 'Deipnosophistae',
    });
    const stone = parseWitnessForm(
      form({ siglum: 'I', name: 'I', category: 'inscription', sourceAuthor: 'x' }),
    );
    expect(stone.ok && stone.data).toMatchObject({ format: null, sourceAuthor: '' });
  });
});

describe('parseTranscriptionForm and parseName', () => {
  it('turns empty choices into null', () => {
    expect(
      parseTranscriptionForm(
        form({ name: ' Iliad 1 ', workId: '', fromTranscriptionId: '', keepsWrittenForm: 'on' }),
      ),
    ).toEqual({
      ok: true,
      data: { name: 'Iliad 1', workId: null, keepsWrittenForm: true, fromTranscriptionId: null },
    });
    expect(parseTranscriptionForm(form({ name: '' })).ok).toBe(false);
    expect(parseName(form({ name: '  New ' }))).toEqual({ ok: true, data: { name: 'New' } });
  });
});

describe('parseConjectureForm', () => {
  it('asks for what each kind needs', () => {
    const substitution = parseConjectureForm(
      form({ segment: '1.5', kind: 'substitution', lemma: 'πᾶσι', reading: '' }),
    );
    expect(!substitution.ok && substitution.errors.reading).toEqual(['Give the proposed words.']);
    const deletion = parseConjectureForm(
      form({ segment: '1.5', kind: 'deletion', lemma: '', reading: '' }),
    );
    expect(!deletion.ok && deletion.errors.lemma).toEqual([
      'Give the words the conjecture concerns.',
    ]);
    const lacuna = parseConjectureForm(
      form({ segment: '1.5', kind: 'lacuna', extent: 'one line', reading: 'stray' }),
    );
    expect(lacuna).toEqual({
      ok: true,
      data: {
        segment: '1.5',
        kind: 'lacuna',
        lemma: '',
        reading: '',
        proposer: null,
        note: null,
        extent: 'one line',
        published: false,
      },
    });
  });

  it('keeps the extent for a lacuna only, and reads the published box', () => {
    const parsed = parseConjectureForm(
      form({
        segment: ' 1.5 ',
        kind: 'substitution',
        lemma: 'πᾶσι',
        reading: 'δαῖτα',
        extent: 'x',
        proposer: 'Zenodotus',
        published: 'on',
      }),
    );
    expect(parsed.ok && parsed.data).toMatchObject({
      segment: '1.5',
      extent: null,
      proposer: 'Zenodotus',
      published: true,
    });
    expect(parseConjectureForm(form({ segment: '', kind: 'addition', reading: 'x' })).ok).toBe(
      false,
    );
    expect(parseConjectureForm(form({ segment: '1', kind: 'guess', reading: 'x' })).ok).toBe(false);
  });
});

describe('parseReadingForm', () => {
  it('wants a witness and a lemma or a reading; an empty reading is an omission', () => {
    const missing = parseReadingForm(
      form({ segment: '1.1', witnessId: '', lemma: '', reading: '' }),
    );
    expect(!missing.ok && missing.errors).toMatchObject({
      witnessId: ['Choose a witness.'],
      lemma: ['Give the lemma, the reading or both.'],
    });
    const omission = parseReadingForm(
      form({ segment: '1.1', witnessId: 'w', lemma: 'θεὰ', reading: '', source: ' Allen ' }),
    );
    expect(omission).toEqual({
      ok: true,
      data: {
        segment: '1.1',
        witnessId: 'w',
        lemma: 'θεὰ',
        reading: '',
        source: 'Allen',
        note: null,
        published: false,
      },
    });
  });
});

describe('parseCitations', () => {
  it('reads the picker’s JSON, empty notes as null', () => {
    const json = JSON.stringify([
      { itemId: 'b1', prenote: 'cf.', postnote: ' 45 ' },
      { itemId: 'b2', prenote: null, postnote: '' },
    ]);
    expect(parseCitations(form({ citations: json }))).toEqual({
      ok: true,
      data: [
        { itemId: 'b1', prenote: 'cf.', postnote: '45' },
        { itemId: 'b2', prenote: null, postnote: null },
      ],
    });
    expect(parseCitations(form({}))).toEqual({ ok: true, data: [] });
    expect(parseCitations(form({ citations: '[]' }))).toEqual({ ok: true, data: [] });
  });

  it('refuses what the picker would not send', () => {
    expect(parseCitations(form({ citations: 'nonsense' })).ok).toBe(false);
    expect(parseCitations(form({ citations: JSON.stringify([{ itemId: '' }]) })).ok).toBe(false);
    expect(
      parseCitations(
        form({ citations: JSON.stringify([{ itemId: 'x', postnote: 'p'.repeat(101) }]) }),
      ).ok,
    ).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({ itemId: `b${i}` }));
    expect(parseCitations(form({ citations: JSON.stringify(many) })).ok).toBe(false);
    expect(parseCitations(form({ citations: JSON.stringify(many.slice(0, 20)) })).ok).toBe(true);
  });
});

describe('small helpers', () => {
  it('checks an email', () => {
    expect(parseEmail(form({ email: ' a@b.org ' }))).toEqual({
      ok: true,
      data: { email: 'a@b.org' },
    });
    expect(parseEmail(form({ email: 'nobody' })).ok).toBe(false);
  });

  it('sets a parameter on a local path', () => {
    expect(withParam('/works/iliad', 'witness', 'W1')).toBe('/works/iliad?witness=W1');
    expect(withParam('/works/iliad?tab=a#x', 'witness', 'W 2')).toBe(
      '/works/iliad?tab=a&witness=W+2#x',
    );
  });

  it('says what depends on an entry', () => {
    const editions = [
      { slug: 'a', title: 'Iliad 1', ownerName: 'Bob' },
      { slug: 'b', title: 'Iliad 2', ownerName: 'Eve' },
    ];
    expect(describeDependents({ editions, transcriptions: 2, records: 1 }, 'conjectures')).toBe(
      'the editions Iliad 1 and Iliad 2, 2 transcripts and a conjecture or reported reading',
    );
    expect(
      describeDependents({ editions: [editions[0]!], transcriptions: 0, records: 3 }, 'readings'),
    ).toBe('the edition Iliad 1 and 3 reported readings');
    expect(describeDependents({ editions: [], transcriptions: 1, records: 0 }, 'readings')).toBe(
      'a transcript',
    );
  });
});
