import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { toText } from '../stream/text.ts';
import { detectNumbering, importPlainText } from './plaintext.ts';

const prose =
  '1 Ἐπειδὴ πάντες ἄνθρωποι τοῦ εἰδέναι ὀρέγονται φύσει.\n' +
  '2 σημεῖον δ᾽ ἡ τῶν αἰσθήσεων ἀγάπησις.\n' +
  '3 καὶ γὰρ χωρὶς τῆς χρείας ἀγαπῶνται.';

const verse = [
  'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος',
  'οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,',
  'πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν',
  'ἡρώων, αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν',
  'οἰωνοῖσί τε πᾶσι, Διὸς δ᾽ ἐτελείετο βουλή,',
  'ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε',
  'Ἀτρεΐδης τε ἄναξ ἀνδρῶν καὶ δῖος Ἀχιλλεύς.',
  'τίς τ᾽ ἄρ σφωε θεῶν ἔριδι ξυνέηκε μάχεσθαι;',
  'Λητοῦς καὶ Διὸς υἱός: ὃ γὰρ βασιλῆι χολωθεὶς',
  'νοῦσον ἀνὰ στρατὸν ὄρσε κακήν, ὀλέκοντο δὲ λαοί,',
];

describe('detectNumbering', () => {
  it('finds numbers at the start of lines', () => {
    const [first] = detectNumbering(prose);
    expect(first).toMatchObject({ kind: 'line-start-number', matches: 3, sample: '1' });
  });

  it('finds bracketed numbers anywhere', () => {
    const text =
      '[1] Ἐπειδὴ πάντες ἄνθρωποι [2] σημεῖον δ᾽ ἡ τῶν αἰσθήσεων\n[3] καὶ γὰρ χωρὶς τῆς χρείας';
    const [first] = detectNumbering(text);
    expect(first).toMatchObject({ kind: 'bracketed', matches: 3, sample: '1' });
  });

  it('proposes numbering every line of unnumbered verse', () => {
    const patterns = detectNumbering(verse.slice(0, 4).join('\n'));
    expect(patterns.map((p) => p.kind)).toEqual(['every-line']);
    expect(patterns[0]).toMatchObject({ matches: 4, sample: verse[0] });
  });

  it('finds margin numbers on every fifth line, at the start or the end', () => {
    const text = verse.map((line, i) => ((i + 1) % 5 === 0 ? `${line} ${i + 1}` : line)).join('\n');
    const patterns = detectNumbering(text);
    expect(patterns.map((p) => p.kind)).toEqual(['margin-every-n', 'every-line']);
    expect(patterns[0]).toMatchObject({ matches: 2, sample: '5', interval: 5 });
  });

  it('reads Bekker and Stephanus labels', () => {
    expect(
      detectNumbering(
        '1094a1 Πᾶσα τέχνη καὶ πᾶσα μέθοδος\n1094a2 ὁμοίως δὲ πρᾶξις τε καὶ προαίρεσις',
      )[0],
    ).toMatchObject({
      kind: 'line-start-number',
      sample: '1094a1',
    });
    expect(detectNumbering('17a. Ἀκήκοα μὲν ἔγωγε\n17b. ὥστε καὶ αὐτός')[0]).toMatchObject({
      kind: 'line-start-number',
      sample: '17a',
    });
  });

  it('finds nothing in unnumbered prose with long lines', () => {
    const line =
      'Ἐπειδὴ πάντες ἄνθρωποι τοῦ εἰδέναι ὀρέγονται φύσει. σημεῖον δ᾽ ἡ τῶν αἰσθήσεων ἀγάπησις καὶ γὰρ χωρὶς τῆς χρείας ἀγαπῶνται δι᾽ αὑτάς.';
    expect(detectNumbering(`${line}\n${line}`)).toEqual([]);
    expect(detectNumbering('')).toEqual([]);
  });
});

