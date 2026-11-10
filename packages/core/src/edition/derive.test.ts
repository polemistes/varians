import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Token } from '../stream/items.ts';
import { fromText, toText } from '../stream/text.ts';
import { deriveEdition, deriveTranscription } from './derive.ts';

describe('deriveEdition', () => {
  it('prints read forms, keeps lines and segment starts, drops page breaks and marks', () => {
    const s = fromText('ΜΗΝΙΝ ΑΕΙΔΕ\nΘΕΑ', { ids: sequentialIds('a') });
    (s.items[0] as Token).norm = 'μῆνιν';
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[0] as Token).marks = [{ kind: 'unclear' }];
    s.items.splice(2, 0, { kind: 'break', id: 'pb', type: 'page', pageId: 'p1' });
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    expect(toText(e)).toBe('μῆνιν ΑΕΙΔΕ\nΘΕΑ');
    const first = e.items[0] as Token;
    expect(first.source).toEqual({ kind: 'witness', transcriptionId: 'T', tokenIds: ['a1'] });
    expect(first.segment).toEqual({ segmentId: 's1' });
    expect(first.marks).toBeUndefined();
    expect(
      e.items.filter((i) => i.kind === 'break').map((b) => (b as { type: string }).type),
    ).toEqual(['line']);
  });

  it('keeps only the segments asked for', () => {
    const s = fromText('a b\nc d\ne f', { ids: sequentialIds('a') });
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[3] as Token).segment = { segmentId: 's2' };
    (s.items[6] as Token).segment = { segmentId: 's3' };
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e'), segmentIds: new Set(['s2']) });
    expect(toText(e)).toBe('c d');
  });
});

describe('deriveEdition, divided words', () => {
  /** A witness text where a part marked with a trailing + joins the next token. */
  function witness(text: string): ReturnType<typeof fromText> {
    const s = fromText(text, { ids: sequentialIds('a') });
    for (const item of s.items) {
      if (item.kind === 'token' && item.form.endsWith('+')) {
        item.form = item.form.slice(0, -1);
        item.joinNext = true;
      }
    }
    return s;
  }

  it('keeps a word the witness divides at a line end as two joined parts, each with its segment start', () => {
    const s = witness('ανα+\nστασις δε');
    (s.items[0] as Token).segment = { segmentId: 's1' };
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    expect(e.items.map((i) => i.kind)).toEqual(['token', 'break', 'token', 'token']);
    const [a, , b] = e.items as Token[];
    expect([a!.form, a!.joinNext, a!.segment]).toEqual(['ανα', true, { segmentId: 's1' }]);
    expect([b!.form, b!.joinNext]).toEqual(['στασις', undefined]);
    expect(b!.source).toEqual({ kind: 'witness', transcriptionId: 'T', tokenIds: ['a3'] });
  });

  it('keeps a word divided where a segment begins, the second part with its own start', () => {
    const s = witness('ανα+ στασις');
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[1] as Token).segment = { segmentId: 's2' };
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    const [a, b] = e.items as Token[];
    expect(a!.joinNext).toBe(true);
    expect(b!.segment).toEqual({ segmentId: 's2' });
  });

  it('divides the normalized form of the whole word where the witness divides it, when the letters correspond', () => {
    const s = witness('ανα+\nστασις δε');
    (s.items[0] as Token).norm = 'ἀνάστασις';
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    const [a, , b] = e.items as Token[];
    expect([a!.form, a!.joinNext]).toEqual(['ἀνά', true]);
    expect(b!.form).toBe('στασις');
  });

  it('keeps the accents of the normalized form on the letters they stand on, wherever the witness divides', () => {
    const s = witness('ἀνασ+\nτασις');
    (s.items[0] as Token).norm = 'ἀνάστασις';
    const [a, , b] = deriveEdition(s, 'T', { ids: sequentialIds('e') }).items as Token[];
    expect([a!.form, b!.form]).toEqual(['ἀνάσ', 'τασις']);
  });

  it('has the word whole before the break where the letters do not correspond, and the next word begins the segment the second part began', () => {
    const s = witness('ανα+\nστσις δε');
    (s.items[0] as Token).norm = 'ἀνάστασις';
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[2] as Token).segment = { segmentId: 's2' };
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    expect(toText(e)).toBe('ἀνάστασις\nδε');
    const [a, , de] = e.items as Token[];
    expect(a!.joinNext).toBeUndefined();
    expect(a!.source).toEqual({ kind: 'witness', transcriptionId: 'T', tokenIds: ['a1', 'a3'] });
    expect(a!.segment).toEqual({ segmentId: 's1' });
    expect(de!.segment).toEqual({ segmentId: 's2' });
  });

  it('leaves no empty line where the second part stood alone on its line', () => {
    const s = witness('ανα+\nστσις\nδε');
    (s.items[0] as Token).norm = 'ἀνάστασις';
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    expect(toText(e)).toBe('ἀνάστασις\nδε');
  });

  it('keeps two words where the cut falls between the words of a normalized form', () => {
    const s = witness('ανα+\nμεσον');
    (s.items[0] as Token).norm = 'ἀνὰ μέσον';
    const [a, , b] = deriveEdition(s, 'T', { ids: sequentialIds('e') }).items as Token[];
    expect([a!.form, a!.joinNext, b!.form]).toEqual(['ἀνὰ', undefined, 'μέσον']);
  });

  it('keeps a part that begins with a break and a word whose parts are on a page and a column boundary', () => {
    const s = witness('ανα+\nστασις');
    s.items.splice(2, 0, { kind: 'break', id: 'pb', type: 'page', pageId: 'p1' });
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e') });
    expect(e.items.map((i) => i.kind)).toEqual(['token', 'break', 'token']);
    expect((e.items[0] as Token).joinNext).toBe(true);
  });

  it('drops a join that nothing follows where the range stops inside the word', () => {
    const s = witness('α β\nανα+\nστασις');
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[3] as Token).segment = { segmentId: 's2' };
    (s.items[5] as Token).segment = { segmentId: 's3' };
    const e = deriveEdition(s, 'T', { ids: sequentialIds('e'), segmentIds: new Set(['s2']) });
    expect(toText(e)).toBe('ανα');
    expect((e.items[0] as Token).joinNext).toBeUndefined();
  });
});

describe('deriveTranscription', () => {
  it('copies everything with new ids and no sources', () => {
    const s = fromText('a b', { ids: sequentialIds('a') });
    (s.items[0] as Token).source = { kind: 'editor' };
    (s.items[0] as Token).marks = [{ kind: 'unclear' }];
    const t = deriveTranscription(s, { ids: sequentialIds('n') });
    expect(t.items.map((i) => i.id)).toEqual(['n1', 'n2']);
    expect((t.items[0] as Token).marks).toEqual([{ kind: 'unclear' }]);
    expect((t.items[0] as Token).source).toBeUndefined();
    expect(toText(t)).toBe('a b');
  });
});
