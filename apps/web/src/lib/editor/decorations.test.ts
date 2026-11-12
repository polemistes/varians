import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Break, type Stream, type Token } from '@varians/core';
import { buildDecorations, languageStarts } from './decorations.ts';
import { buildModel } from './model.ts';

/** "arma virumque" in Latin, "μῆνιν ἄειδε" in Greek on the next line, "cano" in Latin, then a word without a language. */
function mixed(): Stream {
  const s = fromText('arma virumque\nμῆνιν ἄειδε cano x', { lang: 'la', ids: sequentialIds() });
  for (const item of s.items) {
    if (item.kind !== 'token') continue;
    if (item.form === 'μῆνιν' || item.form === 'ἄειδε') item.lang = 'grc';
    if (item.form === 'x') delete item.lang;
  }
  return s;
}

const form = (s: Stream, id: string) => (s.items.find((i) => i.id === id) as Token).form;

describe('languageStarts', () => {
  it('names the first word and every word in another language than the word before, across lines', () => {
    const s = mixed();
    const starts = languageStarts(buildModel(s, { form: 'written' }));
    expect(starts.map((x) => [form(s, x.id), x.lang])).toEqual([
      ['arma', 'la'],
      ['μῆνιν', 'grc'],
      ['cano', 'la'],
    ]);
  });

  it('names the first word of a page shown alone, whatever the page before is in', () => {
    const s = fromText('a b\nc d', { lang: 'grc', ids: sequentialIds() });
    const brk = s.items.find((i) => i.kind === 'break') as Break;
    brk.type = 'page';
    brk.pageId = 'p1';
    const starts = languageStarts(buildModel(s, { form: 'written', page: 'p1' }));
    expect(starts.map((x) => form(s, x.id))).toEqual(['c']);
  });

  it('names nothing in a text without a language', () => {
    const s = fromText('a b', { lang: 'la', ids: sequentialIds() });
    for (const item of s.items) if (item.kind === 'token') delete item.lang;
    expect(languageStarts(buildModel(s, { form: 'written' }))).toEqual([]);
  });

  it('puts a label before each of those words', () => {
    const model = buildModel(mixed(), { form: 'written' });
    const labels: [number, string][] = [];
    buildDecorations(model, false).between(0, model.ledger.text.length, (from, _to, deco) => {
      const widget = deco.spec.widget as { lang?: string } | undefined;
      if (widget?.lang) labels.push([from, widget.lang]);
    });
    expect(labels).toEqual(languageStarts(model).map((x) => [x.from, x.lang]));
  });
});