describe('importPlainText', () => {
  it('strips line-start numbers and labels the first token after each', () => {
    const text = '1 Ἐπειδὴ πάντες ἄνθρωποι\nτοῦ εἰδέναι ὀρέγονται\n2 σημεῖον δὲ';
    const [pattern] = detectNumbering(text);
    const result = importPlainText(text, { pattern, ids: sequentialIds() });
    expect(toText(result.stream)).toBe('Ἐπειδὴ πάντες ἄνθρωποι\nτοῦ εἰδέναι ὀρέγονται\nσημεῖον δὲ');
    expect(result.segmentStarts).toEqual([
      { itemIndex: 0, label: '1' },
      { itemIndex: 8, label: '2' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('strips bracketed numbers in the middle of a line', () => {
    const text = '[1] Ἐπειδὴ πάντες [2] σημεῖον δὲ\n[3] καὶ γάρ';
    const [pattern] = detectNumbering(text);
    const result = importPlainText(text, { pattern, ids: sequentialIds() });
    expect(toText(result.stream)).toBe('Ἐπειδὴ πάντες σημεῖον δὲ\nκαὶ γάρ');
    expect(result.segmentStarts).toEqual([
      { itemIndex: 0, label: '1' },
      { itemIndex: 2, label: '2' },
      { itemIndex: 5, label: '3' },
    ]);
  });

  it('numbers every line from a start label, skipping blank lines and keeping paragraph breaks', () => {
    const text = 'μῆνιν ἄειδε θεὰ\nοὐλομένην ἣ\n\nπολλὰς δ᾽';
    const [pattern] = detectNumbering(text);
    expect(pattern?.kind).toBe('every-line');
    const result = importPlainText(text, {
      pattern,
      ids: sequentialIds(),
      startLabel: '1.1',
      paragraphs: true,
    });
    expect(
      result.stream.items
        .filter((i) => i.kind === 'break')
        .map((b) => (b as { type: string }).type),
    ).toEqual(['line', 'paragraph']);
    expect(result.segmentStarts).toEqual([
      { itemIndex: 0, label: '1.1' },
      { itemIndex: 4, label: '1.2' },
      { itemIndex: 7, label: '1.3' },
    ]);
  });

  it('needs a start label to number every line', () => {
    const result = importPlainText('a\nb', {
      pattern: { kind: 'every-line', regex: '^.+$', matches: 2, sample: 'a' },
    });
    expect(result.segmentStarts).toEqual([]);
    expect(result.warnings).toEqual(['Numbering every line needs a start label.']);
  });

  it('counts the lines between margin numbers and checks the count', () => {
    const text = verse.map((line, i) => ((i + 1) % 5 === 0 ? `${line} ${i + 1}` : line)).join('\n');
    const [pattern] = detectNumbering(text);
    const result = importPlainText(text, { pattern, ids: sequentialIds(), startLabel: '1' });
    expect(toText(result.stream)).toBe(verse.join('\n'));
    expect(result.segmentStarts.map((s) => s.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    const firstTokens = result.stream.items
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item, index }) =>
          item.kind === 'token' &&
          (index === 0 || result.stream.items[index - 1]!.kind === 'break'),
      )
      .map(({ index }) => index);
    expect(result.segmentStarts.map((s) => s.itemIndex)).toEqual(firstTokens);
    expect(result.warnings).toEqual([]);

    const wrong = importPlainText(text.replace(/ 10$/u, ' 11'), { pattern, startLabel: '1' });
    expect(wrong.warnings).toEqual([
      'Line 10 is numbered 11, but counting from the previous number gives 10.',
    ]);
    expect(wrong.segmentStarts[9]?.label).toBe('11');
  });

  it('leaves the lines before the first margin number unlabelled without a start label', () => {
    const text = verse.map((line, i) => ((i + 1) % 5 === 0 ? `${i + 1} ${line}` : line)).join('\n');
    const [pattern] = detectNumbering(text);
    expect(pattern?.kind).toBe('margin-every-n');
    const result = importPlainText(text, { pattern });
    expect(result.segmentStarts.map((s) => s.label)).toEqual(['5', '6', '7', '8', '9', '10']);
    expect(result.warnings).toEqual([
      '4 lines before the first number have no label; give a start label to count them.',
    ]);
  });

  it('uses the caller’s label sequence and stops when it ends', () => {
    const text = 'α β\nγ δ\nε ζ';
    const labels = ['3.1', '3.2'];
    const result = importPlainText(text, {
      pattern: { kind: 'every-line', regex: '^.+$', matches: 3, sample: 'α β' },
      startLabel: '3.1',
      nextLabel: (label) => labels[labels.indexOf(label) + 1] ?? null,
    });
    expect(result.segmentStarts.map((s) => s.label)).toEqual(['3.1', '3.2']);
    expect(result.warnings).toEqual(['No label follows 3.2; the remaining lines are unlabelled.']);
  });

  it('keeps the labels in step with hyphen joins', () => {
    const text = '1 ἄνδ-\nρα μοι\n2 ἔννεπε';
    const [pattern] = detectNumbering(text);
    const result = importPlainText(text, { pattern, ids: sequentialIds(), hyphenJoins: true });
    expect(result.stream.items[0]).toMatchObject({ form: 'ἄνδ', joinNext: true });
    expect(result.segmentStarts).toEqual([
      { itemIndex: 0, label: '1' },
      { itemIndex: 5, label: '2' },
    ]);
  });

  it('warns about labels with no text after them and about repeated labels', () => {
    const pattern = detectNumbering('[1] a [2] b')[0];
    const dangling = importPlainText('Ἐπειδὴ πάντες [2]', { pattern });
    expect(dangling.segmentStarts).toEqual([]);
    expect(dangling.warnings).toEqual(['Label 2 has no text after it and was dropped.']);

    const empty = importPlainText('[1] [2] Ἐπειδὴ', { pattern });
    expect(empty.segmentStarts).toEqual([{ itemIndex: 0, label: '2' }]);
    expect(empty.warnings).toEqual(['Label 1 has no text before label 2 and was dropped.']);

    const repeated = importPlainText('[1] a [1] b', { pattern });
    expect(repeated.warnings).toEqual(['Label 1 appears more than once.']);
  });

  it('imports without a pattern as plain text', () => {
    const result = importPlainText('μῆνιν ἄειδε\nθεά', { ids: sequentialIds() });
    expect(toText(result.stream)).toBe('μῆνιν ἄειδε\nθεά');
    expect(result.segmentStarts).toEqual([]);
  });

  it('reports an unusable regular expression', () => {
    const result = importPlainText('1 a', {
      pattern: { kind: 'line-start-number', regex: '(', matches: 1, sample: '1' },
    });
    expect(result.warnings[0]).toMatch(/not a valid regular expression/u);
    expect(toText(result.stream)).toBe('1 a');
  });
});
